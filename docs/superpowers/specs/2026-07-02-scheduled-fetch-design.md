# `claude-explorer install fetch` — scheduled fetch service — Design

**Date:** 2026-07-02
**Status:** Approved (design phase)
**Branch:** `lokkju/scheduled-fetch` (off `main`)

## Context

Today an archive only updates when the user manually runs `claude-explorer
fetch` (or clicks Refresh in the web UI). We want a supervised job that
keeps the archive current on a schedule, monitored by `doctor`, and — the
key ask — that **alerts the user to re-authenticate** when the Claude
session key expires (a background job can't re-login interactively).

This mirrors the existing `install watcher` (a supervised OS job), but as a
**periodic** job rather than a continuously-running daemon.

## Decisions (locked during brainstorming)

1. **Schedule:** hourly incremental fetch by default (`--interval` seconds,
   default 3600). Incremental = only new/changed conversations, so hourly is
   cheap.
2. **Per-run steps:** incremental fetch → search reindex drift pass. Nothing
   else (kept lean).
3. **Re-auth alerting scope (v1):** status file + best-effort desktop
   notification (fired only on the ok→expired transition) + `doctor` WARN.
   **No web-UI banner** in v1 (deferred — see Future work).
4. **CLI:** `install fetch [--interval N] [--uninstall]`, folded into
   `install all`. Periodic scheduling (not the watcher's KeepAlive/Restart).

## Scope

### In scope

- `install fetch [--interval N] [--uninstall]` subcommand + inclusion in
  `install all`.
- Per-OS **periodic** supervised job (launchd `StartInterval`, systemd
  `.timer` + oneshot `.service`, Windows Task Scheduler hourly time trigger).
- A run routine (`run_scheduled_fetch`) invoked each tick: incremental fetch
  → reindex drift → write status → notify on auth-expiry transition, with an
  overlap lock and a log file.
- Status file `~/.claude-explorer/scheduled-fetch-status.json`.
- Best-effort cross-platform desktop notification helper (`backend/notify.py`).
- `doctor` check for the scheduled fetch (installed? auth expired? stale?).
- `is_scheduled_fetch_installed()` install-detection (mirrors
  `watcher_status`).

### Out of scope (deferred → Future work)

- Web-UI "session expired" banner + one-click Refresh re-auth.
- Auto-launching interactive re-capture from the background job.
- MCP tools / a skill reading the status file to warn the user their archive
  is stale or their session expired when they query it (user-requested,
  2026-07-02).

## CLI surface

```
claude-explorer install fetch [--interval 3600] [--uninstall]
claude-explorer install all      # now also installs the scheduled fetch
```

## The run routine (`backend/scheduled_fetch.py:run_scheduled_fetch`)

Invoked once per scheduler tick (via a small launcher script the installers
write, mirroring the watcher's `~/.claude-explorer/cc-watcher.py` pattern, run
by the resolved python interpreter). Returns an exit code.

Steps, in order:

1. **Overlap lock.** Acquire a lockfile (`~/.claude-explorer/scheduled-fetch.lock`).
   If already held, log "previous run still in progress" and exit 0 — do not
   stack fetches.
2. **Credentials present?** If `credentials.json` is missing → write status
   `needs_auth`, notify (transition-only), exit non-zero.
3. **Incremental fetch, in-process.** Reuse the same fetch path the CLI uses
   (`fetcher.bulk_fetch`), so the result and any auth failure are inspectable.
   Auth failures are already classified by `fetcher/http_retry.py`
   (401 → `AUTH_EXPIRED`, 403 → `ORG_FORBIDDEN`).
4. **On auth failure (`AUTH_EXPIRED`/`ORG_FORBIDDEN`):** write status
   `auth_expired`; if this is a transition (prior status was `ok`/absent),
   fire the desktop notification; exit non-zero. No retry-hammering.
5. **On success:** run `reindex-search --drift` (in-process via
   `backend.search_index` drift helper) so new conversations are searchable
   without `serve`; write status `ok` (clears `auth_expired`, records
   `last_success_at`, `fetched_count`); exit 0.
6. **On other error:** write status `error` with the message; exit non-zero.
   (No notification — only auth expiry alerts the user.)
7. **Always** release the lock; write `last_run_at`; append to the log file
   (`~/.claude-explorer/scheduled-fetch.log`).

Never raises out of the routine — every failure becomes a status + exit code.

## Status file

`~/.claude-explorer/scheduled-fetch-status.json` (atomic write, 0o600):

```json
{
  "last_run_at": "2026-07-02T14:00:03Z",
  "last_success_at": "2026-07-02T13:00:02Z",
  "last_result": "ok | auth_expired | needs_auth | error",
  "auth_expired": false,
  "fetched_count": 4,
  "error": null,
  "interval_sec": 3600
}
```

Single source of truth read by `doctor` and by the notification
transition-check. Written by `run_scheduled_fetch`.

## Desktop notification (`backend/notify.py`)

`notify(title: str, message: str) -> bool` — best-effort, never raises:

- macOS → `osascript -e 'display notification "<msg>" with title "<title>"'`
- Linux → `notify-send <title> <msg>` if `notify-send` is on PATH (needs a
  live desktop session/DBUS; skipped otherwise)
- Windows → PowerShell toast
- Unknown/failure → return False (caller falls back to status file + doctor)

Fired ONLY on the ok→expired transition (compare the prior status file), so
the user isn't notified every hour. Message requests re-auth with the exact
command: *"Claude Explorer: your Claude session expired. Re-authenticate: run
`claude-explorer capture` (or click Refresh in the web UI)."*

CLI-only; MUST stay out of the MCPB import closure (canary forbids
`backend.notify` and `backend.scheduled_fetch`).

## doctor check (`check_scheduled_fetch`)

One `CheckResult`, by priority:

- Scheduled fetch **not installed** → WARN, fix `claude-explorer install fetch`.
- Installed + status `auth_expired`/`needs_auth` → WARN, fix
  `claude-explorer capture` (re-authenticate). Most urgent.
- Installed + `last_success_at` older than 2× `interval_sec` → WARN
  ("fetches stale — check the job/logs").
- Installed + fresh success → OK (shows last success time + count).

New helper `is_scheduled_fetch_installed()` mirrors
`watcher_status.is_watcher_installed()` (launchctl / systemctl / schtasks
probe; env override `CLAUDE_EXPLORER_SCHEDULED_FETCH_INSTALLED` for tests).

## Platform install (`cli/scheduled_fetch_install.py`, mirrors `cli/watcher.py`)

Identifiers (mirror the watcher's naming):

- launchd label: `com.claude-explorer.scheduled-fetch`, plist at
  `~/Library/LaunchAgents/com.claude-explorer.scheduled-fetch.plist`, using
  `StartInterval` (= interval) instead of KeepAlive.
- systemd: `claude-explorer-scheduled-fetch.service` (Type=oneshot) +
  `claude-explorer-scheduled-fetch.timer` (`OnBootSec` + `OnUnitActiveSec` =
  interval); enable the timer. Reminder to `loginctl enable-linger $USER`.
- Windows: Task Scheduler `ClaudeExplorerScheduledFetch`, hourly time trigger
  running the launcher via `pythonw.exe`.

Each writes the launcher script (`~/.claude-explorer/scheduled-fetch.py`) that
runs `run_scheduled_fetch()`. `--uninstall` removes the unit/task/plist.

`install fetch` and `install all` wire through the existing
`_summarize_install` / `InstallResult` aggregation, and are NOT gated by the
corrupt-config writer gate (same exemption as the watcher — the launcher lives
outside `data_dir`).

## Testing (black-box, per CLAUDE-TESTING.md)

- **Run routine:** with a fake fetch (monkeypatched) returning success /
  `AUTH_EXPIRED` / error and a `tmp` home: status file has the right fields;
  auth-expiry writes `auth_expired` + calls notify once, and only on
  transition (second expired run does NOT re-notify); success clears it and
  runs the drift pass; overlap lock prevents a second concurrent run; never
  raises.
- **notify:** monkeypatch the subprocess runner + `sys.platform`; assert the
  correct argv per OS; unknown platform / missing binary → returns False, no
  raise.
- **doctor check:** tmp status file drives each branch (not installed / auth
  expired / stale / fresh); uses the env override for install detection.
- **Install generators:** unit-test the plist / systemd unit+timer / schtasks
  content (interval present, periodic not KeepAlive); mock the actual
  install calls (as the watcher tests do).
- **CLI:** `install fetch`/`install all` route + `--uninstall`; closure canary
  forbids `backend.notify` + `backend.scheduled_fetch`.
- No network, no real scheduler, no real notifications — all injected.

## The honest limitation (documented in README/CLAUDE.md)

A background job can't silently re-login (interactive browser needed), and on
Linux `notify-send` from a systemd user service needs a live desktop
session/DBUS — so the desktop notification is best-effort. The status file +
`doctor` are the reliable signals; re-auth is a one-time manual
`claude-explorer capture` (or web Refresh). The scheduled job keeps the
archive current *between* re-auths.

## Verification

- `claude-explorer install fetch` then `doctor` shows the scheduled-fetch
  check; on this Linux box, `systemctl --user list-timers` shows the timer.
- Simulate expiry (bad creds) → status file `auth_expired`, doctor WARN with
  the capture fix.
- Full backend suite: baseline + new tests, 0 new failures (pre-existing
  `test_lifespan_filecache_warm` unrelated), canary green.
