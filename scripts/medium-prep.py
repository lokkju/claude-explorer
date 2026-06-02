#!/usr/bin/env python3
"""Transform an article .md into a Medium-ready, paste-able HTML file.

Medium can't resolve relative image paths, doesn't render raw Markdown, and
ignores our in-repo TOC anchors and relative cross-links. So for each article we
emit ``medium-build/<name>.medium.html`` with:

  * **Absolute image URLs.** ``![](Attachments/x.png)`` and
    ``<img src="Attachments/x.png">`` -> the file's ``raw.githubusercontent`` URL.
    On paste, Medium fetches and re-hosts these automatically (the bulk of the win).
  * **TOC + anchors removed.** The ``## Contents`` block and every
    ``<a id="..."></a>`` are dropped (Medium assigns its own block ids).
  * **Cross-links resolved.** ``http(s)`` links pass through. Relative ``.md``
    links use ``MEDIUM_URLS`` if the target is already published; otherwise the
    link is stripped and the visible text kept (per the medium-articles.md
    publish-step decision).
  * **Rendered to standalone HTML** via pandoc (GFM), ready to open + copy.

USAGE
    python3 scripts/medium-prep.py articles/part_2_web_app_userdoc.md

THEN (the manual, Medium-side steps)
    1. open  medium-build/<name>.medium.html  in a browser
    2. Select-All (Cmd-A), Copy (Cmd-C)
    3. new Medium story -> Paste (Cmd-V); Medium pulls text + every image
    4. set title/subtitle; resize the narrow crops in Medium's editor (Medium
       normalizes image size on import regardless of source width)
    5. add code-block language hints if Medium dropped them; eyeball the lede/disclaimer

Re-run any time the source changes; output is regenerated.
"""
from __future__ import annotations
import os
import re
import subprocess
import sys

RAW_BASE = "https://raw.githubusercontent.com/rpeck/claude-explorer/main/articles/"

# Published Medium URLs, keyed by relative .md target. Fill in as parts ship;
# unlisted relative .md links get stripped to plain text.
MEDIUM_URLS: dict[str, str] = {
    # "part_2_web_app_userdoc.md": "https://medium.com/@raymondpeck/...",
}

OUT_DIR = "medium-build"


def strip_toc(text: str) -> str:
    out, lines, i = [], text.split("\n"), 0
    while i < len(lines):
        if lines[i].strip() == "## Contents":
            i += 1
            while i < len(lines) and (
                lines[i].strip() == "" or re.match(r"^- \[.*\]\(#.*\)\s*$", lines[i].strip())
            ):
                i += 1
            continue
        out.append(lines[i])
        i += 1
    return "\n".join(out)


def strip_anchors(text: str) -> str:
    return "\n".join(
        l for l in text.split("\n") if not re.match(r'^\s*<a id="[^"]*">\s*</a>\s*$', l)
    )


def absolutize_images(text: str) -> int:
    n = 0

    def md(m):
        nonlocal n
        n += 1
        return f"{m.group(1)}{RAW_BASE}Attachments/{m.group(2)}{m.group(3)}"

    def html(m):
        nonlocal n
        n += 1
        return f'{m.group(1)}{RAW_BASE}Attachments/{m.group(2)}{m.group(3)}'

    text = re.sub(r"(!\[[^\]]*\]\()Attachments/([^)]+)(\))", md, text)
    text = re.sub(r'(<img[^>]*\bsrc=")Attachments/([^"]+)(")', html, text)
    return text, n


def fix_md_links(text: str) -> tuple[str, int, int]:
    mapped = stripped = 0

    def repl(m):
        nonlocal mapped, stripped
        label, target = m.group(1), m.group(2)
        if target in MEDIUM_URLS:
            mapped += 1
            return f"[{label}]({MEDIUM_URLS[target]})"
        stripped += 1
        return label

    text = re.sub(r"\[([^\]]+)\]\(([a-z0-9_]+\.md)\)", repl, text)
    return text, mapped, stripped


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: python3 scripts/medium-prep.py <article.md>")
        return 2
    src = sys.argv[1]
    text = open(src, encoding="utf-8").read()
    text = re.sub(r"^<!--.*?-->\n+", "", text, count=1, flags=re.DOTALL)  # drop provenance header
    text = strip_toc(text)
    text = strip_anchors(text)
    text, n_img = absolutize_images(text)
    text, n_map, n_strip = fix_md_links(text)

    os.makedirs(OUT_DIR, exist_ok=True)
    base = os.path.splitext(os.path.basename(src))[0]
    out_md = os.path.join(OUT_DIR, f"{base}.medium.md")
    out_html = os.path.join(OUT_DIR, f"{base}.medium.html")
    with open(out_md, "w", encoding="utf-8") as f:
        f.write(text)
    subprocess.run(
        ["pandoc", "-f", "gfm", "-t", "html", "-s", "--metadata", f"title={base}", "-o", out_html],
        input=text, text=True, check=True,
    )
    print(f"✓ wrote {out_md}   (open in Obsidian -> reading view -> copy)")
    print(f"✓ wrote {out_html}  (fallback: open in browser -> copy)")
    print(f"    images -> absolute raw URLs : {n_img}")
    print(f"    relative .md links          : {n_map} mapped to Medium, {n_strip} stripped to text")
    print(f"    TOC + <a id> anchors        : removed")
    print(f"\n  Paste into a new Medium story; Medium fetches every absolute-URL image.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
