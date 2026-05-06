"""Tests for /api/preferences endpoint (P3a).

The preferences blob lives at <data_dir parent>/preferences.json — i.e.
``~/.claude-exporter/preferences.json`` in production. Versioned envelope:

    {"version": 1, "data": {"theme": "dark", ...}}

PATCH is the primary write path: it deep-merges (top-level overwrite) into the
existing data so unrelated keys are preserved. PUT replaces the whole blob.
"""

from __future__ import annotations

import importlib
import json
import os
import stat
import threading

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client_with_prefs(tmp_path, monkeypatch):
    """TestClient where preferences persist under tmp_path."""
    # CLAUDE_EXPORTER_DATA_DIR points at the conversations dir; the
    # preferences file lives in its parent (mirroring ~/.claude-exporter/).
    data_dir = tmp_path / "conversations"
    data_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("CLAUDE_EXPORTER_DATA_DIR", str(data_dir))

    # Drop the cached settings so the new env var is honored.
    from backend import config as cfg
    cfg.get_settings.cache_clear()

    # Reload routers + app so the new env var/data_dir is picked up.
    from backend import main as backend_main
    import backend.routers.preferences as prefs_router
    importlib.reload(prefs_router)
    importlib.reload(backend_main)

    prefs_file = tmp_path / "preferences.json"
    return TestClient(backend_main.app), prefs_file


def test_get_returns_defaults_when_file_missing(client_with_prefs):
    client, prefs_file = client_with_prefs
    assert not prefs_file.exists()
    r = client.get("/api/preferences")
    assert r.status_code == 200
    body = r.json()
    assert body == {"version": 1, "data": {}}


def test_patch_creates_file_with_keys(client_with_prefs):
    client, prefs_file = client_with_prefs
    r = client.patch("/api/preferences", json={"data": {"theme": "dark"}})
    assert r.status_code == 200
    assert r.json() == {"version": 1, "data": {"theme": "dark"}}
    assert prefs_file.exists()
    on_disk = json.loads(prefs_file.read_text())
    assert on_disk == {"version": 1, "data": {"theme": "dark"}}


def test_patch_deep_merge_preserves_other_keys(client_with_prefs):
    client, _ = client_with_prefs
    r1 = client.patch("/api/preferences", json={"data": {"theme": "dark"}})
    assert r1.status_code == 200
    r2 = client.patch("/api/preferences", json={"data": {"keyboardMode": "vim"}})
    assert r2.status_code == 200
    r3 = client.get("/api/preferences")
    assert r3.status_code == 200
    data = r3.json()["data"]
    assert data == {"theme": "dark", "keyboardMode": "vim"}


def test_patch_overwrites_same_key(client_with_prefs):
    client, _ = client_with_prefs
    client.patch("/api/preferences", json={"data": {"theme": "dark"}})
    client.patch("/api/preferences", json={"data": {"theme": "light"}})
    r = client.get("/api/preferences")
    assert r.json()["data"]["theme"] == "light"


def test_round_trip_versioned_envelope(client_with_prefs):
    client, prefs_file = client_with_prefs
    client.patch("/api/preferences", json={"data": {"foo": "bar"}})
    on_disk = json.loads(prefs_file.read_text())
    assert "version" in on_disk and on_disk["version"] == 1
    assert "data" in on_disk and isinstance(on_disk["data"], dict)
    assert on_disk["data"] == {"foo": "bar"}


def test_file_mode_0600(client_with_prefs):
    client, prefs_file = client_with_prefs
    client.patch("/api/preferences", json={"data": {"theme": "dark"}})
    mode = stat.S_IMODE(os.stat(prefs_file).st_mode)
    assert oct(mode) == "0o600"


def test_concurrent_patches_dont_corrupt(client_with_prefs):
    client, _ = client_with_prefs

    keys = [f"k{i}" for i in range(5)]
    errors: list[Exception] = []

    def patch_one(key: str) -> None:
        try:
            r = client.patch("/api/preferences", json={"data": {key: f"v-{key}"}})
            assert r.status_code == 200, r.text
        except Exception as e:  # pragma: no cover - reported via list
            errors.append(e)

    threads = [threading.Thread(target=patch_one, args=(k,)) for k in keys]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert errors == []
    final = client.get("/api/preferences").json()["data"]
    for k in keys:
        assert final.get(k) == f"v-{k}", f"Lost key {k} in {final}"


def test_unknown_key_tolerated(client_with_prefs):
    client, _ = client_with_prefs
    r = client.patch(
        "/api/preferences",
        json={"data": {"__unknown_future_key": {"nested": True}}},
    )
    assert r.status_code == 200
    g = client.get("/api/preferences")
    assert g.status_code == 200
    assert g.json()["data"]["__unknown_future_key"] == {"nested": True}


def test_put_replaces_whole_blob(client_with_prefs):
    client, _ = client_with_prefs
    client.patch("/api/preferences", json={"data": {"keyboardMode": "vim"}})
    r = client.put("/api/preferences", json={"data": {"theme": "light"}})
    assert r.status_code == 200
    final = client.get("/api/preferences").json()["data"]
    assert final == {"theme": "light"}
    assert "keyboardMode" not in final
