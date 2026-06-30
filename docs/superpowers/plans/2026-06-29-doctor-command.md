# `claude-explorer doctor` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only `claude-explorer doctor` command that checks install + environment health, reports pass/warn/fail per check with a fix hint, and sets a CI-usable exit code.

**Architecture:** A check registry in `backend/doctor.py` (pure-ish functions reusing existing primitives — `watcher_status`, `config`, `search_index`) plus a standalone `backend/mcp_config_detect.py` reader (config-file MCP registration for Claude Code + Desktop, reused later by a future `install-mcp`). A thin Click command in `cli/main.py` runs the registry, renders human or `--json` output, and exits non-zero on any FAIL.

**Tech Stack:** Python 3, Click (CLI), dataclasses + Enum (result model), stdlib `json`/`pathlib`/`shutil` only in the detect module, pytest + `click.testing.CliRunner` (tests).

## Global Constraints

- Python: PEP 8, type hints (copied from spec / CLAUDE.md "Code Style").
- Commits: Conventional commit messages, **no AI attribution lines**.
- `doctor` is **read-only** — no check may mutate state. Fixing stays in dedicated commands.
- `doctor` is **NOT** wired through the corrupt-config writer gate (`_refuse_if_config_corrupt`); it is read-only and a recovery aid (same rationale that exempts `install-watcher`). It *reports* corrupt config as a check.
- `backend/doctor.py` and `backend/mcp_config_detect.py` are CLI-only and MUST NOT be imported by `mcp_server.server` (keep them out of the MCPB closure; the canary test `mcp_server/tests/test_mcpb_closure.py` must stay green).
- `backend/mcp_config_detect.py` is import-light: stdlib `json` + `pathlib` + `os` + `sys` only.
- Status semantics: `OK` healthy; `WARN` degraded/unconfirmable (does NOT fail exit code); `FAIL` core capability broken (exit code 1).
- Tests are black-box / spec-driven (per `CLAUDE-TESTING.md`), no network, no real Claude Desktop dependency — inject paths/env.
- Test env override hooks that already exist: `CLAUDE_EXPLORER_DATA_DIR`, `CLAUDE_DIR`, `CLAUDE_EXPLORER_WATCHER_INSTALLED`; `get_settings.cache_clear()` to drop the cached `Settings`.

---

### Task 1: Result model + runner

**Files:**
- Create: `backend/doctor.py`
- Test: `backend/tests/test_doctor_runner.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `class Status(str, Enum)` with members `OK = "ok"`, `WARN = "warn"`, `FAIL = "fail"`.
  - `@dataclass class CheckResult` with fields `name: str`, `status: Status`, `detail: str`, `fix_command: str | None = None`, `fix: Callable[[], None] | None = None`.
  - `Check = Callable[[], CheckResult]` (type alias).
  - `run_checks(checks: list[tuple[str, Check]]) -> list[CheckResult]` — runs each; an exception becomes a `FAIL` result named with the registry name.
  - `has_failure(results: list[CheckResult]) -> bool`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_doctor_runner.py
from __future__ import annotations

from backend.doctor import CheckResult, Status, has_failure, run_checks


def _ok() -> CheckResult:
    return CheckResult(name="ok-check", status=Status.OK, detail="fine")


def _warn() -> CheckResult:
    return CheckResult(name="warn-check", status=Status.WARN, detail="meh", fix_command="do x")


def _boom() -> CheckResult:
    raise RuntimeError("kaboom")


def test_run_checks_collects_all_results() -> None:
    results = run_checks([("A", _ok), ("B", _warn)])
    assert [r.status for r in results] == [Status.OK, Status.WARN]


def test_exception_in_one_check_becomes_fail_and_does_not_abort_others() -> None:
    results = run_checks([("Boom", _boom), ("After", _ok)])
    assert results[0].status is Status.FAIL
    assert "kaboom" in results[0].detail
    assert results[0].name == "Boom"          # registry name used on exception
    assert results[1].status is Status.OK       # later checks still run


def test_has_failure_true_only_when_a_fail_present() -> None:
    assert has_failure([_ok(), _warn()]) is False
    assert has_failure([_ok(), CheckResult("x", Status.FAIL, "broken")]) is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest backend/tests/test_doctor_runner.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.doctor'`.

- [ ] **Step 3: Write minimal implementation**

```python
# backend/doctor.py
"""Read-only environment/install diagnostics for `claude-explorer doctor`.

Each check is a zero-arg callable returning a :class:`CheckResult`. The
registry pairs a display name with the callable so the runner can label a
result even if the check raises. Checks MUST NOT mutate state — fixing
lives in dedicated commands (install-watcher, reindex-search, mcp).
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Callable


class Status(str, Enum):
    OK = "ok"
    WARN = "warn"
    FAIL = "fail"


@dataclass
class CheckResult:
    name: str
    status: Status
    detail: str
    fix_command: str | None = None
    fix: Callable[[], None] | None = None


Check = Callable[[], "CheckResult"]


def run_checks(checks: list[tuple[str, Check]]) -> list[CheckResult]:
    """Run every check, wrapping unexpected exceptions as FAIL results.

    One check failing never aborts the others.
    """
    out: list[CheckResult] = []
    for name, fn in checks:
        try:
            out.append(fn())
        except Exception as exc:  # noqa: BLE001 - doctor must never crash
            out.append(
                CheckResult(
                    name=name,
                    status=Status.FAIL,
                    detail=f"unexpected error: {type(exc).__name__}: {exc}",
                )
            )
    return out


def has_failure(results: list[CheckResult]) -> bool:
    return any(r.status is Status.FAIL for r in results)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest backend/tests/test_doctor_runner.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/doctor.py backend/tests/test_doctor_runner.py
git commit -m "feat(doctor): add check result model and runner"
```

---

### Task 2: Filesystem + config checks

**Files:**
- Modify: `backend/doctor.py`
- Test: `backend/tests/test_doctor_fs_checks.py`

**Interfaces:**
- Consumes: `CheckResult`, `Status` (Task 1); `backend.config.get_settings`.
- Produces:
  - `credentials_path() -> Path` — `Path.home() / ".claude-explorer" / "credentials.json"` (own function so tests can monkeypatch).
  - `check_credentials() -> CheckResult`
  - `check_data_dir() -> CheckResult`
  - `check_config() -> CheckResult`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_doctor_fs_checks.py
from __future__ import annotations

from pathlib import Path

import backend.doctor as doctor
from backend.config import get_settings
from backend.doctor import Status


def _set_data_dir(monkeypatch, tmp_path: Path) -> Path:
    conv = tmp_path / "conversations"
    conv.mkdir()
    monkeypatch.setenv("CLAUDE_EXPLORER_DATA_DIR", str(conv))
    get_settings.cache_clear()
    return conv


def test_credentials_missing_is_warn(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(doctor, "credentials_path", lambda: tmp_path / "nope.json")
    r = doctor.check_credentials()
    assert r.status is Status.WARN
    assert "capture" in (r.fix_command or "")


def test_credentials_present_is_ok(monkeypatch, tmp_path: Path) -> None:
    creds = tmp_path / "credentials.json"
    creds.write_text("{}")
    monkeypatch.setattr(doctor, "credentials_path", lambda: creds)
    assert doctor.check_credentials().status is Status.OK


def test_data_dir_present_and_writable_is_ok(monkeypatch, tmp_path: Path) -> None:
    conv = _set_data_dir(monkeypatch, tmp_path)
    (conv / "a.json").write_text("{}")
    r = doctor.check_data_dir()
    assert r.status is Status.OK
    assert "1" in r.detail  # one conversation counted


def test_data_dir_missing_is_fail(monkeypatch, tmp_path: Path) -> None:
    missing = tmp_path / "conversations"  # not created
    monkeypatch.setenv("CLAUDE_EXPLORER_DATA_DIR", str(missing))
    get_settings.cache_clear()
    assert doctor.check_data_dir().status is Status.FAIL


def test_config_valid_is_ok(monkeypatch, tmp_path: Path) -> None:
    _set_data_dir(monkeypatch, tmp_path)
    assert doctor.check_config().status is Status.OK


def test_config_corrupt_is_fail(monkeypatch, tmp_path: Path) -> None:
    from backend import config as cfg
    monkeypatch.setattr(
        cfg, "get_settings",
        lambda: cfg.Settings(
            claude_dir=tmp_path, data_dir=tmp_path,
            claude_desktop_app_dir=tmp_path,  # required field on Settings
            config_corrupt_reason="x.json: JSONDecodeError: boom",
        ),
    )
    monkeypatch.setattr(doctor, "get_settings", cfg.get_settings)
    r = doctor.check_config()
    assert r.status is Status.FAIL
    assert "boom" in r.detail
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest backend/tests/test_doctor_fs_checks.py -v`
Expected: FAIL — `AttributeError: module 'backend.doctor' has no attribute 'credentials_path'`.

- [ ] **Step 3: Write minimal implementation**

Add to `backend/doctor.py` (imports at top: `import os`, `from pathlib import Path`, `from .config import get_settings`):

```python
def credentials_path() -> Path:
    return Path.home() / ".claude-explorer" / "credentials.json"


def check_credentials() -> CheckResult:
    p = credentials_path()
    if p.is_file():
        return CheckResult("Credentials", Status.OK, f"found ({p})")
    return CheckResult(
        "Credentials", Status.WARN,
        "not found (needed for fetch, not for browsing existing data)",
        fix_command="claude-explorer capture",
    )


def check_data_dir() -> CheckResult:
    data_dir = get_settings().data_dir
    if not data_dir.exists():
        return CheckResult(
            "Data directory", Status.FAIL, f"missing: {data_dir}",
            fix_command=f"mkdir -p {data_dir}  (or set CLAUDE_EXPLORER_DATA_DIR)",
        )
    if not os.access(data_dir, os.W_OK):
        return CheckResult(
            "Data directory", Status.FAIL, f"not writable: {data_dir}",
            fix_command=f"chmod u+w {data_dir}",
        )
    count = sum(1 for _ in data_dir.glob("*.json"))
    return CheckResult("Data directory", Status.OK, f"{data_dir} ({count} conversation(s))")


def check_config() -> CheckResult:
    get_settings.cache_clear()
    reason = get_settings().config_corrupt_reason
    if reason:
        return CheckResult(
            "Config", Status.FAIL, f"corrupt: {reason}",
            fix_command="fix or remove the named config file",
        )
    return CheckResult("Config", Status.OK, "valid")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest backend/tests/test_doctor_fs_checks.py -v`
Expected: PASS (6 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/doctor.py backend/tests/test_doctor_fs_checks.py
git commit -m "feat(doctor): add credentials, data-dir, config checks"
```

---

### Task 3: Watcher + search checks

**Files:**
- Modify: `backend/doctor.py`
- Test: `backend/tests/test_doctor_watcher_search.py`

**Interfaces:**
- Consumes: `CheckResult`, `Status`; `backend.watcher_status.is_watcher_installed`, `invalidate_cache`; `backend.search_index.get_search_index`.
- Produces:
  - `watcher_install_command() -> str` — platform-correct hint.
  - `check_watcher() -> CheckResult`
  - `check_search() -> CheckResult`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_doctor_watcher_search.py
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest backend/tests/test_doctor_watcher_search.py -v`
Expected: FAIL — `AttributeError: module 'backend.doctor' has no attribute 'check_watcher'`.

- [ ] **Step 3: Write minimal implementation**

Add to `backend/doctor.py` top imports: `import sys`, `from .watcher_status import is_watcher_installed`, `from .search_index import get_search_index`.

```python
def watcher_install_command() -> str:
    base = "claude-explorer install-watcher"
    if sys.platform.startswith("linux"):
        return base + "  (then: sudo loginctl enable-linger $USER)"
    return base


def check_watcher() -> CheckResult:
    if is_watcher_installed():
        return CheckResult("CC watcher", Status.OK, "installed")
    return CheckResult(
        "CC watcher", Status.WARN,
        "not installed (image-cache data loss risk during downtime)",
        fix_command=watcher_install_command(),
    )


def check_search() -> CheckResult:
    idx = get_search_index()
    if idx is None:
        return CheckResult(
            "Search (FTS5)", Status.WARN,
            "FTS5 unavailable; search uses linear scan (still works)",
        )
    if not idx.is_ready():
        return CheckResult(
            "Search (FTS5)", Status.WARN,
            "index not ready (building or stale); linear-scan fallback active",
            fix_command="claude-explorer reindex-search",
        )
    return CheckResult("Search (FTS5)", Status.OK, "index ready")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest backend/tests/test_doctor_watcher_search.py -v`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/doctor.py backend/tests/test_doctor_watcher_search.py
git commit -m "feat(doctor): add watcher and search checks"
```

---

### Task 4: Environment checks (uv/uvx + PDF libs)

**Files:**
- Modify: `backend/doctor.py`
- Test: `backend/tests/test_doctor_env_checks.py`

**Interfaces:**
- Consumes: `CheckResult`, `Status`.
- Produces:
  - `pdf_install_hint() -> str` — OS-specific.
  - `check_uvx() -> CheckResult`
  - `check_pdf_libs() -> CheckResult`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_doctor_env_checks.py
from __future__ import annotations

import backend.doctor as doctor
from backend.doctor import Status


def test_uvx_present_is_ok(monkeypatch) -> None:
    monkeypatch.setattr(doctor.shutil, "which", lambda name: "/usr/bin/" + name)
    r = doctor.check_uvx()
    assert r.status is Status.OK
    assert "uvx" in r.detail


def test_uvx_missing_is_warn(monkeypatch) -> None:
    monkeypatch.setattr(doctor.shutil, "which", lambda name: None)
    r = doctor.check_uvx()
    assert r.status is Status.WARN
    assert r.fix_command is not None


def test_pdf_libs_importable_is_ok(monkeypatch) -> None:
    monkeypatch.setattr(doctor, "_weasyprint_importable", lambda: (True, ""))
    assert doctor.check_pdf_libs().status is Status.OK


def test_pdf_libs_missing_is_warn_with_os_hint(monkeypatch) -> None:
    monkeypatch.setattr(doctor, "_weasyprint_importable", lambda: (False, "OSError: no pango"))
    r = doctor.check_pdf_libs()
    assert r.status is Status.WARN
    assert r.fix_command  # OS-specific install hint present
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest backend/tests/test_doctor_env_checks.py -v`
Expected: FAIL — `AttributeError: module 'backend.doctor' has no attribute 'check_uvx'`.

- [ ] **Step 3: Write minimal implementation**

Add to `backend/doctor.py` top imports: `import shutil`.

```python
def check_uvx() -> CheckResult:
    uvx = shutil.which("uvx")
    uv = shutil.which("uv")
    if uvx or uv:
        found = uvx or uv
        return CheckResult("Runtime (uv/uvx)", Status.OK, f"found ({found})")
    return CheckResult(
        "Runtime (uv/uvx)", Status.WARN,
        "uv/uvx not on PATH (needed only for the uvx-based MCP config)",
        fix_command="install uv (https://docs.astral.sh/uv/) or add it to PATH",
    )


def _weasyprint_importable() -> tuple[bool, str]:
    try:
        import weasyprint  # noqa: F401
    except Exception as exc:  # noqa: BLE001 - OSError when pango missing, etc.
        return False, f"{type(exc).__name__}: {exc}"
    return True, ""


def pdf_install_hint() -> str:
    if sys.platform == "darwin":
        return "brew install pango cairo libffi"
    if sys.platform.startswith("linux"):
        return "apt-get install libpango-1.0-0 libpangocairo-1.0-0 libcairo2"
    return "MSYS2: pacman -S mingw-w64-x86_64-pango (or the standalone WeasyPrint .exe)"


def check_pdf_libs() -> CheckResult:
    ok, err = _weasyprint_importable()
    if ok:
        return CheckResult("PDF export", Status.OK, "weasyprint importable")
    return CheckResult(
        "PDF export", Status.WARN,
        f"unavailable ({err}); PDF export disabled, rest of app fine",
        fix_command=pdf_install_hint(),
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest backend/tests/test_doctor_env_checks.py -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/doctor.py backend/tests/test_doctor_env_checks.py
git commit -m "feat(doctor): add uv/uvx and PDF library checks"
```

---

### Task 5: MCP config detection module

**Files:**
- Create: `backend/mcp_config_detect.py`
- Test: `backend/tests/test_mcp_config_detect.py`

**Interfaces:**
- Consumes: stdlib only.
- Produces:
  - `@dataclass class McpRegistration` with `found: bool`, `config_path: Path | None`, `scope: str | None`, `server_name: str | None`.
  - `claude_desktop_config_path() -> Path` (OS-specific).
  - `detect_mcp_in_claude_code(user_config: Path | None = None, project_config: Path | None = None) -> McpRegistration`
  - `detect_mcp_in_claude_desktop(config_path: Path | None = None) -> McpRegistration`
  - Internal `_entry_matches(command, args) -> bool` for "is this `claude-explorer mcp`".

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_mcp_config_detect.py
from __future__ import annotations

import json
from pathlib import Path

from backend.mcp_config_detect import (
    detect_mcp_in_claude_code,
    detect_mcp_in_claude_desktop,
)


def _write(p: Path, servers: dict) -> Path:
    p.write_text(json.dumps({"mcpServers": servers}))
    return p


def test_code_user_scope_uvx_form(tmp_path: Path) -> None:
    user = _write(tmp_path / ".claude.json", {
        "claude-sessions": {"command": "uvx", "args": ["claude-explorer", "mcp"]},
    })
    reg = detect_mcp_in_claude_code(user_config=user, project_config=tmp_path / "absent.json")
    assert reg.found is True
    assert reg.scope == "user"
    assert reg.server_name == "claude-sessions"


def test_code_project_scope_uv_run_form(tmp_path: Path) -> None:
    proj = _write(tmp_path / ".mcp.json", {
        "x": {"command": "uv", "args": ["run", "--directory", "/p", "claude-explorer", "mcp"]},
    })
    reg = detect_mcp_in_claude_code(user_config=tmp_path / "absent.json", project_config=proj)
    assert reg.found is True
    assert reg.scope == "project"


def test_code_absolute_binary_form(tmp_path: Path) -> None:
    user = _write(tmp_path / ".claude.json", {
        "x": {"command": "/opt/bin/claude-explorer", "args": ["mcp"]},
    })
    reg = detect_mcp_in_claude_code(user_config=user, project_config=tmp_path / "absent.json")
    assert reg.found is True


def test_code_unrelated_server_not_found(tmp_path: Path) -> None:
    user = _write(tmp_path / ".claude.json", {
        "other": {"command": "uvx", "args": ["some-other-tool"]},
    })
    reg = detect_mcp_in_claude_code(user_config=user, project_config=tmp_path / "absent.json")
    assert reg.found is False


def test_absent_file_is_not_found_no_raise(tmp_path: Path) -> None:
    reg = detect_mcp_in_claude_code(
        user_config=tmp_path / "absent.json", project_config=tmp_path / "absent2.json"
    )
    assert reg.found is False


def test_corrupt_json_is_not_found_no_raise(tmp_path: Path) -> None:
    bad = tmp_path / ".claude.json"
    bad.write_text("{ not json ")
    reg = detect_mcp_in_claude_code(user_config=bad, project_config=tmp_path / "absent.json")
    assert reg.found is False


def test_desktop_found(tmp_path: Path) -> None:
    cfg = _write(tmp_path / "claude_desktop_config.json", {
        "claude-sessions": {"command": "uvx", "args": ["claude-explorer", "mcp"]},
    })
    reg = detect_mcp_in_claude_desktop(config_path=cfg)
    assert reg.found is True
    assert reg.scope == "desktop"


def test_desktop_missing_mcpservers_key(tmp_path: Path) -> None:
    cfg = tmp_path / "claude_desktop_config.json"
    cfg.write_text(json.dumps({"preferences": {}}))
    reg = detect_mcp_in_claude_desktop(config_path=cfg)
    assert reg.found is False
    assert reg.config_path == cfg
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest backend/tests/test_mcp_config_detect.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.mcp_config_detect'`.

- [ ] **Step 3: Write minimal implementation**

```python
# backend/mcp_config_detect.py
"""Detect whether `claude-explorer mcp` is registered in MCP client config
files (Claude Code: ~/.claude.json user scope + ./.mcp.json project scope;
Claude Desktop: claude_desktop_config.json).

Config-file detection only. Claude Desktop `.mcpb`/DXT bundle installs are
NOT detectable from disk (tracked in the app's binary LevelDB/IndexedDB
store), so callers treat a Desktop "not found" as WARN-with-caveat, not a
hard failure. This module is the read side that a future `install-mcp`
command reuses to stay idempotent. Stdlib only — keep it out of any heavy
import path.
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path


@dataclass
class McpRegistration:
    found: bool
    config_path: Path | None
    scope: str | None
    server_name: str | None


def claude_desktop_config_path() -> Path:
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "Claude" / "claude_desktop_config.json"
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA") or (Path.home() / "AppData" / "Roaming"))
        return base / "Claude" / "claude_desktop_config.json"
    return Path.home() / ".config" / "Claude" / "claude_desktop_config.json"


def _entry_matches(command: str, args: list) -> bool:
    """True iff (command, args) resolves to `claude-explorer ... mcp`.

    Handles `uvx claude-explorer mcp`, `uv run --directory X claude-explorer
    mcp`, and an absolute path to a `claude-explorer` binary with `mcp`.
    """
    tokens = [Path(str(command)).name] + [str(a) for a in (args or [])]
    if "claude-explorer" not in tokens:
        return False
    idx = tokens.index("claude-explorer")
    return "mcp" in tokens[idx + 1:]


def _scan(path: Path, scope: str) -> McpRegistration | None:
    """Return a found McpRegistration if `path` registers our server, else
    None. Missing/corrupt files yield None (never raise)."""
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        return None
    servers = data.get("mcpServers") if isinstance(data, dict) else None
    if not isinstance(servers, dict):
        return None
    for name, entry in servers.items():
        if not isinstance(entry, dict):
            continue
        if _entry_matches(entry.get("command", ""), entry.get("args", [])):
            return McpRegistration(True, path, scope, name)
    return None


def detect_mcp_in_claude_code(
    user_config: Path | None = None,
    project_config: Path | None = None,
) -> McpRegistration:
    user = user_config or (Path.home() / ".claude.json")
    project = project_config or (Path.cwd() / ".mcp.json")
    for path, scope in ((user, "user"), (project, "project")):
        hit = _scan(path, scope)
        if hit is not None:
            return hit
    return McpRegistration(False, None, None, None)


def detect_mcp_in_claude_desktop(config_path: Path | None = None) -> McpRegistration:
    path = config_path or claude_desktop_config_path()
    hit = _scan(path, "desktop")
    if hit is not None:
        return hit
    # Report the path we looked at so the caller can name it in the fix hint.
    return McpRegistration(False, path, None, None)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest backend/tests/test_mcp_config_detect.py -v`
Expected: PASS (8 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/mcp_config_detect.py backend/tests/test_mcp_config_detect.py
git commit -m "feat(doctor): add MCP config-file detection module"
```

---

### Task 6: MCP checks (Code + Desktop with .mcpb caveat)

**Files:**
- Modify: `backend/doctor.py`
- Test: `backend/tests/test_doctor_mcp_checks.py`

**Interfaces:**
- Consumes: `CheckResult`, `Status`; `backend.mcp_config_detect.detect_mcp_in_claude_code`, `detect_mcp_in_claude_desktop`, `McpRegistration`.
- Produces:
  - `check_mcp_code() -> CheckResult`
  - `check_mcp_desktop() -> CheckResult`
  - Module constant `MCPB_CAVEAT: str` (the ".mcpb installs aren't detectable" note).

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_doctor_mcp_checks.py
from __future__ import annotations

from pathlib import Path

import backend.doctor as doctor
from backend.doctor import Status
from backend.mcp_config_detect import McpRegistration


def test_mcp_code_found_is_ok(monkeypatch) -> None:
    monkeypatch.setattr(
        doctor, "detect_mcp_in_claude_code",
        lambda: McpRegistration(True, Path("/h/.claude.json"), "user", "claude-sessions"),
    )
    r = doctor.check_mcp_code()
    assert r.status is Status.OK
    assert "user" in r.detail


def test_mcp_code_missing_is_warn_with_add_command(monkeypatch) -> None:
    monkeypatch.setattr(
        doctor, "detect_mcp_in_claude_code",
        lambda: McpRegistration(False, None, None, None),
    )
    r = doctor.check_mcp_code()
    assert r.status is Status.WARN
    assert "claude mcp add" in (r.fix_command or "")


def test_mcp_desktop_found_is_ok(monkeypatch) -> None:
    monkeypatch.setattr(
        doctor, "detect_mcp_in_claude_desktop",
        lambda: McpRegistration(True, Path("/h/claude_desktop_config.json"), "desktop", "x"),
    )
    assert doctor.check_mcp_desktop().status is Status.OK


def test_mcp_desktop_missing_is_warn_not_fail_with_mcpb_caveat(monkeypatch) -> None:
    monkeypatch.setattr(
        doctor, "detect_mcp_in_claude_desktop",
        lambda: McpRegistration(False, Path("/h/claude_desktop_config.json"), None, None),
    )
    r = doctor.check_mcp_desktop()
    assert r.status is Status.WARN          # never FAIL — protects .mcpb users
    assert ".mcpb" in r.detail or ".mcpb" in (r.fix_command or "")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest backend/tests/test_doctor_mcp_checks.py -v`
Expected: FAIL — `AttributeError: module 'backend.doctor' has no attribute 'check_mcp_code'`.

- [ ] **Step 3: Write minimal implementation**

Add to `backend/doctor.py` top imports:
`from .mcp_config_detect import detect_mcp_in_claude_code, detect_mcp_in_claude_desktop`.

```python
MCPB_CAVEAT = (
    "if you installed the .mcpb bundle via the Extensions UI, this is "
    "expected — bundle installs aren't detectable from disk"
)


def check_mcp_code() -> CheckResult:
    reg = detect_mcp_in_claude_code()
    if reg.found:
        return CheckResult(
            "MCP -> Claude Code", Status.OK,
            f"registered ({reg.scope} scope: {reg.server_name})",
        )
    return CheckResult(
        "MCP -> Claude Code", Status.WARN, "not registered",
        fix_command="claude mcp add --scope user claude-sessions -- uvx claude-explorer mcp",
    )


def check_mcp_desktop() -> CheckResult:
    reg = detect_mcp_in_claude_desktop()
    if reg.found:
        return CheckResult(
            "MCP -> Claude Desktop", Status.OK,
            f"registered ({reg.server_name})",
        )
    where = reg.config_path or "claude_desktop_config.json"
    return CheckResult(
        "MCP -> Claude Desktop", Status.WARN,
        f"no entry in {where}; {MCPB_CAVEAT}",
        fix_command=(
            "add an mcpServers stdio block for `uvx claude-explorer mcp` to "
            f"{where}, then restart Claude Desktop"
        ),
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest backend/tests/test_doctor_mcp_checks.py -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/doctor.py backend/tests/test_doctor_mcp_checks.py
git commit -m "feat(doctor): add MCP registration checks (code + desktop)"
```

---

### Task 7: Registry + CLI command (`doctor`) with `--json` and exit code

**Files:**
- Modify: `backend/doctor.py` (add `ALL_CHECKS`, `render_text`, `to_json`)
- Modify: `cli/main.py` (add `doctor` command)
- Test: `backend/tests/test_doctor_cli.py`

**Interfaces:**
- Consumes: every `check_*` (Tasks 2–6), `run_checks`, `has_failure`, `Status`, `CheckResult`.
- Produces:
  - `ALL_CHECKS: list[tuple[str, Check]]` — registry in display order.
  - `render_text(results: list[CheckResult]) -> str`
  - `to_json(results: list[CheckResult]) -> dict` — `{"checks": [...], "summary": {...}}` with status as string.
  - Click command `doctor` (flag `--json`), exit code 1 on any FAIL.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_doctor_cli.py
from __future__ import annotations

import json

from click.testing import CliRunner

import backend.doctor as doctor
from backend.doctor import CheckResult, Status
from cli.main import main


def _patch_checks(monkeypatch, results: list[CheckResult]) -> None:
    monkeypatch.setattr(
        doctor, "ALL_CHECKS",
        [(r.name, (lambda r=r: r)) for r in results],
    )


def test_doctor_all_ok_exit_zero(monkeypatch) -> None:
    _patch_checks(monkeypatch, [CheckResult("A", Status.OK, "fine")])
    res = CliRunner().invoke(main, ["doctor"])
    assert res.exit_code == 0
    assert "All checks passed" in res.output


def test_doctor_warn_only_exit_zero(monkeypatch) -> None:
    _patch_checks(monkeypatch, [CheckResult("A", Status.WARN, "meh", fix_command="do x")])
    res = CliRunner().invoke(main, ["doctor"])
    assert res.exit_code == 0
    assert "do x" in res.output  # fix hint rendered


def test_doctor_any_fail_exit_one(monkeypatch) -> None:
    _patch_checks(monkeypatch, [
        CheckResult("A", Status.OK, "fine"),
        CheckResult("B", Status.FAIL, "broken", fix_command="fix it"),
    ])
    res = CliRunner().invoke(main, ["doctor"])
    assert res.exit_code == 1
    assert "fix it" in res.output


def test_doctor_json_output(monkeypatch) -> None:
    _patch_checks(monkeypatch, [CheckResult("A", Status.FAIL, "broken")])
    res = CliRunner().invoke(main, ["doctor", "--json"])
    assert res.exit_code == 1
    payload = json.loads(res.output)
    assert payload["checks"][0]["status"] == "fail"
    assert payload["summary"]["failed"] == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest backend/tests/test_doctor_cli.py -v`
Expected: FAIL — `AttributeError: module 'backend.doctor' has no attribute 'ALL_CHECKS'` (and no `doctor` command).

- [ ] **Step 3: Write minimal implementation**

Add to `backend/doctor.py` (after all `check_*` defined). Imports: `import json`.

```python
ALL_CHECKS: list[tuple[str, Check]] = [
    ("Credentials", check_credentials),
    ("Data directory", check_data_dir),
    ("Config", check_config),
    ("CC watcher", check_watcher),
    ("Search (FTS5)", check_search),
    ("Runtime (uv/uvx)", check_uvx),
    ("PDF export", check_pdf_libs),
    ("MCP -> Claude Code", check_mcp_code),
    ("MCP -> Claude Desktop", check_mcp_desktop),
]

_SYMBOL = {Status.OK: "[ok]", Status.WARN: "[warn]", Status.FAIL: "[FAIL]"}


def render_text(results: list[CheckResult]) -> str:
    width = max((len(r.name) for r in results), default=0)
    lines: list[str] = []
    for r in results:
        lines.append(f"  {r.name.ljust(width)}  {_SYMBOL[r.status]} {r.detail}")
        if r.status is not Status.OK and r.fix_command:
            lines.append(f"  {' ' * width}  -> {r.fix_command}")
    failed = sum(1 for r in results if r.status is Status.FAIL)
    warned = sum(1 for r in results if r.status is Status.WARN)
    if failed:
        lines.append(f"\n{failed} problem(s) found, {warned} warning(s).")
    elif warned:
        lines.append(f"\nNo failures. {warned} warning(s) — see fixes above.")
    else:
        lines.append("\nAll checks passed.")
    return "\n".join(lines)


def to_json(results: list[CheckResult]) -> dict:
    return {
        "checks": [
            {
                "name": r.name,
                "status": r.status.value,
                "detail": r.detail,
                "fix_command": r.fix_command,
            }
            for r in results
        ],
        "summary": {
            "ok": sum(1 for r in results if r.status is Status.OK),
            "warnings": sum(1 for r in results if r.status is Status.WARN),
            "failed": sum(1 for r in results if r.status is Status.FAIL),
        },
    }
```

Add the command to `cli/main.py` (top already has `import click`; add `import json`, `import sys`):

```python
@main.command()
@click.option("--json", "as_json", is_flag=True, help="Machine-readable JSON output")
def doctor(as_json: bool) -> None:
    """Diagnose install + environment health (read-only).

    Reports pass/warn/fail per check with a fix hint. Exits non-zero if
    any check fails. Fixing stays in dedicated commands (install-watcher,
    reindex-search, mcp).
    """
    from backend.doctor import ALL_CHECKS, has_failure, render_text, run_checks, to_json

    results = run_checks(ALL_CHECKS)
    if as_json:
        click.echo(json.dumps(to_json(results), indent=2))
    else:
        click.echo(render_text(results))
    sys.exit(1 if has_failure(results) else 0)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest backend/tests/test_doctor_cli.py -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/doctor.py cli/main.py backend/tests/test_doctor_cli.py
git commit -m "feat(doctor): add registry, rendering, and CLI command"
```

---

### Task 8: MCPB closure guard + docs

**Files:**
- Modify: `mcp_server/tests/test_mcpb_closure.py` (extend the existing `forbidden_prefixes` tuple in `test_forbidden_internal_modules_absent`)
- Modify: `README.md` (Command Reference), `CLAUDE.md` (CLI Usage command list)

**Interfaces:**
- Consumes: the existing `closure` pytest fixture in `test_mcpb_closure.py` (returns `(internal: set[str], external: set[str])` from `mcpb_import_closure.compute_closure(...)`).
- Produces: the canary now also forbids `backend.doctor` and `backend.mcp_config_detect` from the MCP eager-import closure.

- [ ] **Step 1: Extend the existing canary test (it should still pass — proving the modules are correctly absent)**

In `mcp_server/tests/test_mcpb_closure.py`, find the `forbidden_prefixes` tuple inside `test_forbidden_internal_modules_absent` (currently `("backend.main", "backend.routers", "backend.cc_watcher", "backend.deps")`) and add the two new CLI-only modules:

```python
    forbidden_prefixes = (
        "backend.main",
        "backend.routers",
        "backend.cc_watcher",
        "backend.deps",
        "backend.doctor",          # CLI-only: doctor command
        "backend.mcp_config_detect",  # CLI-only: MCP config reader
    )
```

Also update that test's docstring's parenthetical to mention these are CLI-only modules (one line), so a future reader knows why they're forbidden.

- [ ] **Step 2: Run the canary to verify it still passes (modules correctly absent)**

Run: `uv run pytest mcp_server/tests/test_mcpb_closure.py -v`
Expected: PASS. `mcp_server.server` never imports `backend.doctor`/`backend.mcp_config_detect`, so they are not in the closure and the tightened assertion holds.

If it FAILS, an unexpected import edge exists. Find it:
`uv run python -c "import sys; sys.path.insert(0,'scripts'); import mcpb_import_closure as m; i,_=m.compute_closure(entry_module='mcp_server.server', project_root='.', project_packages={'mcp_server','backend','cli','fetcher'}); print([x for x in i if 'doctor' in x or 'mcp_config' in x])"`
Remove the offending import (move it inside a function body or drop it). Do NOT loosen the test.

- [ ] **Step 3: Update docs (renumbered — this follows the canary edit above)**

In `README.md`, under the Command Reference section (after `serve` / near `install-watcher`), add:

````markdown
#### `claude-explorer doctor`

Diagnose install and environment health. **Read-only** — reports
pass/warn/fail for each check with the exact command to fix it, and exits
non-zero if any check fails (usable in setup scripts / CI). Fixing stays
in the dedicated commands it points at.

```bash
claude-explorer doctor          # human-readable report
claude-explorer doctor --json   # machine-readable
```

Checks: credentials, data directory, config validity, CC watcher,
search/FTS5 index, uv/uvx on PATH, PDF export libraries, and whether
`claude-explorer mcp` is registered in Claude Code and Claude Desktop.

> **Note on Claude Desktop + `.mcpb`:** the Desktop MCP check only sees
> servers in `claude_desktop_config.json`. Extensions installed via the
> Desktop Extensions UI (`.mcpb` bundle) are stored in the app's internal
> database and are **not detectable from disk**, so a bundle-only install
> shows a warning, not a failure.
````

In `CLAUDE.md`, add `doctor` to the CLI command list under "CLI Usage" (one line in the same style as the other commands), e.g. after the `serve` description:

```markdown
# Diagnose install + environment health (read-only)
claude-explorer doctor
```

- [ ] **Step 4: Run the full backend suite to confirm no regression**

Run: `uv run pytest backend/tests/test_doctor_runner.py backend/tests/test_doctor_fs_checks.py backend/tests/test_doctor_watcher_search.py backend/tests/test_doctor_env_checks.py backend/tests/test_mcp_config_detect.py backend/tests/test_doctor_mcp_checks.py backend/tests/test_doctor_cli.py mcp_server/tests/test_mcpb_closure.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add mcp_server/tests/test_mcpb_closure.py README.md CLAUDE.md
git commit -m "test(doctor): guard MCP closure; docs for doctor command"
```

---

## Final verification (after all tasks)

- [ ] Run the whole backend suite and confirm the count rose by the new tests with no drops:
  `uv run pytest backend -q` — confirm no `SyntaxError`/`collected 0`, baseline (1139) + new tests, 0 failed.
- [ ] Smoke-test the real command: `uv run claude-explorer doctor` and `uv run claude-explorer doctor --json` on this machine; eyeball that each check renders and the exit code matches (`echo $?`).
- [ ] Confirm `uv run claude-explorer --help` lists `doctor`.

## Self-Review notes (spec coverage)

- Spec checks 1–9 → Tasks 2 (1–3), 3 (4–5), 4 (6–7), 6 (8–9). ✓
- Read-only + `--fix`-ready (`fix`/`fix_command` carried, no `--fix` impl) → Task 1 model. ✓
- `--json` → Task 7. ✓
- Exit code semantics (WARN ok, FAIL → 1) → Tasks 1 & 7. ✓
- `mcp_config_detect` as standalone reusable module, stdlib-only → Task 5. ✓
- `.mcpb` WARN-not-FAIL + caveat → Task 6. ✓
- MCPB closure stays clean → Task 8. ✓
- Corrupt-config gate exemption (doctor reports, never gated) → Global Constraints + Task 2 `check_config`. ✓
