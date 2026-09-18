"""The refresh concurrency flag must not survive an abandoned stream.

Found 2026-09-16. `refresh_pipeline` sets the module-level
`_refresh_in_progress = True` in the HANDLER, but the only reset is the
`finally` inside `refresh_pipeline_stream`:

    _refresh_in_progress = True
    return StreamingResponse(
        refresh_pipeline_stream(incremental=incremental, limit=limit), ...)

An async generator's `finally` runs only if its body was ever entered.
At that point the generator has merely been CONSTRUCTED. Starlette never
calls `aclose()` on a body iterator (grep `responses.py`), so an
un-started generator that gets dropped is finalised without executing
its body -- the flag stays True.

Failure scenario: the user clicks Refresh and immediately navigates away
or hits Esc, so the connection is torn down before `stream_response`
reaches the first `__anext__`. anyio cancels the task group, the
generator is collected un-started, and every later
`GET /api/fetch/refresh` returns `409 Refresh already in progress` --
with no work running anywhere -- until the worker restarts.

The fix primes the generator inside the handler, so its body (and
therefore its `finally`) is guaranteed to have been entered before the
iterator is handed to Starlette. A started generator that is abandoned
gets `aclose()`d by asyncio's async-generator finaliser, which runs the
`finally`.
"""
from __future__ import annotations

from pathlib import Path

import pytest

import backend.routers.fetch as fetch_mod


@pytest.fixture(autouse=True)
def _reset_flag():
    fetch_mod._refresh_in_progress = False
    yield
    fetch_mod._refresh_in_progress = False


@pytest.fixture
def capture_path_only(monkeypatch, tmp_path: Path):
    """Force the capture branch and make capture emit one event then fail,
    so the real refresh generator runs start-to-finish quickly."""
    monkeypatch.setattr(
        fetch_mod, "DEFAULT_CREDENTIALS_PATH", tmp_path / "nope.json"
    )

    async def _fake_capture():
        yield ("event", "data: {\"type\": \"capture_start\"}\n\n")
        yield ("error", "synthetic failure")

    monkeypatch.setattr(fetch_mod, "_capture_phase_stream", _fake_capture)


async def test_flag_is_released_when_the_body_is_never_consumed(
    capture_path_only,
) -> None:
    """The headline case: response built, client goes away, nobody ever
    iterates the body."""
    resp = await fetch_mod.refresh_pipeline(incremental=True, limit=None)
    assert fetch_mod._refresh_in_progress is True, (
        "the handler must claim the flag synchronously so the 409 check "
        "stays race-free"
    )

    await resp.body_iterator.aclose()

    assert fetch_mod._refresh_in_progress is False, (
        "abandoning the stream must release the refresh flag; otherwise "
        "every later refresh 409s until the worker restarts"
    )


async def test_flag_is_released_after_a_full_consume(capture_path_only) -> None:
    """No regression on the normal path."""
    resp = await fetch_mod.refresh_pipeline(incremental=True, limit=None)

    chunks = [c async for c in resp.body_iterator]

    assert chunks, "the stream must still deliver its events"
    assert any("capture_start" in c for c in chunks)
    assert fetch_mod._refresh_in_progress is False


async def test_second_request_409s_while_one_is_live(capture_path_only) -> None:
    """The flag still does its job."""
    from fastapi import HTTPException

    resp = await fetch_mod.refresh_pipeline(incremental=True, limit=None)
    try:
        with pytest.raises(HTTPException) as ei:
            await fetch_mod.refresh_pipeline(incremental=True, limit=None)
        assert ei.value.status_code == 409
    finally:
        await resp.body_iterator.aclose()


async def test_error_before_the_first_yield_becomes_an_error_frame(
    monkeypatch, tmp_path
) -> None:
    """A generator that blows up before its first yield must still close
    the stream cleanly and release the flag.

    This used to propagate out of the handler as a 500 (and the handler
    released the flag in an `except BaseException`). Since the pipeline
    grew a terminal-error frame -- see
    docs/notes/BACKLOG-verified-unfixed.md item 5 -- the exception is
    caught inside the generator and delivered to the client as a normal
    `error` event, which is what the frontend knows how to render. The
    flag is then released by the generator's `finally` like any other
    completion.
    """
    monkeypatch.setattr(
        fetch_mod, "DEFAULT_CREDENTIALS_PATH", tmp_path / "nope.json"
    )

    async def _boom():
        raise RuntimeError("capture exploded")
        yield  # pragma: no cover - makes this an async generator

    monkeypatch.setattr(fetch_mod, "_capture_phase_stream", _boom)

    resp = await fetch_mod.refresh_pipeline(incremental=True, limit=None)
    chunks = [c async for c in resp.body_iterator]

    assert any("error" in c for c in chunks), (
        f"expected a terminal error frame, got {chunks!r}"
    )
    assert any("capture exploded" in c for c in chunks)
    assert fetch_mod._refresh_in_progress is False
