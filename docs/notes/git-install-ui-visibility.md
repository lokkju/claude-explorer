# A UI-less install is invisible

**Priority:** Medium — the product gives no signal that the web UI is
missing.
**Discovery date:** 2026-09-16

## Context

Reported as "a git based install doesn't include the ui."

## What I could and could not reproduce

**Could not reproduce the missing bundle.** On this machine the
git-installed tool (`~/.local/share/uv/tools/claude-explorer`, installed
from `git+https://github.com/lokkju/claude-explorer.git?rev=main`)
contains a complete `backend/_static` — `index.html`, `vite.svg`, and
both hashed Vite assets — and `claude-explorer serve` returns the app
(`GET /` -> 200 `text/html`, `GET /assets/index-*.js` -> 200). A fresh
`git clone` + `uv build --wheel` also bundles it: the hatch hook ran
`npm ci && npm run build` and force-included `frontend/dist` ->
`backend/_static`, 4 entries in the wheel.

The hook also has no silent-failure path: a missing `npm`, a missing
`frontend/package.json`, or a build that produces no `index.html` each
raise `RuntimeError` and fail the install loudly.

**Reproduced the real defect: nothing tells you.** When
`_resolve_static_dir()` returns None the backend starts anyway in
API-only mode, `/` answers JSON instead of the app, and the only signal
is one `log.warning` at import time — which lands in the structured log,
not in front of the person who just typed `serve`. `doctor` had no check
for it at all, so an install with no UI reported "All checks passed".

That is the same shape as
[[doctor-blind-to-index-coverage]]: a capability can be entirely absent
and every diagnostic still reads green.

The most likely thing the reporter actually saw is this warning from a
dev checkout (`uv run claude-explorer serve` in the repo, where
`frontend/dist` does not exist until someone runs `npm run build`) — but
that is a guess, and the fix below makes the real state legible either
way.

## Fix

- New `backend/static_assets.py` leaf module holding
  `_resolve_static_dir` (and `_resolve_spa_file`), so `doctor` can ask
  about the bundle without importing the FastAPI app.
- New `doctor` check "Web UI": OK with the asset count and path, WARN
  when absent with an actionable fix, and a distinct WARN for an
  `index.html` with no `assets/` — that case loads a page where every
  script 404s, which reads as "broken" rather than "missing".
- `serve` now prints an API-only warning to stderr before the
  "Starting server on ..." line, matching the existing
  watcher-not-installed hint.

## Still open

If a UI-less git install shows up again, capture `claude-explorer doctor`
output and `find <venv>/backend/_static` before reinstalling. The build
hook cannot fail quietly, so a genuinely empty `_static` would point at
something upstream of it — a cached wheel, or an installer that skipped
the build hook entirely.

## Affected files

- `backend/static_assets.py` (new), `backend/main.py`
- `backend/doctor.py` (`check_web_ui`, `ALL_CHECKS`)
- `cli/main.py` (`_serve_static_dir`, `serve`)
- `backend/tests/test_doctor_web_ui.py`,
  `backend/tests/test_cli_serve_ui_warning.py`
