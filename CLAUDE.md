# Claude Desktop Message Exporter

## Project Structure

```
├── backend/          # FastAPI backend (Python)
├── frontend/         # React frontend (TypeScript)
├── fetcher/          # mitmproxy addon for fetching conversations (Python)
├── PLANS/            # Implementation plans
└── pyproject.toml    # Python dependencies
```

## CLI Usage

After installing (`uv sync`), use the `claude-exporter` command:

```bash
# Step 1: Capture credentials from Claude Desktop
claude-exporter capture

# In another terminal, launch Claude Desktop through the proxy:
open -a "Claude" --args --proxy-server="127.0.0.1:8080"

# Step 2: Fetch all conversations
claude-exporter fetch

# Step 3: Start the web server to browse
claude-exporter serve
# Then open http://localhost:8000
```

### Command Reference

#### `claude-exporter capture`

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
open -a "Claude" --args --proxy-server="127.0.0.1:8080"

# Windows
"C:\...\Claude.exe" --proxy-server="127.0.0.1:8080"

# Linux
claude --proxy-server="127.0.0.1:8080"
```

#### `claude-exporter fetch`

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
claude-exporter fetch

# Re-fetch everything
claude-exporter fetch --full-refresh

# Fetch only 10 conversations with verbose output
claude-exporter fetch --limit 10 --verbose

# Use custom credentials
claude-exporter fetch --session-key "sk-ant-..." --org-id "uuid-..."
```

#### `claude-exporter serve`

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
claude-exporter serve

# Start on different port
claude-exporter serve --port 9000

# Development mode with auto-reload
claude-exporter serve --reload
```

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
