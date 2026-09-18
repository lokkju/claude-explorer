from __future__ import annotations

from pathlib import Path

import backend.scheduled_fetch as sf
from backend.scheduled_fetch_status import FetchStatus, read_status, write_status
from fetcher.http_retry import FetchAuthError


def _setup(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("CLAUDE_EXPLORER_DATA_DIR", str(tmp_path / "conversations"))
    (tmp_path / "conversations").mkdir(parents=True, exist_ok=True)
    # status + creds live under a tmp home
    monkeypatch.setattr(sf, "status_path", lambda: tmp_path / "status.json")
    monkeypatch.setattr(sf, "credentials_path", lambda: tmp_path / "credentials.json")
    monkeypatch.setattr(sf, "_reindex_drift", lambda: None)
    monkeypatch.setattr(sf, "_acquire_lock", lambda: object())  # always acquire
    monkeypatch.setattr(sf, "_release_lock", lambda h: None)


def test_success_writes_ok_and_clears_auth(monkeypatch, tmp_path: Path) -> None:
    _setup(monkeypatch, tmp_path)
    (tmp_path / "credentials.json").write_text("{}")
    monkeypatch.setattr(sf, "run_incremental_fetch", lambda **k: None)
    code = sf.run_scheduled_fetch(interval_sec=3600, now="2026-07-02T10:00:00Z")
    assert code == 0
    s = read_status(tmp_path / "status.json")
    assert s.last_result == "ok" and s.auth_expired is False
    assert s.last_success_at == "2026-07-02T10:00:00Z"


def test_missing_creds_is_needs_auth(monkeypatch, tmp_path: Path) -> None:
    _setup(monkeypatch, tmp_path)  # credentials.json not created
    fired = []
    monkeypatch.setattr(sf, "notify", lambda t, m: fired.append((t, m)) or True)
    code = sf.run_scheduled_fetch(interval_sec=3600, now="2026-07-02T10:00:00Z")
    assert code == 1
    assert read_status(tmp_path / "status.json").last_result == "needs_auth"
    assert len(fired) == 1  # notified exactly once


def test_auth_expired_notifies_once_on_transition(monkeypatch, tmp_path: Path) -> None:
    _setup(monkeypatch, tmp_path)
    (tmp_path / "credentials.json").write_text("{}")
    monkeypatch.setattr(sf, "run_incremental_fetch",
                        lambda **k: (_ for _ in ()).throw(FetchAuthError("401")))
    fired = []
    monkeypatch.setattr(sf, "notify", lambda t, m: fired.append(1) or True)
    # first run: ok->expired transition -> notifies
    sf.run_scheduled_fetch(interval_sec=3600, now="2026-07-02T10:00:00Z")
    # second run: already expired -> does NOT re-notify
    sf.run_scheduled_fetch(interval_sec=3600, now="2026-07-02T11:00:00Z")
    assert read_status(tmp_path / "status.json").auth_expired is True
    assert len(fired) == 1


def test_overlap_lock_skips(monkeypatch, tmp_path: Path) -> None:
    _setup(monkeypatch, tmp_path)
    monkeypatch.setattr(sf, "_acquire_lock", lambda: None)  # lock held -> None
    ran = []
    monkeypatch.setattr(sf, "run_incremental_fetch", lambda **k: ran.append(1))
    code = sf.run_scheduled_fetch(interval_sec=3600, now="2026-07-02T10:00:00Z")
    assert code == 0 and ran == []  # skipped, no fetch


# ---------------------------------------------------------------------------
# "Never raises" contract (docs/notes/scheduled-fetch-contract-holes.md)
#
# The module docstring promises every failure becomes a status + exit
# code. Two holes: _acquire_lock() was called OUTSIDE the try, so an
# OSError from mkdir/os.open escaped past the catch-all; and the
# catch-all itself logged and returned without writing a status, leaving
# `doctor` reporting the previous run's stale result.
# ---------------------------------------------------------------------------


def test_lock_acquire_failure_does_not_escape(monkeypatch, tmp_path: Path) -> None:
    """Bug it would surface: the supervised job dying with a traceback
    when ~/.claude-explorer is read-only or the disk is full.

    _acquire_lock only catches FileExistsError; mkdir() and os.open()
    raise PermissionError / OSError(ENOSPC) too.
    """
    _setup(monkeypatch, tmp_path)
    (tmp_path / "credentials.json").write_text("{}")

    def _boom():
        raise PermissionError(13, "Permission denied")

    monkeypatch.setattr(sf, "_acquire_lock", _boom)

    code = sf.run_scheduled_fetch(interval_sec=3600, now="2026-07-02T10:00:00Z")

    assert code == 1


def test_lock_acquire_failure_records_error_status(monkeypatch, tmp_path: Path) -> None:
    """A failed run must leave a status saying so, or `doctor` keeps
    reporting the last success as if nothing went wrong."""
    _setup(monkeypatch, tmp_path)
    (tmp_path / "credentials.json").write_text("{}")
    write_status(
        FetchStatus(
            last_run_at="2026-07-01T10:00:00Z",
            last_success_at="2026-07-01T10:00:00Z",
            last_result="ok",
            auth_expired=False,
            fetched_count=None,
            error=None,
            interval_sec=3600,
        ),
        tmp_path / "status.json",
    )

    monkeypatch.setattr(sf, "_acquire_lock", lambda: (_ for _ in ()).throw(OSError(28, "No space left")))

    sf.run_scheduled_fetch(interval_sec=3600, now="2026-07-02T10:00:00Z")

    s = read_status(tmp_path / "status.json")
    assert s.last_result == "error", f"expected an error status, got {s.last_result!r}"
    assert s.last_run_at == "2026-07-02T10:00:00Z"
    # A failed run must not claim a fresh success.
    assert s.last_success_at == "2026-07-01T10:00:00Z"


def test_unexpected_error_mid_run_records_error_status(monkeypatch, tmp_path: Path) -> None:
    """Same for anything else that escapes to the catch-all."""
    _setup(monkeypatch, tmp_path)
    (tmp_path / "credentials.json").write_text("{}")
    monkeypatch.setattr(sf, "run_incremental_fetch", lambda **k: None)

    def _boom() -> None:
        raise RuntimeError("index exploded")

    monkeypatch.setattr(sf, "_reindex_drift", _boom)

    code = sf.run_scheduled_fetch(interval_sec=3600, now="2026-07-02T10:00:00Z")

    assert code == 1
    s = read_status(tmp_path / "status.json")
    assert s.last_result == "error"
    assert "index exploded" in (s.error or "")


def test_lock_contention_still_returns_zero(monkeypatch, tmp_path: Path) -> None:
    """A concurrent run is not an error -- must stay a quiet skip, and
    must not overwrite the prior status."""
    _setup(monkeypatch, tmp_path)
    (tmp_path / "credentials.json").write_text("{}")
    write_status(
        FetchStatus(
            last_run_at="2026-07-01T10:00:00Z",
            last_success_at="2026-07-01T10:00:00Z",
            last_result="ok",
            auth_expired=False,
            fetched_count=None,
            error=None,
            interval_sec=3600,
        ),
        tmp_path / "status.json",
    )
    monkeypatch.setattr(sf, "_acquire_lock", lambda: None)

    code = sf.run_scheduled_fetch(interval_sec=3600, now="2026-07-02T10:00:00Z")

    assert code == 0
    assert read_status(tmp_path / "status.json").last_result == "ok"
