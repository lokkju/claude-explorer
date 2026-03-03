# Claude Desktop Message Exporter

A tool to extract, browse, search, and export your Claude conversation history — even if you've lost access to the email address on your account.

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

Claude Desktop does **not** do SSL certificate pinning. That means we can:

1. Run **mitmproxy** as a local proxy on port 8080
2. Launch Claude Desktop through the proxy with `--proxy-server=127.0.0.1:8080 --ignore-certificate-errors`
3. Watch the intercepted traffic to capture the **session cookie** (`sessionKey`)
4. Use that session cookie to **bulk-fetch all conversations** directly from the claude.ai API

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
├── PLANS/
│   ├── overview.md          # Project goals and architecture
│   ├── fetcher.md           # Fetcher design and test plan
│   └── backend.md           # Backend API design and test plan
├── fetcher/
│   ├── README.md            # Step-by-step instructions with screenshots
│   ├── mitmproxy-addon.py   # Intercepts traffic, captures session cookie
│   └── bulk-fetch.py        # Downloads all conversations to local JSON
├── backend/
│   ├── main.py              # FastAPI app
│   ├── models.py            # Pydantic models
│   ├── store.py             # Reads and indexes JSON files from disk
│   ├── search.py            # Full-text search
│   ├── export.py            # Markdown + PDF export
│   └── routers/             # conversations, search, export endpoints
├── frontend/
│   └── src/                 # React 18 + TypeScript + Tailwind + shadcn/ui
└── scripts/
    └── dev.sh               # Starts backend + frontend together
```

---

## Quick Start

### Prerequisites

```bash
brew install mitmproxy
pip install uv
```

### Step 1: Capture Your Session Cookie

```bash
# Terminal 1 — start the proxy
mitmproxy -s fetcher/mitmproxy-addon.py --listen-port 8080

# Terminal 2 — launch Claude Desktop through the proxy
open -a "Claude" --args --proxy-server="127.0.0.1:8080" --ignore-certificate-errors
```

Click around in Claude Desktop for a few seconds. The addon will print:

```
✅ Credentials captured! You can now quit mitmproxy (q) and close Claude Desktop.
   Run: python fetcher/bulk-fetch.py
```

Credentials are saved to `~/.claude-exporter/credentials.json`.

### Step 2: Download Your Conversations

```bash
python fetcher/bulk-fetch.py
```

This downloads all your conversations as JSON files to `~/.claude-exporter/conversations/`. A rate-limited 0.3s delay between requests keeps things polite. Incremental mode (default) skips conversations you've already downloaded.

### Step 3: Browse and Export

```bash
bash scripts/dev.sh
```

Opens the web app at `http://localhost:5173`.

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
| Fetcher | mitmproxy, Python stdlib |
| Backend | FastAPI, uvicorn, uv, weasyprint |
| Frontend | React 18, TypeScript, Vite, Tailwind CSS v4, shadcn/ui, TanStack Query |
| Search | In-process full-text search over loaded JSON |
| Export | Markdown (built-in), PDF (weasyprint) |

---

## License

MIT
