"""Tests for the image-attachment proxy.

The proxy fetches /api/<org>/files/<uuid>/{thumbnail,preview} from
claude.ai using the captured sessionKey cookie, and returns the bytes
to the same-origin browser. These tests cover the request shape +
error handling without hitting the live claude.ai (which we mock).
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def fresh_creds(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Drop a fake credentials.json that load_credentials will accept."""
    creds = {
        "schema_version": 2,
        "session_key": "sk-ant-sid01-fake-test-key",
        "primary_org_id": "ae24ae66-4622-48e7-b4b3-1ab2c49f933d",
        "org_id": "ae24ae66-4622-48e7-b4b3-1ab2c49f933d",
        "orgs": [
            {
                "uuid": "ae24ae66-4622-48e7-b4b3-1ab2c49f933d",
                "name": "Personal",
                "capabilities": [],
            }
        ],
        "captured_at": "2026-05-03T00:00:00Z",
        "cf_bm": "fake-cf-bm",
        "cf_clearance": "fake-cf-clearance",
    }
    creds_path = tmp_path / "credentials.json"
    creds_path.write_text(json.dumps(creds))
    monkeypatch.setattr(
        "backend.routers.files.DEFAULT_CREDENTIALS_PATH", creds_path
    )
    return creds_path


@pytest.fixture
def client_no_creds(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setattr(
        "backend.routers.files.DEFAULT_CREDENTIALS_PATH",
        tmp_path / "missing.json",
    )
    from backend.main import app
    return TestClient(app)


def test_proxy_503_when_no_credentials(client_no_creds: TestClient) -> None:
    resp = client_no_creds.get("/api/test-org/files/test-uuid/thumbnail")
    assert resp.status_code == 503
    assert "claude-explorer capture" in resp.json()["detail"]


def test_proxy_streams_upstream_bytes(fresh_creds: Path) -> None:
    from backend.main import app
    client = TestClient(app)

    upstream = MagicMock()
    upstream.status_code = 200
    upstream.content = b"\xff\xd8\xff\xe0FAKEJPEGBYTES"
    upstream.headers = {"content-type": "image/webp"}

    with patch("curl_cffi.requests.get", return_value=upstream) as mock_get:
        resp = client.get("/api/org-1/files/file-1/thumbnail")

    assert resp.status_code == 200
    assert resp.content == b"\xff\xd8\xff\xe0FAKEJPEGBYTES"
    assert resp.headers["content-type"] == "image/webp"
    assert "max-age" in resp.headers["cache-control"]

    args, kwargs = mock_get.call_args
    assert args[0] == "https://claude.ai/api/org-1/files/file-1/thumbnail"
    assert kwargs["cookies"]["sessionKey"] == "sk-ant-sid01-fake-test-key"
    assert kwargs["cookies"]["__cf_bm"] == "fake-cf-bm"
    assert kwargs["impersonate"] == "chrome"


def test_proxy_404_propagates(fresh_creds: Path) -> None:
    from backend.main import app
    client = TestClient(app)
    upstream = MagicMock()
    upstream.status_code = 404
    upstream.content = b'{"detail":"not found"}'
    upstream.headers = {"content-type": "application/json"}
    with patch("curl_cffi.requests.get", return_value=upstream):
        resp = client.get("/api/org-1/files/missing/preview")
    assert resp.status_code == 404
    assert "image not found" in resp.json()["detail"]


def test_proxy_401_surfaces_capture_hint(fresh_creds: Path) -> None:
    from backend.main import app
    client = TestClient(app)
    upstream = MagicMock()
    upstream.status_code = 401
    upstream.content = b"unauthorized"
    upstream.headers = {"content-type": "text/plain"}
    with patch("curl_cffi.requests.get", return_value=upstream):
        resp = client.get("/api/org-1/files/file-1/thumbnail")
    assert resp.status_code == 401
    assert "session expired" in resp.json()["detail"].lower()


def test_proxy_preview_endpoint(fresh_creds: Path) -> None:
    """Preview variant is a separate route from thumbnail."""
    from backend.main import app
    client = TestClient(app)
    upstream = MagicMock()
    upstream.status_code = 200
    upstream.content = b"PNG-BYTES"
    upstream.headers = {"content-type": "image/png"}
    with patch("curl_cffi.requests.get", return_value=upstream) as mock_get:
        resp = client.get("/api/o/files/f/preview")
    assert resp.status_code == 200
    args, _ = mock_get.call_args
    assert args[0].endswith("/files/f/preview")
