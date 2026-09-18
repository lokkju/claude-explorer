# PDF export read any file named by a conversation

**Priority:** High — arbitrary file read that lands in an artifact users
share.
**Discovery date:** 2026-09-16

## Context

Found while auditing the file-serving surfaces after
[[spa-catchall-path-traversal]].

## Problem

Claude Code references image attachments from inside message text as a
literal `[Image: source: <abs-path>]` marker.
`backend/exporters/_shared.py` matches it with

```python
CC_IMAGE_MARKER_RE = re.compile(r"\[Image: source: ([^\]]+)\]")
```

anywhere in a message body — so whatever can put that string into a
conversation chooses the file. Both other consumers know this:

- `backend/routers/files.py:get_cc_image` resolves, checks
  `relative_to` the image-cache root, and enforces an extension
  allow-list.
- `backend/exporters/bundle.py` has `_image_marker_path_is_safe` with the
  docstring "Mirrors backend.routers.files.get_cc_image."

`backend/exporters/pdf.py:_resolve_cc_image_path` had no check at all:

```python
candidate = Path(abs_path).expanduser()
if candidate.is_file():
    return candidate
```

The WeasyPrint `url_fetcher` then read the bytes and embedded them in
the rendered PDF. Verified: `_resolve_cc_image_path("/etc/passwd")`
returned the path, and the fetcher returned its contents rather than the
1x1 placeholder.

What makes this worse than the browser-side equivalent is the direction
the data travels. A PDF is exported in order to send it to someone. A
conversation containing
`[Image: source: ~/.claude-explorer/credentials.json]` puts the session
key into a file the user then hands to a third party.

`pdf.py` already reasons about this exact class for URL schemes — the
`url_fetcher` docstring notes that deferring unknown schemes to
WeasyPrint's default fetcher "would turn any HTML-injection vector in a
user-controlled field into SSRF + arbitrary-file-read during PDF
render", pinned by `test_export_pdf_html_injection.py`. The cc-image
branch was simply missed.

## Fix

`_image_marker_path_is_safe` moved to `_shared.py` as
`image_marker_path_is_safe`, alongside a `cc_image_cache_root()` that
honors the same `CLAUDE_DIR` override the HTTP route uses, so all three
surfaces agree on what "inside the cache" means. `bundle.py` now
delegates to it; `_resolve_cc_image_path` gates on it. The permanent-
cache fallback re-checks its glob results too, since the `sess` and `n`
components of that pattern are derived from the same untrusted path.

## Affected files

- `backend/exporters/_shared.py`, `backend/exporters/pdf.py`,
  `backend/exporters/bundle.py`
- `backend/tests/test_export_pdf_cc_image_containment.py`
