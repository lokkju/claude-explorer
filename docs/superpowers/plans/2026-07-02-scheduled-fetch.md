# Scheduled Fetch Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `claude-explorer install fetch` — a periodic supervised job that runs an incremental fetch (+ search reindex) on a schedule, writes a status file, alerts the user to re-authenticate on session expiry, and is monitored by `doctor`.

**Architecture:** A run routine (`backend/scheduled_fetch.py`) invoked each scheduler tick reuses the existing fetch path (extracted into `fetcher/run_fetch.py`), catches `FetchAuthError`, writes `~/.claude-explorer/scheduled-fetch-status.json`, and fires a best-effort desktop notification (`backend/notify.py`) on the ok→expired transition. Per-OS periodic installers (`cli/scheduled_fetch_install.py`) mirror `cli/watcher.py` but use launchd `StartInterval` / a systemd `.timer` / a Task Scheduler hourly trigger. `doctor` gains a check that reads the status file and install state.

**Tech Stack:** Python 3, Click (CLI), stdlib `json`/`os`/`subprocess`/`pathlib`/`dataclasses`, pytest + `click.testing.CliRunner`.

## Global Constraints

- Python: PEP 8, type hints. Conventional commits, **no AI attribution lines**.
- New CLI-only modules (`backend/scheduled_fetch.py`, `backend/scheduled_fetch_status.py`, `backend/notify.py`) MUST stay OUT of the MCPB import closure — the canary (`mcp_server/tests/test_mcpb_closure.py` `forbidden_prefixes`) gains all three.
- The run routine and its public functions **never raise** — every failure becomes a status write + exit code.
- Status file path: `~/.claude-explorer/scheduled-fetch-status.json` (derive from `backend.config.canonical_home_dir()`), atomic write, `0o600`.
- Default schedule: `--interval` seconds, **default 3600** (hourly). Incremental fetch only.
- Notification fires ONLY on the ok/absent → auth-expired transition (compare prior status).
- Install identifiers mirror the watcher's naming: launchd `com.claude-explorer.scheduled-fetch`, systemd `claude-explorer-scheduled-fetch.{service,timer}`, Task Scheduler `ClaudeExplorerScheduledFetch`.
- `install fetch` / `install all` are NOT gated by the corrupt-config writer gate (same exemption as `install watcher`).
- Test-integrity: no network, no real scheduler, no real notifications — all injected. Report real pass counts.

---

### Task 1: Status file module

**Files:**
- Create: `backend/scheduled_fetch_status.py`
- Test: `backend/tests/test_scheduled_fetch_status.py`

**Interfaces:**
- Consumes: `backend.config.canonical_home_dir`.
- Produces:
  - `@dataclass class FetchStatus` — `last_run_at: str | None = None`, `last_success_at: str | None = None`, `last_result: str = "unknown"`, `auth_expired: bool = False`, `fetched_count: int | None = None`, `error: str | None = None`, `interval_sec: int | None = None`.
  - `status_path() -> Path` — `canonical_home_dir() / "scheduled-fetch-status.json"`.
  - `read_status(path: Path | None = None) -> FetchStatus` — missing/corrupt → default `FetchStatus()`, never raises.
  - `write_status(status: FetchStatus, path: Path | None = None) -> None` — atomic (`.tmp` + `os.replace`), `0o600`, creates parent dir.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_scheduled_fetch_status.py
from __future__ import annotations

import json
from pathlib import Path

from backend.scheduled_fetch_status import FetchStatus, read_status, write_status


def test_roundtrip(tmp_path: Path) -> None:
    p = tmp_path / "s.json"
    write_status(FetchStatus(last_result="ok", auth_expired=False, fetched_count=3,
                             last_success_at="2026-07-02T00:00:00Z", interval_sec=3600), p)
    s = read_status(p)
    assert s.last_result == "ok"
    assert s.fetched_count == 3
    assert s.auth_expired is False


def test_missing_file_is_default(tmp_path: Path) -> None:
    s = read_status(tmp_path / "absent.json")
    assert s.last_result == "unknown"
    assert s.auth_expired is False


def test_corrupt_file_is_default_no_raise(tmp_path: Path) -> None:
    p = tmp_path / "s.json"
    p.write_text("{ not json ")
    assert read_status(p).last_result == "unknown"


def test_write_is_0600_and_atomic(tmp_path: Path) -> None:
    p = tmp_path / "sub" / "s.json"  # parent absent
    write_status(FetchStatus(last_result="auth_expired", auth_expired=True), p)
    assert json.loads(p.read_text())["auth_expired"] is True
    assert (p.stat().st_mode & 0o777) == 0o600
    assert list((tmp_path / "sub").glob("*.tmp")) == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest backend/tests/test_scheduled_fetch_status.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.scheduled_fetch_status'`.

- [ ] **Step 3: Write minimal implementation**

```python
# backend/scheduled_fetch_status.py
"""Read/write the scheduled-fetch run-status file.

Single source of truth for `doctor` and the notification transition
check. CLI-only — must stay OUT of the MCPB import closure. Never
raises on read (missing/corrupt → defaults).
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path

from .config import canonical_home_dir


@dataclass
class FetchStatus:
    last_run_at: str | None = None
    last_success_at: str | None = None
    last_result: str = "unknown"          # ok | auth_expired | needs_auth | error | unknown
    auth_expired: bool = False
    fetched_count: int | None = None
    error: str | None = None
    interval_sec: int | None = None


def status_path() -> Path:
    return canonical_home_dir() / "scheduled-fetch-status.json"


def read_status(path: Path | None = None) -> FetchStatus:
    p = path or status_path()
    try:
        data = json.loads(p.read_text())
    except (OSError, ValueError):
        return FetchStatus()
    if not isinstance(data, dict):
        return FetchStatus()
    known = {f: data.get(f) for f in FetchStatus().__dict__}
    return FetchStatus(**known)


def write_status(status: FetchStatus, path: Path | None = None) -> None:
    p = path or status_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(p.name + ".tmp")
    try:
        tmp.write_text(json.dumps(asdict(status), indent=2))
        os.chmod(tmp, 0o600)
        os.replace(tmp, p)
    except OSError:
        if tmp.exists():
            tmp.unlink()
        raise
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest backend/tests/test_scheduled_fetch_status.py -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/scheduled_fetch_status.py backend/tests/test_scheduled_fetch_status.py
git commit -m "feat(fetch): add scheduled-fetch status file module"
```

---

### Task 2: Desktop notification module

**Files:**
- Create: `backend/notify.py`
- Test: `backend/tests/test_notify.py`

**Interfaces:**
- Consumes: stdlib only.
- Produces:
  - `_run(cmd: list[str]) -> bool` — run a notifier command; True on rc 0, False on any failure (never raises). Module-level so tests monkeypatch it.
  - `notify(title: str, message: str) -> bool` — best-effort per-OS notification; returns True if a notifier was dispatched successfully, else False.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_notify.py
from __future__ import annotations

import backend.notify as notify


def test_macos_uses_osascript(monkeypatch) -> None:
    calls = []
    monkeypatch.setattr(notify.sys, "platform", "darwin")
    monkeypatch.setattr(notify, "_run", lambda cmd: calls.append(cmd) or True)
    assert notify.notify("T", "M") is True
    assert calls[0][0] == "osascript"


def test_linux_uses_notify_send_when_present(monkeypatch) -> None:
    calls = []
    monkeypatch.setattr(notify.sys, "platform", "linux")
    monkeypatch.setattr(notify.shutil, "which", lambda name: "/usr/bin/notify-send")
    monkeypatch.setattr(notify, "_run", lambda cmd: calls.append(cmd) or True)
    assert notify.notify("T", "M") is True
    assert calls[0][0] == "notify-send"


def test_linux_no_notify_send_returns_false(monkeypatch) -> None:
    monkeypatch.setattr(notify.sys, "platform", "linux")
    monkeypatch.setattr(notify.shutil, "which", lambda name: None)
    assert notify.notify("T", "M") is False


def test_windows_uses_powershell(monkeypatch) -> None:
    calls = []
    monkeypatch.setattr(notify.sys, "platform", "win32")
    monkeypatch.setattr(notify, "_run", lambda cmd: calls.append(cmd) or True)
    assert notify.notify("T", "M") is True
    assert "powershell" in calls[0][0].lower()


def test_unknown_platform_returns_false(monkeypatch) -> None:
    monkeypatch.setattr(notify.sys, "platform", "sunos5")
    assert notify.notify("T", "M") is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest backend/tests/test_notify.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.notify'`.

- [ ] **Step 3: Write minimal implementation**

```python
# backend/notify.py
"""Best-effort cross-platform desktop notification. CLI-only; never
raises. Returns False when no notifier is available (caller falls back
to the status file + doctor). Must stay OUT of the MCPB closure."""

from __future__ import annotations

import shutil
import subprocess
import sys


def _run(cmd: list[str]) -> bool:
    try:
        return subprocess.run(cmd, capture_output=True, text=True).returncode == 0
    except OSError:
        return False


def notify(title: str, message: str) -> bool:
    if sys.platform == "darwin":
        script = f'display notification {message!r} with title {title!r}'
        return _run(["osascript", "-e", script])
    if sys.platform.startswith("linux"):
        if shutil.which("notify-send") is None:
            return False
        return _run(["notify-send", title, message])
    if sys.platform == "win32":
        ps = (
            "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications,"
            " ContentType = WindowsRuntime] > $null; "
            f"Write-Output {message!r}"
        )
        # Minimal balloon via powershell; best-effort only.
        return _run(["powershell", "-NoProfile", "-Command", ps])
    return False
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest backend/tests/test_notify.py -v`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/notify.py backend/tests/test_notify.py
git commit -m "feat(fetch): add best-effort desktop notification helper"
```

---

### Task 3: Extract shared `run_incremental_fetch` helper (behavior-preserving)

**Files:**
- Create: `fetcher/run_fetch.py`
- Modify: `cli/main.py` (the `fetch` command body, lines ~111–198)
- Test: `backend/tests/test_run_fetch_helper.py` (plus the existing `fetcher/tests/test_cli_fetch_wiring.py` must stay green)

**Interfaces:**
- Consumes: `fetcher.bulk_fetch.ClaudeFetcher`, `load_credentials`; `fetcher.http_retry.FetchAuthError` (raised by `ClaudeFetcher.run` on 401/403).
- Produces:
  - `run_incremental_fetch(*, output_dir: Path, files_dir: Path, credentials: Path, session_key: str | None, org_id: str | None, incremental: bool, download_files: bool, delay: float, limit: int | None, verbose: bool) -> None` — the org-resolution (modes 1/2/3) + `ClaudeFetcher(...)` construction + `fetcher.run(limit=limit)`, moved verbatim from the CLI. Raises `click.ClickException` for missing creds (as today) and propagates `FetchAuthError` from `run`.

Implementer notes:
- This is a **mechanical move**: cut the block from `cli/main.py` `fetch` starting at `from fetcher.bulk_fetch import ClaudeFetcher, load_credentials` through `fetcher.run(limit=limit)` (the mode-1/2/3 org resolution + the `ClaudeFetcher(...)` call + `fetcher.run(...)`) into `run_incremental_fetch`, parameterized on the function args. Do NOT change the logic — `fetcher/tests/test_cli_fetch_wiring.py` pins it.
- The CLI `fetch` keeps its corrupt-config gate check, then calls:
  `run_incremental_fetch(output_dir=output_dir, files_dir=files_dir, credentials=credentials, session_key=session_key, org_id=org_id, incremental=incremental, download_files=download_files, delay=delay, limit=limit, verbose=verbose)`.
- `run_fetch.py` may import `click` (for `ClickException`) — it's a fetcher-layer CLI helper; that's acceptable and does not affect the MCP closure (fetcher isn't in it).

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_run_fetch_helper.py
from __future__ import annotations

from pathlib import Path

import pytest

import fetcher.run_fetch as rf


class _FakeFetcher:
    last_kwargs = None
    def __init__(self, **kwargs):
        _FakeFetcher.last_kwargs = kwargs
    def run(self, limit=None):
        _FakeFetcher.ran_with = limit


def test_v1_creds_resolve_single_org(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(rf, "ClaudeFetcher", _FakeFetcher)
    monkeypatch.setattr(rf, "load_credentials",
                        lambda p: {"session_key": "sk", "org_id": "org-1"})
    rf.run_incremental_fetch(
        output_dir=tmp_path, files_dir=tmp_path, credentials=tmp_path / "c.json",
        session_key=None, org_id=None, incremental=True, download_files=False,
        delay=0.0, limit=5, verbose=False,
    )
    kw = _FakeFetcher.last_kwargs
    assert kw["session_key"] == "sk"
    assert kw["primary_org_id"] == "org-1"
    assert _FakeFetcher.ran_with == 5


def test_missing_session_key_raises_clickexception(monkeypatch, tmp_path: Path) -> None:
    import click
    monkeypatch.setattr(rf, "ClaudeFetcher", _FakeFetcher)
    monkeypatch.setattr(rf, "load_credentials", lambda p: {"org_id": "org-1"})
    with pytest.raises(click.ClickException):
        rf.run_incremental_fetch(
            output_dir=tmp_path, files_dir=tmp_path, credentials=tmp_path / "c.json",
            session_key=None, org_id=None, incremental=True, download_files=False,
            delay=0.0, limit=None, verbose=False,
        )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest backend/tests/test_run_fetch_helper.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'fetcher.run_fetch'`.

- [ ] **Step 3: Write minimal implementation**

Create `fetcher/run_fetch.py` with the moved block:

```python
# fetcher/run_fetch.py
"""Shared incremental-fetch entry used by the `fetch` CLI command and the
scheduled-fetch run routine. Holds the org-resolution (v1/v2/override)
+ ClaudeFetcher construction + run, so both callers stay identical and
auth failures (FetchAuthError) surface the same way."""

from __future__ import annotations

from pathlib import Path

import click

from fetcher.bulk_fetch import ClaudeFetcher, load_credentials


def run_incremental_fetch(
    *,
    output_dir: Path,
    files_dir: Path,
    credentials: Path,
    session_key: str | None,
    org_id: str | None,
    incremental: bool,
    download_files: bool,
    delay: float,
    limit: int | None,
    verbose: bool,
) -> None:
    cf_bm: str | None = None
    cf_clearance: str | None = None
    if session_key and org_id:
        orgs = [{"uuid": org_id, "name": None, "capabilities": [], "seen_in_response": False}]
        primary = org_id
    else:
        creds = load_credentials(credentials)
        session_key = session_key or creds.get("session_key")
        if "orgs" in creds and creds.get("orgs"):
            orgs = list(creds["orgs"])
            primary = creds.get("primary_org_id") or orgs[0]["uuid"]
        else:
            legacy_id = org_id or creds.get("org_id")
            if not legacy_id:
                raise click.ClickException(
                    "Missing org_id. Run `claude-explorer capture` to refresh credentials."
                )
            orgs = [{"uuid": legacy_id, "name": None, "capabilities": [], "seen_in_response": False}]
            primary = legacy_id
        cf_bm = creds.get("cf_bm")
        cf_clearance = creds.get("cf_clearance")

    if not session_key:
        raise click.ClickException("Missing session_key. Run `claude-explorer capture` first.")

    fetcher = ClaudeFetcher(
        session_key=session_key, orgs=orgs, primary_org_id=primary,
        output_dir=output_dir, files_dir=files_dir, delay=delay,
        incremental=incremental, verbose=verbose, download_files=download_files,
        cf_bm=cf_bm, cf_clearance=cf_clearance,
    )
    fetcher.run(limit=limit)
```

Then in `cli/main.py` `fetch`, replace the moved block (from `from fetcher.bulk_fetch import ...` through `fetcher.run(limit=limit)`) with:

```python
    from fetcher.run_fetch import run_incremental_fetch

    run_incremental_fetch(
        output_dir=output_dir, files_dir=files_dir, credentials=credentials,
        session_key=session_key, org_id=org_id, incremental=incremental,
        download_files=download_files, delay=delay, limit=limit, verbose=verbose,
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest backend/tests/test_run_fetch_helper.py fetcher/tests/test_cli_fetch_wiring.py -v`
Expected: PASS (new helper tests + the existing wiring regression test still green).

- [ ] **Step 5: Commit**

```bash
git add fetcher/run_fetch.py cli/main.py backend/tests/test_run_fetch_helper.py
git commit -m "refactor(fetch): extract run_incremental_fetch shared helper"
```

---

### Task 4: Run routine

**Files:**
- Create: `backend/scheduled_fetch.py`
- Test: `backend/tests/test_scheduled_fetch_routine.py`

**Interfaces:**
- Consumes: `fetcher.run_fetch.run_incremental_fetch` (Task 3); `fetcher.http_retry.FetchAuthError`; `backend.scheduled_fetch_status.{FetchStatus, read_status, write_status}` (Task 1); `backend.notify.notify` (Task 2); `backend.config.{get_settings, canonical_home_dir}`; `backend.search_index.get_search_index` + `update_drifted_files`; `backend.store.ConversationStore`.
- Produces:
  - `run_scheduled_fetch(*, interval_sec: int = 3600, now: str | None = None) -> int` — the full routine; returns an exit code (0 ok, 1 failure). Never raises. `now` is an injectable ISO timestamp for tests (avoids `datetime.now()` nondeterminism in assertions).
  - `_reindex_drift() -> None` — run the search-index drift pass (isolated so a failure there doesn't fail the fetch).

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_scheduled_fetch_routine.py
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
    assert fired  # notified


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest backend/tests/test_scheduled_fetch_routine.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.scheduled_fetch'`.

- [ ] **Step 3: Write minimal implementation**

```python
# backend/scheduled_fetch.py
"""Scheduled-fetch run routine — invoked once per scheduler tick by the
supervised job. Incremental fetch -> reindex drift -> status write, with
an overlap lock and a re-auth notification on the ok->expired transition.
Never raises: every failure becomes a status + exit code. CLI-only; must
stay OUT of the MCPB closure."""

from __future__ import annotations

import logging
from pathlib import Path

from fetcher.http_retry import FetchAuthError
from fetcher.run_fetch import run_incremental_fetch

from .config import canonical_home_dir, get_settings
from .notify import notify
from .scheduled_fetch_status import FetchStatus, read_status, status_path, write_status

log = logging.getLogger(__name__)

_REAUTH_TITLE = "Claude Explorer"
_REAUTH_MSG = (
    "Your Claude session expired. Re-authenticate: run `claude-explorer capture` "
    "(or click Refresh in the web UI)."
)


def credentials_path() -> Path:
    return canonical_home_dir() / "credentials.json"


def _lock_path() -> Path:
    return canonical_home_dir() / "scheduled-fetch.lock"


def _acquire_lock():
    """Return a lock handle, or None if another run holds it. Uses O_CREAT|
    O_EXCL on a lockfile; the handle is the open fd."""
    import os
    p = _lock_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    try:
        return os.open(p, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        return None


def _release_lock(handle) -> None:
    import os
    if handle is None:
        return
    try:
        os.close(handle)
    except OSError:
        pass
    try:
        _lock_path().unlink()
    except OSError:
        pass


def _reindex_drift() -> None:
    """Best-effort search-index drift pass; isolated so its failure never
    fails the fetch."""
    try:
        from .search_index import get_search_index, update_drifted_files
        from .store import ConversationStore
        idx = get_search_index()
        if idx is not None:
            update_drifted_files(ConversationStore(), index=idx)
    except Exception as exc:  # noqa: BLE001
        log.warning("scheduled-fetch: drift reindex failed: %s", exc)


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def run_scheduled_fetch(*, interval_sec: int = 3600, now: str | None = None) -> int:
    ts = now or _now_iso()
    prior = read_status(status_path())

    handle = _acquire_lock()
    if handle is None:
        log.info("scheduled-fetch: previous run still in progress; skipping")
        return 0

    try:
        if not credentials_path().exists():
            _write(prior, ts, result="needs_auth", auth_expired=True,
                   interval_sec=interval_sec)
            if not prior.auth_expired:
                notify(_REAUTH_TITLE, _REAUTH_MSG)
            return 1

        settings = get_settings()
        try:
            run_incremental_fetch(
                output_dir=settings.data_dir,
                files_dir=settings.data_dir / "files",
                credentials=credentials_path(),
                session_key=None, org_id=None, incremental=True,
                download_files=True, delay=0.3, limit=None, verbose=False,
            )
        except FetchAuthError:
            _write(prior, ts, result="auth_expired", auth_expired=True,
                   interval_sec=interval_sec)
            if not prior.auth_expired:
                notify(_REAUTH_TITLE, _REAUTH_MSG)
            return 1
        except Exception as exc:  # noqa: BLE001
            _write(prior, ts, result="error", auth_expired=False,
                   interval_sec=interval_sec, error=str(exc))
            return 1

        _reindex_drift()
        write_status(FetchStatus(
            last_run_at=ts, last_success_at=ts, last_result="ok",
            auth_expired=False, fetched_count=None, error=None,
            interval_sec=interval_sec,
        ), status_path())
        return 0
    finally:
        _release_lock(handle)


def _write(prior: FetchStatus, ts: str, *, result: str, auth_expired: bool,
           interval_sec: int, error: str | None = None) -> None:
    write_status(FetchStatus(
        last_run_at=ts,
        last_success_at=prior.last_success_at,   # preserve prior success time
        last_result=result, auth_expired=auth_expired,
        fetched_count=prior.fetched_count, error=error, interval_sec=interval_sec,
    ), status_path())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest backend/tests/test_scheduled_fetch_routine.py -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/scheduled_fetch.py backend/tests/test_scheduled_fetch_routine.py
git commit -m "feat(fetch): add scheduled-fetch run routine"
```

---

### Task 5: Install-state detection

**Files:**
- Modify: `backend/scheduled_fetch_status.py` (add detection)
- Test: `backend/tests/test_scheduled_fetch_installed.py`

**Interfaces:**
- Consumes: stdlib `subprocess`/`shutil`/`sys`/`os`.
- Produces:
  - `is_scheduled_fetch_installed() -> bool` — mirrors `watcher_status.is_watcher_installed`: env override `CLAUDE_EXPLORER_SCHEDULED_FETCH_INSTALLED` (1/true/yes → True, 0/false/no → False), else platform probe (macOS `launchctl list` contains `com.claude-explorer.scheduled-fetch`; Linux `systemctl --user is-enabled claude-explorer-scheduled-fetch.timer` rc 0; Windows `schtasks /Query /TN ClaudeExplorerScheduledFetch` rc 0). Any probe failure → False.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_scheduled_fetch_installed.py
from __future__ import annotations

from backend.scheduled_fetch_status import is_scheduled_fetch_installed


def test_env_override_true(monkeypatch) -> None:
    monkeypatch.setenv("CLAUDE_EXPLORER_SCHEDULED_FETCH_INSTALLED", "1")
    assert is_scheduled_fetch_installed() is True


def test_env_override_false(monkeypatch) -> None:
    monkeypatch.setenv("CLAUDE_EXPLORER_SCHEDULED_FETCH_INSTALLED", "0")
    assert is_scheduled_fetch_installed() is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest backend/tests/test_scheduled_fetch_installed.py -v`
Expected: FAIL — `ImportError: cannot import name 'is_scheduled_fetch_installed'`.

- [ ] **Step 3: Write minimal implementation**

Append to `backend/scheduled_fetch_status.py` (add imports `subprocess`, `sys`):

```python
_LAUNCHD_LABEL = "com.claude-explorer.scheduled-fetch"
_SYSTEMD_TIMER = "claude-explorer-scheduled-fetch.timer"
_WIN_TASK = "ClaudeExplorerScheduledFetch"
_ENV = "CLAUDE_EXPLORER_SCHEDULED_FETCH_INSTALLED"
_TRUTHY = {"1", "true", "yes"}
_FALSY = {"0", "false", "no"}


def is_scheduled_fetch_installed() -> bool:
    override = os.environ.get(_ENV, "").strip().lower()
    if override in _TRUTHY:
        return True
    if override in _FALSY:
        return False
    try:
        if sys.platform == "darwin":
            out = subprocess.run(["launchctl", "list"], capture_output=True,
                                 text=True, timeout=5)
            return _LAUNCHD_LABEL in out.stdout
        if sys.platform.startswith("linux"):
            return subprocess.run(
                ["systemctl", "--user", "is-enabled", _SYSTEMD_TIMER],
                capture_output=True, text=True, timeout=5).returncode == 0
        if sys.platform == "win32":
            return subprocess.run(
                ["schtasks", "/Query", "/TN", _WIN_TASK],
                capture_output=True, text=True, timeout=5).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False
    return False
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest backend/tests/test_scheduled_fetch_installed.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/scheduled_fetch_status.py backend/tests/test_scheduled_fetch_installed.py
git commit -m "feat(fetch): add scheduled-fetch install detection"
```

---

### Task 6: Per-OS periodic installers

**Files:**
- Create: `cli/scheduled_fetch_install.py`
- Test: `backend/tests/test_scheduled_fetch_install_gen.py`

**Interfaces:**
- Consumes: stdlib; `backend.config.canonical_home_dir`.
- Produces (mirror `cli/watcher.py`'s structure):
  - `LAUNCHER_PATH() -> Path` → `canonical_home_dir() / "scheduled-fetch.py"`.
  - `write_launcher() -> Path` — writes a launcher that runs `run_scheduled_fetch()`.
  - `build_launchd_plist(python_bin: str, interval: int) -> str` — uses `<key>StartInterval</key><integer>{interval}</integer>` (NOT KeepAlive).
  - `build_systemd_service(python_bin: str, launcher: Path) -> str` — `Type=oneshot`.
  - `build_systemd_timer(interval: int) -> str` — `OnBootSec=1min` + `OnUnitActiveSec={interval}s`.
  - `install(python_bin: str, interval: int) -> None` / `uninstall() -> None` — per-OS dispatch (launchctl load / systemctl enable+start the .timer / schtasks create `/SC HOURLY`).

Implementer notes:
- Closely mirror `cli/watcher.py` — same subprocess patterns, same identifier constants (Task 5's labels), same "wrote X" echoes and the Linux `loginctl enable-linger` reminder. The ONLY behavioral differences: (a) periodic scheduling, not KeepAlive/Restart; (b) the launcher runs `backend.scheduled_fetch.run_scheduled_fetch` once and exits.
- Launcher body:
  ```python
  #!/usr/bin/env python3
  import sys
  from backend.scheduled_fetch import run_scheduled_fetch
  sys.exit(run_scheduled_fetch(interval_sec={interval}))
  ```
- Windows: `schtasks /Create /TN ClaudeExplorerScheduledFetch /TR "<pythonw> <launcher>" /SC HOURLY /F` (and `/SC MINUTE /MO <n>` when interval isn't a whole hour — for v1 default hourly, `/SC HOURLY` is sufficient; if `interval != 3600`, use `/SC MINUTE /MO {interval//60}`).
- This task's TEST covers the pure generators only (content assertions); the actual `install()`/`uninstall()` subprocess dispatch is exercised via the CLI task with mocks.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_scheduled_fetch_install_gen.py
from __future__ import annotations

from pathlib import Path

import cli.scheduled_fetch_install as sfi


def test_launchd_uses_start_interval_not_keepalive() -> None:
    plist = sfi.build_launchd_plist("/usr/bin/python3", 3600)
    assert "StartInterval" in plist and "3600" in plist
    assert "KeepAlive" not in plist


def test_systemd_service_is_oneshot() -> None:
    body = sfi.build_systemd_service("/usr/bin/python3", Path("/h/scheduled-fetch.py"))
    assert "Type=oneshot" in body
    assert "Restart=always" not in body


def test_systemd_timer_has_interval() -> None:
    timer = sfi.build_systemd_timer(3600)
    assert "OnUnitActiveSec=3600s" in timer
    assert "[Timer]" in timer
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest backend/tests/test_scheduled_fetch_install_gen.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'cli.scheduled_fetch_install'`.

- [ ] **Step 3: Write minimal implementation**

Read `cli/watcher.py` first for the exact patterns to mirror, then create `cli/scheduled_fetch_install.py` with the generators + install/uninstall. Minimum to pass the generator tests (full install/uninstall dispatch mirrors watcher.py):

```python
# cli/scheduled_fetch_install.py  (generators shown; install/uninstall mirror cli/watcher.py)
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import click

from backend.config import canonical_home_dir
from backend.scheduled_fetch_status import (
    _LAUNCHD_LABEL, _SYSTEMD_TIMER, _WIN_TASK,
)

_SYSTEMD_SERVICE = "claude-explorer-scheduled-fetch.service"


def LAUNCHER_PATH() -> Path:
    return canonical_home_dir() / "scheduled-fetch.py"


def write_launcher(interval: int) -> Path:
    p = LAUNCHER_PATH()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(
        "#!/usr/bin/env python3\n"
        "import sys\n"
        "from backend.scheduled_fetch import run_scheduled_fetch\n"
        f"sys.exit(run_scheduled_fetch(interval_sec={interval}))\n"
    )
    return p


def build_launchd_plist(python_bin: str, interval: int) -> str:
    launcher = LAUNCHER_PATH()
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" '
        '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
        '<plist version="1.0"><dict>\n'
        f'  <key>Label</key><string>{_LAUNCHD_LABEL}</string>\n'
        '  <key>ProgramArguments</key>\n'
        f'  <array><string>{python_bin}</string><string>{launcher}</string></array>\n'
        f'  <key>StartInterval</key><integer>{interval}</integer>\n'
        '  <key>RunAtLoad</key><true/>\n'
        '</dict></plist>\n'
    )


def build_systemd_service(python_bin: str, launcher: Path) -> str:
    return (
        "[Unit]\n"
        "Description=Claude Explorer scheduled incremental fetch\n\n"
        "[Service]\n"
        "Type=oneshot\n"
        f"ExecStart={python_bin} {launcher}\n"
    )


def build_systemd_timer(interval: int) -> str:
    return (
        "[Unit]\n"
        "Description=Claude Explorer scheduled fetch timer\n\n"
        "[Timer]\n"
        "OnBootSec=1min\n"
        f"OnUnitActiveSec={interval}s\n"
        "Persistent=true\n\n"
        "[Install]\n"
        "WantedBy=timers.target\n"
    )
```

Add `install(python_bin, interval)` and `uninstall()` that dispatch on `sys.platform` and mirror `cli/watcher.py` (macOS: write plist + `launchctl load`; Linux: write .service + .timer under `~/.config/systemd/user/`, `daemon-reload`, `enable --now` the .timer, print the linger reminder; Windows: `schtasks /Create ... /SC HOURLY /F`). Uninstall removes files + `launchctl unload` / `systemctl --user disable --now` the timer / `schtasks /Delete /F`.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest backend/tests/test_scheduled_fetch_install_gen.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add cli/scheduled_fetch_install.py backend/tests/test_scheduled_fetch_install_gen.py
git commit -m "feat(fetch): add per-OS periodic scheduled-fetch installers"
```

---

### Task 7: CLI `install fetch` + wire into `install all`

**Files:**
- Modify: `cli/main.py`
- Test: `backend/tests/test_cli_install_fetch.py`

**Interfaces:**
- Consumes: `cli.scheduled_fetch_install.{install, uninstall}`; `backend.mcp_config_install.InstallResult`; `_summarize_install` + `_do_watcher` (existing).
- Produces:
  - `_do_scheduled_fetch(interval: int, uninstall: bool) -> InstallResult` — runs install/uninstall, catching exceptions → failed `InstallResult(target="fetch", ...)`.
  - `install fetch [--interval N] [--uninstall] [--no-color]` subcommand.
  - `install all` also runs `_do_scheduled_fetch(3600, uninstall)` (added to the results list, after watcher, before mcp).

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_cli_install_fetch.py
from __future__ import annotations

from click.testing import CliRunner

import cli.main as cm
import cli.scheduled_fetch_install as sfi
from cli.main import main


def test_install_fetch_runs_installer(monkeypatch) -> None:
    calls = []
    monkeypatch.setattr(sfi, "install", lambda python_bin, interval: calls.append(interval))
    res = CliRunner().invoke(main, ["install", "fetch", "--interval", "1800"])
    assert res.exit_code == 0
    assert calls == [1800]


def test_install_fetch_uninstall(monkeypatch) -> None:
    calls = []
    monkeypatch.setattr(sfi, "uninstall", lambda: calls.append("u"))
    res = CliRunner().invoke(main, ["install", "fetch", "--uninstall"])
    assert res.exit_code == 0
    assert calls == ["u"]


def test_install_all_includes_fetch(monkeypatch) -> None:
    seen = []
    monkeypatch.setattr(cm, "_do_watcher", lambda *a, **k: _ok("watcher"))
    monkeypatch.setattr(cm, "_do_scheduled_fetch",
                        lambda interval, uninstall: seen.append("fetch") or _ok("fetch"))
    import backend.mcp_config_install as mci
    monkeypatch.setattr(mci, "install_mcp_code", lambda scope="user", **k: _ok("code"))
    monkeypatch.setattr(mci, "install_mcp_desktop", lambda **k: _ok("desktop"))
    res = CliRunner().invoke(main, ["install", "all"])
    assert res.exit_code == 0
    assert "fetch" in seen


def _ok(target):
    import backend.mcp_config_install as mci
    return mci.InstallResult(target, True, True, f"{target} done")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest backend/tests/test_cli_install_fetch.py -v`
Expected: FAIL — `No such command 'fetch'` under `install`.

- [ ] **Step 3: Write minimal implementation**

Add to `cli/main.py` near the other install subcommands:

```python
def _do_scheduled_fetch(interval: int, uninstall: bool) -> "InstallResult":
    from backend.mcp_config_install import InstallResult
    import cli.scheduled_fetch_install as sfi
    import sys as _sys
    try:
        if uninstall:
            sfi.uninstall()
            return InstallResult("fetch", True, True, "scheduled fetch uninstalled")
        sfi.install(_sys.executable, interval)
        return InstallResult("fetch", True, True, f"scheduled fetch installed ({interval}s)")
    except Exception as exc:  # noqa: BLE001
        return InstallResult("fetch", False, False, f"scheduled fetch failed: {exc}")


@install.command("fetch")
@click.option("--interval", type=int, default=3600,
              help="Fetch interval in seconds (default: 3600 = hourly).")
@click.option("--uninstall", is_flag=True, help="Remove the scheduled fetch job.")
@click.option("--no-color", is_flag=True, help="Disable colored output.")
def install_fetch(interval: int, uninstall: bool, no_color: bool) -> None:
    """Install (or uninstall) a scheduled incremental fetch (hourly by default)."""
    import sys as _sys
    from backend.cli_style import should_use_color
    r = _do_scheduled_fetch(interval, uninstall)
    _sys.exit(_summarize_install([r], color=should_use_color(no_color)))
```

Then in `install_all`, add the scheduled-fetch result after the watcher line:
```python
    results = [_do_watcher(None, 600.0, uninstall)]
    results.append(_do_scheduled_fetch(3600, uninstall))
    if uninstall:
        ...
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest backend/tests/test_cli_install_fetch.py backend/tests/test_cli_install_all.py -v`
Expected: PASS (new fetch tests + existing install-all tests still green — the `install all` test may need the `_do_scheduled_fetch` monkeypatch; update `test_cli_install_all.py` only if it now fails because the real installer runs. If it fails, patch `cm._do_scheduled_fetch` to a stub in those tests).

- [ ] **Step 5: Commit**

```bash
git add cli/main.py backend/tests/test_cli_install_fetch.py backend/tests/test_cli_install_all.py
git commit -m "feat(fetch): add install fetch subcommand + wire into install all"
```

---

### Task 8: doctor check

**Files:**
- Modify: `backend/doctor.py`
- Test: `backend/tests/test_doctor_scheduled_fetch.py`

**Interfaces:**
- Consumes: `backend.scheduled_fetch_status.{is_scheduled_fetch_installed, read_status, FetchStatus}`.
- Produces: `check_scheduled_fetch() -> CheckResult`; registered in `ALL_CHECKS` after `check_watcher`.

Priority logic:
- not installed → WARN, fix `claude-explorer install fetch`.
- installed + `auth_expired` (or `last_result` in {auth_expired, needs_auth}) → WARN, fix `claude-explorer capture`.
- installed + `last_success_at` older than `2 * (interval_sec or 3600)` → WARN "fetches stale".
- installed + fresh → OK (detail names last success).

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_doctor_scheduled_fetch.py
from __future__ import annotations

import backend.doctor as doctor
from backend.doctor import Status
from backend.scheduled_fetch_status import FetchStatus


def test_not_installed_is_warn(monkeypatch) -> None:
    monkeypatch.setattr(doctor, "is_scheduled_fetch_installed", lambda: False)
    r = doctor.check_scheduled_fetch()
    assert r.status is Status.WARN
    assert "install fetch" in (r.fix_command or "")


def test_auth_expired_is_warn_with_capture(monkeypatch) -> None:
    monkeypatch.setattr(doctor, "is_scheduled_fetch_installed", lambda: True)
    monkeypatch.setattr(doctor, "read_status",
                        lambda: FetchStatus(last_result="auth_expired", auth_expired=True))
    r = doctor.check_scheduled_fetch()
    assert r.status is Status.WARN
    assert "capture" in (r.fix_command or "")


def test_fresh_success_is_ok(monkeypatch) -> None:
    monkeypatch.setattr(doctor, "is_scheduled_fetch_installed", lambda: True)
    monkeypatch.setattr(doctor, "_fetch_status_is_stale", lambda s: False)
    monkeypatch.setattr(doctor, "read_status",
                        lambda: FetchStatus(last_result="ok", last_success_at="2026-07-02T10:00:00Z"))
    assert doctor.check_scheduled_fetch().status is Status.OK
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest backend/tests/test_doctor_scheduled_fetch.py -v`
Expected: FAIL — `AttributeError: module 'backend.doctor' has no attribute 'check_scheduled_fetch'`.

- [ ] **Step 3: Write minimal implementation**

Add to `backend/doctor.py` (import `from .scheduled_fetch_status import FetchStatus, is_scheduled_fetch_installed, read_status`):

```python
def _fetch_status_is_stale(s: "FetchStatus") -> bool:
    """True if last success is older than 2x the interval (or missing)."""
    if not s.last_success_at:
        return True
    from datetime import datetime, timezone
    try:
        last = datetime.strptime(s.last_success_at, "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=timezone.utc)
    except ValueError:
        return True
    age = (datetime.now(timezone.utc) - last).total_seconds()
    return age > 2 * (s.interval_sec or 3600)


def check_scheduled_fetch() -> CheckResult:
    if not is_scheduled_fetch_installed():
        return CheckResult(
            "Scheduled fetch", Status.WARN,
            "not installed (archive updates only on manual fetch)",
            fix_command="claude-explorer install fetch",
        )
    s = read_status()
    if s.auth_expired or s.last_result in ("auth_expired", "needs_auth"):
        return CheckResult(
            "Scheduled fetch", Status.WARN,
            "Claude session expired — scheduled fetch can't run",
            fix_command="claude-explorer capture",
        )
    if _fetch_status_is_stale(s):
        return CheckResult(
            "Scheduled fetch", Status.WARN,
            f"no recent successful fetch (last: {s.last_success_at or 'never'})",
            fix_command="check the job logs / claude-explorer install fetch",
        )
    return CheckResult(
        "Scheduled fetch", Status.OK, f"last success {s.last_success_at}",
    )
```

Register in `ALL_CHECKS` after `("CC watcher", check_watcher)`:
```python
    ("Scheduled fetch", check_scheduled_fetch),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest backend/tests/test_doctor_scheduled_fetch.py backend/tests/test_doctor_cli.py -v`
Expected: PASS (new check tests + existing doctor CLI tests — the CLI tests monkeypatch `ALL_CHECKS` so the added registry entry doesn't break them).

- [ ] **Step 5: Commit**

```bash
git add backend/doctor.py backend/tests/test_doctor_scheduled_fetch.py
git commit -m "feat(doctor): add scheduled-fetch check"
```

---

### Task 9: Closure canary + docs

**Files:**
- Modify: `mcp_server/tests/test_mcpb_closure.py`
- Modify: `README.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: the existing `forbidden_prefixes` tuple.

- [ ] **Step 1: Extend the canary (must still PASS)**

Add to `forbidden_prefixes` in `test_forbidden_internal_modules_absent`:
```python
        "backend.scheduled_fetch",   # CLI-only: scheduled-fetch run routine
        "backend.scheduled_fetch_status",  # CLI-only: status + install detection
        "backend.notify",            # CLI-only: desktop notification
```

Run: `uv run pytest mcp_server/tests/test_mcpb_closure.py -v`
Expected: PASS — none are imported by `mcp_server.server`. If it FAILS, find the import edge and make it lazy / remove it; do NOT loosen the test.

- [ ] **Step 2: Update docs**

README (near the `install` section): document `install fetch` — hourly incremental fetch + reindex, status file, doctor monitoring, re-auth notification, and the honest limitation (background jobs can't re-login; notification is best-effort; re-auth is a one-time `claude-explorer capture`). CLAUDE.md: add a one-line `install fetch` entry to the CLI list, and a short note that `install all` now includes it.

- [ ] **Step 3: Verify nothing regressed**

Run: `uv run pytest backend/tests/test_scheduled_fetch_status.py backend/tests/test_notify.py backend/tests/test_run_fetch_helper.py backend/tests/test_scheduled_fetch_routine.py backend/tests/test_scheduled_fetch_installed.py backend/tests/test_scheduled_fetch_install_gen.py backend/tests/test_cli_install_fetch.py backend/tests/test_doctor_scheduled_fetch.py mcp_server/tests/test_mcpb_closure.py -q`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add mcp_server/tests/test_mcpb_closure.py README.md CLAUDE.md
git commit -m "test(fetch): guard MCP closure; docs for scheduled fetch"
```

---

## Final verification (after all tasks)

- [ ] Full backend suite, bare: `uv run pytest backend -q` — no `SyntaxError`/`collected 0`; pass count rose by the new tests; only failure is the pre-existing unrelated `test_lifespan_filecache_warm`.
- [ ] `uv run claude-explorer install --help` lists `fetch`; `uv run claude-explorer doctor` shows the "Scheduled fetch" check (WARN not-installed on a clean box).
- [ ] Real install on this Linux box: `uv run claude-explorer install fetch --interval 3600`, then `systemctl --user list-timers | grep claude-explorer-scheduled-fetch` shows the timer; `uv run claude-explorer doctor` flips the check; then `uv run claude-explorer install fetch --uninstall`.

## Self-Review notes (spec coverage)

- install fetch (periodic job) → Tasks 6/7. ✓
- run routine (fetch + drift + status + notify transition + lock) → Task 4. ✓
- status file → Task 1. ✓
- notification (best-effort, transition-only) → Task 2 + Task 4. ✓
- shared fetch helper (auth detection) → Task 3. ✓
- install detection → Task 5. ✓
- doctor check (installed/auth/stale) → Task 8. ✓
- install all inclusion → Task 7. ✓
- stdlib-only CLI modules out of MCP closure → Task 9 canary. ✓
- docs + honest limitation → Task 9. ✓
- Future work (web banner, MCP/skill staleness prompt) → spec only, not built. ✓
