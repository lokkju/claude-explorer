"""Export functionality for Markdown and PDF."""

import base64
import io
import re
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

from .models import ConversationDetail, Message, ContentBlock


# Issue #4 — Markdown export dialects for the bundled-zip variant.
# CommonMark uses standard ![alt](path); Obsidian uses ![[path]]
# wikilinks. Both Obsidian and GitHub render plain CommonMark so
# CommonMark covers GitHub/MacDown/most others by default.
MarkdownDialect = Literal["commonmark", "obsidian"]


def sanitize_filename(name: str) -> str:
    """Sanitize a string to be safe for use as a filename."""
    # Remove or replace invalid characters
    sanitized = re.sub(r'[<>:"/\\|?*]', "", name)
    # Replace whitespace with underscores
    sanitized = re.sub(r"\s+", "_", sanitized)
    # Limit length
    if len(sanitized) > 100:
        sanitized = sanitized[:100]
    return sanitized or "conversation"


def format_timestamp(dt: datetime) -> str:
    """Format a datetime for display."""
    return dt.strftime("%Y-%m-%d %H:%M")


# Placeholder text that Claude Desktop uses for tool calls
TOOL_PLACEHOLDER = "This block is not supported on your current device yet."


def filter_tool_placeholders(text: str) -> str:
    """Strip Claude Desktop's TOOL_PLACEHOLDER everywhere in ``text``.

    Mirrors the frontend canonical algorithm in
    ``frontend/src/components/message/MarkdownRenderer.tsx::stripToolPlaceholderText``
    (P1.3a/P1.3b — keep the two in sync).

    Behaviour:

    * Walks the text line-by-line, tracking whether we're inside a
      fenced code block (toggled by any line whose first non-whitespace
      content is ``\`\`\``).
    * **Outside a fence**: drop ALL occurrences of TOOL_PLACEHOLDER
      anywhere on the line (line-anchored OR mid-paragraph). If the
      line was non-empty before the strip but whitespace-only after,
      drop the whole line so we don't leave a phantom blank paragraph.
    * **Inside a fence**: the frontend leaves the placeholder intact
      so its ``code`` component can render a friendly badge in its
      place. The backend export surfaces (Markdown + PDF) have no such
      badge — the literal string would just leak to the recipient — so
      we strip it inside fences too. If after stripping the fence
      block is empty (``\`\`\`\n\n\`\`\``-like), the surrounding fence
      lines are left in place; downstream renderers handle empty code
      blocks fine.

    After the line walk we collapse 3-or-more consecutive newlines
    down to a single paragraph break, matching the frontend.
    """
    if TOOL_PLACEHOLDER not in text:
        return text

    lines = text.split("\n")
    out: list[str] = []
    in_fence = False
    fence_open_idx: int | None = None  # index in `out` of the most recent ``` we kept

    for line in lines:
        stripped_line = line.lstrip()
        is_fence_marker = stripped_line.startswith("```")

        if is_fence_marker:
            if not in_fence:
                in_fence = True
                fence_open_idx = len(out)
                out.append(line)
            else:
                in_fence = False
                # If the fence we're closing wrapped only stripped /
                # blank content, drop the whole fence (open + body +
                # close) so we don't leave an empty ``` ``` block
                # behind. This is the common Claude Desktop shape.
                if fence_open_idx is not None:
                    body = out[fence_open_idx + 1 :]
                    if all(b.strip() == "" for b in body):
                        del out[fence_open_idx:]
                        fence_open_idx = None
                        continue
                fence_open_idx = None
                out.append(line)
            continue

        # Non-fence line: strip ALL occurrences regardless of fence
        # state (see docstring re: backend has no badge surface).
        had_content = line.strip() != ""
        stripped = line.replace(TOOL_PLACEHOLDER, "")
        if had_content and stripped.strip() == "":
            # Line was only the placeholder (plus whitespace) — drop it.
            continue
        out.append(stripped)

    filtered = "\n".join(out)
    # Collapse runs of blank lines to a single paragraph break.
    filtered = re.sub(r"\n{3,}", "\n\n", filtered)
    return filtered


def render_content_block(
    block: ContentBlock, indent: int = 0, include_tools: bool = True
) -> str:
    """Render a content block to Markdown."""
    prefix = "  " * indent

    if block.type == "text" and block.text:
        # Always strip TOOL_PLACEHOLDER from text content blocks
        # (P1.3b — the placeholder must never reach the recipient
        # regardless of include_tools).
        return filter_tool_placeholders(block.text)

    if block.type == "tool_use":
        if not include_tools:
            return ""
        lines = [f"{prefix}**Tool: {block.name}**"]
        if block.input:
            import json

            input_str = json.dumps(block.input, indent=2)
            lines.append(f"{prefix}```json\n{input_str}\n{prefix}```")
        return "\n".join(lines)

    if block.type == "tool_result" and block.content:
        if not include_tools:
            return ""
        lines = [f"{prefix}<details>", f"{prefix}<summary>Tool Result</summary>", ""]
        for child in block.content:
            lines.append(render_content_block(child, indent + 1, include_tools))
        lines.extend(["", f"{prefix}</details>"])
        return "\n".join(lines)

    return ""


def message_has_visible_content(message: Message, include_tools: bool = True) -> bool:
    """Check if a message has any visible content (considering tool call visibility).

    A message with image attachments is always visible (Council Q7: images
    are primary content, not gated by toggles).
    """
    # Forward declaration: _dedupe_image_files is defined later in this
    # module. The check is cheap (list membership) and avoids restructuring
    # the existing function order.
    if _dedupe_image_files(message):
        return True
    if message.text and message.text.strip():
        if not include_tools:
            filtered = filter_tool_placeholders(message.text).strip()
            if not filtered:
                return False
        return True
    if message.content:
        for block in message.content:
            if block.type == "text" and block.text and block.text.strip():
                return True
            if block.type in ("tool_use", "tool_result") and include_tools:
                return True
    return False


def _dedupe_image_files(message: Message) -> list[dict[str, Any]]:
    """Merge files + files_v2 and dedupe by file_uuid; image files only."""
    merged: list[dict[str, Any]] = []
    for raw in (message.files or []) + (getattr(message, "files_v2", None) or []):
        if isinstance(raw, dict) and raw.get("file_kind") == "image":
            merged.append(raw)
    by_uuid: dict[str, dict[str, Any]] = {}
    for f in merged:
        uuid = f.get("file_uuid") or f.get("file_name") or ""
        existing = by_uuid.get(uuid)
        if not existing:
            by_uuid[uuid] = f
            continue
        # Prefer the entry with a preview_asset.url present.
        existing_url = (existing.get("preview_asset") or {}).get("url")
        new_url = (f.get("preview_asset") or {}).get("url")
        if not existing_url and new_url:
            by_uuid[uuid] = f
    return list(by_uuid.values())


def _image_markdown(message: Message) -> str:
    """Render image attachments as Markdown image refs (after content)."""
    images = _dedupe_image_files(message)
    if not images:
        return ""
    lines: list[str] = [""]
    for img in images:
        url = (img.get("preview_asset") or {}).get("url") or img.get("thumbnail_url") or ""
        name = img.get("file_name") or "image"
        alt = f"Image attachment: {name}"
        if url:
            lines.append(f"![{alt}]({url})")
        else:
            lines.append(f"_(image attachment unavailable: {name})_")
        lines.append("")
    return "\n".join(lines)


def message_to_markdown(message: Message, include_tools: bool = True) -> str:
    """Convert a single message to Markdown."""
    sender = "You" if message.sender == "human" else "Claude"
    timestamp = format_timestamp(message.created_at)

    lines = [f"**{sender}:** *{timestamp}*", ""]

    # Render content blocks
    if message.content:
        for block in message.content:
            rendered = render_content_block(block, include_tools=include_tools)
            if rendered:
                lines.append(rendered)
    elif message.text:
        # Always strip TOOL_PLACEHOLDER (P1.3b — it represents an
        # uncaptured tool call/artifact and the recipient should never
        # see the literal string, regardless of include_tools).
        lines.append(filter_tool_placeholders(message.text))

    # Image attachments (always rendered, regardless of include_tools).
    image_md = _image_markdown(message)
    if image_md:
        lines.append(image_md)

    lines.append("")
    lines.append("---")
    lines.append("")

    return "\n".join(lines)


def conversation_to_markdown(
    conversation: ConversationDetail, include_tools: bool = True
) -> str:
    """Convert a conversation to Markdown."""
    lines = [
        f"# {conversation.name}",
        "",
        f"**Model:** {conversation.model}",
        f"**Created:** {format_timestamp(conversation.created_at)}",
        f"**Messages:** {conversation.message_count}",
        "",
        "---",
        "",
    ]

    for message in conversation.messages:
        if message_has_visible_content(message, include_tools):
            lines.append(message_to_markdown(message, include_tools))

    return "\n".join(lines)


def conversation_to_html(
    conversation: ConversationDetail, include_tools: bool = True
) -> str:
    """Convert a conversation to HTML for PDF rendering."""
    # Basic HTML template with embedded CSS
    html = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>{conversation.name}</title>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 800px;
            margin: 40px auto;
            padding: 20px;
            line-height: 1.6;
            color: #333;
        }}
        h1 {{
            border-bottom: 2px solid #eee;
            padding-bottom: 10px;
        }}
        .meta {{
            color: #666;
            font-size: 14px;
            margin-bottom: 30px;
        }}
        .message {{
            margin-bottom: 24px;
            padding: 16px;
            border-radius: 8px;
        }}
        .message.human {{
            background: #e3f2fd;
        }}
        .message.assistant {{
            background: #f5f5f5;
        }}
        .message-header {{
            font-weight: bold;
            margin-bottom: 8px;
            color: #555;
        }}
        .message-header .timestamp {{
            font-weight: normal;
            font-size: 12px;
            color: #888;
        }}
        .message-content {{
            white-space: pre-wrap;
        }}
        pre {{
            background: #f8f8f8;
            border: 1px solid #ddd;
            border-radius: 4px;
            padding: 12px;
            overflow-x: auto;
            font-size: 13px;
        }}
        code {{
            font-family: 'SF Mono', 'Fira Code', monospace;
        }}
        .tool-use {{
            background: #fff3e0;
            border: 1px solid #ffb74d;
            border-radius: 4px;
            padding: 12px;
            margin: 8px 0;
        }}
        .tool-result {{
            background: #e8f5e9;
            border: 1px solid #81c784;
            border-radius: 4px;
            padding: 12px;
            margin: 8px 0;
        }}
        hr {{
            border: none;
            border-top: 1px solid #eee;
            margin: 20px 0;
        }}
    </style>
</head>
<body>
    <h1>{conversation.name}</h1>
    <div class="meta">
        <strong>Model:</strong> {conversation.model}<br>
        <strong>Created:</strong> {format_timestamp(conversation.created_at)}<br>
        <strong>Messages:</strong> {conversation.message_count}
    </div>
"""

    for message in conversation.messages:
        if not message_has_visible_content(message, include_tools):
            continue

        sender = "You" if message.sender == "human" else "Claude"
        timestamp = format_timestamp(message.created_at)

        # Get message content
        content_html = ""
        if message.content:
            for block in message.content:
                content_html += render_content_block_html(block, include_tools)
        elif message.text:
            # Always strip TOOL_PLACEHOLDER before HTML escape (P1.3b).
            text = filter_tool_placeholders(message.text)
            content_html = escape_html(text)

        # Append image attachments (always, never gated by include_tools).
        # Mirrors the Markdown export's _image_markdown helper so the PDF
        # surface stays in sync with viewer + Markdown ("one truth, three
        # surfaces").
        images_html = _image_html(message)

        html += f"""
    <div class="message {message.sender}">
        <div class="message-header">
            {sender} <span class="timestamp">{timestamp}</span>
        </div>
        <div class="message-content">{content_html}{images_html}</div>
    </div>
"""

    html += """
</body>
</html>
"""
    return html


def escape_html(text: str) -> str:
    """Escape HTML special characters."""
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _image_html(message: Message) -> str:
    """Render the message's image attachments as an HTML block.

    WeasyPrint accepts both data: URIs and absolute http(s) URLs. Our
    image URLs are claude.ai-relative (``/api/...``); WeasyPrint can't
    fetch those directly, so we wrap each image in a <p> with the
    filename as a fallback caption when the URL fails to resolve.
    """
    images = _dedupe_image_files(message)
    if not images:
        return ""
    parts: list[str] = ['<div class="attachments">']
    for img in images:
        url = (img.get("preview_asset") or {}).get("url") or img.get("thumbnail_url") or ""
        name = img.get("file_name") or "image"
        alt = f"Image attachment: {name}"
        if url:
            parts.append(
                f'<figure class="attachment">'
                f'<img src="{escape_html(url)}" alt="{escape_html(alt)}" '
                f'style="max-width:100%;max-height:480px;height:auto;display:block;" />'
                f'<figcaption style="font-size:11px;color:#666;">{escape_html(name)}</figcaption>'
                f"</figure>"
            )
        else:
            parts.append(
                f'<p class="attachment-missing"><em>(image attachment unavailable: '
                f"{escape_html(name)})</em></p>"
            )
    parts.append("</div>")
    return "".join(parts)


def render_content_block_html(block: ContentBlock, include_tools: bool = True) -> str:
    """Render a content block to HTML."""
    if block.type == "text" and block.text:
        # Always strip TOOL_PLACEHOLDER (P1.3b).
        return escape_html(filter_tool_placeholders(block.text))

    if block.type == "tool_use":
        if not include_tools:
            return ""
        import json

        input_str = json.dumps(block.input, indent=2) if block.input else ""
        return f"""
        <div class="tool-use">
            <strong>Tool: {escape_html(block.name or '')}</strong>
            <pre><code>{escape_html(input_str)}</code></pre>
        </div>
        """

    if block.type == "tool_result" and block.content:
        if not include_tools:
            return ""
        result_html = ""
        for child in block.content:
            result_html += render_content_block_html(child, include_tools)
        return f"""
        <div class="tool-result">
            <strong>Tool Result</strong>
            {result_html}
        </div>
        """

    return ""


def create_pdf(conversation: ConversationDetail, include_tools: bool = True) -> bytes:
    """Create a PDF from a conversation using WeasyPrint."""
    try:
        from weasyprint import HTML
    except ImportError:
        raise RuntimeError(
            "WeasyPrint is required for PDF export. Install with: pip install weasyprint"
        )

    html_content = conversation_to_html(conversation, include_tools)
    pdf_bytes = HTML(string=html_content).write_pdf()
    return pdf_bytes


def create_markdown_zip(conversations: list[ConversationDetail]) -> bytes:
    """Create a ZIP file containing all conversations as Markdown."""
    buffer = io.BytesIO()

    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for conv in conversations:
            filename = f"{sanitize_filename(conv.name)}.md"
            content = conversation_to_markdown(conv)
            zf.writestr(filename, content.encode("utf-8"))

    buffer.seek(0)
    return buffer.read()


# ----------------------------------------------------------------------
# Issue #4 — Markdown BUNDLE export (zip with conversation.md +
# images/<filename> + relative refs). Lets the user package a
# conversation for emailing to a colleague without the local backend.
# ----------------------------------------------------------------------


CC_IMAGE_MARKER_RE = re.compile(r"\[Image: source: ([^\]]+)\]")


def _image_marker_path_is_safe(path: Path, image_cache_root: Path) -> bool:
    """Refuse paths that resolve outside the user's Claude Code image
    cache directory. Mirrors backend.routers.files.get_cc_image."""
    try:
        resolved = path.expanduser().resolve(strict=True)
        resolved.relative_to(image_cache_root.resolve())
    except (FileNotFoundError, OSError, ValueError):
        return False
    return True


def _markdown_image_ref(rel_path: str, alt: str, dialect: MarkdownDialect) -> str:
    """Render an image ref in the chosen dialect."""
    if dialect == "obsidian":
        return f"![[{rel_path}]]"
    return f"![{alt}]({rel_path})"


def _bundle_block_to_markdown(
    block: ContentBlock,
    *,
    include_tools: bool,
    bundle_index: dict[str, str],  # cc-image source key -> images/<filename>
    bundled_alts: dict[str, str],
    dialect: MarkdownDialect,
) -> str:
    """Variant of render_content_block that knows how to swap image
    refs for bundle-relative paths.

    For text blocks: replace each ``[Image: source: <abs-path>]`` marker
    with the chosen-dialect image ref pointing at the bundled copy
    (or a clear fallback if the source path was rejected/missing).

    For inline image content blocks: emit the image ref directly.
    """
    if block.type == "text" and block.text:
        def _swap(match: re.Match[str]) -> str:
            key = f"marker:{match.group(1).strip()}"
            rel = bundle_index.get(key)
            if rel:
                alt = bundled_alts.get(key, "image")
                return _markdown_image_ref(rel, alt, dialect)
            return f"_(image not bundled: {match.group(1).strip()})_"

        # Always strip TOOL_PLACEHOLDER from bundled text (P1.3b).
        return CC_IMAGE_MARKER_RE.sub(_swap, filter_tool_placeholders(block.text))

    if block.type == "image":
        # Inline image content block. The bundle index keys these by the
        # message-position-derived id passed in via bundled_alts/index
        # — the caller pre-populated bundle_index for every inline
        # image in the conversation.
        # We don't know the block's identity from here, so the caller
        # also injects a synthetic textual placeholder we can resolve.
        return ""  # Handled at the message level; see _bundle_message_to_markdown

    if block.type == "tool_use":
        if not include_tools:
            return ""
        import json

        lines = [f"**Tool: {block.name}**"]
        if block.input:
            input_str = json.dumps(block.input, indent=2)
            lines.append(f"```json\n{input_str}\n```")
        return "\n".join(lines)

    if block.type == "tool_result" and block.content:
        if not include_tools:
            return ""
        lines = ["<details>", "<summary>Tool Result</summary>", ""]
        for child in block.content:
            rendered = _bundle_block_to_markdown(
                child,
                include_tools=include_tools,
                bundle_index=bundle_index,
                bundled_alts=bundled_alts,
                dialect=dialect,
            )
            if rendered:
                lines.append(rendered)
        lines.extend(["", "</details>"])
        return "\n".join(lines)

    return ""


def _bundle_message_to_markdown(
    message: Message,
    *,
    include_tools: bool,
    inline_image_refs: dict[int, str],  # block_index -> images/<filename>
    bundle_index: dict[str, str],
    bundled_alts: dict[str, str],
    dialect: MarkdownDialect,
) -> str:
    """Render one message for the bundle, swapping CC image refs for
    bundle-relative paths and inserting inline-image refs at their
    block position."""
    sender = "You" if message.sender == "human" else "Claude"
    timestamp = format_timestamp(message.created_at)
    lines: list[str] = [f"**{sender}:** *{timestamp}*", ""]

    if message.content:
        for bi, block in enumerate(message.content):
            if block.type == "image":
                rel = inline_image_refs.get(bi)
                if rel:
                    lines.append(_markdown_image_ref(rel, "inline image", dialect))
                continue
            rendered = _bundle_block_to_markdown(
                block,
                include_tools=include_tools,
                bundle_index=bundle_index,
                bundled_alts=bundled_alts,
                dialect=dialect,
            )
            if rendered:
                lines.append(rendered)
    elif message.text:
        # Always strip TOOL_PLACEHOLDER (P1.3b).
        text = filter_tool_placeholders(message.text)
        # Run marker substitution on plain text too.
        def _swap(match: re.Match[str]) -> str:
            key = f"marker:{match.group(1).strip()}"
            rel = bundle_index.get(key)
            if rel:
                alt = bundled_alts.get(key, "image")
                return _markdown_image_ref(rel, alt, dialect)
            return f"_(image not bundled: {match.group(1).strip()})_"

        lines.append(CC_IMAGE_MARKER_RE.sub(_swap, text))

    # Desktop preview-asset image attachments: not bundled (they
    # require an authenticated proxy fetch from claude.ai). Emit a
    # footnote so the colleague viewing the bundled .md knows what
    # they're missing instead of seeing a dangling /api/... URL.
    if _dedupe_image_files(message):
        lines.append("")
        for img in _dedupe_image_files(message):
            name = img.get("file_name") or "image"
            lines.append(f"_(Desktop image attachment not bundled: {name})_")

    lines.append("")
    lines.append("---")
    lines.append("")
    return "\n".join(lines)


def create_markdown_bundle(
    conversation: ConversationDetail,
    *,
    include_tools: bool = True,
    dialect: MarkdownDialect = "commonmark",
    image_cache_root: Path | None = None,
) -> bytes:
    """Bundle a single conversation as a self-contained zip.

    Layout::

        <zip>
        ├── conversation.md     — Markdown with relative image refs
        └── images/
            ├── <synthetic-filename-1>.png
            └── ...

    Image sources bundled:
      - Inline base64 ``image`` content blocks (Claude Code shape) —
        decoded and written under ``images/``.
      - ``[Image: source: <abs-path>]`` text markers — copied from the
        absolute path on disk (validated to live under
        ``image_cache_root``) into ``images/``.

    Image sources NOT bundled:
      - Desktop ``Message.files[]`` previews (require an authenticated
        proxy fetch from claude.ai). Surfaced as a footnote in the .md.
    """
    if image_cache_root is None:
        from .config import get_settings

        image_cache_root = get_settings().claude_dir / "image-cache"

    buffer = io.BytesIO()
    bundle_index: dict[str, str] = {}  # logical key -> "images/<name>"
    bundled_alts: dict[str, str] = {}  # logical key -> alt text
    files_to_write: list[tuple[str, bytes]] = []
    used_names: set[str] = set()

    def _unique_name(stem: str, suffix: str) -> str:
        """Avoid clobbering when two source images would share a name."""
        base = sanitize_filename(stem) or "image"
        candidate = f"{base}{suffix}"
        i = 2
        while candidate in used_names:
            candidate = f"{base}-{i}{suffix}"
            i += 1
        used_names.add(candidate)
        return candidate

    # Pass 1: scan messages, collect bytes + decide image filenames.
    inline_refs_per_message: dict[str, dict[int, str]] = {}

    for message in conversation.messages:
        if not message.content:
            # Walk text for marker images.
            if message.text:
                for match in CC_IMAGE_MARKER_RE.finditer(message.text):
                    _maybe_bundle_marker(
                        match.group(1).strip(),
                        image_cache_root,
                        bundle_index,
                        bundled_alts,
                        files_to_write,
                        _unique_name,
                    )
            continue

        msg_inline_refs: dict[int, str] = {}
        for bi, block in enumerate(message.content):
            if block.type == "image" and block.source:
                src = block.source
                # Pydantic ContentBlock.source is `dict | None`; cast safely.
                source_dict: dict[str, Any] = src if isinstance(src, dict) else getattr(src, "model_dump", lambda: {})()
                if source_dict.get("type") == "base64" and source_dict.get("data"):
                    media = source_dict.get("media_type") or "image/png"
                    suffix = "." + (media.split("/")[-1] or "png")
                    name = _unique_name(f"inline-{message.uuid[:8]}-{bi}", suffix)
                    rel = f"images/{name}"
                    files_to_write.append((rel, base64.b64decode(source_dict["data"])))
                    msg_inline_refs[bi] = rel
            elif block.type == "text" and block.text:
                for match in CC_IMAGE_MARKER_RE.finditer(block.text):
                    _maybe_bundle_marker(
                        match.group(1).strip(),
                        image_cache_root,
                        bundle_index,
                        bundled_alts,
                        files_to_write,
                        _unique_name,
                    )
        if msg_inline_refs:
            inline_refs_per_message[message.uuid] = msg_inline_refs

    # Pass 2: build conversation.md.
    md_lines: list[str] = [
        f"# {conversation.name}",
        "",
        f"**Model:** {conversation.model}",
        f"**Created:** {format_timestamp(conversation.created_at)}",
        f"**Messages:** {conversation.message_count}",
        "",
        "---",
        "",
    ]
    for message in conversation.messages:
        if not message_has_visible_content(message, include_tools):
            continue
        md_lines.append(
            _bundle_message_to_markdown(
                message,
                include_tools=include_tools,
                inline_image_refs=inline_refs_per_message.get(message.uuid, {}),
                bundle_index=bundle_index,
                bundled_alts=bundled_alts,
                dialect=dialect,
            )
        )
    md = "\n".join(md_lines)

    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("conversation.md", md.encode("utf-8"))
        for name, data in files_to_write:
            zf.writestr(name, data)

    buffer.seek(0)
    return buffer.read()


def _maybe_bundle_marker(
    abs_path_str: str,
    image_cache_root: Path,
    bundle_index: dict[str, str],
    bundled_alts: dict[str, str],
    files_to_write: list[tuple[str, bytes]],
    unique_name_fn: Any,
) -> None:
    """Resolve a `[Image: source: ...]` marker path and, if it's
    safe + readable, register it in bundle_index + queue its bytes
    for the zip writer."""
    key = f"marker:{abs_path_str}"
    if key in bundle_index:
        return
    p = Path(abs_path_str)
    if not _image_marker_path_is_safe(p, image_cache_root):
        return
    try:
        data = p.read_bytes()
    except OSError:
        return
    name = unique_name_fn(p.stem, p.suffix or ".png")
    rel = f"images/{name}"
    bundle_index[key] = rel
    bundled_alts[key] = p.name
    files_to_write.append((rel, data))