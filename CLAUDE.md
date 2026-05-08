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
# Then open http://localhost:8000
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
4. Credentials are saved to `~/.claude-exporter/credentials.json`

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
                                  (default: ~/.claude-exporter/conversations)
  --credentials PATH              Path to credentials file
                                  (default: ~/.claude-exporter/credentials.json)
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
  --port INTEGER    Port to bind to (default: 8000)
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

#### Web UI Refresh button (Build-9)

The sidebar **Refresh** button owns the full pipeline — capture + fetch — so the user never has to drop to the CLI to re-capture credentials.

- **Endpoint:** `GET /api/fetch/refresh?incremental=true` (SSE).
- **Behavior:** if `~/.claude-exporter/credentials.json` is missing OR the fetch returns `401`/`403`/`cf-mitigated`, the backend invokes `fetcher.playwright_capture.capture_credentials` in-process. On success it persists creds (atomic write, `0o600`) and continues with an incremental fetch automatically.
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
uv run uvicorn backend.main:app --reload --port 8000

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
   DYLD_LIBRARY_PATH=/opt/homebrew/lib uv run uvicorn backend.main:app --reload --port 8000
   ```

2. Start the frontend (in another terminal):
   ```bash
   cd frontend && npm run dev
   ```

The frontend proxies `/api` requests to the backend.

## Data Directory

Conversations are stored in `~/.claude-exporter/conversations/` as JSON files.

Set `CLAUDE_EXPORTER_DATA_DIR` to override, or create `~/.claude-exporter/config.json`:
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

## Code Style

- Python: Follow PEP 8, use type hints
- TypeScript: Strict mode, prefer functional components
- Commits: Conventional commit messages, no AI attribution lines
