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


def test_search_ready_is_ok(monkeypatch) -> None:
    class _Idx:
        def is_ready(self) -> bool:
            return True
    monkeypatch.setattr(doctor, "get_search_index", lambda: _Idx())
    assert doctor.check_search().status is Status.OK


def test_search_unavailable_is_warn(monkeypatch) -> None:
    monkeypatch.setattr(doctor, "get_search_index", lambda: None)
    r = doctor.check_search()
    assert r.status is Status.WARN
    assert "linear" in r.detail.lower()


def test_search_not_ready_is_warn_with_reindex_fix(monkeypatch) -> None:
    class _Idx:
        def is_ready(self) -> bool:
            return False
    monkeypatch.setattr(doctor, "get_search_index", lambda: _Idx())
    r = doctor.check_search()
    assert r.status is Status.WARN
    assert "reindex-search" in (r.fix_command or "")
