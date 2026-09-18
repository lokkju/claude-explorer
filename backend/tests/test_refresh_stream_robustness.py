"""Two robustness holes in the refresh SSE pipeline.

Both from docs/notes/BACKLOG-verified-unfixed.md.

**1. No terminal error frame.** ``refresh_pipeline_stream`` had
``try/finally`` but no ``except``, and ``_fetch_phase_stream`` guards
only ``load_credentials`` -- everything after it (``mkdir``,
``ClaudeFetcher(...)``, ``existing_pairs()``) is unguarded. A read-only
or full volume, or a stale network mount, makes ``mkdir`` raise; it
propagates out of both generators and Starlette aborts an already-200
response mid-body. The client receives no ``error`` frame and no
``complete``, so the sidebar spinner spins forever. The older
``fetch_conversations_stream`` wraps its whole body and emits an error
event; the refresh path did not, and the asymmetry looks unintentional.

**2. Leaked capture task.** In ``_run_capture_with_keepalive``,
``capture_task.cancel()`` ran only inside ``except Exception``.
``GeneratorExit`` and ``CancelledError`` are ``BaseException``, so
closing the stream mid-capture bypassed it entirely and there was no
``finally``. Closing the tab ~10s into a headful capture left the
browser up for the remaining ~290s, and the next click launched a second
one; both could race to ``save_credentials`` on the same path.
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

import backend.routers.fetch as fetch_mod


@pytest.fixture(autouse=True)
def _reset_flag():
    fetch_mod._refresh_in_progress = False
    yield
    fetch_mod._refresh_in_progress = False


def _frames(chunks: list[str]) -> list[dict]:
    out = []
    for c in chunks:
        for line in c.splitlines():
            if line.startswith("data: "):
                try:
                    out.append(json.loads(line[6:]))
                except json.JSONDecodeError:
                    pass
    return out


async def test_unexpected_error_emits_a_terminal_error_frame(
    monkeypatch, tmp_path: Path
) -> None:
    """Bug it would surface: the stream dying mid-body with no error
    frame, leaving the frontend spinner running indefinitely."""
    creds = tmp_path / "credentials.json"
    creds.write_text("{}")
    monkeypatch.setattr(fetch_mod, "DEFAULT_CREDENTIALS_PATH", creds)

    async def _boom(*a, **k):
        raise OSError(30, "Read-only file system")
        yield  # pragma: no cover - makes this an async generator

    monkeypatch.setattr(fetch_mod, "_fetch_phase_stream", _boom)

    resp = await fetch_mod.refresh_pipeline(incremental=True, limit=None)
    chunks = [c async for c in resp.body_iterator]

    frames = _frames(chunks)
    assert frames, f"stream produced no parseable frames: {chunks!r}"
    assert frames[-1].get("type") == "error", (
        "an exception inside the pipeline must still close the stream with "
        f"a terminal error frame; got {frames!r}"
    )
    assert "Read-only file system" in json.dumps(frames[-1])
    assert fetch_mod._refresh_in_progress is False


async def test_capture_task_is_cancelled_when_the_stream_is_closed(
    monkeypatch,
) -> None:
    """Bug it would surface: GeneratorExit bypassing the only cancel()
    call, leaving a headful browser running for the full timeout."""
    started = asyncio.Event()

    async def _never_finishes(timeout: int = 0, headless: bool = False):
        started.set()
        await asyncio.sleep(3600)

    monkeypatch.setattr(fetch_mod, "capture_credentials", _never_finishes)
    monkeypatch.setattr(fetch_mod, "CAPTURE_KEEPALIVE_SECONDS", 0.05)

    agen = fetch_mod._run_capture_with_keepalive(timeout=300)
    # Pull one keep-alive so the capture task is definitely running.
    await agen.__anext__()
    await asyncio.wait_for(started.wait(), timeout=2)

    tasks_before = [
        t for t in asyncio.all_tasks()
        if t.get_coro().__name__ == "_never_finishes"
    ]
    assert tasks_before, "precondition: capture task is running"

    await agen.aclose()
    await asyncio.sleep(0)

    assert all(t.cancelled() or t.done() for t in tasks_before), (
        "closing the stream must cancel the capture task; otherwise a "
        "headful browser stays open for the remaining timeout"
    )
