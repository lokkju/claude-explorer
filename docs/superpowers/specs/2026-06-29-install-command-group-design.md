# `claude-explorer install` command group — Design

**Date:** 2026-06-29
**Status:** Approved (design phase)
**Branch:** `lokkju/install-mcp` (off local `main`, stacks on the doctor work — reuses `backend/mcp_config_detect.py`)

## Context

Today there is a single flat install command, `install-watcher` (`cli/main.py`),
which sets up an OS-supervised background job (launchd / systemd / Task
Scheduler) for the CC image-cache watcher. It is already shipped publicly
(v1.0.x) and referenced in README/CLAUDE.md.

We now want first-class install support for registering the project's MCP
server (`claude-explorer mcp`) with **Claude Code** and **Claude Desktop**,
alongside the existing watcher install. This is the natural follow-on to the
`doctor` command (which only *detects* MCP registration): `install mcp` is the
write side of the same problem, and reuses the `backend/mcp_config_detect.py`
reader built for `doctor`.

## Decisions (locked during brainstorming)

1. **Structure:** an `install` Click **group** with subcommands, NOT a flat pile
   of `install-*` commands. Better discovery (`install --help`), clean
   namespace, room to grow (`install completion` later).
2. **Backward compatibility:** keep `install-watcher` as a **hidden, deprecated**
   top-level alias that delegates to `install watcher` and prints a one-line
   deprecation notice to stderr. Existing launchd/systemd/Task Scheduler installs,
   docs, and muscle memory keep working. No breaking change.
3. **Code registration method:** prefer `claude mcp add` when the `claude` CLI is
   on PATH (authoritative — handles their schema/scopes); otherwise write the
   config file directly (idempotent via `mcp_config_detect`).
4. **`install all`:** a one-shot that runs watcher + mcp (all clients) with each
   target's defaults; resilient aggregation (continue on failure, summary, exit
   non-zero if any failed).

## Scope

### In scope

- New `install` group with subcommands:
  - `install all [--uninstall]`
  - `install watcher [--uninstall] [--python-bin PATH] [--interval FLOAT]` (existing logic, moved under the group)
  - `install mcp --client {all|code|desktop} [--scope user|project] [--uninstall]`
- Hidden deprecated `install-watcher` alias → `install watcher`.
- New `backend/mcp_config_install.py` (write side: merge/remove an `mcpServers`
  entry, atomic write, preserve other keys), reusing `mcp_config_detect`.
- Extend the MCPB closure canary to forbid `backend.mcp_config_install`.
- README/CLAUDE.md docs.

### Out of scope (deferred)

- `install completion <shell>` — structure leaves room; not built now.
- `--python-bin`/`--interval`/`--scope` passthrough on `install all` (YAGNI; use
  the subcommand directly to customize).
- `.mcpb` bundle automation — GUI-only, undetectable from disk (established in
  the doctor design).
- `doctor --fix` delegating to these install functions — separate effort.

## CLI surface

```
claude-explorer install all      [--uninstall]
claude-explorer install watcher  [--uninstall] [--python-bin PATH] [--interval FLOAT]
claude-explorer install mcp      --client {all|code|desktop} [--scope user|project] [--uninstall]
claude-explorer install completion <shell>     # FUTURE — not built now
claude-explorer install-watcher                # hidden, deprecated -> install watcher
```

## Behavior

### `install watcher`
Identical to today's `install-watcher` (per-OS dispatch to launchd/systemd/Task
Scheduler, `--uninstall`, `--python-bin`, `--interval`). The implementation
functions stay where they are; only the Click command entry point moves under the
group. The deprecated `install-watcher` alias calls the same underlying logic.

### `install mcp`
- `--client` selects targets: `code`, `desktop`, or `all` (default `all`).
- `--scope user|project` (default `user`) applies to the **code** target only:
  - `user` → `~/.claude.json` (or `claude mcp add --scope user`)
  - `project` → `./.mcp.json` (or `claude mcp add --scope project`)
- **Code install:**
  - If `shutil.which("claude")`: run `claude mcp add --scope <scope> claude-sessions -- uvx claude-explorer mcp` via subprocess.
  - Else: merge the `mcpServers` block directly into the scope's config file (atomic, preserve keys).
- **Desktop install:** merge the block into `claude_desktop_config.json`
  (`mcp_config_detect.claude_desktop_config_path()`), atomic, preserve keys, then
  print "restart Claude Desktop." No `claude` CLI involved for desktop.
- **Idempotent:** before writing, call `mcp_config_detect` for the target; if
  already registered, report "already configured" and make NO change.
- **Server name:** `claude-sessions` (the `mcpServers` key — matches every
  existing README example + the verification prompt). It is an arbitrary local
  alias; detection matches on the command/args, not this key. **Future (maybe):**
  rename to `claude-explorer` for brand consistency — deferred; would require
  updating the README's `claude-sessions` references and the `doctor` fix-hint in
  lockstep. **Command form:** `uvx claude-explorer mcp`.
- **`--uninstall`:** remove the matching `claude-sessions` entry. Code: `claude mcp
  remove claude-sessions` when `claude` present, else direct edit. Desktop: direct
  edit + restart reminder. Removing an absent entry is a no-op success.
- **Resilience for `--client all`:** attempt both code and desktop; one failing
  does not abort the other; print a per-client ✓/✗ summary; exit non-zero if any
  failed.

### `install all`
- Install: `watcher` (defaults) + `mcp --client all --scope user`.
- Uninstall (`--uninstall`): tear down both.
- Resilient aggregation across all targets (continue on failure, per-target ✓/✗
  summary, exit non-zero if any target failed).
- Uses defaults only — no option passthrough.

## Architecture

```
cli/main.py
  - new `@main.group("install")` def install()
  - `install all`, `install watcher`, `install mcp` subcommands
  - watcher subcommand reuses existing _install_macos/_install_linux/_install_windows
    + _uninstall_* helpers (already in cli/main.py); no logic change
  - hidden `@main.command("install-watcher")` alias -> calls install watcher's
    underlying function with a deprecation notice
  - mcp subcommand delegates to backend.mcp_config_install (lazy import in body)

backend/mcp_config_install.py   (NEW — write side, stdlib-only, CLI-only)
  - server-name + command-form constants (single source of truth)
  - mcp_block() -> dict           # the {command, args} entry value
  - install_mcp_code(scope, *, claude_cli: bool) -> InstallResult
  - install_mcp_desktop() -> InstallResult
  - uninstall_mcp_code(scope, *, claude_cli: bool) -> InstallResult
  - uninstall_mcp_desktop() -> InstallResult
  - _merge_entry(config_path, name, entry) / _remove_entry(config_path, name)
    # atomic write (tmp + os.replace), 0o600 where the file is created, preserve
    # all other top-level keys; create file+parents if absent
  - reuses backend.mcp_config_detect for presence checks (idempotency)
  - subprocess to `claude` is injected/mockable (a module-level runner function)

backend/mcp_config_detect.py    (existing — read side, unchanged except maybe a
  shared server-name constant if worth DRYing)
```

`InstallResult` dataclass: `{target: str, action: str, changed: bool, detail:
str, ok: bool}` — drives the per-target summary and exit code.

### Constraints / invariants
- `backend.mcp_config_install` is stdlib-only (`json`, `os`, `sys`, `subprocess`,
  `pathlib`, `dataclasses`) and CLI-only — MUST stay OUT of the MCPB import
  closure. The canary (`mcp_server/tests/test_mcpb_closure.py`
  `forbidden_prefixes`) gains `backend.mcp_config_install`.
- NOT wired through the corrupt-config writer gate: it writes to *client* configs
  (`~/.claude.json`, `claude_desktop_config.json`), never to claude-explorer's own
  `data_dir`/`config.json`, so the data-orphaning gate does not apply (same
  exemption rationale as `install-watcher`).
- Atomic writes: write to a temp file in the same dir, `os.replace`. Never
  partially write a client's config. Preserve every existing top-level key.
- Never raise on a malformed/absent target config — return a failed
  `InstallResult` with a readable reason (mirrors `mcp_config_detect`'s
  never-raise discipline).

## Testing (black-box, per CLAUDE-TESTING.md)

- **Write-side unit tests** (`backend/mcp_config_install.py`) with `tmp_path`:
  fresh install creates the entry; idempotent re-install makes no change /
  reports already-configured; uninstall removes only our entry and preserves
  others; install into an existing config preserves all other top-level keys;
  atomic write (no partial file on simulated failure); absent file → created;
  corrupt JSON target → failed InstallResult, no raise.
- **`claude` CLI path:** monkeypatch `shutil.which` and the module's subprocess
  runner so tests NEVER shell out; assert the correct `claude mcp add/remove`
  argv is built for each scope, and that the fallback direct-write path runs when
  `claude` is absent.
- **CLI tests** (`CliRunner`): `install --help` lists subcommands;
  `install mcp --client code|desktop|all` routes correctly; `--uninstall` path;
  `install all` aggregates + exit code on partial failure; deprecated
  `install-watcher` alias delegates and emits the deprecation notice; watcher
  subcommand still works (mock the OS-supervisor helpers).
- **Closure canary:** `backend.mcp_config_install` absent from the MCP closure.
- No network, no real `claude` CLI, no real Claude Desktop — all injected.

## Verification
- `uv run claude-explorer install --help` lists all/watcher/mcp.
- `uv run claude-explorer install mcp --client code` on this machine, then
  `uv run claude-explorer doctor` shows MCP -> Claude Code as registered (OK).
- `uv run claude-explorer install-watcher --help` still works and notes deprecation.
- Full backend suite: baseline + new tests, 0 new failures (the pre-existing
  `test_lifespan_filecache_warm` failure is unrelated), canary green.
