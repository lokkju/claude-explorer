# SPA catch-all served arbitrary files off disk

**Priority:** High — arbitrary local file read, including the Claude
session key.
**Discovery date:** 2026-09-16

## Context

Found while investigating a report that a git-based install ships
without the UI. The UI turned out to be bundled correctly; the code that
serves it was not.

## Problem

`backend/main.py:_spa_catchall` joined the request path straight onto the
bundle root:

```python
candidate = _STATIC_DIR / full_path
if candidate.is_file():
    return FileResponse(candidate)
```

`Path.__truediv__` joins lexically. `..` segments walk out of the bundle,
and an absolute right operand (`_STATIC_DIR / "/etc/passwd"`) discards
the left side entirely. uvicorn percent-decodes the request target and
does **not** collapse `..`, so the route receives traversal strings
verbatim — a browser normalises them, an attacker's client does not.

Confirmed against a real `claude-explorer serve` over a raw socket:

```
GET /../../../../../../etc/passwd                 -> 200, file contents
GET /%2e%2e%2f%2e%2e%2f...etc/hostname            -> 200, file contents
```

Everything readable by the serving user is exposed. The one that matters
is `~/.claude-explorer/credentials.json`, which holds the Claude session
key — one request away from full account access.

Reach is capped by CORS being pinned to the Vite dev origins
(`backend/main.py:962`), so a hostile web page can issue the request but
cannot read the response. That leaves local and LAN callers — and
`serve --host 0.0.0.0` is a documented option, which puts it on the
network.

Note that `/api/files/cc-image`, the other route that takes a
caller-controlled path, is properly hardened: resolve, `relative_to` the
root, extension allow-list, null-byte handling, readability check. The
catch-all was simply missed.

## Fix

`_resolve_spa_file(static_dir, full_path)` resolves the candidate and
refuses anything that is not a real file inside the resolved root.
Resolution also collapses symlinks, so a link planted inside the bundle
is not a way out either. Traversal attempts now fall through to
`index.html` exactly like any other unknown deep link.

## Affected files

- `backend/main.py` (`_resolve_spa_file`, `_spa_catchall`)
- `backend/tests/test_spa_static_traversal.py`
