"""Build-9: One-button Refresh — combined capture + fetch SSE pipeline.

Refresh in the UI must own the full pipeline. If credentials are missing or
the fetch fails with a session-expired signal (401/403/cf-mitigated), the
backend automatically launches Playwright capture, persists the new
credentials, and then continues with an INCREMENTAL fetch.

Endpoint: GET /api/fetch/refresh?incremental=true
Stream events:
    capture_start         - Playwright browser is opening
    capture_waiting_login - User must log in (may fire repeatedly as keep-alive)
    capture_done          - Credentials captured + saved
    capture_error         - Capture failed (closed browser / timeout / no creds)
    start                 - Fetch list begin (existing)
    progress              - Per-conversation progress (existing)
    complete              - Fetch finished (existing)
    error                 - Fetch failed (existing)

Concurrency:
    A second concurrent /fetch/refresh request returns HTTP 409.

Atomicity:
    capture_credentials is invoked at most once per request. If post-capture
    fetch still 401s, we emit `error` and stop — never loop capture again.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient


def _parse_sse_events(text: str) -> list[dict]:
    """Parse a `text/event-stream` response body into a list of JSON events.

    Ignores keep-alive comment lines (`: ping`).
    """
    events: list[dict] = []
    for raw in text.split("\n\n"):
        line = raw.strip()
        if not line:
            continue
        if line.startswith(":"):  # SSE comment — keep-alive
            continue
        if line.startswith("data:"):
            payload = line[len("data:") :].strip()
            try:
                events.append(json.loads(payload))
            except json.JSONDecodeError:
                pass
    return events


@pytest.fixture
def isolated_creds(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Point the fetch router at a temp credentials path with no file present."""
    creds = tmp_path / "credentials.json"
    monkeypatch.setattr(
        "backend.routers.fetch.DEFAULT_CREDENTIALS_PATH", creds, raising=True
    )
    return creds


@pytest.fixture
def isolated_output(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    out = tmp_path / "conversations"
    out.mkdir()
    monkeypatch.setattr(
        "backend.routers.fetch.DEFAULT_OUTPUT_DIR", out, raising=True
    )
    monkeypatch.setattr(
        "backend.routers.fetch.DEFAULT_FILES_DIR", tmp_path / "files", raising=True
    )
    return out


def _stub_capture(creds_path: Path, payload: dict[str, Any] | None = None):
    """Build an async stub that mimics playwright_capture.capture_credentials."""

    async def _stub(timeout: int = 300, headless: bool = False) -> dict | None:
        if payload is None:
            return None
        return payload

    return _stub


def test_missing_credentials_triggers_capture(
    client: TestClient,
    isolated_creds: Path,
    isolated_output: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No creds on disk -> stream begins with capture_start, then capture_done."""

    captured = {"session_key": "sk-new", "org_id": "org-new"}

    async def fake_capture(timeout: int = 300, headless: bool = False) -> dict:
        return captured

    monkeypatch.setattr(
        "backend.routers.fetch.capture_credentials", fake_capture, raising=False
    )

    # Stub the fetcher's network methods so post-capture fetch returns no
    # conversations (we just want to assert the event order, not exercise
    # bulk_fetch).
    monkeypatch.setattr(
        "backend.routers.fetch.ClaudeFetcher.fetch_conversation_list",
        lambda self: [],
        raising=False,
    )
    monkeypatch.setattr(
        "backend.routers.fetch.ClaudeFetcher.save_index",
        lambda self, conversations: None,
        raising=False,
    )

    response = client.get("/api/fetch/refresh?incremental=true")
    assert response.status_code == 200
    events = _parse_sse_events(response.text)
    types = [e["type"] for e in events]

    assert "capture_start" in types, f"expected capture_start in {types}"
    assert "capture_done" in types, f"expected capture_done in {types}"
    # capture_start must precede capture_done
    assert types.index("capture_start") < types.index("capture_done")
    # After capture, the fetch phase must run
    assert "complete" in types, f"expected complete after capture in {types}"
    assert types.index("capture_done") < types.index("complete")

    # And the credentials file must now exist with the captured payload
    assert isolated_creds.exists()
    saved = json.loads(isolated_creds.read_text())
    assert saved["session_key"] == "sk-new"
    assert saved["org_id"] == "org-new"


def test_valid_credentials_skip_capture(
    client: TestClient,
    isolated_creds: Path,
    isolated_output: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Creds already present + fetch succeeds -> no capture events emitted."""
    isolated_creds.parent.mkdir(parents=True, exist_ok=True)
    isolated_creds.write_text(
        json.dumps({"session_key": "sk-existing", "org_id": "org-existing"})
    )

    async def fail_capture(*args, **kwargs):  # pragma: no cover - must not run
        raise AssertionError("capture must not be invoked when creds are valid")

    monkeypatch.setattr(
        "backend.routers.fetch.capture_credentials", fail_capture, raising=False
    )
    monkeypatch.setattr(
        "backend.routers.fetch.ClaudeFetcher.fetch_conversation_list",
        lambda self: [],
        raising=False,
    )
    monkeypatch.setattr(
        "backend.routers.fetch.ClaudeFetcher.save_index",
        lambda self, conversations: None,
        raising=False,
    )

    response = client.get("/api/fetch/refresh?incremental=true")
    assert response.status_code == 200
    events = _parse_sse_events(response.text)
    types = [e["type"] for e in events]

    assert "capture_start" not in types
    assert "capture_done" not in types
    assert "complete" in types


def test_session_expired_triggers_recapture_then_retry(
    client: TestClient,
    isolated_creds: Path,
    isolated_output: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Stale creds: first fetch attempt 401s -> capture runs -> retry succeeds."""
    isolated_creds.parent.mkdir(parents=True, exist_ok=True)
    isolated_creds.write_text(
        json.dumps({"session_key": "sk-stale", "org_id": "org-stale"})
    )

    async def fake_capture(timeout: int = 300, headless: bool = False) -> dict:
        return {"session_key": "sk-fresh", "org_id": "org-fresh"}

    monkeypatch.setattr(
        "backend.routers.fetch.capture_credentials", fake_capture, raising=False
    )

    call_count = {"n": 0}

    def fake_list(self):
        call_count["n"] += 1
        if call_count["n"] == 1:
            raise RuntimeError("401 Client Error: Unauthorized")
        return []

    monkeypatch.setattr(
        "backend.routers.fetch.ClaudeFetcher.fetch_conversation_list",
        fake_list,
        raising=False,
    )
    monkeypatch.setattr(
        "backend.routers.fetch.ClaudeFetcher.save_index",
        lambda self, conversations: None,
        raising=False,
    )

    response = client.get("/api/fetch/refresh?incremental=true")
    assert response.status_code == 200
    events = _parse_sse_events(response.text)
    types = [e["type"] for e in events]

    assert "capture_start" in types
    assert "capture_done" in types
    assert "complete" in types
    assert call_count["n"] == 2  # initial 401 + post-capture retry


def test_capture_failure_emits_error_event(
    client: TestClient,
    isolated_creds: Path,
    isolated_output: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """User closes browser / timeout -> capture returns None -> error event."""

    async def fake_capture(timeout: int = 300, headless: bool = False) -> None:
        return None

    monkeypatch.setattr(
        "backend.routers.fetch.capture_credentials", fake_capture, raising=False
    )

    response = client.get("/api/fetch/refresh?incremental=true")
    assert response.status_code == 200
    events = _parse_sse_events(response.text)
    types = [e["type"] for e in events]

    assert "capture_start" in types
    assert "error" in types or "capture_error" in types
    # Once capture fails, no fetch phase should follow
    assert "complete" not in types


def test_post_capture_still_401_does_not_loop(
    client: TestClient,
    isolated_creds: Path,
    isolated_output: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """After capture, fetch still 401s (e.g. wrong account) -> emit error and stop.

    Capture must be invoked AT MOST ONCE per request — never loop.
    """
    isolated_creds.parent.mkdir(parents=True, exist_ok=True)
    isolated_creds.write_text(
        json.dumps({"session_key": "sk-stale", "org_id": "org-stale"})
    )

    capture_calls = {"n": 0}

    async def fake_capture(timeout: int = 300, headless: bool = False) -> dict:
        capture_calls["n"] += 1
        return {"session_key": "sk-also-stale", "org_id": "org-also-stale"}

    monkeypatch.setattr(
        "backend.routers.fetch.capture_credentials", fake_capture, raising=False
    )

    def always_401(self):
        raise RuntimeError("401 Client Error: Unauthorized")

    monkeypatch.setattr(
        "backend.routers.fetch.ClaudeFetcher.fetch_conversation_list",
        always_401,
        raising=False,
    )

    response = client.get("/api/fetch/refresh?incremental=true")
    assert response.status_code == 200
    events = _parse_sse_events(response.text)
    types = [e["type"] for e in events]

    assert capture_calls["n"] == 1, "capture must run exactly once per request"
    assert "error" in types
    assert "complete" not in types


def test_concurrent_refresh_returns_409(
    client: TestClient,
    isolated_creds: Path,
    isolated_output: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """While a refresh is mid-flight, a second call must return 409 Conflict."""
    import backend.routers.fetch as fetch_mod

    # Force the in-progress flag so the second request sees a conflict, even
    # though no actual stream is running. This mirrors the real behavior of
    # the lock under contention.
    fetch_mod._refresh_in_progress = True
    try:
        response = client.get("/api/fetch/refresh?incremental=true")
        assert response.status_code == 409
        body = response.json()
        assert "in progress" in body.get("detail", "").lower()
    finally:
        fetch_mod._refresh_in_progress = False


def test_credentials_saved_with_0o600_perms(
    client: TestClient,
    isolated_creds: Path,
    isolated_output: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Captured credentials must be persisted with 0o600 (owner-read-only)."""

    async def fake_capture(timeout: int = 300, headless: bool = False) -> dict:
        return {"session_key": "sk-perm", "org_id": "org-perm"}

    monkeypatch.setattr(
        "backend.routers.fetch.capture_credentials", fake_capture, raising=False
    )
    monkeypatch.setattr(
        "backend.routers.fetch.ClaudeFetcher.fetch_conversation_list",
        lambda self: [],
        raising=False,
    )
    monkeypatch.setattr(
        "backend.routers.fetch.ClaudeFetcher.save_index",
        lambda self, conversations: None,
        raising=False,
    )

    response = client.get("/api/fetch/refresh?incremental=true")
    assert response.status_code == 200
    assert isolated_creds.exists()

    mode = isolated_creds.stat().st_mode & 0o777
    assert mode == 0o600, f"credentials must be 0o600, got {oct(mode)}"
