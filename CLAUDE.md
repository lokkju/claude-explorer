# Claude Explorer

## UX Rules

All UX flows and rules are documented in [UX.md](./UX.md). Code changes that affect UI behavior MUST keep that document accurate; failing-test-first applies (see CLAUDE.md "Code Style" rule on TDD).

## Testing Rules

When writing or reviewing tests (Playwright, pytest, vitest), read [CLAUDE-TESTING.md](./CLAUDE-TESTING.md). It codifies black-box / spec-driven discipline, bidirectional verification, Playwright-specific gotchas (overflow-clipping, shadcn `<Select>`, Radix `<ScrollArea>`), fixture-design rules, and a pre-flight checklist. Other agents (pure feature work, refactors, deployments) can skip it.

## Project Structure

```
├── backend/          # FastAPI backend (Python)
├── frontend/         # React frontend (TypeScript)
├── fetcher/          # mitmproxy addon for fetching conversations (Python)
├── PLANS/            # Implementation plans
└── pyproject.toml    # Python dependencies
```

## CLI Usage

After installing (`uv sync`), use the `claude-explorer` command:

```bash
# Step 1: Capture credentials from Claude Desktop
claude-explorer capture

# In another terminal, launch Claude Desktop through the proxy:
open -a "Claude" --args --proxy-server="127.0.0.1:8080" --ignore-certificate-errors

# Step 2: Fetch all conversations
claude-explorer fetch

# Step 3: Start the web server to browse
claude-explorer serve
# Then open http://localhost:8765
```

### Command Reference

#### `claude-explorer capture`

Start mitmproxy to intercept Claude Desktop session credentials.

```
Options:
  --port INTEGER    Proxy port (default: 8080)
```

**How it works:**
1. Starts a local HTTPS proxy using mitmproxy
2. You launch Claude Desktop through the proxy
3. The addon extracts `sessionKey` and `org_id` from API requests
4. Credentials are saved to `~/.claude-explorer/credentials.json`

**Platform-specific launch commands:**
```bash
# macOS
open -a "Claude" --args --proxy-server="127.0.0.1:8080" --ignore-certificate-errors

# Windows
"C:\...\Claude.exe" --proxy-server="127.0.0.1:8080" --ignore-certificate-errors

# Linux
claude --proxy-server="127.0.0.1:8080" --ignore-certificate-errors
```

#### `claude-explorer fetch`

Download all conversations from Claude using captured credentials.

```
Options:
  --output-dir PATH               Where to save JSON files
                                  (default: ~/.claude-explorer/conversations)
  --credentials PATH              Path to credentials file
                                  (default: ~/.claude-explorer/credentials.json)
  --session-key TEXT              Session key (overrides credentials file)
  --org-id TEXT                   Org ID (overrides credentials file)
  --incremental / --full-refresh  Skip already-saved conversations (default: incremental)
  --delay FLOAT                   Seconds between requests (default: 0.3)
  --limit INTEGER                 Max conversations to fetch
  --verbose                       Show detailed output
```

**Examples:**
```bash
# Fetch all new conversations
claude-explorer fetch

# Re-fetch everything
claude-explorer fetch --full-refresh

# Fetch only 10 conversations with verbose output
claude-explorer fetch --limit 10 --verbose

# Use custom credentials
claude-explorer fetch --session-key "sk-ant-..." --org-id "uuid-..."
```

#### `claude-explorer serve`

Start the web server to browse and export conversations.

```
Options:
  --host TEXT       Host to bind to (default: 127.0.0.1)
  --port INTEGER    Port to bind to (default: 8765)
  --reload          Enable auto-reload for development
```

**Examples:**
```bash
# Start server
claude-explorer serve

# Start on different port
claude-explorer serve --port 9000

# Development mode with auto-reload
claude-explorer serve --reload
```

#### `claude-explorer install-watcher` (cross-platform — strongly recommended)

Install a supervised job that runs the CC image-cache watcher
continuously, independent of `claude-explorer serve`. **Without this,
the watcher only runs while the dev server is up — Claude Code can
rotate images off disk during downtime, causing permanent data loss.**

The CLI dispatches by `sys.platform`:

  * macOS  → launchd user agent (`~/Library/LaunchAgents/com.claude-explorer.cc-watcher.plist`)
  * Linux  → systemd user unit (`~/.config/systemd/user/claude-explorer-cc-watcher.service`); also run `sudo loginctl enable-linger $USER` to survive logout
  * Windows → Task Scheduler task `ClaudeExplorerCCWatcher` (logon-triggered, runs the launcher at `%USERPROFILE%\.claude-explorer\cc-watcher.py` via `pythonw.exe`)

The watcher uses **`watchdog` for event-driven capture** (FSEvents on
macOS, inotify on Linux, ReadDirectoryChangesW on Windows) — sub-
second latency, near-zero idle CPU. A periodic backstop poll
(default 600s = 10 min, overridable via `--interval` or env var
`CLAUDE_EXPLORER_CC_WATCHER_INTERVAL_SEC`) catches the rare event the
OS dropped or coalesced.

```bash
uv run claude-explorer install-watcher

# Verify (per platform):
launchctl list | grep claude-explorer                                 # macOS
systemctl --user status claude-explorer-cc-watcher.service            # Linux
schtasks /Query /TN ClaudeExplorerCCWatcher                           # Windows

# Logs (macOS):
tail -f ~/Library/Logs/claude-explorer-cc-watcher.{out,err}

# Tune the backstop poll interval (default 600s):
uv run claude-explorer install-watcher --interval 60

# Uninstall:
uv run claude-explorer install-watcher --uninstall
```

#### `claude-explorer reindex-search` (manual override only)

Force a rebuild of the SQLite FTS5 search index at
`~/.claude-explorer/search-index.sqlite`. **You should not need this in
normal operation:** the index is built automatically at backend startup
(non-blocking lifespan task) and kept in sync by the same watcher
loop that handles CC images (event-driven via `watchdog`, with a
600s backstop poll). Use only when:

- the index file got corrupted (delete it, then run this);
- you want a known-fresh full rebuild;
- a future schema bump requires manual rebuild without restarting `serve`.

```bash
# Default: full DROP + rebuild from scratch.
uv run claude-explorer reindex-search

# Drift-only pass (re-index only files whose mtime changed since last index).
uv run claude-explorer reindex-search --drift
```

**How search works in the running server:**

- `backend/search_index.py` owns the SQLite FTS5 schema, lifecycle,
  and queries. Singleton via `get_search_index()`; returns `None` on
  sqlite3 builds without FTS5.
- `backend/search.py:search_conversations` is a dispatcher: prefer
  the FTS5 fast path when `idx.is_ready()`, fall back to the
  linear-scan code on any failure (initial build still running, FTS5
  unavailable, sqlite3 error). Search never goes "down".
- Architecture is **Scatter-Gather**: FTS5 returns `(conv_uuid,
  message_uuid)` pairs; the existing Python `create_snippet`/sort
  code runs on the matched conversations only (warm via FileCache).
  Result: byte-for-byte identical `SearchResult` shape to the linear
  path for whole-word queries.
- The CC image watcher (`backend/cc_image_watcher.py:scan_once`) runs
  the search-index drift pass once per backstop scan (600s default).
  Image-cache events fire instantly via `watchdog` but do NOT trigger
  a drift pass — search picks up new sessions on the next backstop
  poll. Failures in either pass are isolated.

If you change the schema, bump `backend/search_index.SCHEMA_VERSION`
and the next process startup will drop+rebuild on its own.

#### Web UI Refresh button (Build-9)

The sidebar **Refresh** button owns the full pipeline — capture + fetch — so the user never has to drop to the CLI to re-capture credentials.

- **Endpoint:** `GET /api/fetch/refresh?incremental=true` (SSE).
- **Behavior:** if `~/.claude-explorer/credentials.json` is missing OR the fetch returns `401`/`403`/`cf-mitigated`, the backend invokes `fetcher.playwright_capture.capture_credentials` in-process. On success it persists creds (atomic write, `0o600`) and continues with an incremental fetch automatically.
- **Capture is run at most once per request.** A post-capture fetch that still 401s emits a final `error` event — no retry loop.
- **Concurrency:** module-level `_refresh_in_progress` flag plus `asyncio.Lock`. A second concurrent request returns `409 Conflict`. Frontend disables the button while running, so 409 is defense-in-depth.
- **SSE event types:** `capture_start`, `capture_waiting_login` (heartbeat every 25s during the 5-min login wait), `capture_done`, `capture_error`, plus the existing `start`, `progress`, `complete`, `error`.
- **Manual override:** the Details modal's "Full Refresh" and "Fetch New" buttons still hit `/fetch/start` directly with no auto-capture.

If you change capture or fetch logic, edit `backend/routers/fetch.py` (the `_capture_phase_stream`, `_fetch_phase_stream`, and `refresh_pipeline_stream` async generators) and `frontend/src/components/fetch/FetchToast.tsx` (the `useRefreshPipeline` hook) together — the SSE event schema is shared.

## Development Setup

### Python (Backend & Fetcher)

Use `uv` to manage the Python virtual environment:

```bash
# Create/sync the virtual environment
uv sync

# Run backend server
uv run uvicorn backend.main:app --reload --port 8765

# Run with dev dependencies
uv sync --extra dev
uv run pytest
```

The `.venv` directory is local to the project and managed by `uv`.

### Frontend

```bash
cd frontend
npm install
npm run dev    # Development server on http://localhost:5173
npm run build  # Production build
```

## Running the Full Stack

1. Start the backend:
   ```bash
   # On macOS with Homebrew, set library path for WeasyPrint PDF support:
   DYLD_LIBRARY_PATH=/opt/homebrew/lib uv run uvicorn backend.main:app --reload --port 8765
   ```

2. Start the frontend (in another terminal):
   ```bash
   cd frontend && npm run dev
   ```

The frontend proxies `/api` requests to the backend.

## Data Directory

Conversations are stored in `~/.claude-explorer/conversations/` as JSON files.

Set `CLAUDE_EXPLORER_DATA_DIR` to override, or create `~/.claude-explorer/config.json`:
```json
{"data_dir": "/path/to/conversations"}
```

## PDF Export Dependencies

WeasyPrint requires system libraries for PDF generation:

```bash
# macOS
brew install pango cairo libffi

# Ubuntu/Debian
apt-get install libpango-1.0-0 libpangocairo-1.0-0 libcairo2
```

See: https://doc.courtbouillon.org/weasyprint/stable/first_steps.html#installation

### macOS DYLD bootstrap (tests + dev server)

macOS Sonoma+ strips `DYLD_*` env vars from subprocess invocations
(SIP), so prefixing `uv run pytest` with `DYLD_FALLBACK_LIBRARY_PATH=...`
silently no-ops. The tests bootstrap this from `backend/tests/conftest.py`
at import time (sets `DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib`
before WeasyPrint imports), so `uv run pytest backend/tests` Just Works
with no `--ignore` flags or env-var prefixes.

For the live dev server (`claude-explorer serve` or
`uvicorn backend.main:app`), set `DYLD_LIBRARY_PATH` directly on the
command line as shown above — the server doesn't go through conftest.

## Code Style

- Python: Follow PEP 8, use type hints
- TypeScript: Strict mode, prefer functional components
- Commits: Conventional commit messages, no AI attribution lines
