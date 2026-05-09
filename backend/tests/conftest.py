"""Pytest configuration and fixtures.

Existing fixtures (``client``, ``temp_data_dir``, ``sample_conversation``) are
preserved for backwards compatibility; new tests opt in to the P0 fixtures
below.

P0 fixtures (added 2026-05-08 per ``PLANS/2026.05.08 BACKEND TEST PLAN.md``):

* :func:`isolated_data_dir` — env-var-driven, ``lru_cache``-aware data-dir
  isolation that satisfies CLAUDE-TESTING.md \u00a75.1.
* :func:`fastapi_app` / :func:`real_async_client` — raw ASGI client for
  SSE / concurrency tests where ``TestClient`` would block on streaming.
* :func:`collect_sse_data_events` — module-level async helper (NOT a
  fixture) that parses ``data:``-only SSE frames, skips ``:`` keep-alive
  comments, and bounds the entire stream by a wall-clock deadline.
* :func:`legacy_v1_prefs` — seeds an on-disk v1 preferences blob with the
  legacy markers (``polarity``, ``pinned``, ``activeFilterIds``) for
  migration tests per CLAUDE-TESTING.md \u00a75.5.
* :func:`_isolated_credentials_path` — patches the three module-level
  ``DEFAULT_CREDENTIALS_PATH`` bindings for fetch tests.
* :func:`reset_refresh_flag` — autouse, resets the
  ``backend.routers.fetch._refresh_in_progress`` module flag between
  tests so a leaked ``True`` doesn't 409 the next test.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from typing import Any


def _bootstrap_macos_dyld_for_weasyprint() -> None:
    """On macOS, ensure WeasyPrint's CFFI bindings can locate Homebrew-installed
    GLib/Pango/Cairo even though SIP strips DYLD_* env vars from subprocess
    invocations (e.g. ``uv run pytest``).

    Setting ``DYLD_FALLBACK_LIBRARY_PATH`` from inside Python at import time
    works because :func:`ctypes.util.find_library` on macOS spawns subprocesses
    that inherit the updated environment. The PDF-export tests rely on this.

    No-op on non-Darwin or when Homebrew lib dir doesn't exist.
    """
    if sys.platform != "darwin":
        return
    for brew_lib in ("/opt/homebrew/lib", "/usr/local/lib"):
        if not os.path.isdir(brew_lib):
            continue
        existing = os.environ.get("DYLD_FALLBACK_LIBRARY_PATH", "")
        if brew_lib in existing.split(":"):
            return
        os.environ["DYLD_FALLBACK_LIBRARY_PATH"] = (
            f"{brew_lib}:{existing}" if existing else brew_lib
        )
        return


_bootstrap_macos_dyld_for_weasyprint()


import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from httpx import ASGITransport

from backend.main import app


def _weasyprint_available() -> bool:
    """Detect whether WeasyPrint can import without OSError (i.e., its native
    Pango/Cairo/GLib libs are loadable). Used by the PDF-test auto-skip
    fixture below."""
    try:
        import weasyprint  # noqa: F401
        return True
    except (ImportError, OSError):
        return False


@pytest.fixture(autouse=True)
def _skip_pdf_tests_when_weasyprint_unavailable(request):
    """Skip PDF-export tests with a clear, actionable message instead of a
    cryptic CFFI ``OSError`` when WeasyPrint native libs (libgobject, libpango,
    etc.) aren't loadable.

    Trigger condition: test file or test name contains ``pdf``. Skip message
    points at CLAUDE.md "PDF Export Dependencies" so the dev knows what to
    install.
    """
    if "pdf" not in request.node.nodeid.lower():
        return
    if not _weasyprint_available():
        pytest.skip(
            "WeasyPrint native libs not loadable. "
            "On macOS: brew install pango cairo libffi (see CLAUDE.md PDF Export Dependencies)."
        )


@pytest.fixture
def client():
    """Create a test client for the FastAPI app."""
    return TestClient(app)


@pytest.fixture
def temp_data_dir():
    """Create a temporary directory with sample conversation data."""
    with tempfile.TemporaryDirectory() as tmpdir:
        data_dir = Path(tmpdir)

        # Create sample conversation file
        sample_conv = {
            "uuid": "test-uuid-123",
            "name": "Test Conversation",
            "summary": "A test conversation for unit testing",
            "model": "claude-sonnet-4-6",
            "created_at": "2024-03-01T12:00:00Z",
            "updated_at": "2024-03-01T13:00:00Z",
            "is_starred": False,
            "is_temporary": False,
            "current_leaf_message_uuid": "msg-2",
            "chat_messages": [
                {
                    "uuid": "msg-1",
                    "sender": "human",
                    "text": "Hello, Claude!",
                    "content": [{"type": "text", "text": "Hello, Claude!"}],
                    "created_at": "2024-03-01T12:00:00Z",
                    "updated_at": "2024-03-01T12:00:00Z",
                    "parent_message_uuid": None,
                },
                {
                    "uuid": "msg-2",
                    "sender": "assistant",
                    "text": "Hello! How can I help you today?",
                    "content": [{"type": "text", "text": "Hello! How can I help you today?"}],
                    "created_at": "2024-03-01T12:01:00Z",
                    "updated_at": "2024-03-01T12:01:00Z",
                    "parent_message_uuid": "msg-1",
                },
            ],
        }

        conv_file = data_dir / "test-uuid-123.json"
        with open(conv_file, "w") as f:
            json.dump(sample_conv, f)

        yield data_dir


@pytest.fixture
def sample_conversation():
    """Return sample conversation data."""
    return {
        "uuid": "test-uuid-123",
        "name": "Test Conversation",
        "summary": "A test conversation",
        "model": "claude-sonnet-4-6",
        "created_at": "2024-03-01T12:00:00Z",
        "updated_at": "2024-03-01T13:00:00Z",
        "is_starred": False,
        "is_temporary": False,
        "message_count": 2,
        "human_message_count": 1,
        "has_branches": False,
        "source": "CLAUDE_AI",
    }


# ---------------------------------------------------------------------------
# P0 fixtures (PLANS/2026.05.08 BACKEND TEST PLAN.md)
# ---------------------------------------------------------------------------


@pytest.fixture
def isolated_data_dir(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Iterator[Path]:
    """Per-test, env-var-driven, ``lru_cache``-aware data-dir isolation.

    Creates ``<tmp_path>/data`` (a SUBDIRECTORY of ``tmp_path``, NOT
    ``tmp_path`` itself) and points ``CLAUDE_EXPORTER_DATA_DIR`` at it.
    The subdirectory layout is mandatory because
    ``backend/routers/preferences.py:_resolve_path`` resolves the
    preferences file via ``settings.data_dir.parent / "preferences.json"``,
    so ``<isolated_data_dir>.parent`` is the writable preferences root.

    Also pins ``CLAUDE_DIR`` to ``<tmp_path>/claude`` so the test never
    accidentally crawls a developer's real ``~/.claude/projects``.

    Per CLAUDE-TESTING.md \u00a75.1, ``backend.config.get_settings`` is
    ``@lru_cache``d; we MUST clear the cache both before yielding (in case
    a prior test left a cached ``Settings`` behind) and on teardown (so
    we don't leak this test's settings into the next).

    Yields the data-dir path.
    """

    from backend import config

    data_dir = tmp_path / "data"
    claude_dir = tmp_path / "claude"
    data_dir.mkdir()
    claude_dir.mkdir()

    monkeypatch.setenv("CLAUDE_EXPORTER_DATA_DIR", str(data_dir))
    monkeypatch.setenv("CLAUDE_DIR", str(claude_dir))

    config.get_settings.cache_clear()
    try:
        yield data_dir
    finally:
        config.get_settings.cache_clear()


@pytest.fixture
def fastapi_app() -> FastAPI:
    """Expose the backend ASGI app to fixtures that need it.

    Named ``fastapi_app`` (not ``app``) to avoid shadowing
    ``from backend.main import app`` imports at the module top of test
    files.
    """

    return app


@pytest.fixture
async def real_async_client(fastapi_app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    """Async HTTP client wired to the in-process ASGI app.

    Use this for SSE / concurrency tests where ``TestClient`` would block
    on streaming. With ``asyncio_mode = "auto"`` set in pyproject.toml,
    the plain ``@pytest.fixture`` decorator handles the async lifecycle.

    .. warning::

       This fixture does NOT isolate disk state. Routes that read or
       write ``~/.claude-exporter/preferences.json``, ``credentials.json``,
       or the data dir will hit the developer's REAL files unless the
       test ALSO requests :func:`isolated_data_dir` and/or
       :func:`_isolated_credentials_path` (and the existing fetch
       fixtures where applicable). Pair this client with the relevant
       isolation fixtures whenever the route under test touches disk.
    """

    transport = ASGITransport(app=fastapi_app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def collect_sse_data_events(
    resp: Any,
    *,
    stop_on: tuple[str, ...] = ("complete", "error"),
    timeout: float = 5.0,
) -> AsyncIterator[tuple[str, dict[str, Any]]]:
    """Async generator: yield ``(payload["type"], payload)`` from an SSE response.

    Wire format on this server is ``data: {json}\\n\\n`` ONLY \u2014 there are no
    ``event:`` headers. The capture phase emits ``: ping\\n\\n`` SSE
    comments as keep-alives (see ``backend/routers/fetch.py:519, :932-933``);
    those are skipped here.

    Bounds the ENTIRE iteration by a wall-clock ``timeout`` (not per-event).
    A slow-dribble stream that yields one event every 4.9s with a 5s
    timeout would otherwise run for minutes; we want fast failure.

    Malformed JSON payloads bubble up immediately as ``json.JSONDecodeError``
    rather than being silently skipped \u2014 a malformed frame is a
    backend-contract bug we want surfaced loudly.

    Args:
        resp: anything with an ``aiter_lines()`` async iterator (typically
            an ``httpx.Response`` opened via ``client.stream(...)`` ).
        stop_on: payload ``type`` values that terminate the stream.
        timeout: seconds for the entire iteration.

    Raises:
        TimeoutError: if the stream does not reach a ``stop_on`` type
            within ``timeout`` seconds.
        json.JSONDecodeError: if a ``data:`` frame is not valid JSON.
    """

    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout

    async def _gen() -> AsyncIterator[tuple[str, dict[str, Any]]]:
        async for line in resp.aiter_lines():
            if not line:
                continue
            if line.startswith(":"):
                # SSE comment / keep-alive (e.g. ``: ping``); skip.
                continue
            if not line.startswith("data:"):
                continue
            payload_str = line[len("data:"):].strip()
            payload = json.loads(payload_str)  # let JSONDecodeError propagate
            etype = payload.get("type", "")
            yield etype, payload
            if etype in stop_on:
                return

    agen = _gen()
    try:
        while True:
            time_left = deadline - loop.time()
            if time_left <= 0:
                raise TimeoutError(
                    "collect_sse_data_events: stream did not reach a "
                    f"stop_on={stop_on!r} type within {timeout}s"
                )
            try:
                etype, payload = await asyncio.wait_for(
                    agen.__anext__(), timeout=time_left
                )
            except StopAsyncIteration:
                return
            yield etype, payload
            if etype in stop_on:
                return
    finally:
        await agen.aclose()


@pytest.fixture
def legacy_v1_prefs(isolated_data_dir: Path) -> Path:
    """Seed a v1-shaped ``preferences.json`` for migration tests.

    The on-disk shape is what users currently have (per CLAUDE-TESTING.md
    \u00a75.5: migration tests MUST seed the legacy shape, not the new shape).
    The presence of ``polarity`` (no ``behavior``), ``pinned``,
    ``activeFilterIds``, and the ABSENCE of ``_migratedV2`` is what makes
    this blob "legacy v1".

    Lives at ``<isolated_data_dir>.parent / "preferences.json"`` to match
    ``backend/routers/preferences.py:_resolve_path``.

    Returns the path to the seeded file.
    """

    prefs_path = isolated_data_dir.parent / "preferences.json"
    blob = {
        "version": 1,
        "data": {
            "savedFilters": [
                {
                    "id": "f1",
                    "name": "Exclude X",
                    "patterns": ["*X*"],
                    "polarity": "exclude",  # legacy v1 marker (no `behavior`)
                    "pinned": True,  # legacy v1 marker
                    "mode": "glob",
                    "target": "title",
                    "enabled": True,
                },
            ],
            "activeFilterIds": ["f1"],  # legacy v1 marker
            "theme": "dark",
            "keyboardMode": "vim",
            # NO `_migratedV2` sentinel \u2014 unmigrated state.
        },
    }
    prefs_path.write_text(json.dumps(blob, indent=2))
    return prefs_path


@pytest.fixture
def _isolated_credentials_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Iterator[Path]:
    """Pin the credentials path to ``<tmp_path>/credentials.json``.

    There are FOUR module-level ``DEFAULT_CREDENTIALS_PATH`` bindings to
    consider:

    1. ``fetcher.credentials.DEFAULT_CREDENTIALS_PATH`` (line 66) \u2014 the
       default ``path=`` arg of ``save_credentials``.
    2. ``fetcher.bulk_fetch.DEFAULT_CREDENTIALS_PATH`` (line 40) \u2014 a
       SEPARATE definition; ``backend.routers.fetch`` imports from here.
    3. ``backend.routers.fetch.DEFAULT_CREDENTIALS_PATH`` (line 19, value-
       imported at module load) \u2014 the binding the route handler reads.
    4. ``backend.routers.orgs.DEFAULT_CREDENTIALS_PATH`` (value-imported
       from ``fetcher.credentials`` at module load) \u2014 the binding the
       ``/api/orgs`` route handler reads.

    All four must be patched: a ``from foo import X`` does a value-binding
    into the importing module's namespace, so patching the source alone
    does not affect the importer's local copy. ``raising=False`` is used
    defensively in case future refactors move a constant.

    Yields the temp credentials path (file may or may not exist on disk).
    """

    creds = tmp_path / "credentials.json"
    targets = (
        "fetcher.credentials.DEFAULT_CREDENTIALS_PATH",
        "fetcher.bulk_fetch.DEFAULT_CREDENTIALS_PATH",
        "backend.routers.fetch.DEFAULT_CREDENTIALS_PATH",
        "backend.routers.orgs.DEFAULT_CREDENTIALS_PATH",
    )
    for target in targets:
        monkeypatch.setattr(target, creds, raising=False)
    yield creds


def _reset_refresh_flag_body() -> Iterator[None]:
    """Generator body for the ``reset_refresh_flag`` fixture.

    Extracted as a plain generator so the lifecycle (setup-yield-teardown)
    can be unit-tested directly via ``next(gen)`` without violating
    pytest's "fixtures must not be called directly" rule.
    """

    import backend.routers.fetch as fetch_mod

    fetch_mod._refresh_in_progress = False
    try:
        yield
    finally:
        fetch_mod._refresh_in_progress = False


@pytest.fixture(autouse=True)
def reset_refresh_flag() -> Iterator[None]:
    """Reset ``backend.routers.fetch._refresh_in_progress`` per test.

    The ``/api/fetch/refresh`` route guards itself with a module-level
    boolean (``fetch.py:42``). A test that crashes mid-stream (or a
    concurrency test that leaves the flag set) would 409 the NEXT test
    on first call. Resetting here is defense-in-depth for ALL tests.

    Function-scoped + autouse: runs around every test.
    """

    yield from _reset_refresh_flag_body()
