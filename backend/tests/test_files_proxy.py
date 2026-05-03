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


# ----------------------------------------------------------------------
# Claude Code image-cache route tests
# ----------------------------------------------------------------------

def test_cc_image_serves_file_under_image_cache(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    cache_root = tmp_path / "image-cache" / "test-session"
    cache_root.mkdir(parents=True)
    img_path = cache_root / "1.png"
    img_path.write_bytes(
        b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01'
        b'\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xfc\xff'
        b'\xff?\x03\x00\x05\xfe\x02\xfe\xa6\x14\xa6\x9d\x00\x00\x00\x00IEND\xaeB`\x82'
    )
    monkeypatch.setenv("CLAUDE_DIR", str(tmp_path))
    from backend import config
    config.get_settings.cache_clear()
    from backend.main import app
    client = TestClient(app)
    resp = client.get("/api/cc-image", params={"path": str(img_path)})
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("image/png")
    assert resp.content.startswith(b"\x89PNG")


def test_cc_image_refuses_path_outside_image_cache(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    (tmp_path / "image-cache").mkdir()
    secret = tmp_path / "secret.png"
    secret.write_bytes(b"\x89PNG-secret-bytes")
    monkeypatch.setenv("CLAUDE_DIR", str(tmp_path))
    from backend import config
    config.get_settings.cache_clear()
    from backend.main import app
    client = TestClient(app)
    resp = client.get("/api/cc-image", params={"path": str(secret)})
    assert resp.status_code == 403
    assert "outside" in resp.json()["detail"].lower()


def test_cc_image_refuses_non_image_extension(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    cache = tmp_path / "image-cache" / "session"
    cache.mkdir(parents=True)
    txt = cache / "leaked.txt"
    txt.write_bytes(b"sensitive text content")
    monkeypatch.setenv("CLAUDE_DIR", str(tmp_path))
    from backend import config
    config.get_settings.cache_clear()
    from backend.main import app
    client = TestClient(app)
    resp = client.get("/api/cc-image", params={"path": str(txt)})
    assert resp.status_code == 400
    assert "extension" in resp.json()["detail"].lower()


def test_cc_image_404_for_missing_path(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    (tmp_path / "image-cache" / "session").mkdir(parents=True)
    monkeypatch.setenv("CLAUDE_DIR", str(tmp_path))
    from backend import config
    config.get_settings.cache_clear()
    from backend.main import app
    client = TestClient(app)
    resp = client.get(
        "/api/cc-image",
        params={"path": str(tmp_path / "image-cache" / "session" / "nope.png")},
    )
    assert resp.status_code == 404
