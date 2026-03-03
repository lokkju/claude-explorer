# Claude Desktop Message Exporter — Project Plan

This is the **master plan document**. For component-level details, see:

| Document | Covers |
|----------|--------|
| [fetcher.md](./fetcher.md) | mitmproxy addon, bulk-fetch script, CLI interface, tests |
| [backend.md](./backend.md) | FastAPI endpoints, Pydantic models, search, export, tests |
| [frontend.md](./frontend.md) | React components, state management, styling, keyboard shortcuts, tests |

---

## Background & Findings

### The Problem
Claude Desktop (claude.ai) stores conversations **server-side only**. There is no meaningful local cache. Specifically:

- `~/Library/Application Support/Claude/IndexedDB/https_claude.ai_0.indexeddb.leveldb` — contains only **chat drafts** (unsent text in the input box), not conversation history
- `~/Library/Caches/com.anthropic.claudefordesktop/Cache.db` — contains only app update check URLs
- The official export (Settings → Privacy → Export Data) sends a download link to the account email — useless if you have lost access to that email

### The Solution We Found
Claude Desktop is an Electron app wrapping claude.ai. It does **not** do certificate pinning. We can:

1. Run **mitmproxy** as a local proxy
2. Launch Claude Desktop with `--proxy-server=127.0.0.1:8080 --ignore-certificate-errors`
3. Intercept API traffic to capture the **session cookie** (`sessionKey`)
4. Use the session cookie to **bulk-fetch all conversations** directly from the claude.ai API

### claude.ai API (Unofficial, Observed)
All endpoints are authenticated via `Cookie: sessionKey=sk-ant-sid01-...`

```
GET /api/organizations/{org_id}/chat_conversations?limit=30&starred=false&offset=0
  → Array of conversation summaries

GET /api/organizations/{org_id}/chat_conversations/count_all
  → { count: N }

GET /api/organizations/{org_id}/chat_conversations/{uuid}?tree=True&rendering_mode=messages&render_all_tools=true&consistency=strong
  → Full conversation with messages
```

### Conversation JSON Structure
```json
{
  "uuid": "...",
  "name": "Conversation title",
  "summary": "",
  "model": "claude-sonnet-4-6",
  "created_at": "2026-02-25T19:14:43Z",
  "updated_at": "2026-02-25T20:30:51Z",
  "is_starred": false,
  "is_temporary": false,
  "platform": "...",
  "current_leaf_message_uuid": "...",
  "chat_messages": [...]
}
```

### Message JSON Structure
```json
{
  "uuid": "...",
  "text": "message text (may be empty if content array is used)",
  "content": [...],
  "sender": "human" | "assistant",
  "index": 0,
  "created_at": "2026-02-25T19:14:43Z",
  "updated_at": "...",
  "truncated": false,
  "attachments": [],
  "files": [],
  "parent_message_uuid": "..."
}
```

Messages form a **tree**, not a flat list. `parent_message_uuid` links each message to its
parent, enabling conversation branching (when you edit a message and regenerate, a new branch
is created). `current_leaf_message_uuid` on the conversation points to the "active" branch tip.

### Content Blocks
The `content` array contains typed blocks:
- `{ "type": "text", "text": "..." }` — regular text
- `{ "type": "tool_use", "name": "...", "input": {...} }` — tool calls
- `{ "type": "tool_result", "content": [...] }` — tool results
- `{ "type": "image", ... }` — images

---

## Project Goals

1. **Fetch** — Capture all conversations from a claude.ai account via mitmproxy interception
2. **Visualize** — Consumer-grade web app to browse, search, and read conversations
3. **Export** — Convert conversations to Markdown or PDF
4. **Migrate** — (Best-effort) assist moving conversations to a new Claude account

---

## Architecture

```
claude-desktop-message-exporter/
├── README.md
├── PLANS/
│   ├── overview.md                  # This file (master plan)
│   ├── fetcher.md                   # Detailed plan for Phase 1
│   ├── backend.md                   # Detailed plan for Phase 2
│   └── frontend.md                  # Detailed plan for Phases 3-4
├── fetcher/
│   ├── README.md                    # Step-by-step fetch instructions
│   ├── mitmproxy-addon.py           # Captures session cookie + saves traffic
│   └── bulk-fetch.py                # Uses session key to download all conversations
├── backend/
│   ├── main.py                      # FastAPI app
│   ├── models.py                    # Pydantic models
│   ├── export.py                    # Markdown + PDF export
│   └── pyproject.toml
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── components/
│       │   ├── ConversationList.tsx
│       │   ├── ConversationView.tsx
│       │   ├── MessageBubble.tsx
│       │   ├── BranchTree.tsx
│       │   ├── SearchBar.tsx
│       │   └── ExportMenu.tsx
│       └── lib/
│           ├── api.ts
│           └── types.ts
└── scripts/
    └── dev.sh                       # Starts backend + frontend together
```

---

## Tech Stack

### Backend
- **FastAPI** + **uvicorn**
- **uv** for dependency management
- **weasyprint** for PDF export
- Serves conversation JSON from a configurable local directory

### Frontend
- **React 18** + **TypeScript**
- **Vite** — build tool
- **Tailwind CSS v4**
- **shadcn/ui** — component library (radix-ui based)
- **TanStack Query** — server state / caching
- **React Router v7**
- **react-markdown** + **rehype-highlight** — render Claude markdown
- **Lucide React** — icons
- **date-fns** — date formatting
- **cmdk** — command palette for search

### Fetcher
- **mitmproxy** (brew install mitmproxy)
- Pure Python stdlib for bulk fetch

---

## Feature Details

### Conversation List (Left Sidebar)
- Sorted by updated_at descending
- Shows: title, model, date, message count
- Starred conversations pinned to top
- Full-text search across titles and message content
- Filter by date range, model

### Conversation View (Main Panel)
- Follows active branch (current_leaf_message_uuid → walk parent chain to root)
- Human messages: right-aligned bubble
- Assistant messages: left-aligned, full markdown with syntax highlighting
- Tool use/results: collapsible, distinct style
- Branch indicator with switcher when alternates exist

### Branch Tree View
- Optional panel showing full message tree
- Highlights the active path

### Export
- **Markdown**: single .md file per conversation
- **PDF**: HTML → PDF via weasyprint
- **Bulk export**: all conversations as zip of .md files

### Import to New Account
- No official import API exists
- Best approach: archive viewer mode — browse old conversations alongside new account
- Stretch: probe mitmproxy output when creating a new conversation to find POST endpoint,
  investigate whether conversations can be created with historical timestamps

---

## Implementation Phases

### Phase 1 — Fetcher (Proof of Concept Done)

> **Detailed plan:** [fetcher.md](./fetcher.md)

- [x] mitmproxy addon proof of concept
- [x] Bulk fetch script proof of concept
- [x] Auto-extract session key from intercepted traffic
- [x] Handle starred conversations separately
- [x] Incremental fetch (skip already-downloaded)
- [ ] Write fetcher README with screenshots
- [ ] Tests: credential extraction, pagination, error handling

### Phase 2 — Backend

> **Detailed plan:** [backend.md](./backend.md)

- [ ] FastAPI app with configurable data directory
- [ ] Endpoints: list, get, search, export
- [ ] Pydantic models
- [ ] Message tree resolution (active branch extraction)
- [ ] Full-text search implementation
- [ ] Markdown export
- [ ] PDF export (weasyprint)
- [ ] Tests: store, search, export, routers

### Phase 3 — Frontend MVP

> **Detailed plan:** [frontend.md](./frontend.md) (Phases 3a–3c)

- [ ] Vite + React + TypeScript + Tailwind + shadcn/ui scaffold
- [ ] TanStack Query setup with API client
- [ ] Sidebar with ConversationList (virtualized)
- [ ] ConversationPage with MessageBubble components
- [ ] MarkdownRenderer with syntax highlighting
- [ ] Tool use/result blocks (collapsible)
- [ ] ExportMenu (Markdown download, copy to clipboard)

### Phase 4 — Polish

> **Detailed plan:** [frontend.md](./frontend.md) (Phases 4a–4c)

- [ ] BranchSwitcher in message list
- [ ] TreeViewPage with full branch visualization
- [ ] CommandPalette (cmdk) with keyboard shortcuts
- [ ] Dark mode with persistence
- [ ] Mobile-responsive layout
- [ ] PDF export integration
- [ ] Bulk zip export
- [ ] Error boundaries and toast notifications
- [ ] Component and integration tests (Vitest + RTL + MSW)

### Phase 5 — Docs & Release
- [ ] Main README with install instructions
- [ ] Fetcher README with screenshots
- [ ] GitHub release

---

## Key Open Questions

1. **Session key auto-extraction**: The mitmproxy addon can watch for `Cookie` headers
   containing `sessionKey=` and write it to a file — no manual copy-paste needed.

2. **cf_clearance necessity**: This Cloudflare cookie expires. Need to test whether
   bulk fetch works with just `sessionKey` from the same IP.

3. **Truncated messages**: API returns `truncated: true` for long messages.
   Need to investigate whether there is a per-message endpoint for full content.

4. **Rate limiting**: 0.3s sleep worked for 57 conversations. Keep conservative.

5. **Import**: No known write API. Worth probing mitmproxy traffic when creating
   a new conversation to understand the POST body format.
