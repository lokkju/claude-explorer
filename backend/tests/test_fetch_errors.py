"""Fetch error mapping + credentials age surfacing.

Build-1 from PLANS/explorer-improvements-build.md.

The fetch error pipeline used to only string-match "401" and surface
generic errors otherwise. Cloudflare blocks return 403 with a
'cf-mitigated' header, and an expired sessionKey can also return 403.
Both must map to a single actionable message: "Session expired or
Cloudflare-blocked. Re-run claude-explorer capture."

In addition, /api/fetch/status now exposes credentials_age_days so the
UI can warn when credentials are stale.
"""

from __future__ import annotations

import json
import os
import time

from backend.routers.fetch import classify_fetch_error


def test_classify_401_as_session_expired() -> None:
    msg = classify_fetch_error("401 Client Error: Unauthorized for url: https://...")
    assert "Re-run" in msg and "capture" in msg.lower()


def test_classify_403_as_session_expired() -> None:
    msg = classify_fetch_error("403 Client Error: Forbidden for url: https://...")
    assert "Re-run" in msg and "capture" in msg.lower()


def test_classify_cf_mitigated_as_session_expired() -> None:
    msg = classify_fetch_error(
        "403 Client Error: Forbidden | cf-mitigated: challenge"
    )
    assert "Re-run" in msg and "capture" in msg.lower()


def test_classify_other_500_passes_through() -> None:
    msg = classify_fetch_error("500 Internal Server Error")
    assert "Re-run" not in msg
    assert "500" in msg or "Internal" in msg


def test_classify_connection_error_passes_through() -> None:
    msg = classify_fetch_error("Connection refused")
    assert "Re-run" not in msg
    assert "Connection refused" in msg


def test_status_includes_credentials_age_days(client, tmp_path, monkeypatch) -> None:
    creds = tmp_path / "credentials.json"
    creds.write_text(json.dumps({"session_key": "sk", "org_id": "o"}))
    age_seconds = 20 * 24 * 3600
    old = time.time() - age_seconds
    os.utime(creds, (old, old))

    monkeypatch.setattr(
        "backend.routers.fetch.DEFAULT_CREDENTIALS_PATH", creds, raising=True
    )

    response = client.get("/api/fetch/status")
    assert response.status_code == 200
    body = response.json()
    assert body["has_credentials"] is True
    assert "credentials_age_days" in body
    assert 19 <= body["credentials_age_days"] <= 21


def test_status_credentials_age_none_when_missing(client, tmp_path, monkeypatch) -> None:
    creds = tmp_path / "no_creds_here.json"
    monkeypatch.setattr(
        "backend.routers.fetch.DEFAULT_CREDENTIALS_PATH", creds, raising=True
    )

    response = client.get("/api/fetch/status")
    assert response.status_code == 200
    body = response.json()
    assert body["has_credentials"] is False
    assert body["credentials_age_days"] is None
