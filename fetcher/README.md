# Fetcher Module

This module handles credential capture and conversation downloading from claude.ai.

## Quick Start

```bash
# Step 1: Capture credentials (opens browser for login)
claude-explorer capture

# Step 2: Download all conversations
claude-explorer fetch

# Step 3: Start the web viewer
claude-explorer serve
```

## Commands

### `capture` - Get Session Credentials

There are two methods to capture your session cookie:

#### Method A: Browser Login (Default)

Opens a Chromium browser where you log into Claude normally:

```bash
claude-explorer capture
```

Wait for the browser to open, log in to claude.ai, and credentials are automatically extracted.

**Options:**
- `--timeout N` — Max seconds to wait for login (default: 300)

#### Method B: Proxy Interception

Use this when you can't log into the web but Claude Desktop is still authenticated:

```bash
# Terminal 1 - Start the proxy
claude-explorer capture --proxy

# Terminal 2 - Launch Claude Desktop through the proxy
open -a "Claude" --args --proxy-server="127.0.0.1:8080" --ignore-certificate-errors
```

**Platform-specific launch commands:**

| Platform | Command |
|----------|---------|
| macOS | `open -a "Claude" --args --proxy-server="127.0.0.1:8080" --ignore-certificate-errors` |
| Windows | `"C:\Users\...\AppData\Local\Programs\Claude\Claude.exe" --proxy-server="127.0.0.1:8080" --ignore-certificate-errors` |
| Linux | `claude --proxy-server="127.0.0.1:8080" --ignore-certificate-errors` |

**Options:**
- `--port N` — Proxy port (default: 8080)

### `fetch` - Download Conversations

Downloads all conversations as JSON files:

```bash
claude-explorer fetch
```

**Options:**
- `--output-dir PATH` — Where to save JSON files (default: `~/.claude-explorer/conversations`)
- `--credentials PATH` — Path to credentials file (default: `~/.claude-explorer/credentials.json`)
- `--session-key TEXT` — Session key (overrides credentials file)
- `--org-id TEXT` — Org ID (overrides credentials file)
- `--incremental` / `--full-refresh` — Skip already-saved conversations (default: incremental)
- `--delay FLOAT` — Seconds between requests (default: 0.3)
- `--limit N` — Max conversations to fetch
- `--verbose` — Show detailed output

**Examples:**

```bash
# Fetch only new conversations (default)
claude-explorer fetch

# Re-download everything
claude-explorer fetch --full-refresh

# Fetch 10 conversations with verbose output
claude-explorer fetch --limit 10 --verbose

# Use custom credentials
claude-explorer fetch --session-key "sk-ant-..." --org-id "uuid-..."
```

### `serve` - Start Web Viewer

Starts the FastAPI backend to browse and export conversations:

```bash
claude-explorer serve
```

**Options:**
- `--host TEXT` — Host to bind (default: 127.0.0.1)
- `--port N` — Port to bind (default: 8000)
- `--reload` — Enable auto-reload for development

## Troubleshooting

### "Session key expired"

Session keys expire after some time. Re-run `capture` to get a fresh one.

### "Cloudflare challenge"

Some networks require solving a Cloudflare challenge. The browser capture method handles this automatically. For proxy capture, try switching networks or using the browser method.

### "Certificate errors"

The `--ignore-certificate-errors` flag is required when using the proxy method because mitmproxy generates its own certificates.

### mitmproxy won't start

mitmproxy requires a proper ANSI terminal. It won't work in:
- VS Code integrated terminal (sometimes)
- Non-interactive shells
- CI environments

Use Terminal.app, iTerm2, or another full-featured terminal.

## Files

| File | Description |
|------|-------------|
| `cli.py` | Click-based CLI entry point |
| `playwright_capture.py` | Browser-based credential capture |
| `mitmproxy_addon.py` | Proxy-based credential capture |
| `bulk_fetch.py` | Downloads conversations from API |
| `local_claude_code.py` | Reads local Claude Code JSONL files |

## Credentials Storage

Credentials are saved to `~/.claude-explorer/credentials.json`:

```json
{
  "session_key": "sk-ant-sid01-...",
  "org_id": "uuid-...",
  "cf_clearance": "..."
}
```

Conversations are saved to `~/.claude-explorer/conversations/` as individual JSON files named by UUID.
