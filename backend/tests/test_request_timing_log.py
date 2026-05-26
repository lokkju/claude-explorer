"""Regression: every HTTP response logs a single line including the
elapsed request time.

User asked (2026-05-22): "Why not change the uvicorn logging so that
it logs the elapsed time for the request? That's clean, would not
clutter the logs, and would be useful long-term."

User-observable contract (per CLAUDE-TESTING §5.13):
  - Every successful response triggers ONE log line.
  - The line contains the request method, path, status, and elapsed
    time formatted as a float (seconds, 3 decimal places).
  - A fast request (e.g. /api/info, ~5ms) and a slow request (an
    artificially-slowed route) produce DIFFERENT elapsed values —
    i.e. the timer measures real work, not a constant placeholder.

Bidirectional pair:
  - Positive: fast request emits a line with `elapsed=` and a small
    number.
  - Discriminator: slow request (sleeps 200ms) emits a larger number.
    Without the timer actually wrapping the request, both would
    show the same near-zero value.

Why not just rely on uvicorn's access log: uvicorn's default log
format does NOT include elapsed time. Adding a custom format string
to uvicorn requires per-deployment `--log-config`; baking timing
into our own middleware keeps it in-tree and survives any deploy
config.
"""

from __future__ import annotations

import logging
import re

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.main import install_request_timing_middleware


@pytest.fixture
def timed_app(caplog) -> TestClient:
    """A minimal FastAPI app with the timing middleware installed.

    Avoids the full backend.main:app surface (lifespan + 9 routers)
    so the test focuses on the middleware contract alone.
    """
    app = FastAPI()
    install_request_timing_middleware(app)

    @app.get('/fast')
    def fast():
        return {'ok': True}

    @app.get('/slow')
    def slow():
        import time
        time.sleep(0.2)
        return {'ok': True}

    # Middleware logs through uvicorn.error so the line survives
    # `--no-access-log` and uvicorn's default LOGGING_CONFIG (which
    # doesn't wire `backend.main`). See install_request_timing_middleware
    # docstring for the bug history.
    caplog.set_level(logging.INFO, logger='uvicorn.error')
    return TestClient(app)


def _find_timing_line(caplog, method: str, path: str) -> str | None:
    """Return the timing log line matching method+path, or None."""
    for record in caplog.records:
        msg = record.getMessage()
        if method in msg and path in msg and 'elapsed=' in msg:
            return msg
    return None


def test_fast_request_emits_one_timing_line_with_small_elapsed(timed_app, caplog):
    timed_app.get('/fast')
    line = _find_timing_line(caplog, 'GET', '/fast')
    assert line is not None, (
        f'Expected one log line containing GET /fast and elapsed=. '
        f'Got: {[r.getMessage() for r in caplog.records]}'
    )
    # Status code present.
    assert ' 200' in line, f'Expected status 200 in log line; got: {line!r}'
    # Elapsed parses as a float < 0.1s (a no-op handler is microseconds).
    match = re.search(r'elapsed=([\d.]+)s', line)
    assert match is not None, f'No elapsed=<n>s in log line: {line!r}'
    elapsed_s = float(match.group(1))
    assert elapsed_s < 0.1, (
        f'Fast handler should log a tiny elapsed; got {elapsed_s}s'
    )


def test_slow_request_emits_a_proportionally_larger_elapsed(timed_app, caplog):
    timed_app.get('/slow')
    line = _find_timing_line(caplog, 'GET', '/slow')
    assert line is not None
    match = re.search(r'elapsed=([\d.]+)s', line)
    assert match is not None, f'No elapsed=<n>s in log line: {line!r}'
    elapsed_s = float(match.group(1))
    # The handler sleeps 200ms. Allow some slack for test-harness overhead.
    assert elapsed_s >= 0.15, (
        f'Slow handler should log >=0.15s elapsed; got {elapsed_s}s. '
        f"The timer isn't wrapping the request body."
    )


def test_no_duplicate_timing_lines_per_request(timed_app, caplog):
    timed_app.get('/fast')
    timing_lines = [
        r.getMessage()
        for r in caplog.records
        if 'elapsed=' in r.getMessage() and '/fast' in r.getMessage()
    ]
    assert len(timing_lines) == 1, (
        f'Expected exactly one timing line per request; got {len(timing_lines)}: {timing_lines}'
    )
