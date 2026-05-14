"""Tests for /api/preferences endpoint (P3a).

The preferences blob lives at <data_dir parent>/preferences.json — i.e.
``~/.claude-explorer/preferences.json`` in production. Versioned envelope:

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
    # CLAUDE_EXPLORER_DATA_DIR points at the conversations dir; the
    # preferences file lives in its parent (mirroring ~/.claude-explorer/).
    data_dir = tmp_path / "conversations"
    data_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("CLAUDE_EXPLORER_DATA_DIR", str(data_dir))

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


# ---------------------------------------------------------------------------
# P2.4 — Atomic write recovery (preferences). When os.replace fails mid-write,
# the original file MUST be byte-identical and no .tmp must leak.
# ---------------------------------------------------------------------------


def test__patch_preferences__os_replace_fails__original_byte_identical_no_tmp_leak(
    client_with_prefs, monkeypatch
):
    """PREF-ATOMIC-RECOVERY (P2.4). os.replace OSError → original preserved, no tmp leak.

    Per CLAUDE-TESTING.md section 5.8: simulate kernel-level rename failure at the
    Python boundary (monkeypatch os.replace), not by holding a lock or pulling
    the disk. We don't claim the test models a real kernel reorder; we claim
    the route handler doesn't corrupt user data when its own atomic-write
    helper raises.
    """
    client, prefs_file = client_with_prefs

    # Seed a known-good blob so the recovery target is non-trivial.
    r0 = client.put("/api/preferences", json={"data": {"theme": "dark", "lang": "en"}})
    assert r0.status_code == 200
    original_bytes = prefs_file.read_bytes()

    # Boom: any subsequent write raises before the atomic swap commits.
    import backend.routers.preferences as prefs_mod

    def _boom(_src, _dst):
        raise OSError("simulated kernel-level rename failure")

    monkeypatch.setattr(prefs_mod.os, "replace", _boom)

    # Starlette's TestClient defaults to ``raise_server_exceptions=True``, so
    # an OSError inside the route handler propagates out of ``client.patch``
    # rather than surfacing as a 500. The CONTRACT we care about is the
    # filesystem invariant: original blob preserved, no .tmp leak. FastAPI
    # converts to 500 in production; in tests we just assert it raises and
    # then verify the on-disk state — verified-then-asserted per
    # CLAUDE-TESTING.md section 5.8.
    with pytest.raises(OSError, match="simulated kernel-level rename failure"):
        client.patch("/api/preferences", json={"data": {"theme": "light"}})

    # Original blob is untouched (byte-identical, NOT just JSON-equivalent).
    assert prefs_file.read_bytes() == original_bytes, (
        "original preferences.json must be byte-identical after a failed atomic write"
    )

    # No .tmp leak in the parent directory.
    leaked = list(prefs_file.parent.glob("preferences.json.tmp*"))
    assert leaked == [], f"leaked tmp files after failed atomic write: {leaked}"


# ---------------------------------------------------------------------------
# P4.6 — Deep-merge stress: per-key independence, explicit-null isolation,
# no-op on empty {data: {}}.
# ---------------------------------------------------------------------------


def test__patch_preferences__multi_key__per_key_independent(client_with_prefs):
    """PREF-PATCH-INDEP (P4.6). PATCH with {A, B, C} updates each independently."""
    client, _ = client_with_prefs
    client.put("/api/preferences", json={"data": {
        "theme": "dark", "lang": "en", "keyboardMode": "vim", "untouched": 1,
    }})
    r = client.patch("/api/preferences", json={"data": {
        "theme": "light", "lang": "fr", "keyboardMode": "emacs",
    }})
    assert r.status_code == 200
    data = client.get("/api/preferences").json()["data"]
    assert data["theme"] == "light"
    assert data["lang"] == "fr"
    assert data["keyboardMode"] == "emacs"
    assert data["untouched"] == 1, "key absent from the PATCH must survive"


def test__patch_preferences__null_on_one_key__siblings_unaffected(client_with_prefs):
    """PREF-PATCH-NULL-ISOL (P4.6). Explicit null on key A leaves B/C/D unchanged."""
    client, _ = client_with_prefs
    client.put("/api/preferences", json={"data": {
        "theme": "dark", "lang": "en", "keyboardMode": "vim",
    }})
    r = client.patch("/api/preferences", json={"data": {"theme": None}})
    assert r.status_code == 200
    data = client.get("/api/preferences").json()["data"]
    # Top-level overwrite per key (preferences.py:107-110) — null is a value,
    # not a delete sentinel for unrelated keys.
    assert data["theme"] is None
    assert data["lang"] == "en", "null on theme must NOT clear lang"
    assert data["keyboardMode"] == "vim", "null on theme must NOT clear keyboardMode"


def test__patch_preferences__empty_data__no_op_preserves_all(client_with_prefs):
    """PREF-PATCH-EMPTY-NOOP (P4.6). PATCH {data: {}} is a no-op; nothing changes."""
    client, _ = client_with_prefs
    client.put("/api/preferences", json={"data": {
        "theme": "dark", "lang": "en", "keyboardMode": "vim",
    }})
    before = client.get("/api/preferences").json()["data"]
    r = client.patch("/api/preferences", json={"data": {}})
    assert r.status_code == 200
    after = client.get("/api/preferences").json()["data"]
    assert before == after, f"empty PATCH must not change state; before={before!r} after={after!r}"
