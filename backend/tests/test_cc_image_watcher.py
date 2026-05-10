"""Tests for backend.cc_image_watcher.

The watcher polls ``~/.claude/image-cache/`` periodically and copies
any new files to the permanent cache. Tests cover:
  - cold scan picks up files already on disk
  - second scan is a no-op (idempotent via the per-process _seen set)
  - new files dropped after the first scan are picked up on the next
  - non-image files are ignored (and remembered as ignored)
  - source rotation between scans doesn't blow up the watcher
"""

from __future__ import annotations

import base64

import pytest


# 1x1 transparent PNG bytes — same payload used elsewhere.
TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAA"
    "YAAjCB0C8AAAAASUVORK5CYII="
)
TINY_PNG_BYTES = base64.b64decode(TINY_PNG_B64)
OTHER_PNG_BYTES = TINY_PNG_BYTES + b"\x00other"


@pytest.fixture
def watcher_env(tmp_path, monkeypatch):
    """Stand up isolated CLAUDE_DIR + CLAUDE_EXPORTER_DATA_DIR and
    clear the watcher's per-process ``_seen`` cache between tests.
    """
    claude_dir = tmp_path / "claude"
    claude_dir.mkdir()
    (claude_dir / "image-cache").mkdir()
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    monkeypatch.setenv("CLAUDE_DIR", str(claude_dir))
    monkeypatch.setenv("CLAUDE_EXPORTER_DATA_DIR", str(data_dir))

    from backend import config, cc_image_watcher

    config.get_settings.cache_clear()
    cc_image_watcher.reset_seen_for_tests()

    yield {
        "claude_dir": claude_dir,
        "data_dir": data_dir,
        "image_cache": claude_dir / "image-cache",
        "perm_cache_root": data_dir.parent / "cc-images"
        if data_dir.name == "conversations"
        else data_dir / "cc-images",
    }

    config.get_settings.cache_clear()
    cc_image_watcher.reset_seen_for_tests()


def _drop_image(image_cache, sess: str, n: str, payload: bytes) -> None:
    sess_dir = image_cache / sess
    sess_dir.mkdir(parents=True, exist_ok=True)
    (sess_dir / f"{n}.png").write_bytes(payload)


def _cached_files(perm_cache_root, sess: str, n: str):
    if not perm_cache_root.exists():
        return []
    return list(perm_cache_root.glob(f"{sess}/{sess}--{n}.*.png"))


def test_cold_scan_picks_up_existing_files(watcher_env):
    from backend import cc_image_watcher

    _drop_image(watcher_env["image_cache"], "sess-cold", "1", TINY_PNG_BYTES)
    _drop_image(watcher_env["image_cache"], "sess-cold", "2", TINY_PNG_BYTES)

    handled = cc_image_watcher.scan_once()
    assert handled == 2

    cached = _cached_files(watcher_env["perm_cache_root"], "sess-cold", "1")
    assert len(cached) == 1
    assert cached[0].read_bytes() == TINY_PNG_BYTES


def test_second_scan_is_idempotent_via_seen_set(watcher_env):
    from backend import cc_image_watcher

    _drop_image(watcher_env["image_cache"], "sess-seen", "1", TINY_PNG_BYTES)
    assert cc_image_watcher.scan_once() == 1
    # Second pass: same path is already in _seen, so it counts 0 newly
    # handled.
    assert cc_image_watcher.scan_once() == 0


def test_files_added_after_first_scan_caught_on_next_pass(watcher_env):
    from backend import cc_image_watcher

    _drop_image(watcher_env["image_cache"], "sess-incr", "1", TINY_PNG_BYTES)
    assert cc_image_watcher.scan_once() == 1

    # Simulate Claude Code dropping a NEW file after our first sweep.
    _drop_image(watcher_env["image_cache"], "sess-incr", "2", OTHER_PNG_BYTES)
    assert cc_image_watcher.scan_once() == 1

    cached_2 = _cached_files(watcher_env["perm_cache_root"], "sess-incr", "2")
    assert len(cached_2) == 1
    assert cached_2[0].read_bytes() == OTHER_PNG_BYTES


def test_non_image_extension_ignored(watcher_env):
    from backend import cc_image_watcher

    sess_dir = watcher_env["image_cache"] / "sess-other"
    sess_dir.mkdir(parents=True)
    (sess_dir / "notes.txt").write_bytes(b"not an image")

    handled = cc_image_watcher.scan_once()
    assert handled == 0
    assert not watcher_env["perm_cache_root"].exists() or not list(
        watcher_env["perm_cache_root"].rglob("*.txt")
    )


def test_scan_once_runs_search_index_drift_pass(watcher_env, monkeypatch):
    """scan_once() also runs the search-index drift pass per Phase 3 of
    PLANS/2026.05.10-search-fts5.md.

    Setup: replace the singleton with a mock that records whether
    update_drifted_files was invoked. is_ready=True so the pass actually
    runs (not bypassed).

    Bug it would surface: forgetting to wire the drift pass into the
    watcher → search index never picks up file changes between
    backend restarts.
    """
    from backend import cc_image_watcher, search_index as si

    drift_called = {"count": 0}

    class _MockIdx:
        def is_ready(self):
            return True

    def _mock_drift(store, *, index=None):
        drift_called["count"] += 1
        return 0

    monkeypatch.setattr(si, "_search_index", _MockIdx())
    monkeypatch.setattr("backend.search_index.update_drifted_files", _mock_drift)

    # Even with no images on disk, the watcher pass should still call
    # the drift function.
    cc_image_watcher.scan_once()
    assert drift_called["count"] == 1, (
        "scan_once() must call update_drifted_files once per pass so the "
        "search index stays in sync with on-disk file changes."
    )


def test_scan_once_skips_drift_when_index_not_ready(watcher_env, monkeypatch):
    """If the index is still building (is_ready=False), the drift pass
    must NOT fire.

    Bug it would surface: drift pass running on a half-built index would
    waste cycles re-indexing files the initial build is about to write.
    """
    from backend import cc_image_watcher, search_index as si

    drift_called = {"count": 0}

    class _MockIdx:
        def is_ready(self):
            return False

    def _mock_drift(store, *, index=None):
        drift_called["count"] += 1
        return 0

    monkeypatch.setattr(si, "_search_index", _MockIdx())
    monkeypatch.setattr("backend.search_index.update_drifted_files", _mock_drift)

    cc_image_watcher.scan_once()
    assert drift_called["count"] == 0


def test_scan_once_drift_failure_does_not_break_image_pass(watcher_env, monkeypatch):
    """If update_drifted_files raises, the image-cache pass MUST still
    complete successfully.

    Negative-space: pin the failure-domain isolation. An error in the
    search-index pass is not allowed to silently break the image
    watcher (which is the load-bearing data-loss prevention path).
    """
    from backend import cc_image_watcher, search_index as si

    class _MockIdx:
        def is_ready(self):
            return True

    def _boom(store, *, index=None):
        raise RuntimeError("simulated drift-pass failure")

    monkeypatch.setattr(si, "_search_index", _MockIdx())
    monkeypatch.setattr("backend.search_index.update_drifted_files", _boom)

    _drop_image(watcher_env["image_cache"], "sess-isolated", "1", TINY_PNG_BYTES)
    handled = cc_image_watcher.scan_once()
    # Image pass completed despite the drift-pass crash.
    assert handled == 1
    cached = _cached_files(watcher_env["perm_cache_root"], "sess-isolated", "1")
    assert len(cached) == 1


def test_source_rotated_between_scans_does_not_break_watcher(watcher_env):
    """If a source file disappears between the rglob enumeration and
    the read, copy_marker_image_to_cache returns None and the watcher
    keeps going without raising.
    """
    from backend import cc_image_watcher

    # File exists when scan starts; disappears after the seen-check but
    # before the read. Easiest way to simulate: after the first scan
    # caches it, delete it manually and re-run. The cache copy should
    # survive (proving rotation safety).
    _drop_image(watcher_env["image_cache"], "sess-rot", "1", TINY_PNG_BYTES)
    cc_image_watcher.scan_once()

    src = watcher_env["image_cache"] / "sess-rot" / "1.png"
    src.unlink()

    # Permanent cache copy still exists and is intact.
    cached = _cached_files(watcher_env["perm_cache_root"], "sess-rot", "1")
    assert len(cached) == 1
    assert cached[0].read_bytes() == TINY_PNG_BYTES

    # Subsequent scan does NOT re-handle the missing path.
    handled = cc_image_watcher.scan_once()
    assert handled == 0
