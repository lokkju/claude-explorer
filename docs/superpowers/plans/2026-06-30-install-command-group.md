# `claude-explorer install` command group — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `claude-explorer install` command group (`all` / `watcher` / `mcp`) that can register the MCP server with Claude Code + Claude Desktop, keeping `install-watcher` working as a hidden deprecated alias.

**Architecture:** A new stdlib-only `backend/mcp_config_install.py` owns the write side (atomic merge/remove of an `mcpServers` entry), reusing `backend/mcp_config_detect.py` (read side) for idempotency. `cli/main.py` gains an `install` Click group whose `watcher` subcommand reuses the existing `cli/watcher.py` OS helpers, whose `mcp` subcommand delegates to the write module, and whose `all` subcommand aggregates both. The deprecated `install-watcher` alias delegates to the same watcher logic.

**Tech Stack:** Python 3, Click (CLI groups/subcommands), dataclasses (`InstallResult`), stdlib `json`/`os`/`pathlib`/`subprocess`/`shutil`, pytest + `click.testing.CliRunner`.

## Global Constraints

- Python: PEP 8, type hints (from spec / CLAUDE.md "Code Style").
- Commits: Conventional commit messages, **no AI attribution lines**.
- `backend/mcp_config_install.py` is **stdlib-only** (`json`, `os`, `sys`, `subprocess`, `shutil`, `pathlib`, `dataclasses`) and **CLI-only** — MUST NOT be imported by `mcp_server.server`. The MCPB closure canary (`mcp_server/tests/test_mcpb_closure.py` `forbidden_prefixes`) gains `backend.mcp_config_install`.
- Writes are **atomic** (temp file in the same dir + `os.replace`) and **preserve every existing top-level key** in the target config. Never partially write a client config.
- **Never raise at the public boundary:** `install_mcp_*` / `uninstall_mcp_*` catch `(OSError, ValueError)` (incl. corrupt-JSON targets) and return a failed `InstallResult` — they never clobber a corrupt config and never raise.
- NOT wired through the corrupt-config writer gate (writes to *client* configs, never claude-explorer's `data_dir`/`config.json` — same exemption as `install-watcher`).
- **Server name:** `claude-sessions`. **Entry block:** `{"type": "stdio", "command": "uvx", "args": ["claude-explorer", "mcp"]}`. Single source of truth in the install module.
- `install all` uses **defaults only** (no `--python`/`--interval`/`--scope` passthrough).
- Idempotency check uses command-matching detection (`detect_mcp_in_file`), so an entry registered under ANY key (incl. by `claude mcp add`) counts as "already configured".

---

### Task 1: Single-file detection helper in `mcp_config_detect.py`

**Files:**
- Modify: `backend/mcp_config_detect.py`
- Test: `backend/tests/test_mcp_config_detect_in_file.py`

**Interfaces:**
- Consumes: existing `McpRegistration`, `_scan` (in `mcp_config_detect.py`).
- Produces: `detect_mcp_in_file(path: Path, scope: str) -> McpRegistration` — scans a single config file; returns the found registration or `McpRegistration(False, path, None, None)`. Never raises.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_mcp_config_detect_in_file.py
from __future__ import annotations

import json
from pathlib import Path

from backend.mcp_config_detect import detect_mcp_in_file


def _write(p: Path, servers: dict) -> Path:
    p.write_text(json.dumps({"mcpServers": servers}))
    return p


def test_found_in_file(tmp_path: Path) -> None:
    cfg = _write(tmp_path / "x.json", {
        "claude-sessions": {"command": "uvx", "args": ["claude-explorer", "mcp"]},
    })
    reg = detect_mcp_in_file(cfg, "user")
    assert reg.found is True
    assert reg.scope == "user"
    assert reg.server_name == "claude-sessions"


def test_not_found_returns_path_no_raise(tmp_path: Path) -> None:
    cfg = _write(tmp_path / "x.json", {"other": {"command": "uvx", "args": ["x"]}})
    reg = detect_mcp_in_file(cfg, "desktop")
    assert reg.found is False
    assert reg.config_path == cfg


def test_absent_file_no_raise(tmp_path: Path) -> None:
    reg = detect_mcp_in_file(tmp_path / "absent.json", "user")
    assert reg.found is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest backend/tests/test_mcp_config_detect_in_file.py -v`
Expected: FAIL — `ImportError: cannot import name 'detect_mcp_in_file'`.

- [ ] **Step 3: Write minimal implementation**

Add to `backend/mcp_config_detect.py` (after `detect_mcp_in_claude_desktop`):

```python
def detect_mcp_in_file(path: Path, scope: str) -> McpRegistration:
    """Scan a single config file for a registered `claude-explorer mcp`
    server. Returns the found registration, or a not-found
    McpRegistration carrying the looked-at path. Never raises."""
    hit = _scan(path, scope)
    if hit is not None:
        return hit
    return McpRegistration(False, path, None, None)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest backend/tests/test_mcp_config_detect_in_file.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/mcp_config_detect.py backend/tests/test_mcp_config_detect_in_file.py
git commit -m "feat(install): add single-file MCP detection helper"
```

---

### Task 2: Write-side file ops in `mcp_config_install.py`

**Files:**
- Create: `backend/mcp_config_install.py`
- Test: `backend/tests/test_mcp_config_install_fileops.py`

**Interfaces:**
- Consumes: stdlib only.
- Produces:
  - `SERVER_NAME = "claude-sessions"`
  - `mcp_block() -> dict` → `{"type": "stdio", "command": "uvx", "args": ["claude-explorer", "mcp"]}`
  - `@dataclass class InstallResult` → `target: str`, `ok: bool`, `changed: bool`, `detail: str`
  - `_load_config(path: Path) -> dict` — `{}` if absent; raises `ValueError` on corrupt/non-dict.
  - `_atomic_write_json(path: Path, data: dict) -> None`
  - `_merge_entry(path: Path, name: str, entry: dict) -> bool` — returns `changed`.
  - `_remove_entry(path: Path, name: str) -> bool` — returns `changed`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_mcp_config_install_fileops.py
from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend import mcp_config_install as mci


def _read(p: Path) -> dict:
    return json.loads(p.read_text())


def test_merge_creates_file_and_entry(tmp_path: Path) -> None:
    cfg = tmp_path / "sub" / "x.json"  # parent does not exist yet
    changed = mci._merge_entry(cfg, mci.SERVER_NAME, mci.mcp_block())
    assert changed is True
    data = _read(cfg)
    assert data["mcpServers"][mci.SERVER_NAME] == mci.mcp_block()


def test_merge_is_idempotent(tmp_path: Path) -> None:
    cfg = tmp_path / "x.json"
    mci._merge_entry(cfg, mci.SERVER_NAME, mci.mcp_block())
    changed = mci._merge_entry(cfg, mci.SERVER_NAME, mci.mcp_block())
    assert changed is False


def test_merge_preserves_other_keys_and_servers(tmp_path: Path) -> None:
    cfg = tmp_path / "x.json"
    cfg.write_text(json.dumps({
        "theme": "dark",
        "mcpServers": {"other": {"command": "uvx", "args": ["other"]}},
    }))
    mci._merge_entry(cfg, mci.SERVER_NAME, mci.mcp_block())
    data = _read(cfg)
    assert data["theme"] == "dark"
    assert "other" in data["mcpServers"]
    assert mci.SERVER_NAME in data["mcpServers"]


def test_remove_entry(tmp_path: Path) -> None:
    cfg = tmp_path / "x.json"
    cfg.write_text(json.dumps({"mcpServers": {
        mci.SERVER_NAME: mci.mcp_block(),
        "other": {"command": "uvx", "args": ["other"]},
    }}))
    changed = mci._remove_entry(cfg, mci.SERVER_NAME)
    assert changed is True
    data = _read(cfg)
    assert mci.SERVER_NAME not in data["mcpServers"]
    assert "other" in data["mcpServers"]


def test_remove_absent_is_noop(tmp_path: Path) -> None:
    cfg = tmp_path / "x.json"
    cfg.write_text(json.dumps({"mcpServers": {}}))
    assert mci._remove_entry(cfg, mci.SERVER_NAME) is False


def test_load_corrupt_raises(tmp_path: Path) -> None:
    cfg = tmp_path / "x.json"
    cfg.write_text("{ not json ")
    with pytest.raises(ValueError):
        mci._load_config(cfg)


def test_load_non_dict_raises(tmp_path: Path) -> None:
    cfg = tmp_path / "x.json"
    cfg.write_text("[1, 2, 3]")
    with pytest.raises(ValueError):
        mci._load_config(cfg)


def test_atomic_write_no_partial_on_failure(tmp_path: Path, monkeypatch) -> None:
    cfg = tmp_path / "x.json"
    cfg.write_text(json.dumps({"keep": True}))

    def boom(*a, **k):
        raise OSError("disk full")

    monkeypatch.setattr(mci.os, "replace", boom)
    with pytest.raises(OSError):
        mci._atomic_write_json(cfg, {"new": True})
    # original file untouched, no leftover temp in the dir
    assert _read(cfg) == {"keep": True}
    assert list(tmp_path.glob("*.tmp*")) == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest backend/tests/test_mcp_config_install_fileops.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.mcp_config_install'`.

- [ ] **Step 3: Write minimal implementation**

```python
# backend/mcp_config_install.py
"""Write side for registering the `claude-explorer mcp` server in MCP
client configs (Claude Code: ~/.claude.json / ./.mcp.json; Claude
Desktop: claude_desktop_config.json).

Pairs with backend.mcp_config_detect (read side). Stdlib-only and
CLI-only — must stay OUT of the MCPB import closure. Writes are atomic
(temp + os.replace) and preserve every other top-level key; the public
install_*/uninstall_* functions never raise (a corrupt/unwritable
target yields a failed InstallResult, never a clobbered file).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from .mcp_config_detect import claude_desktop_config_path, detect_mcp_in_file


SERVER_NAME = "claude-sessions"


def mcp_block() -> dict:
    """The mcpServers entry value we write. Single source of truth."""
    return {"type": "stdio", "command": "uvx", "args": ["claude-explorer", "mcp"]}


@dataclass
class InstallResult:
    target: str       # "code" | "desktop" | "watcher"
    ok: bool
    changed: bool
    detail: str


def _load_config(path: Path) -> dict:
    """Return the parsed config dict, or {} if the file is absent.

    Raises ValueError on corrupt JSON or a non-dict root — callers must
    NOT clobber a config they cannot parse.
    """
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise ValueError(f"{path}: invalid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError(f"{path}: top-level JSON is not an object")
    return data


def _atomic_write_json(path: Path, data: dict) -> None:
    """Write data to path atomically (temp in same dir + os.replace).

    Creates parent dirs as needed. Sets 0o600 on the temp file before
    replace so a newly-created config isn't world-readable. Cleans up
    the temp file if the replace fails.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    try:
        tmp.write_text(json.dumps(data, indent=2))
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    except OSError:
        if tmp.exists():
            tmp.unlink()
        raise


def _merge_entry(path: Path, name: str, entry: dict) -> bool:
    """Ensure mcpServers[name] == entry in the config at path.

    Returns True if the file was changed, False if it already matched.
    Preserves all other top-level keys and other mcpServers entries.
    """
    data = _load_config(path)
    servers = data.get("mcpServers")
    if not isinstance(servers, dict):
        servers = {}
    if servers.get(name) == entry:
        return False
    servers[name] = entry
    data["mcpServers"] = servers
    _atomic_write_json(path, data)
    return True


def _remove_entry(path: Path, name: str) -> bool:
    """Remove mcpServers[name] from the config at path.

    Returns True if an entry was removed, False if it wasn't present.
    """
    data = _load_config(path)
    servers = data.get("mcpServers")
    if not isinstance(servers, dict) or name not in servers:
        return False
    del servers[name]
    data["mcpServers"] = servers
    _atomic_write_json(path, data)
    return True
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest backend/tests/test_mcp_config_install_fileops.py -v`
Expected: PASS (8 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/mcp_config_install.py backend/tests/test_mcp_config_install_fileops.py
git commit -m "feat(install): add atomic mcpServers merge/remove write ops"
```

---

### Task 3: High-level install/uninstall functions

**Files:**
- Modify: `backend/mcp_config_install.py`
- Test: `backend/tests/test_mcp_config_install_actions.py`

**Interfaces:**
- Consumes: Task 2 symbols; `detect_mcp_in_file` (Task 1); `claude_desktop_config_path`.
- Produces:
  - `_code_config_path(scope: str) -> Path` — `user` → `~/.claude.json`, `project` → `./.mcp.json`.
  - `_claude_available() -> bool` — `shutil.which("claude") is not None`.
  - `_run_claude(args: list[str]) -> tuple[int, str]` — runs `claude <args>`, returns `(returncode, combined_output)`.
  - `install_mcp_code(scope: str = "user", *, config_path: Path | None = None) -> InstallResult`
  - `install_mcp_desktop(*, config_path: Path | None = None) -> InstallResult`
  - `uninstall_mcp_code(scope: str = "user", *, config_path: Path | None = None) -> InstallResult`
  - `uninstall_mcp_desktop(*, config_path: Path | None = None) -> InstallResult`

Notes for the implementer:
- Idempotency: call `detect_mcp_in_file(path, scope)` first; if `found`, return `changed=False, ok=True`.
- Code install prefers the `claude` CLI: if `_claude_available()`, call `_run_claude(["mcp", "add", "--scope", scope, SERVER_NAME, "--", "uvx", "claude-explorer", "mcp"])`; non-zero return → failed result. Else direct `_merge_entry`.
- **Uninstall always direct-edits** the resolved file (`_remove_entry`) — robust whether install used the CLI or a direct write (both target the same file), and avoids depending on `claude mcp remove` syntax.
- All four public functions wrap their body in `try/except (OSError, ValueError)` → `InstallResult(ok=False, ...)`. Never raise.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_mcp_config_install_actions.py
from __future__ import annotations

import json
from pathlib import Path

from backend import mcp_config_install as mci


def test_install_code_direct_write_when_no_claude(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(mci, "_claude_available", lambda: False)
    cfg = tmp_path / ".claude.json"
    r = mci.install_mcp_code("user", config_path=cfg)
    assert r.ok and r.changed and r.target == "code"
    assert json.loads(cfg.read_text())["mcpServers"][mci.SERVER_NAME] == mci.mcp_block()


def test_install_code_idempotent(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(mci, "_claude_available", lambda: False)
    cfg = tmp_path / ".claude.json"
    mci.install_mcp_code("user", config_path=cfg)
    r = mci.install_mcp_code("user", config_path=cfg)
    assert r.ok and r.changed is False
    assert "already configured" in r.detail.lower()


def test_install_code_uses_claude_cli_when_present(tmp_path, monkeypatch) -> None:
    calls = []
    monkeypatch.setattr(mci, "_claude_available", lambda: True)
    monkeypatch.setattr(mci, "_run_claude", lambda args: (calls.append(args) or (0, "added")))
    cfg = tmp_path / ".claude.json"  # absent → detect not-found → CLI path taken
    r = mci.install_mcp_code("user", config_path=cfg)
    assert r.ok and r.changed
    assert calls == [["mcp", "add", "--scope", "user", mci.SERVER_NAME, "--",
                      "uvx", "claude-explorer", "mcp"]]


def test_install_code_claude_cli_failure_is_failed_result(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(mci, "_claude_available", lambda: True)
    monkeypatch.setattr(mci, "_run_claude", lambda args: (1, "boom"))
    r = mci.install_mcp_code("user", config_path=tmp_path / ".claude.json")
    assert r.ok is False and "boom" in r.detail


def test_install_desktop_writes_and_mentions_restart(tmp_path) -> None:
    cfg = tmp_path / "claude_desktop_config.json"
    r = mci.install_mcp_desktop(config_path=cfg)
    assert r.ok and r.changed and r.target == "desktop"
    assert "restart" in r.detail.lower()


def test_install_corrupt_target_is_failed_not_raised(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(mci, "_claude_available", lambda: False)
    cfg = tmp_path / ".claude.json"
    cfg.write_text("{ not json ")
    r = mci.install_mcp_code("user", config_path=cfg)
    assert r.ok is False
    assert cfg.read_text() == "{ not json "  # untouched, not clobbered


def test_uninstall_code_direct_edit(tmp_path) -> None:
    cfg = tmp_path / ".claude.json"
    cfg.write_text(json.dumps({"mcpServers": {mci.SERVER_NAME: mci.mcp_block()}}))
    r = mci.uninstall_mcp_code("user", config_path=cfg)
    assert r.ok and r.changed
    assert mci.SERVER_NAME not in json.loads(cfg.read_text())["mcpServers"]


def test_uninstall_absent_is_ok_noop(tmp_path) -> None:
    cfg = tmp_path / "claude_desktop_config.json"
    cfg.write_text(json.dumps({"mcpServers": {}}))
    r = mci.uninstall_mcp_desktop(config_path=cfg)
    assert r.ok and r.changed is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest backend/tests/test_mcp_config_install_actions.py -v`
Expected: FAIL — `AttributeError: module 'backend.mcp_config_install' has no attribute 'install_mcp_code'`.

- [ ] **Step 3: Write minimal implementation**

Append to `backend/mcp_config_install.py`:

```python
def _code_config_path(scope: str) -> Path:
    if scope == "project":
        return Path.cwd() / ".mcp.json"
    return Path.home() / ".claude.json"


def _claude_available() -> bool:
    return shutil.which("claude") is not None


def _run_claude(args: list[str]) -> tuple[int, str]:
    """Run `claude <args>`; return (returncode, combined stdout+stderr)."""
    proc = subprocess.run(
        ["claude", *args], capture_output=True, text=True, check=False
    )
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def install_mcp_code(scope: str = "user", *, config_path: Path | None = None) -> InstallResult:
    path = config_path or _code_config_path(scope)
    try:
        reg = detect_mcp_in_file(path, scope)
        if reg.found:
            return InstallResult("code", True, False,
                                 f"already configured ({reg.server_name})")
        if _claude_available():
            rc, out = _run_claude(["mcp", "add", "--scope", scope, SERVER_NAME,
                                   "--", "uvx", "claude-explorer", "mcp"])
            if rc == 0:
                return InstallResult("code", True, True,
                                     f"registered via claude CLI ({scope} scope)")
            return InstallResult("code", False, False,
                                 f"claude mcp add failed: {out.strip()}")
        changed = _merge_entry(path, SERVER_NAME, mcp_block())
        return InstallResult("code", True, changed, f"wrote {path}")
    except (OSError, ValueError) as exc:
        return InstallResult("code", False, False, f"failed: {exc}")


def install_mcp_desktop(*, config_path: Path | None = None) -> InstallResult:
    path = config_path or claude_desktop_config_path()
    try:
        reg = detect_mcp_in_file(path, "desktop")
        if reg.found:
            return InstallResult("desktop", True, False,
                                 f"already configured ({reg.server_name})")
        changed = _merge_entry(path, SERVER_NAME, mcp_block())
        return InstallResult("desktop", True, changed,
                             f"wrote {path}; restart Claude Desktop to load it")
    except (OSError, ValueError) as exc:
        return InstallResult("desktop", False, False, f"failed: {exc}")


def uninstall_mcp_code(scope: str = "user", *, config_path: Path | None = None) -> InstallResult:
    path = config_path or _code_config_path(scope)
    try:
        changed = _remove_entry(path, SERVER_NAME)
        return InstallResult("code", True, changed,
                             "removed" if changed else "not present")
    except (OSError, ValueError) as exc:
        return InstallResult("code", False, False, f"failed: {exc}")


def uninstall_mcp_desktop(*, config_path: Path | None = None) -> InstallResult:
    path = config_path or claude_desktop_config_path()
    try:
        changed = _remove_entry(path, SERVER_NAME)
        return InstallResult("desktop", True, changed,
                             "removed; restart Claude Desktop" if changed else "not present")
    except (OSError, ValueError) as exc:
        return InstallResult("desktop", False, False, f"failed: {exc}")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest backend/tests/test_mcp_config_install_actions.py -v`
Expected: PASS (8 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/mcp_config_install.py backend/tests/test_mcp_config_install_actions.py
git commit -m "feat(install): add MCP code/desktop install + uninstall actions"
```

---

### Task 4: `install` group + `watcher` subcommand + deprecated alias

**Files:**
- Modify: `cli/main.py`
- Test: `backend/tests/test_cli_install_watcher.py`

**Interfaces:**
- Consumes: existing re-exported `cli.main._install_macos/_install_linux/_install_windows` + `_uninstall_*` (from `cli.watcher`); `backend.mcp_config_install.InstallResult`.
- Produces:
  - `_do_watcher(python_bin: str | None, interval: float, uninstall: bool) -> InstallResult` — runs the existing per-OS dispatch, catching exceptions; `target="watcher"`.
  - Click group `install`; subcommand `install watcher` (options `--python`/`--interval`/`--uninstall`); hidden deprecated top-level `install-watcher` alias.

Implementer notes:
- `_do_watcher` contains the platform dispatch currently inside `install_watcher` (`darwin`→`_install_macos`, `linux`→`_install_linux`, `win32`→`_install_windows`, and the `_uninstall_*` mirror), wrapped in `try/except Exception` → `InstallResult("watcher", ok=False, ...)`. On success return `InstallResult("watcher", True, True, "...")`.
- The existing `@main.command("install-watcher")` becomes the hidden deprecated alias: keep the name, add `hidden=True`, print a one-line deprecation notice to stderr, then call `_do_watcher` and exit on its `ok`.
- Add `@main.group("install")` and `@install.command("watcher")` that calls `_do_watcher`.
- Keep the rich docstring/help on the new `install watcher` (move the existing prose there); the alias's help can be short.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_cli_install_watcher.py
from __future__ import annotations

from click.testing import CliRunner

import cli.main as cm
from cli.main import main


def _stub_os_helpers(monkeypatch) -> list:
    """Replace all six OS watcher helpers with recorders so no real
    launchd/systemd/schtasks call happens. Returns the call log."""
    calls = []
    for fn in ("_install_macos", "_install_linux", "_install_windows"):
        monkeypatch.setattr(cm, fn, lambda *a, _n=fn, **k: calls.append(_n))
    for fn in ("_uninstall_macos", "_uninstall_linux", "_uninstall_windows"):
        monkeypatch.setattr(cm, fn, lambda *a, _n=fn, **k: calls.append(_n))
    return calls


def test_install_group_lists_watcher(monkeypatch) -> None:
    res = CliRunner().invoke(main, ["install", "--help"])
    assert res.exit_code == 0
    assert "watcher" in res.output


def test_install_watcher_subcommand_runs_one_os_helper(monkeypatch) -> None:
    calls = _stub_os_helpers(monkeypatch)
    res = CliRunner().invoke(main, ["install", "watcher"])
    assert res.exit_code == 0
    # exactly one platform install helper fired
    assert len([c for c in calls if c.startswith("_install_")]) == 1


def test_install_watcher_uninstall_runs_one_os_helper(monkeypatch) -> None:
    calls = _stub_os_helpers(monkeypatch)
    res = CliRunner().invoke(main, ["install", "watcher", "--uninstall"])
    assert res.exit_code == 0
    assert len([c for c in calls if c.startswith("_uninstall_")]) == 1


def test_deprecated_alias_delegates_and_warns(monkeypatch) -> None:
    calls = _stub_os_helpers(monkeypatch)
    res = CliRunner().invoke(main, ["install-watcher"])
    assert res.exit_code == 0
    assert "deprecated" in res.output.lower()
    assert len([c for c in calls if c.startswith("_install_")]) == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest backend/tests/test_cli_install_watcher.py -v`
Expected: FAIL — `install` group not defined / `No such command 'install'`.

- [ ] **Step 3: Write minimal implementation**

In `cli/main.py`, replace the existing `@main.command("install-watcher")` definition with the following (keep the `cli.watcher` import block above it unchanged). The platform-dispatch body moves into `_do_watcher`:

```python
def _do_watcher(python_bin: str | None, interval: float, uninstall: bool) -> "InstallResult":
    """Run the per-OS watcher install/uninstall dispatch, returning an
    InstallResult instead of raising (so `install all` can aggregate)."""
    from backend.mcp_config_install import InstallResult
    import sys as _sys

    try:
        if uninstall:
            if _sys.platform == "darwin":
                _uninstall_macos()
            elif _sys.platform.startswith("linux"):
                _uninstall_linux()
            elif _sys.platform == "win32":
                _uninstall_windows()
            else:
                raise click.ClickException(f"unsupported platform {_sys.platform!r}")
            return InstallResult("watcher", True, True, "watcher uninstalled")

        bin_ = python_bin or _sys.executable
        if _sys.platform == "darwin":
            _install_macos(bin_, interval)
        elif _sys.platform.startswith("linux"):
            _install_linux(bin_, interval)
        elif _sys.platform == "win32":
            _install_windows(bin_, interval)
        else:
            raise click.ClickException(
                f"unsupported platform {_sys.platform!r}. Supported: darwin, linux, win32."
            )
        return InstallResult("watcher", True, True, "watcher installed")
    except Exception as exc:  # noqa: BLE001 - aggregate, never crash the group
        return InstallResult("watcher", False, False, f"watcher failed: {exc}")


@main.group("install")
def install() -> None:
    """Install integrations: the CC watcher and MCP client registration."""


@install.command("watcher")
@click.option("--python", "python_bin",
              type=click.Path(exists=True, dir_okay=False), default=None,
              help="Python interpreter to use (default: this venv's python).")
@click.option("--interval", type=float, default=600.0,
              help="Backstop poll interval in seconds (default: 600).")
@click.option("--uninstall", is_flag=True,
              help="Remove the watcher unit instead of installing.")
def install_watcher_cmd(python_bin: str | None, interval: float, uninstall: bool) -> None:
    """Install (or uninstall) the supervised CC image-cache watcher
    (launchd / systemd / Task Scheduler)."""
    import sys as _sys
    r = _do_watcher(python_bin, interval, uninstall)
    click.echo(r.detail)
    _sys.exit(0 if r.ok else 1)


@main.command("install-watcher", hidden=True)
@click.option("--python", "python_bin",
              type=click.Path(exists=True, dir_okay=False), default=None)
@click.option("--interval", type=float, default=600.0)
@click.option("--uninstall", is_flag=True)
def install_watcher(python_bin: str | None, interval: float, uninstall: bool) -> None:
    """Deprecated alias for `claude-explorer install watcher`."""
    import sys as _sys
    click.echo(
        "Note: `install-watcher` is deprecated; use `claude-explorer install watcher`.",
        err=True,
    )
    r = _do_watcher(python_bin, interval, uninstall)
    click.echo(r.detail)
    _sys.exit(0 if r.ok else 1)
```

(Delete the old `install_watcher` function body that previously held the inline dispatch — its logic now lives in `_do_watcher`. Keep the `from cli.watcher import (...)` re-export block.)

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest backend/tests/test_cli_install_watcher.py -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add cli/main.py backend/tests/test_cli_install_watcher.py
git commit -m "feat(install): add install group + watcher subcommand + deprecated alias"
```

---

### Task 5: `install mcp` subcommand

**Files:**
- Modify: `cli/main.py`
- Test: `backend/tests/test_cli_install_mcp.py`

**Interfaces:**
- Consumes: `install` group (Task 4); `backend.mcp_config_install.{install_mcp_code,install_mcp_desktop,uninstall_mcp_code,uninstall_mcp_desktop,InstallResult}`.
- Produces:
  - `_summarize_install(results: list[InstallResult]) -> int` — prints a `✓`/`✗ <target>: <detail>` line per result, returns exit code (1 if any `not ok`, else 0).
  - `install mcp --client {all|code|desktop} --scope {user|project} --uninstall`.

Implementer notes:
- Lazy-import the install functions inside the command body, so tests monkeypatch `backend.mcp_config_install.<fn>`.
- `--client all` runs code (with `--scope`) + desktop; collect both results.
- `--uninstall` routes to the `uninstall_*` functions.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_cli_install_mcp.py
from __future__ import annotations

from click.testing import CliRunner

import backend.mcp_config_install as mci
from cli.main import main


def _ok(target):
    return mci.InstallResult(target, True, True, f"{target} done")


def test_mcp_code_only(monkeypatch) -> None:
    seen = []
    monkeypatch.setattr(mci, "install_mcp_code",
                        lambda scope="user", **k: seen.append(("code", scope)) or _ok("code"))
    monkeypatch.setattr(mci, "install_mcp_desktop", lambda **k: _ok("desktop"))
    res = CliRunner().invoke(main, ["install", "mcp", "--client", "code"])
    assert res.exit_code == 0
    assert seen == [("code", "user")]          # desktop NOT called
    assert "code done" in res.output


def test_mcp_all_runs_both(monkeypatch) -> None:
    seen = []
    monkeypatch.setattr(mci, "install_mcp_code", lambda scope="user", **k: seen.append("code") or _ok("code"))
    monkeypatch.setattr(mci, "install_mcp_desktop", lambda **k: seen.append("desktop") or _ok("desktop"))
    res = CliRunner().invoke(main, ["install", "mcp", "--client", "all"])
    assert res.exit_code == 0
    assert seen == ["code", "desktop"]


def test_mcp_scope_project_passed_through(monkeypatch) -> None:
    seen = []
    monkeypatch.setattr(mci, "install_mcp_code", lambda scope="user", **k: seen.append(scope) or _ok("code"))
    monkeypatch.setattr(mci, "install_mcp_desktop", lambda **k: _ok("desktop"))
    CliRunner().invoke(main, ["install", "mcp", "--client", "code", "--scope", "project"])
    assert seen == ["project"]


def test_mcp_partial_failure_exit_one(monkeypatch) -> None:
    monkeypatch.setattr(mci, "install_mcp_code", lambda scope="user", **k: _ok("code"))
    monkeypatch.setattr(mci, "install_mcp_desktop",
                        lambda **k: mci.InstallResult("desktop", False, False, "nope"))
    res = CliRunner().invoke(main, ["install", "mcp", "--client", "all"])
    assert res.exit_code == 1
    assert "nope" in res.output


def test_mcp_uninstall_routes_to_uninstall_fns(monkeypatch) -> None:
    seen = []
    monkeypatch.setattr(mci, "uninstall_mcp_code", lambda scope="user", **k: seen.append("u-code") or _ok("code"))
    monkeypatch.setattr(mci, "uninstall_mcp_desktop", lambda **k: seen.append("u-desktop") or _ok("desktop"))
    res = CliRunner().invoke(main, ["install", "mcp", "--client", "all", "--uninstall"])
    assert res.exit_code == 0
    assert seen == ["u-code", "u-desktop"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest backend/tests/test_cli_install_mcp.py -v`
Expected: FAIL — `No such command 'mcp'` under `install`.

- [ ] **Step 3: Write minimal implementation**

Add to `cli/main.py` (after the `install` group + watcher subcommand):

```python
def _summarize_install(results: list) -> int:
    """Print an [ok]/[FAIL] line per InstallResult; return exit code (1 if any failed).

    ASCII markers (not unicode check/cross) to avoid Windows cp1252 console
    encoding errors — same convention as the `doctor` command.
    """
    failed = 0
    for r in results:
        mark = "[ok]" if r.ok else "[FAIL]"
        click.echo(f"  {mark} {r.target}: {r.detail}")
        if not r.ok:
            failed += 1
    return 1 if failed else 0


@install.command("mcp")
@click.option("--client", type=click.Choice(["all", "code", "desktop"]),
              default="all", help="Which client(s) to register with (default: all).")
@click.option("--scope", type=click.Choice(["user", "project"]),
              default="user", help="Claude Code scope (code client only; default: user).")
@click.option("--uninstall", is_flag=True,
              help="Remove the registration instead of installing.")
def install_mcp(client: str, scope: str, uninstall: bool) -> None:
    """Register (or remove) the `claude-explorer mcp` server with Claude
    Code and/or Claude Desktop."""
    import sys as _sys
    from backend.mcp_config_install import (
        install_mcp_code, install_mcp_desktop,
        uninstall_mcp_code, uninstall_mcp_desktop,
    )

    results = []
    if client in ("all", "code"):
        results.append(
            uninstall_mcp_code(scope) if uninstall else install_mcp_code(scope)
        )
    if client in ("all", "desktop"):
        results.append(
            uninstall_mcp_desktop() if uninstall else install_mcp_desktop()
        )
    _sys.exit(_summarize_install(results))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest backend/tests/test_cli_install_mcp.py -v`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add cli/main.py backend/tests/test_cli_install_mcp.py
git commit -m "feat(install): add install mcp subcommand (code/desktop/all)"
```

---

### Task 6: `install all` subcommand

**Files:**
- Modify: `cli/main.py`
- Test: `backend/tests/test_cli_install_all.py`

**Interfaces:**
- Consumes: `_do_watcher` (Task 4), `_summarize_install` (Task 5), the mcp install/uninstall functions (Task 3).
- Produces: `install all [--uninstall]`.

Implementer notes:
- Install path: `_do_watcher(None, 600.0, False)` + `install_mcp_code("user")` + `install_mcp_desktop()`.
- Uninstall path: `_do_watcher(None, 600.0, True)` + `uninstall_mcp_code("user")` + `uninstall_mcp_desktop()`.
- Aggregate ALL results (continue on failure) and exit via `_summarize_install`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_cli_install_all.py
from __future__ import annotations

from click.testing import CliRunner

import backend.mcp_config_install as mci
import cli.main as cm
from cli.main import main


def _ok(target):
    return mci.InstallResult(target, True, True, f"{target} done")


def test_install_all_runs_watcher_and_mcp(monkeypatch) -> None:
    seen = []
    monkeypatch.setattr(cm, "_do_watcher", lambda *a, **k: seen.append("watcher") or _ok("watcher"))
    monkeypatch.setattr(mci, "install_mcp_code", lambda scope="user", **k: seen.append("code") or _ok("code"))
    monkeypatch.setattr(mci, "install_mcp_desktop", lambda **k: seen.append("desktop") or _ok("desktop"))
    res = CliRunner().invoke(main, ["install", "all"])
    assert res.exit_code == 0
    assert seen == ["watcher", "code", "desktop"]


def test_install_all_continues_and_exits_one_on_failure(monkeypatch) -> None:
    monkeypatch.setattr(cm, "_do_watcher", lambda *a, **k: mci.InstallResult("watcher", False, False, "wfail"))
    monkeypatch.setattr(mci, "install_mcp_code", lambda scope="user", **k: _ok("code"))
    monkeypatch.setattr(mci, "install_mcp_desktop", lambda **k: _ok("desktop"))
    res = CliRunner().invoke(main, ["install", "all"])
    assert res.exit_code == 1
    assert "wfail" in res.output
    assert "code done" in res.output      # later targets still ran


def test_install_all_uninstall(monkeypatch) -> None:
    seen = []
    monkeypatch.setattr(cm, "_do_watcher", lambda pb, iv, un, **k: seen.append(("watcher", un)) or _ok("watcher"))
    monkeypatch.setattr(mci, "uninstall_mcp_code", lambda scope="user", **k: seen.append("u-code") or _ok("code"))
    monkeypatch.setattr(mci, "uninstall_mcp_desktop", lambda **k: seen.append("u-desktop") or _ok("desktop"))
    res = CliRunner().invoke(main, ["install", "all", "--uninstall"])
    assert res.exit_code == 0
    assert seen == [("watcher", True), "u-code", "u-desktop"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest backend/tests/test_cli_install_all.py -v`
Expected: FAIL — `No such command 'all'` under `install`.

- [ ] **Step 3: Write minimal implementation**

Add to `cli/main.py` (after `install_mcp`):

```python
@install.command("all")
@click.option("--uninstall", is_flag=True,
              help="Remove everything instead of installing.")
def install_all(uninstall: bool) -> None:
    """Install (or uninstall) everything: the CC watcher + MCP
    registration for Claude Code and Claude Desktop (defaults only)."""
    import sys as _sys
    from backend.mcp_config_install import (
        install_mcp_code, install_mcp_desktop,
        uninstall_mcp_code, uninstall_mcp_desktop,
    )

    results = [_do_watcher(None, 600.0, uninstall)]
    if uninstall:
        results.append(uninstall_mcp_code("user"))
        results.append(uninstall_mcp_desktop())
    else:
        results.append(install_mcp_code("user"))
        results.append(install_mcp_desktop())
    _sys.exit(_summarize_install(results))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest backend/tests/test_cli_install_all.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add cli/main.py backend/tests/test_cli_install_all.py
git commit -m "feat(install): add install all subcommand"
```

---

### Task 7: Closure canary + docs

**Files:**
- Modify: `mcp_server/tests/test_mcpb_closure.py`
- Modify: `README.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: the existing `closure` fixture / `forbidden_prefixes` tuple.
- Produces: the canary forbids `backend.mcp_config_install`; docs describe the install group.

- [ ] **Step 1: Extend the canary (must still PASS)**

In `mcp_server/tests/test_mcpb_closure.py`, add to the `forbidden_prefixes` tuple in `test_forbidden_internal_modules_absent` (which already lists `backend.doctor`, `backend.mcp_config_detect`):

```python
        "backend.mcp_config_install",  # CLI-only: install/uninstall writer
```

Run: `uv run pytest mcp_server/tests/test_mcpb_closure.py -v`
Expected: PASS — `mcp_server.server` never imports the install writer, so it's correctly absent.
If it FAILS: an unexpected import edge exists; find it and move it lazy / remove it. Do NOT loosen the test.

- [ ] **Step 2: Update docs**

In `README.md`, near the existing `install-watcher` / Command Reference area, add an `install` section:

````markdown
#### `claude-explorer install`

Set up integrations. Subcommands:

```bash
claude-explorer install all                 # watcher + MCP (Code & Desktop)
claude-explorer install watcher             # supervised CC image-cache watcher
claude-explorer install mcp --client all    # register `claude-explorer mcp`
```

`install mcp` registers the MCP server (`claude-sessions`) with Claude Code
and/or Claude Desktop. `--client {all|code|desktop}` (default `all`),
`--scope {user|project}` (Claude Code only, default `user`). For Claude Code it
uses the `claude mcp add` CLI when available, otherwise writes `~/.claude.json`
directly; for Claude Desktop it merges into `claude_desktop_config.json` (restart
Desktop afterward). Re-runs are idempotent. Add `--uninstall` to any subcommand
to remove. `install-watcher` still works as a deprecated alias for
`install watcher`.

> Note: `.mcpb` bundle installs (Desktop Extensions UI) are managed by Claude
> Desktop's own store and are not written or detected by this command.
````

In `CLAUDE.md`'s CLI Usage list, add a one-line entry in the same style:

```markdown
# Install integrations (watcher + MCP registration for Code/Desktop)
claude-explorer install all
```

- [ ] **Step 3: Verify nothing regressed**

Run: `uv run pytest backend/tests/test_mcp_config_detect_in_file.py backend/tests/test_mcp_config_install_fileops.py backend/tests/test_mcp_config_install_actions.py backend/tests/test_cli_install_watcher.py backend/tests/test_cli_install_mcp.py backend/tests/test_cli_install_all.py mcp_server/tests/test_mcpb_closure.py -q`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add mcp_server/tests/test_mcpb_closure.py README.md CLAUDE.md
git commit -m "test(install): guard MCP closure; docs for install group"
```

---

## Final verification (after all tasks)

- [ ] Full backend suite, bare, read the count: `uv run pytest backend -q` — no `SyntaxError`/`collected 0`; pass count rose by the new tests; the only failure is the pre-existing unrelated `test_lifespan_filecache_warm` (confirm it's that one, not a new one).
- [ ] Real smoke test on this machine:
  - `uv run claude-explorer install --help` lists `all`, `watcher`, `mcp`.
  - `uv run claude-explorer install mcp --client code` then `uv run claude-explorer doctor` shows `MCP -> Claude Code` as registered (OK). Then `uv run claude-explorer install mcp --client code --uninstall` to restore.
  - `uv run claude-explorer install-watcher --help` works and the command prints the deprecation note when run.

## Self-Review notes (spec coverage)

- install group + all/watcher/mcp → Tasks 4/5/6. ✓
- deprecated `install-watcher` alias → Task 4. ✓
- write side (atomic, preserve keys, never-raise) → Tasks 2/3. ✓
- prefer `claude mcp add`, fall back to direct write → Task 3 `install_mcp_code`. ✓
- idempotency via detection → Task 1 `detect_mcp_in_file` + Task 3. ✓
- uninstall (direct edit) → Task 3. ✓
- `--client all` resilient aggregation + exit code → Task 5 `_summarize_install`. ✓
- `install all` defaults-only aggregation → Task 6. ✓
- stdlib-only + out of MCPB closure → Task 2 module + Task 7 canary. ✓
- server name `claude-sessions`, block shape → Task 2 constants. ✓
- docs → Task 7. ✓
