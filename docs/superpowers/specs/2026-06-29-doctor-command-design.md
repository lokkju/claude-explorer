# `claude-explorer doctor` — Design

**Date:** 2026-06-29
**Status:** Approved (design phase)
**Branch:** `lokkju/doctor-command`

## Purpose

A read-only diagnostic command that checks the health of a Claude
Explorer install and its surrounding environment, reports pass/warn/fail
per check, and — for every problem — prints the exact command or steps
to fix it. It never mutates state. Fixing stays in dedicated commands
(`install-watcher`, `reindex-search`, `mcp`, and a future `install-mcp`).

This matches the near-universal "doctor" convention: `claude doctor`,
`flutter doctor`, `npm doctor`, `wp doctor`, `mcp-doctor`, and
Salesforce `sf doctor` all diagnose read-only by default; where fixing
exists at all, it is gated behind an explicit `--fix` flag, never run by
default.

## Scope

### In scope (v1)

- `claude-explorer doctor` — read-only report.
- A **check registry**: each check is a small pure-ish function returning
  a structured result. The runner executes all checks, prints a report,
  and sets the process exit code.
- `--json` flag for machine-readable output.
- Nine checks (see below).
- Design each check to be `--fix`-ready (carry a `fix_command` string and
  an optional `fix()` callable) **without** implementing `--fix` yet.

### Out of scope (v1, deferred)

- `--fix` execution (phase 2 — will delegate to existing install
  commands; each check already carries the metadata it needs).
- A live MCP handshake check (spawning `claude-explorer mcp` and probing
  `initialize`). Strongest signal but slow + fragile; revisit behind a
  `--skip-health`-style flag if desired.
- `install-mcp` command (separate epic; the MCP-config *reader* built
  here is its prerequisite and will be reused).
- Parsing Claude Desktop's binary LevelDB/IndexedDB store to detect
  `.mcpb`-installed extensions (see "Known limitation" below).

## Convention research (why these defaults)

- **Read-only by default** is what every well-known doctor does. Mutating
  as a side effect of "just checking" is surprising and, in this
  codebase, would collide with the corrupt-config writer gate.
- **Fixing is flag-gated**, and the cleanest form delegates to the
  already-tested install commands rather than reimplementing them.
- Sources: Claude Code `/doctor`, `mcp-doctor`
  (github.com/Crooj026/mcp-doctor — explicitly read-only), `wp doctor`
  (`--fix` flag), Salesforce `sf doctor` (diagnostics only).

## Architecture

```
cli/main.py                      thin `doctor` Click command:
                                 parse flags → run registry → render → exit code

backend/doctor.py                check registry + runner + result model.
                                 Pure check functions; reuse existing primitives:
                                   - watcher_status.is_watcher_installed()
                                   - config.get_settings() / config_corrupt_reason
                                   - search_index.get_search_index()
                                   - cc_image_cache.cache_dir()

backend/mcp_config_detect.py     standalone reader: is `claude-explorer mcp`
                                 registered in each client's config file?
                                 Own module because `install-mcp` will reuse it.
```

### Result model

Each check returns a `CheckResult`:

```python
@dataclass
class CheckResult:
    name: str                    # "CC watcher", "MCP → Claude Code", ...
    status: Status               # OK | WARN | FAIL
    detail: str                  # one-line human summary (current state)
    fix_command: str | None      # exact command/steps to remediate, or None
    fix: Callable[[], None] | None = None   # phase-2 hook, unused in v1
```

- **Status semantics**
  - `OK` — healthy.
  - `WARN` — degraded but not broken; an optional feature is unavailable,
    or a state we cannot positively confirm (e.g. `.mcpb` Desktop
    installs). Does **not** fail the exit code.
  - `FAIL` — a core capability is broken. Sets non-zero exit.
- The runner collects all results (every check always runs; one check's
  failure never aborts the rest — each is wrapped so an unexpected
  exception becomes a `FAIL` with the exception text in `detail`).

### Exit code

- `0` if no check is `FAIL` (WARNs allowed).
- `1` if any check is `FAIL`.
- Makes `doctor` usable in CI / setup scripts.

### Output

- **Default (human):** aligned table — `<name>  <symbol> <detail>` with an
  indented `→ <fix_command>` line under any non-OK check. Symbols:
  `✔` OK, `⚠` WARN, `✘` FAIL. Trailing summary: `N problem(s) found` or
  `All checks passed`.
- **`--json`:** `{"checks": [CheckResult...], "summary": {...}}` with
  status as a string. Stable key names so scripts can depend on them.

## The nine checks

Core (always meaningful; surface existing primitives):

1. **Credentials** — `~/.claude-explorer/credentials.json` present &
   readable. Missing → WARN (fetch needs it, but browsing existing data
   does not). Fix: `claude-explorer capture`.
2. **Data directory** — resolved `data_dir` exists & is writable; report
   conversation count. Unwritable/missing → FAIL. Fix: create dir / set
   `CLAUDE_EXPLORER_DATA_DIR`.
3. **Config** — valid vs corrupt via `config_corrupt_reason`; show the
   active config path. Corrupt → FAIL with the parse reason. Fix: edit the
   named file.
4. **CC watcher** — `is_watcher_installed()`. Not installed → WARN (data
   loss risk, but not currently broken). Fix: platform-correct
   `claude-explorer install-watcher`.
5. **Search / FTS5** — `get_search_index()` not `None` and index ready.
   FTS5 unavailable → WARN (search falls back to linear scan; still
   works). Index missing/corrupt → WARN. Fix: `claude-explorer
   reindex-search`.

Environment / integration:

6. **uv / uvx on PATH** — `shutil.which("uvx")` and `which("uv")`; report
   resolved path + Python version. Missing → WARN (only matters for the
   uvx-based MCP config). Fix: install uv / put it on PATH. Directly
   targets the documented "GUI app can't find uvx" footgun.
7. **PDF export libs** — attempt `import weasyprint` / probe pango.
   Unavailable → WARN (PDF export degraded; rest of app fine). Fix:
   OS-specific install hint (brew/apt/MSYS2).
8. **MCP → Claude Code** — via `mcp_config_detect`: parse `~/.claude.json`
   (user scope) and `.mcp.json` (cwd, project scope); is there a
   `mcpServers` entry whose command invokes `claude-explorer mcp`?
   Reliable. Not found → WARN. Fix:
   `claude mcp add --scope user claude-sessions -- uvx claude-explorer mcp`.
9. **MCP → Claude Desktop** — via `mcp_config_detect`: parse
   `claude_desktop_config.json` (OS-specific path) for the same entry.
   Found → OK. Not found → WARN with the `.mcpb` caveat (see below) plus
   the manual stdio block to add.

## Known limitation: `.mcpb` detection

Empirically verified against a live Claude Desktop install
(`~/.config/Claude` on Linux, 2026-06-29):

- `.mcpb`/DXT extensions installed via the Extensions UI are **not** stored
  as parseable files. There is no `extensions/` dir, no unpacked
  `manifest.json`, no `.mcpb` on disk. The app tracks them via "stored
  metadata" inside its binary Electron LevelDB/IndexedDB store (logs:
  `Checking N extensions via can_install API using stored metadata`);
  the only on-disk traces are opaque/serialized blobs.
- `claude_desktop_config.json` `mcpServers` and UI-installed extensions
  are **completely separate** storage mechanisms.

**Decision:** do not parse the binary store — it is undocumented,
version-specific, possibly encrypted, and would make the check lie or
break on Desktop updates. Instead:

- The Desktop check positively detects only **config-file** registration.
- When no config-file entry is found, it emits **WARN**, never FAIL, with
  an explicit note that `.mcpb` bundle installs are not detectable from
  disk and may be the (fine) reason. This protects the project's own
  primary Desktop distribution path (the `.mcpb` bundle) from a false
  "broken" verdict while still pointing genuinely-unconfigured users at
  the fix.
- Best-effort directory probing on macOS/Windows may be added later as a
  soft (never-FAIL) signal if a stable path ever surfaces.

## `mcp_config_detect` module contract

```python
def detect_mcp_in_claude_code() -> McpRegistration: ...
def detect_mcp_in_claude_desktop() -> McpRegistration: ...

@dataclass
class McpRegistration:
    found: bool
    config_path: Path | None     # which file was read (None if absent)
    scope: str | None            # "user" | "project" | "desktop"
    server_name: str | None      # the mcpServers key, if found
```

- "Matches claude-explorer" = a `mcpServers` entry whose `command` +
  `args` resolve to `claude-explorer mcp` (covers `uvx claude-explorer
  mcp`, `uv run --directory … claude-explorer mcp`, and an absolute path
  to a `claude-explorer` binary with `mcp` arg).
- Missing/corrupt config files are handled gracefully (treated as
  "not found", never raised) — mirrors the corrupt-config safe-mode
  philosophy elsewhere in the codebase.
- This module is import-light (stdlib `json` + `pathlib` only) so the
  future `install-mcp` command and the MCPB closure canary are unaffected.

## Error handling

- Every check is wrapped: an unexpected exception → `FAIL` result with the
  exception type/message in `detail`, never a crashed command.
- `doctor` does **not** go through the corrupt-config writer gate (it is
  read-only and is a recovery aid — same rationale that exempts
  `install-watcher`). It *reports* corrupt config as check #3.

## Testing

Black-box, spec-driven (per `CLAUDE-TESTING.md`):

- **Per-check unit tests** with injected/tmp environments: each check
  produces the right status for present/absent/corrupt inputs. Use
  `CLAUDE_EXPLORER_DATA_DIR`, `CLAUDE_EXPLORER_WATCHER_INSTALLED`, and
  `tmp_path` configs (existing override hooks).
- **`mcp_config_detect` tests:** Code user scope, Code project scope,
  Desktop config, each command-form variant (uvx / uv-run / absolute),
  absent file, corrupt JSON → never raises.
- **Runner tests:** exit code 0 when only WARN/OK; exit 1 on any FAIL;
  one check raising does not abort the others; `--json` shape is stable.
- **Desktop `.mcpb` caveat:** no config entry → WARN (not FAIL) and the
  caveat text is present.
- No network, no real Claude Desktop dependency — all paths injected.

## Phase-2 sketch (not built now)

`doctor --fix`: iterate checks with a non-None `fix()`; for each FAIL/WARN,
prompt (or `--yes`) then call `fix()`, which delegates to
`install-watcher` / `reindex-search` / `install-mcp`. The result model
already carries everything needed; no rework of v1 checks required.
