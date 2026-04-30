"""Tests for bookmark CRUD (Build-4)."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client_with_bookmarks(tmp_path, monkeypatch):
    """Spin up a TestClient where bookmarks persist to a tmp file."""
    bookmarks_file = tmp_path / "bookmarks.json"
    monkeypatch.setenv("CLAUDE_EXPLORER_BOOKMARKS_FILE", str(bookmarks_file))

    # Reload modules so the env var is picked up.
    import importlib
    from backend import main as backend_main
    import backend.routers.bookmarks as bm_router
    importlib.reload(bm_router)
    importlib.reload(backend_main)

    return TestClient(backend_main.app), bookmarks_file


def test_list_empty(client_with_bookmarks):
    client, _ = client_with_bookmarks
    r = client.get("/api/bookmarks")
    assert r.status_code == 200
    assert r.json() == {"bookmarks": []}


def test_create_and_list(client_with_bookmarks):
    client, path = client_with_bookmarks
    payload = {
        "conversation_id": "conv-1",
        "message_uuid": "msg-1",
        "source": "claude_code",
        "snippet": "First bookmarked message",
        "note": "important",
    }
    r = client.post("/api/bookmarks", json=payload)
    assert r.status_code == 201
    body = r.json()
    assert body["conversation_id"] == "conv-1"
    assert body["message_uuid"] == "msg-1"
    assert body["note"] == "important"
    assert body["snippet"] == "First bookmarked message"
    assert "id" in body and body["id"]
    assert "created_at" in body

    r2 = client.get("/api/bookmarks")
    assert r2.status_code == 200
    items = r2.json()["bookmarks"]
    assert len(items) == 1
    assert items[0]["id"] == body["id"]

    on_disk = json.loads(path.read_text())
    assert len(on_disk["bookmarks"]) == 1


def test_update_note(client_with_bookmarks):
    client, _ = client_with_bookmarks
    r = client.post("/api/bookmarks", json={
        "conversation_id": "c", "message_uuid": "m", "source": "claude_code",
        "snippet": "s", "note": "old",
    })
    assert r.status_code == 201
    bid = r.json()["id"]

    r2 = client.patch(f"/api/bookmarks/{bid}", json={"note": "new note"})
    assert r2.status_code == 200
    assert r2.json()["note"] == "new note"


def test_delete(client_with_bookmarks):
    client, _ = client_with_bookmarks
    r = client.post("/api/bookmarks", json={
        "conversation_id": "c", "message_uuid": "m", "source": "claude_code",
        "snippet": "s",
    })
    bid = r.json()["id"]
    r2 = client.delete(f"/api/bookmarks/{bid}")
    assert r2.status_code == 204
    assert client.get("/api/bookmarks").json()["bookmarks"] == []


def test_delete_unknown_returns_404(client_with_bookmarks):
    client, _ = client_with_bookmarks
    r = client.delete("/api/bookmarks/no-such-id")
    assert r.status_code == 404
