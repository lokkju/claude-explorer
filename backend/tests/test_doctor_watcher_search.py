from __future__ import annotations

import backend.doctor as doctor
from backend.doctor import Status


def test_watcher_installed_is_ok(monkeypatch) -> None:
    monkeypatch.setenv("CLAUDE_EXPLORER_WATCHER_INSTALLED", "1")
    from backend import watcher_status
    watcher_status.invalidate_cache()
    assert doctor.check_watcher().status is Status.OK


def test_watcher_missing_is_warn_with_fix(monkeypatch) -> None:
    monkeypatch.setenv("CLAUDE_EXPLORER_WATCHER_INSTALLED", "0")
    from backend import watcher_status
    watcher_status.invalidate_cache()
    r = doctor.check_watcher()
    assert r.status is Status.WARN
    assert "install-watcher" in (r.fix_command or "")


def test_search_built_on_disk_is_ok(monkeypatch) -> None:
    # Healthy on-disk index (schema intact + populated). Note is_ready()
    # returns False here — as it always does in a cold CLI — so the check
    # must NOT rely on it.
    class _Idx:
        def is_ready(self) -> bool:
            return False
        def is_built_on_disk(self) -> bool:
            return True
        def indexed_file_count(self) -> int:
            return 42
    monkeypatch.setattr(doctor, "get_search_index", lambda: _Idx())
    r = doctor.check_search()
    assert r.status is Status.OK
    assert "42" in r.detail


def test_search_unavailable_is_warn(monkeypatch) -> None:
    monkeypatch.setattr(doctor, "get_search_index", lambda: None)
    r = doctor.check_search()
    assert r.status is Status.WARN
    assert "linear" in r.detail.lower()


def test_search_not_built_is_warn_with_fix(monkeypatch) -> None:
    class _Idx:
        def is_built_on_disk(self) -> bool:
            return False
        def indexed_file_count(self) -> int:
            return 0
    monkeypatch.setattr(doctor, "get_search_index", lambda: _Idx())
    r = doctor.check_search()
    assert r.status is Status.WARN
    assert "reindex-search" in (r.fix_command or "")


# ---------------------------------------------------------------------------
# Per-source index coverage (docs/notes/doctor-blind-to-index-coverage.md)
#
# check_search used to report `index present (N file(s) indexed)` and
# nothing else: no comparison against what is actually on disk, no
# per-source breakdown. An index holding every Desktop conversation and
# zero Cowork sessions read exactly like a complete one, which is why
# doctor said "fine" for the two months the watcher's drift pass was
# dead. These tests pin the coverage comparison.
# ---------------------------------------------------------------------------


class _CoverageIdx:
    """Index stub whose indexed path set is supplied by the test."""

    def __init__(self, indexed) -> None:
        self._indexed = list(indexed)

    def is_built_on_disk(self) -> bool:
        return bool(self._indexed)

    def indexed_file_count(self) -> int:
        return len(self._indexed)

    def list_indexed_paths(self):
        return list(self._indexed)


def _patch_coverage(monkeypatch, *, on_disk, indexed):
    """Wire check_search's enumeration and index to fixed values."""
    idx = _CoverageIdx(indexed)
    monkeypatch.setattr(doctor, "get_search_index", lambda: idx)
    monkeypatch.setattr(
        doctor, "_enumerate_conversation_paths", lambda store: list(on_disk)
    )
    monkeypatch.setattr(doctor, "_coverage_store", lambda: object())
    return idx


def test_search_warns_when_a_source_is_entirely_unindexed(monkeypatch) -> None:
    """Files on disk for a source, zero of them indexed -> WARN naming
    that source.

    This is the exact shape of the reported Cowork failure: 16 sessions
    on disk, none in the index, doctor reporting OK.
    """
    from pathlib import Path

    desktop = [(Path(f"/d/{i}.json"), "CLAUDE_AI") for i in range(3)]
    cowork = [(Path(f"/c/{i}/audit.jsonl"), "CLAUDE_COWORK") for i in range(16)]
    _patch_coverage(
        monkeypatch,
        on_disk=desktop + cowork,
        indexed=[p for p, _ in desktop],
    )

    r = doctor.check_search()

    assert r.status is Status.WARN, (
        f"a source with 16 files on disk and 0 indexed must warn; got {r}"
    )
    assert "CLAUDE_COWORK" in r.detail
    assert "16" in r.detail
    assert "reindex-search" in (r.fix_command or "")


def test_search_ok_reports_per_source_coverage(monkeypatch) -> None:
    """Full coverage is OK, and the detail still carries the per-source
    numbers so a partial shortfall is visible to a human reading it."""
    from pathlib import Path

    on_disk = (
        [(Path(f"/d/{i}.json"), "CLAUDE_AI") for i in range(3)]
        + [(Path(f"/c/{i}/audit.jsonl"), "CLAUDE_COWORK") for i in range(2)]
    )
    _patch_coverage(
        monkeypatch, on_disk=on_disk, indexed=[p for p, _ in on_disk]
    )

    r = doctor.check_search()

    assert r.status is Status.OK, r
    assert "CLAUDE_AI" in r.detail and "CLAUDE_COWORK" in r.detail
    assert "3/3" in r.detail and "2/2" in r.detail


def test_search_ok_shows_partial_shortfall_without_warning(monkeypatch) -> None:
    """A partial shortfall stays OK -- some files legitimately never
    index (empty or user-turn-less sessions return None from the reader
    and are never written to indexed_files), so warning on any gap would
    flap forever. The numbers still surface in the detail."""
    from pathlib import Path

    on_disk = [(Path(f"/p/{i}.jsonl"), "CLAUDE_CODE") for i in range(10)]
    _patch_coverage(
        monkeypatch, on_disk=on_disk, indexed=[p for p, _ in on_disk[:7]]
    )

    r = doctor.check_search()

    assert r.status is Status.OK, r
    assert "7/10" in r.detail


def test_search_survives_enumeration_failure(monkeypatch) -> None:
    """Enumeration raising must not break doctor -- fall back to the
    bare indexed-file count."""
    def _boom(store):
        raise OSError("permission denied")

    idx = _CoverageIdx([__import__("pathlib").Path("/d/1.json")])
    monkeypatch.setattr(doctor, "get_search_index", lambda: idx)
    monkeypatch.setattr(doctor, "_enumerate_conversation_paths", _boom)
    monkeypatch.setattr(doctor, "_coverage_store", lambda: object())

    r = doctor.check_search()

    assert r.status is Status.OK, r
    assert "1" in r.detail


def test_search_no_files_on_disk_is_ok(monkeypatch) -> None:
    """An empty corpus with an empty index is not a problem -- and must
    not divide by zero."""
    _patch_coverage(monkeypatch, on_disk=[], indexed=[])

    r = doctor.check_search()

    assert r.status is not Status.FAIL
