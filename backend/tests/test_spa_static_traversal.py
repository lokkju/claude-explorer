"""The SPA catch-all must not serve files outside the bundled UI dir.

Reported 2026-09-16. ``_spa_catchall`` joined the request path onto
``_STATIC_DIR`` and served whatever landed there:

    candidate = _STATIC_DIR / full_path
    if candidate.is_file():
        return FileResponse(candidate)

``Path`` joins lexically, so ``..`` segments walk straight out of the
bundle. Confirmed against a real ``claude-explorer serve`` over a raw
socket (a browser would normalise the path, an attacker's client does
not)::

    GET /../../../../../../etc/passwd  -> 200, file contents
    GET /%2e%2e%2f%2e%2e%2f...etc/hostname -> 200, file contents

Everything readable by the serving user is exposed, including
``~/.claude-explorer/credentials.json`` — which holds the Claude session
key. CORS is pinned to the Vite dev origins so a hostile web page cannot
read the response, which caps this at local/LAN reach, but ``serve
--host 0.0.0.0`` puts it on the network.

These tests pin the resolver. They exercise the same strings the raw
socket delivered, because that is what the ASGI server hands the route —
uvicorn percent-decodes and does NOT collapse ``..``.
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest

from backend.static_assets import _resolve_spa_file


@pytest.fixture
def bundle(tmp_path: Path) -> Path:
    """A fake built UI bundle with a secret sitting next to it."""
    static = tmp_path / "_static"
    (static / "assets").mkdir(parents=True)
    (static / "index.html").write_text("<html>spa</html>")
    (static / "vite.svg").write_text("<svg/>")
    (static / "assets" / "index-abc123.js").write_text("console.log(1)")
    (tmp_path / "credentials.json").write_text('{"sessionKey": "fake-test-key"}')
    return static


@pytest.mark.parametrize(
    "probe",
    [
        "../credentials.json",
        "../../etc/passwd",
        "../" * 14 + "etc/passwd",
        "assets/../../credentials.json",
        "./../credentials.json",
        "/etc/passwd",
        "//etc/passwd",
    ],
)
def test_traversal_is_refused(bundle: Path, probe: str) -> None:
    """Any path that resolves outside the bundle must resolve to None.

    Bug it would surface: the lexical join. ``../credentials.json`` is the
    one that matters most — the session key lives one directory up from
    the data dir in a real install.
    """
    assert _resolve_spa_file(bundle, probe) is None, (
        f"{probe!r} escaped the bundle root {bundle}"
    )


def test_absolute_path_does_not_hijack_the_join(bundle: Path) -> None:
    """``Path('/a') / '/etc/passwd'`` is ``/etc/passwd`` — pathlib drops
    the left side on an absolute right side. Pinned separately because it
    escapes without containing a single ``..``."""
    assert _resolve_spa_file(bundle, "/etc/passwd") is None


def test_symlink_out_of_the_bundle_is_refused(bundle: Path, tmp_path: Path) -> None:
    """Defense in depth: a symlink planted inside the bundle must not be
    a way out either. Vite would never emit one, but the check costs
    nothing and the alternative is trusting the build output."""
    link = bundle / "escape.json"
    try:
        os.symlink(tmp_path / "credentials.json", link)
    except (OSError, NotImplementedError):
        pytest.skip("symlinks unavailable on this platform")
    assert _resolve_spa_file(bundle, "escape.json") is None


def test_real_assets_are_still_served(bundle: Path) -> None:
    """The fix must not break the thing the route exists for."""
    got = _resolve_spa_file(bundle, "assets/index-abc123.js")
    assert got is not None
    assert got == (bundle / "assets" / "index-abc123.js").resolve()

    svg = _resolve_spa_file(bundle, "vite.svg")
    assert svg is not None and svg.name == "vite.svg"


def test_missing_file_falls_through_to_the_spa(bundle: Path) -> None:
    """A deep link like /conversations/<uuid> names no file; the caller
    serves index.html so the client router can handle it."""
    assert _resolve_spa_file(bundle, "conversations/abc-123") is None
    assert _resolve_spa_file(bundle, "") is None


def test_directory_is_not_served(bundle: Path) -> None:
    """A directory is not a file — must fall through, not 500."""
    assert _resolve_spa_file(bundle, "assets") is None
