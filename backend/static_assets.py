"""Locating and safely serving the bundled frontend assets.

A leaf module on purpose: ``backend.doctor`` needs ``_resolve_static_dir``
to report whether the UI shipped, and importing ``backend.main`` for that
would drag the whole FastAPI app into a cold one-shot CLI (and into the
MCP import closure). Nothing here imports anything but the stdlib.
"""

from __future__ import annotations

from pathlib import Path


def _resolve_static_dir() -> Path | None:
    """Locate the bundled frontend assets, or return None if absent.

    Resolution order:
      1. **Installed mode**: ``<backend package>/_static/`` — written by the
         hatch build hook during ``uv build``. This is what end users get
         from PyPI wheels.
      2. **Dev mode**: ``<repo_root>/frontend/dist/`` — written by
         ``npm run build`` in the frontend dir. Lets contributors run
         ``uv run uvicorn backend.main:app`` against a locally-built bundle
         without re-running ``uv build``.

    Returns the first directory containing ``index.html``, or None if
    neither exists (API-only mode).
    """
    # 1. Installed-wheel location (bundled by hatch_build.py).
    installed = Path(__file__).resolve().parent / "_static"
    if (installed / "index.html").is_file():
        return installed

    # 2. Repo dev location.
    repo_dev = Path(__file__).resolve().parent.parent / "frontend" / "dist"
    if (repo_dev / "index.html").is_file():
        return repo_dev

    return None


def _resolve_spa_file(static_dir: Path, full_path: str) -> Path | None:
    """Map a request path to a real file INSIDE ``static_dir``.

    Returns the resolved path, or None when the request names no file in
    the bundle — either because nothing is there (a client-router deep
    link, which the caller answers with ``index.html``) or because the
    path tries to leave the bundle.

    Containment is enforced on the RESOLVED path, not the literal one.
    ``Path`` joins lexically, so ``static_dir / "../../etc/passwd"`` is a
    perfectly valid path to somebody else's file, and an absolute right
    operand (``static_dir / "/etc/passwd"``) discards the left side
    entirely. Resolving also collapses symlinks, so a link planted inside
    the bundle is not a way out.

    Do NOT reintroduce a bare ``(static_dir / full_path).is_file()``
    here. uvicorn percent-decodes the request target and does not
    collapse ``..``, so the route receives traversal strings verbatim;
    that one-liner served arbitrary files over a raw socket, including
    the session key in ``~/.claude-explorer/credentials.json``. Pinned by
    ``backend/tests/test_spa_static_traversal.py``.
    """
    if not full_path:
        return None
    try:
        resolved = (static_dir / full_path).resolve(strict=True)
        root = static_dir.resolve()
    except (OSError, RuntimeError, ValueError):
        # Nonexistent path, a resolution loop, an embedded NUL, or a name
        # too long for the platform. None of those name a servable file.
        return None
    if resolved != root and root not in resolved.parents:
        return None
    if not resolved.is_file():
        return None
    return resolved
