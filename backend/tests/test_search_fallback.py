"""Search fallback regression tests (C6 (b)).

PLANS/2026.05.18-test-hardening.md C6(b): pin the contract that a
crash inside the FTS5 build path during lifespan startup is isolated
to the index — the app still starts, the index reports
``is_ready() == False``, and ``search_conversations()`` transparently
falls back to the linear-scan path.

Why this test exists:
    backend/main.py wraps the lifespan ``_build_search_index()`` task
    in a broad ``except Exception`` clause and the search dispatcher
    (backend/search.py) gates every fast-path call on
    ``idx.is_ready()``. Both layers EXIST today; this test pins the
    end-to-end contract so a future refactor that, say, hoists the
    build-task body up a layer (and accidentally re-raises) doesn't
    silently start crashing the lifespan.

Test surface choice:
    We monkeypatch ``backend.search_index.build_full_index`` at the
    function boundary (rather than patching deeper into sqlite3 /
    connection objects) because the contract under test is the
    LIFESPAN's error isolation, not the index's internal exception
    handling. Patching a deeper layer would test a different thing:
    that ``build_full_index`` catches its own sqlite3 errors. We don't
    care about that here — we care that whatever raised, the app
    survives and search still works.
"""

from __future__ import annotations

import asyncio
import sqlite3
from pathlib import Path
from unittest.mock import patch

import pytest

from backend.tests import builders as B


@pytest.fixture
def fallback_corpus(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Tiny on-disk corpus + isolated data dirs for a single test.

    Mirrors the ``cold_start_claude_dir`` fixture in
    ``test_lifespan_cold_start.py`` but for Desktop conversations
    (we don't need CC sessions for this test — one Desktop conv with
    a known body is enough to exercise the linear-scan path).

    Suppresses every OTHER lifespan side effect (migration, CC
    watcher, CC warm, summary cache) so the test pins exactly one
    behavior: FTS5 build failure → linear-scan fallback.
    """
    from backend import config as config_mod

    data_dir = tmp_path / "data"
    claude_dir = tmp_path / "claude"
    data_dir.mkdir()
    claude_dir.mkdir()

    # One Desktop conversation containing a unique needle the test
    # will search for. ``build_desktop_conv``'s default body is the
    # ``NEEDLE_HANDSHAKE`` token — perfect for asserting the linear
    # scan actually walked the corpus.
    by_org = data_dir / "by-org" / "org-1"
    conv = B.build_desktop_conv(
        uuid="conv-fallback-1",
        name="fallback test conv",
        body=f"this conversation contains {B.NEEDLE_HANDSHAKE} for the search test",
    )
    B.write_desktop_conv(by_org, conv)

    monkeypatch.setenv("CLAUDE_EXPLORER_DATA_DIR", str(data_dir))
    monkeypatch.setenv("CLAUDE_DIR", str(claude_dir))
    monkeypatch.setenv("CLAUDE_EXPLORER_DISABLE_CC_WATCHER", "1")
    monkeypatch.setenv("CLAUDE_EXPLORER_DISABLE_CC_WARM", "1")
    monkeypatch.setenv("CLAUDE_EXPLORER_SKIP_MIGRATION", "1")
    monkeypatch.setenv("CLAUDE_EXPLORER_SKIP_DATA_DIR_MIGRATION", "1")
    monkeypatch.setenv(
        "CLAUDE_EXPLORER_DISABLE_SUMMARY_CACHE_WARM", "1"
    )
    # FTS5 build is the thing under test — keep it ENABLED so the
    # patched ``build_full_index`` actually fires.
    monkeypatch.delenv("CLAUDE_EXPLORER_DISABLE_SEARCH_INDEX", raising=False)

    config_mod.get_settings.cache_clear()
    try:
        yield data_dir
    finally:
        config_mod.get_settings.cache_clear()


async def test_search_falls_back_when_fts5_build_raises(
    fallback_corpus: Path,
) -> None:
    """Lifespan FTS5 build failure → search still works via linear scan.

    Wire-up:
      1. Monkeypatch ``backend.search_index.build_full_index`` to raise
         ``sqlite3.OperationalError`` — the realistic failure mode (e.g.
         disk full, file permissions, FTS5 corruption mid-rebuild).
      2. Run the lifespan via ``app.router.lifespan_context(app)`` — the
         pattern from ``test_lifespan_cold_start.py``. This actually
         creates the background task, sleeps the 500ms delay, and then
         the task hits our raising mock.
      3. Wait for the patched ``build_full_index`` to be called (proves
         the test isn't trivially passing because the task never ran).
      4. Assert ``get_search_index().is_ready() == False`` — the index
         singleton exists but was never marked ready.
      5. Run a real search query through the public dispatcher. The
         dispatcher checks ``is_ready()``, sees False, falls back to
         ``_search_via_linear_scan``, which walks the on-disk corpus
         and finds the needle.

    What this catches if it regresses:
      * The lifespan task removes its ``except Exception`` wrapper and
        the FTS5 crash propagates → ``app.router.lifespan_context``
        raises and the test fails at the ``async with`` boundary.
      * ``build_full_index`` accidentally calls ``mark_ready()`` BEFORE
        its work completes → ``is_ready()`` returns True after a
        partial / failed build, and the dispatcher hits the FTS5 path
        with a half-baked index. (Today, ``mark_ready()`` is invoked
        AFTER the loop in ``build_full_index``; if a future refactor
        inverts that, this test fails.)
      * The dispatcher loses its ``is_ready()`` guard → linear-scan
        fallback stops firing and we get a 0-result response from the
        FTS5 path against an empty index.
    """
    from backend.main import app
    from backend.search import search_conversations
    from backend.search_index import get_search_index
    from backend.store import ConversationStore

    call_count = 0
    raised_exc = sqlite3.OperationalError("simulated FTS5 build failure")

    def _boom(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        raise raised_exc

    # Patch at the symbol's module of definition. The lifespan task does
    # ``from backend.search_index import build_full_index`` INSIDE the
    # coroutine, so it resolves the attribute lookup at call time —
    # patching ``backend.search_index.build_full_index`` is what the
    # task will see when it imports.
    with patch("backend.search_index.build_full_index", side_effect=_boom):
        async with app.router.lifespan_context(app):
            # Wait until the patched build_full_index has been called.
            # Without this, the dispatcher assertions below would
            # trivially pass — is_ready() starts False and stays False
            # whether the build crashed or simply hadn't started yet.
            # 10s budget is generous: 500ms lifespan delay + a few ms
            # for the asyncio.to_thread call to land in the spy.
            for _ in range(200):
                if call_count > 0:
                    break
                await asyncio.sleep(0.05)

            assert call_count == 1, (
                f"build_full_index was never called (call_count={call_count}); "
                "the FTS5 build task didn't run — test is vacuously passing"
            )

            # Contract 1: the index singleton exists (we never crash the
            # lifespan over a build failure) but was never marked ready.
            idx = get_search_index()
            assert idx is not None, (
                "get_search_index() returned None after lifespan startup; "
                "expected the singleton to be lazily-instantiated even when "
                "build_full_index raised"
            )
            assert idx.is_ready() is False, (
                "is_ready() returned True after a failed build; the build "
                "task must NOT call mark_ready() on its way out of an "
                "exception, otherwise the dispatcher will hit a half-built "
                "FTS5 index"
            )

            # Contract 2: the public dispatcher still answers queries via
            # the linear-scan path. Search the fixture corpus for the
            # NEEDLE_HANDSHAKE token we wrote into conv-fallback-1.
            store = ConversationStore()
            response = search_conversations(store, B.NEEDLE_HANDSHAKE)
            assert response.results, (
                f"search returned no results for {B.NEEDLE_HANDSHAKE!r}; "
                "linear-scan fallback didn't fire — the dispatcher likely "
                "lost its is_ready() guard"
            )
            assert response.results[0].conversation_uuid == "conv-fallback-1", (
                f"unexpected match: {response.results[0]!r}"
            )
            # Linear scan never truncates, by design — pin that here so a
            # future refactor that adds an artificial limit to the
            # fallback path is caught.
            assert response.truncated is False
