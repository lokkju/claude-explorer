# Claude Desktop Message Exporter

A tool to extract, browse, search, and export your Claude conversation history — even if you've lost access to the email address on your account.

## Features

- **Browse conversations** from both Claude Desktop and Claude Code
- **Full-text search** across all messages with instant results
- **Export** to Markdown or PDF
- **Dark mode** with automatic system preference detection
- **Keyboard navigation** with Emacs and Vim modes
- **Message tree visualization** for branched conversations
- **Command palette** (Cmd+K) for quick navigation
- **Claude Code integration** with project grouping and subagent display
- **MCP server** exposing your saved sessions to Claude Desktop and Claude Code

---

## Background

### Where Claude Desktop Stores Your Data

Claude Desktop is an Electron app that wraps `claude.ai`. Your conversation history is **stored server-side only** — there is no meaningful local copy. If you go looking on your Mac, here's what you'll find (and won't find):

| Path | What's There |
|------|-------------|
| `~/Library/Application Support/Claude/IndexedDB/https_claude.ai_0.indexeddb.leveldb` | **Chat drafts only** — unsent text in the input box. No conversation history. |
| `~/Library/Caches/com.anthropic.claudefordesktop/Cache.db` | **App update URLs only** — not conversation data. |

The official export path (Settings → Privacy → Export Data) sends a download link to your account email. If you've lost access to that email address, you're stuck.

### The Workaround

This tool offers two ways to capture your session credentials:

**Method A: Browser Login (Default)**
1. Open a Playwright-controlled browser to claude.ai
2. Let you log in normally (SSO, email, etc.)
3. Extract the **session cookie** (`sessionKey`) after authentication
4. Use that session cookie to **bulk-fetch all conversations** directly from the claude.ai API

**Method B: Proxy Interception (--proxy)**

If you've lost access to the login (e.g., work SSO disabled) but Claude Desktop is still authenticated:

1. Run **mitmproxy** as a local proxy on port 8080
2. Launch Claude Desktop through the proxy with `--proxy-server=127.0.0.1:8080 --ignore-certificate-errors`
3. Watch the intercepted traffic to capture the **session cookie** (`sessionKey`)
4. Use that session cookie to **bulk-fetch all conversations** directly from the claude.ai API

Claude Desktop does **not** do SSL certificate pinning, which makes the proxy method possible.

---

## The claude.ai API (Unofficial, Observed)

All endpoints authenticate via a `Cookie` header:

```
Cookie: sessionKey=sk-ant-sid01-...
```

### Endpoints

```
GET /api/organizations/{org_id}/chat_conversations
    ?limit=30&starred=false&offset=0
    → Paginated list of conversation summaries

GET /api/organizations/{org_id}/chat_conversations/count_all
    → { "count": N }

GET /api/organizations/{org_id}/chat_conversations/{uuid}
    ?tree=True&rendering_mode=messages&render_all_tools=true&consistency=strong
    → Full conversation with all messages
```

### Conversation Structure

```json
{
  "uuid": "...",
  "name": "Conversation title",
  "model": "claude-sonnet-4-6",
  "created_at": "2026-02-25T19:14:43Z",
  "updated_at": "2026-02-25T20:30:51Z",
  "is_starred": false,
  "is_temporary": false,
  "current_leaf_message_uuid": "...",
  "chat_messages": [...]
}
```

### Message Structure

```json
{
  "uuid": "...",
  "sender": "human" | "assistant",
  "text": "message text",
  "content": [...],
  "index": 0,
  "created_at": "2026-02-25T19:14:43Z",
  "truncated": false,
  "parent_message_uuid": "...",
  "attachments": [],
  "files": []
}
```

### Message Trees and Branches

Messages form a **tree**, not a flat list. Each message has a `parent_message_uuid` linking it to its parent. When you edit a message and regenerate a response, Claude creates a new branch — so a conversation can have multiple alternate paths.

`current_leaf_message_uuid` on the conversation object points to the tip of the currently active branch. To reconstruct the displayed conversation, walk backward from the leaf following `parent_message_uuid` links until you reach the root, then reverse the list.

### Content Blocks

The `content` array contains typed blocks:

| Type | Description |
|------|-------------|
| `text` | Regular message text |
| `tool_use` | A tool call (name + input dict) |
| `tool_result` | The result of a tool call |
| `image` | An embedded image |

---

## Project Structure

```
claude-desktop-message-exporter/
├── README.md
├── CLAUDE.md                 # Development guide
├── pyproject.toml            # Python dependencies + CLI entry point
├── PLANS/
│   ├── overview.md           # Project goals and architecture
│   ├── fetcher.md            # Fetcher design and test plan
│   ├── backend.md            # Backend API design and test plan
│   └── frontend.md           # Frontend design and test plan
├── fetcher/
│   ├── cli.py                # CLI entry point (claude-exporter command)
│   ├── playwright_capture.py # Browser-based credential capture (default)
│   ├── mitmproxy_addon.py    # Proxy-based credential capture (--proxy)
│   └── bulk_fetch.py         # Downloads all conversations to local JSON
├── backend/
│   ├── main.py               # FastAPI app
│   ├── models.py             # Pydantic models
│   ├── store.py              # Reads and indexes JSON files from disk
│   ├── search.py             # Full-text search
│   ├── export.py             # Markdown + PDF export
│   └── routers/              # conversations, search, export endpoints
└── frontend/
    └── src/                  # React 18 + TypeScript + Tailwind + shadcn/ui
```

---

## Quick Start

### Prerequisites

```bash
# Install uv (Python package manager)
curl -LsSf https://astral.sh/uv/install.sh | sh

# Clone and install
git clone https://github.com/youruser/claude-desktop-message-exporter
cd claude-desktop-message-exporter
uv sync

# Install Playwright browsers (for browser-based credential capture)
uv run playwright install chromium
```

### Step 1: Capture Your Session Cookie

There are two methods to capture credentials. Choose the one that fits your situation:

#### Method A: Browser Login (Default)

The simplest approach — opens a browser window where you log into Claude normally:

```bash
uv run claude-exporter capture
```

This opens Chromium, navigates to claude.ai, and waits for you to log in. Once authenticated, credentials are automatically extracted and saved to `~/.claude-exporter/credentials.json`.

**Options:**
- `--timeout N` — Max seconds to wait for login (default: 300)

#### Method B: Proxy Interception (--proxy)

Use this method when you **can't log into the web UI** but Claude Desktop is still authenticated. This was a lifesaver for recovering conversations from a work account after losing access to the SSO login.

```bash
# Terminal 1 — start the proxy (requires ANSI terminal)
uv run claude-exporter capture --proxy

# Terminal 2 — launch Claude Desktop through the proxy
open -a "Claude" --args --proxy-server="127.0.0.1:8080" --ignore-certificate-errors
```

Click around in Claude Desktop for a few seconds. The addon will print:

```
✅ Credentials captured! You can now quit mitmproxy (q) and close Claude Desktop.
```

**Options:**
- `--port N` — Proxy port (default: 8080)

**Platform-specific launch commands:**
```bash
# macOS
open -a "Claude" --args --proxy-server="127.0.0.1:8080" --ignore-certificate-errors

# Windows
"C:\...\Claude.exe" --proxy-server="127.0.0.1:8080" --ignore-certificate-errors

# Linux
claude --proxy-server="127.0.0.1:8080" --ignore-certificate-errors
```

**Note:** mitmproxy requires a proper ANSI terminal (Terminal.app, iTerm2, etc.). It will not work in non-TTY environments.

---

Both methods save credentials to `~/.claude-exporter/credentials.json`.

### Step 2: Download Your Conversations

```bash
uv run claude-exporter fetch
```

This downloads all your conversations as JSON files to `~/.claude-exporter/conversations/`. A rate-limited 0.3s delay between requests keeps things polite. Incremental mode (default) skips conversations you've already downloaded.

Options:
- `--full-refresh` — Re-download all conversations
- `--limit N` — Download only N conversations
- `--verbose` — Show detailed progress

### Step 3: Browse and Export

```bash
uv run claude-exporter serve
```

Opens the web app at `http://localhost:8000`.

For development with hot-reload:
```bash
# Terminal 1 — backend
DYLD_LIBRARY_PATH=/opt/homebrew/lib uv run uvicorn backend.main:app --reload

# Terminal 2 — frontend
cd frontend && npm run dev
```
Then open `http://localhost:5173`.

---

## MCP Server

The project ships with a built-in **Model Context Protocol** server that lets Claude Desktop or Claude Code query your saved conversations directly. Once configured, you can ask Claude things like *"find the session where I debugged the weasyprint install"* or *"export the ZFS conversation I had last week as markdown"* and Claude will use the tools below to answer.

### Tools exposed

| Tool | Purpose |
|------|---------|
| `list_sessions` | Full-text search / list conversation sessions, optionally filtered by source or project |
| `list_projects` | List distinct projects with session counts |
| `get_session_outline` | Lightweight per-message summaries (cached in SQLite) for a specific session |
| `get_messages` | Full message content for specific positions or UUIDs, with optional tool calls/results |
| `export_session` | Markdown export of a full or partial session |

The server runs over **stdio** (no network port) and reads from the same `~/.claude-exporter/conversations/` directory the web UI uses.

### Prerequisites

Make sure the project is installed and conversations have been fetched at least once:

```bash
cd /path/to/claude-desktop-message-exporter
uv sync
uv run claude-exporter capture   # one-time
uv run claude-exporter fetch
```

The MCP entry point is `claude-exporter mcp`. You can verify it works standalone:

```bash
uv run --directory /path/to/claude-desktop-message-exporter claude-exporter mcp
# (prints nothing; it's waiting for MCP JSON-RPC on stdin — Ctrl+C to exit)
```

### Claude Code setup (all platforms)

The simplest path is the `claude mcp add` CLI, which writes the config for you:

```bash
claude mcp add claude-sessions \
  -- uv run --directory /absolute/path/to/claude-desktop-message-exporter claude-exporter mcp
```

Use `--scope user` to make it available in every project, or `--scope project` (default) to scope it to the current repo (writes to `.mcp.json`).

Verify with:

```bash
claude mcp list
```

Or edit the config files directly:

- **User scope:** `~/.claude.json` (key: `mcpServers`)
- **Project scope:** `.mcp.json` in the project root

```json
{
  "mcpServers": {
    "claude-sessions": {
      "command": "uv",
      "args": [
        "run",
        "--directory",
        "/absolute/path/to/claude-desktop-message-exporter",
        "claude-exporter",
        "mcp"
      ]
    }
  }
}
```

> **Note:** Use the **absolute path** to the repo. MCP clients do not inherit your shell's `cwd`. If `uv` is not on the default `PATH` the client sees, replace `"uv"` with the absolute path from `which uv` (typically `~/.local/bin/uv` or `/opt/homebrew/bin/uv`).

### Claude Desktop setup

Claude Desktop reads from a `claude_desktop_config.json` file whose location depends on the OS. Create or edit it and add the `claude-sessions` entry under `mcpServers`, then fully quit and relaunch Claude Desktop.

#### macOS

Config path:
```
~/Library/Application Support/Claude/claude_desktop_config.json
```

```json
{
  "mcpServers": {
    "claude-sessions": {
      "command": "/opt/homebrew/bin/uv",
      "args": [
        "run",
        "--directory",
        "/Users/YOU/Source/claude-desktop-message-exporter",
        "claude-exporter",
        "mcp"
      ]
    }
  }
}
```

If you installed `uv` via the standalone installer instead of Homebrew, it will be at `~/.local/bin/uv`. Use `which uv` to confirm.

#### Windows

Config path:
```
%APPDATA%\Claude\claude_desktop_config.json
```
(typically `C:\Users\YOU\AppData\Roaming\Claude\claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "claude-sessions": {
      "command": "uv",
      "args": [
        "run",
        "--directory",
        "C:\\Users\\YOU\\Source\\claude-desktop-message-exporter",
        "claude-exporter",
        "mcp"
      ]
    }
  }
}
```

Use double-backslashes (`\\`) in JSON string paths. If `uv` is not on the system `PATH` as seen by Claude Desktop, use its absolute path (e.g. `C:\\Users\\YOU\\.local\\bin\\uv.exe`).

#### Linux

Config path:
```
~/.config/Claude/claude_desktop_config.json
```

```json
{
  "mcpServers": {
    "claude-sessions": {
      "command": "/home/YOU/.local/bin/uv",
      "args": [
        "run",
        "--directory",
        "/home/YOU/Source/claude-desktop-message-exporter",
        "claude-exporter",
        "mcp"
      ]
    }
  }
}
```

### Verifying it works

After restarting your client, ask it to search your history, e.g.:

> *"Use the claude-sessions MCP server to list my 5 most recent sessions."*

In Claude Code you can also run `/mcp` to see the server status and the list of tools it registered.

### Troubleshooting

- **"command not found: uv"** — the MCP client doesn't see your shell `PATH`. Use the absolute path to `uv` in `command`.
- **"Session not found" / empty results** — run `uv run claude-exporter fetch` first; the MCP server reads from `~/.claude-exporter/conversations/`.
- **Need to use a non-default data dir** — set `CLAUDE_EXPORTER_DATA_DIR` via an `env` block in the MCP config:
  ```json
  "env": { "CLAUDE_EXPORTER_DATA_DIR": "/path/to/conversations" }
  ```
- **Stale session outlines after a branch switch** — outlines are cached in `~/.claude-exporter/cache.db`. Delete that file to force a full rebuild.

---

## Known Limitations

- **Session key expiry:** `sessionKey` will eventually expire. Re-run the mitmproxy step to get a fresh one.
- **Cloudflare cookie:** The `cf_clearance` cookie may be required on some networks. The fetcher attempts to capture it alongside `sessionKey`.
- **Truncated messages:** The API returns `truncated: true` for very long messages. A per-message full-content endpoint has not yet been identified.
- **Import:** There is no known write API for creating conversations. Migration to a new account is not currently possible programmatically.
- **macOS only (for now):** The `open -a "Claude"` proxy launch command is macOS-specific. Linux and Windows launch commands are documented in `fetcher/README.md`.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Credential Capture | Playwright (browser login), mitmproxy (proxy interception) |
| Fetcher | httpx, curl_cffi |
| Backend | FastAPI, uvicorn, uv, weasyprint |
| Frontend | React 18, TypeScript, Vite, Tailwind CSS v4, shadcn/ui, TanStack Query |
| Search | In-process full-text search over loaded JSON |
| Export | Markdown (built-in), PDF (weasyprint) |

---

## License

MIT
