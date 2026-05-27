"""Pin the lifespan in-process-watcher gate.

When the SUPERVISED CC image-cache watcher is installed
(launchd/systemd/Task Scheduler), the backend MUST NOT spawn its
in-process watcher task. Two processes writing to the same
``search-index.sqlite`` race on every drift pass — observed
2026-05-26 as ``sqlite3.OperationalError: database is locked``
during ``update_drifted_files`` upserts.

The supervised watcher does the same work (watchdog event-driven
primary path + 600s backstop poll). When it's running, the
backend's lifespan watcher is redundant AND harmful.

The existing ``CLAUDE_EXPLORER_DISABLE_CC_WATCHER`` env override
still wins — it's the explicit user opt-out. The watcher-installed
gate adds an *implicit* opt-out for the common case where the user
ran ``claude-explorer install-watcher`` and doesn't think to also
set the env var.
"""

from __future__ import annotations

import asyncio
from contextlib import AsyncExitStack

import pytest


@pytest.mark.asyncio
async def test_lifespan_skips_in_process_watcher_when_supervised_installed(
    monkeypatch,
):
    """When the supervised watcher is detected, lifespan must NOT
    spawn the in-process ``run_watcher`` task.

    Sentinel: monkeypatch ``backend.cc_watcher.run_watcher`` to count
    invocations. Boot the lifespan; assert zero calls.
    """
    from backend import main, watcher_status

    monkeypatch.setenv("CLAUDE_EXPLORER_WATCHER_INSTALLED", "1")
    watcher_status.invalidate_cache()

    calls: list[int] = []

    async def fake_run_watcher(stop_event):
        calls.append(1)
        await stop_event.wait()

    monkeypatch.setattr("backend.cc_watcher.run_watcher", fake_run_watcher)

    async with AsyncExitStack() as stack:
        await stack.enter_async_context(main.lifespan(main.app))
        # Give any spawned task a tick to start (would have fired
        # ``calls.append`` immediately if spawned).
        await asyncio.sleep(0.05)

    assert calls == [], (
        f"supervised watcher detected → in-process watcher MUST NOT run; "
        f"got {len(calls)} invocations"
    )


@pytest.mark.asyncio
async def test_lifespan_spawns_in_process_watcher_when_supervised_missing(
    monkeypatch,
):
    """Bidirectional pair: when the supervised watcher is NOT
    installed, lifespan MUST spawn the in-process watcher (the
    pre-2026-05-26 behavior). Defeats a too-aggressive gate that
    suppresses both paths."""
    from backend import main, watcher_status

    monkeypatch.setenv("CLAUDE_EXPLORER_WATCHER_INSTALLED", "0")
    watcher_status.invalidate_cache()

    calls: list[int] = []

    async def fake_run_watcher(stop_event):
        calls.append(1)
        await stop_event.wait()

    monkeypatch.setattr("backend.cc_watcher.run_watcher", fake_run_watcher)

    async with AsyncExitStack() as stack:
        await stack.enter_async_context(main.lifespan(main.app))
        await asyncio.sleep(0.05)

    assert len(calls) == 1, (
        f"supervised missing → in-process watcher MUST spawn; "
        f"got {len(calls)} invocations"
    )


@pytest.mark.asyncio
async def test_explicit_disable_env_var_wins_over_supervised_detection(
    monkeypatch,
):
    """The explicit ``CLAUDE_EXPLORER_DISABLE_CC_WATCHER=1`` opt-out
    must still skip the in-process watcher even when the supervised
    one isn't installed (e.g. a user running offline or in a sandbox
    where the launchd query would false-negative). Pins that the
    supervised-detection gate doesn't accidentally override the
    explicit env var."""
    from backend import main, watcher_status

    monkeypatch.setenv("CLAUDE_EXPLORER_WATCHER_INSTALLED", "0")
    monkeypatch.setenv("CLAUDE_EXPLORER_DISABLE_CC_WATCHER", "1")
    watcher_status.invalidate_cache()

    calls: list[int] = []

    async def fake_run_watcher(stop_event):
        calls.append(1)
        await stop_event.wait()

    monkeypatch.setattr("backend.cc_watcher.run_watcher", fake_run_watcher)

    async with AsyncExitStack() as stack:
        await stack.enter_async_context(main.lifespan(main.app))
        await asyncio.sleep(0.05)

    assert calls == [], (
        f"explicit DISABLE env var must still suppress the in-process "
        f"watcher; got {len(calls)} invocations"
    )
