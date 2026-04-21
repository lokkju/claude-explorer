# Build Map (by Arc)

*This file replaces an earlier date-ordered timeline.* What got built, organized by area rather than by calendar, because the work happened in side-project bursts and the calendar isn't the interesting part. Some arcs overlapped or restarted; the structure below reflects how the work actually shaped itself, not strict chronology. No dates, no durations — the arcs run roughly in the order they opened, but most stayed open and got revisited.

*(Filename kept as `92_timeline.md` for pipeline compatibility; heading updated to match contents.)*

## 1. Project kickoff & durable conventions

The project opens with the user reading the existing `README.md` and assembling three partial plan docs (`fetcher.md`, `backend.md`) into a coherent set, generating the missing `frontend.md` via an LLM Council pass, and landing the first durable rule on the very first commit: **never include self-credit in commit messages**. That rule gets re-asserted later and eventually propagates into `~/.claude/CLAUDE.md` and every `llm-council-*.md` agent file. The `uv`-for-the-venv convention and the "track dependencies in both `package.json` and `pyproject.toml`" rule get baked in early enough to shape every subsequent phase.

Dev-environment discipline shows up as its own rule set: port-scoped `lsof -ti:PORT | xargs kill` is allowed; broad `pkill uvicorn` is not, because the user works on multiple Uvicorn-backed projects and a broad kill's blast radius costs other work.

**Phases in this arc:** 01 (intent and planning), 17 (dev-env noise, pkill permissions).
**Commit:** `8af8187` — Initial commit: project plans and documentation.
**Anchors:** [a70251a5#pos=35 msg=eeebeb16…], [a70251a5#pos=958 msg=237d6350…], [a70251a5#pos=4308 msg=1854813a…]

## 2. Capture: pulling your sessions out

Two credential-capture paths land side-by-side, covering disjoint failure modes.

**mitmproxy comes first.** Launch Claude Desktop through a local HTTPS proxy with `--ignore-certificate-errors`, extract `sessionKey` and `org_id` from API requests, write them to `~/.claude-exporter/credentials.json`. The bulk fetcher walks the `chat_conversations` list endpoint, writes JSON files per conversation into `~/.claude-exporter/conversations/`, and extends to download attachment bytes — images, canvas/artifact text, and PDFs — once a user-spot-checked PDF reveals that `files_v2` has a nested-asset shape (`document_asset.url` / `thumbnail_asset.url`) that differs from the flat top-level `files` shape.

**Playwright-based web login lands as an alternative credential path.** The user explicitly vetoes any "replace mitmproxy" plan: *"this was a lifesaver and I don't want to lose it."* The two paths cover different cases — mitmproxy is the only option when you've lost email access but are still logged into Claude Desktop; Playwright is simpler when you can still log in normally.

**Credential rotation** hits once as an `HTTP 403` on return to the project, correctly diagnosed as an expired session key rather than a code bug. The recovery flow is just: re-run `claude-exporter capture`. The fetcher URL also picks up `render_all_tools=true` so tool-call content actually survives the capture.

**Phases in this arc:** 04 (fetcher + mitmproxy), 05 (attachments), 09 (403 + rebrand), 13 (Playwright alt credential).
**Anchors:** [a70251a5#pos=336 msg=982a2bf2…], [a70251a5#pos=680 msg=895d7bb9…], [a70251a5#pos=2391 msg=7d317c0f…]

## 3. Backend: unified store, search, performance

The FastAPI backend starts as a thin JSON reader against the `conversations/` directory. Layout: `backend/{main,config,models,store,search,export}.py` plus `backend/routers/{conversations,search,export,config}.py`.

The major shift: stop importing Claude Code sessions into `conversations/` and instead read them **live** from `~/.claude/projects/**/*.jsonl` at request time, unified behind a `source` discriminator. The user flags the original import plan as a poor design choice — single source of truth matters — and this reshapes the whole backend around live reads with a shared filter layer. An independent count reveals **258** Claude Code sessions where the initial naive listing showed 35; the other 223 are agent sub-conversations that surface as nested-under-parent in the sidebar.

A three-pronged perf pass kicks in after the first grumble: orjson for JSON parsing, mtime-keyed `FileCache`, `ThreadPoolExecutor` for parallel reads. Listing time drops from 4+ seconds to ~70 ms; warm-cache search at ~48 ms. The JSONL parser is rewritten with `_get_message_key()` and `_merge_entries_to_message()` to fold streaming chunks into whole messages. The user explicitly refuses to reach for SQLite prematurely: *"Hold off on this until we see how slow it is."*

**Phases in this arc:** 03 (backend scaffold), 10 (Claude Code unification), 11 (perf caching).
**Anchors:** [a70251a5#pos=1574 msg=9c6d74a8…], [a70251a5#pos=1700 msg=bd51590b…], [a70251a5#pos=2075 msg=2ae07954…]

## 4. Frontend: browse, read, polish

The React 18 + Tailwind v4 + Vite + shadcn/ui frontend lands against mock data first, then pairs with the backend as endpoints come online. Vitest + React Testing Library + MSW ship the unit/integration layer; Playwright handles E2E. A CMD-K command palette is born from a test gap — the backend's full-text search endpoint exists but isn't wired into the UI — and the fix adds Cmd+K that hits the real search endpoint.

Tool-call rendering fights a two-layer bug: dark-on-dark `.prose pre` CSS plus Claude Desktop exports that strip real tool I/O and leave a placeholder string. The fix is Option 1 — detect the placeholder, render an info box, and ship a `showToolCalls` toggle via `SettingsContext`. Branch *visualization* lands, but the full branch *switcher* is gated on real branched conversations existing — 0 out of 68 do, so it parks. The "Open in Claude Desktop" deep link gets built, tested, and ripped out once it turns out to just launch the app without deep-linking to the conversation.

The `Claude Exporter` → `Claude Explorer` rename happens in this arc (the fetcher keeps the "exporter" name because it actually exports). A refresh button lands in the UI. Caveat-stub conversations — the ones Claude Code generates as shell-command artifacts — get filtered out with a toggle. Synthesized titles for `<local-command-caveat>` / `<command-name>` XML sessions replace raw XML in both the sidebar and detail view. Project grouping in the sidebar groups Claude Code sessions by the git-repo-or-directory they ran in, with four sort fields and natural defaults (descending for dates, ascending for title/project).

The connection-status popup lands for backend-unreachable scenarios — React Query retries retuned to 5 attempts with 1s→10s exponential backoff, a modal dialog with retry progress and a reconnect button. Its first ship flashes the dialog on successful first load; the fix is to only increment `retryCount` after an actual failure.

The v2 UI pass bundles seven items into one `/coding` work order: settings page at `/settings` (Appearance / Keyboard / Data / About), Emacs-default + Vim-opt-in keyboard bindings via `KeyboardNavigationContext`, toast notifications (more on these below), fleshed-out tests at every layer, docs refresh (`README.md` + new `CHANGELOG.md` + new `fetcher/README.md`), and dark mode with **system** as the default via a three-valued theme state (`light` / `dark` / `system`) and a `matchMedia` listener. Backend test suite rounds out with `test_config.py`, `test_conversations.py`, `test_search.py`, `test_export.py`.

**Note on toast notifications:** `sonner ^2.0.7` is installed and `<Toaster position="bottom-right" />` mounts in `App.tsx`, but a repo grep finds zero `toast.*` call sites — the infrastructure landed, no features ever fire a toast. Flagged as follow-up in `PLANS/overview.md` (Known Gaps); retained in the Part-5 retrospective as a "half-shipped feature" beat.

**Phases in this arc:** 03 (initial UI scaffold), 06 (Playwright E2E harness), 07 (viewer + tool-call rendering), 08 (tool-call parser + deep-link ripout), 12 (Caveat filter + Explorer rename), 14 (project grouping + sidebar), 15 (Caveat titles cleanup), 16 (connection popup), 18 (v2 UI pass).
**Commits:** `c94ce6f` (render_all_tools), `1915616` (project display + sort + group), `022c723` (natural sort defaults + path display), `f05d6eb` (skip system messages in title extraction), `7a59616` (phantom-session detection for Caveat-prefixed conversations).
**Anchors:** [a70251a5#pos=1391 msg=02ad1e52…], [a70251a5#pos=1398 msg=55d11b76…], [a70251a5#pos=2257 msg=06d561c9…], [a70251a5#pos=3055 msg=934d36b2…], [a70251a5#pos=3333 msg=584faf50…]

## 5. The keyboard / search navigation arc

This arc earns its own section because it's the project's clearest *ship → use → fix* loop, and the single biggest feature by positions written.

**Era 1 — First version.** An LLM Council pass designs the focus control across the sidebar and detail panes: Enter descends into detail, Esc pops back (the Vim Mode column pattern borrowed into Emacs mode too); `u`/`a` for next user / assistant messages, `U`/`A` for previous; Vim `j`/`k` and Emacs `^N`/`^P`; CMD-R bound to the refresh button. Ships as **commit `aa6e781 Add two-pane keyboard navigation with Vim/Emacs modes`**.

**Era 2 — Hands-on use reveals the gaps.** No spec could have predicted what real use surfaces: Esc from the detail pane leaves the sidebar with no visible selection; tool-call bubbles render even when the toggle is off; Emacs bindings regress in the message pane; PDF/Markdown exports contain blank frames where tool-call renders used to be; `^N`/`^P` work in the messages panel but not the sidebar. The user then specs the formal focus invariant: *"exactly one of {sidebar, detail} has focus; Enter descends, Esc pops."*

**Era 3 — Iteration and perf.** Sidebar `^N`/`^P` symmetry; click-to-focus on any sidebar row or message-pane background; decoupling sidebar navigation from detail loading (a "Hit Enter to select" hint replaces auto-load); CMD-C / CMD-F / CMD-G / CMD-Shift-G search-and-copy spec; match-N-of-M overlay. Ships as **commit `826e794 Improve keyboard navigation, search, and export`**. A final pass targets CMD-G latency — *"super slow, and there's no indication to the user that it's 'thinking'"* — with an in-conversation fast path and a background prefetch task for the ±2 adjacent match conversations. Ships as **commit `85a07b1 Optimize Cmd+G search navigation with prefetch and fast path`**.

**Phase:** 19 (merged from original 19–23; the quiet stretches between sub-phases were user-was-busy on other work, not separate topics).
**Anchors:** [a70251a5#pos=3960 msg=f32f630d…], [a70251a5#pos=4326 msg=49d158c4…], [a70251a5#pos=4580 msg=450b72ef…], [a70251a5#pos=4796 msg=9671cb18…], [a70251a5#pos=4831 msg=015920bd…]

## 6. The MCP server

The keystone piece — designed and shipped last, despite being the most leveraged use of the resulting archive. An LLM Council review (covered in a separate future article; see the forward-reference note in `PROCESS/90_themes.md`) reshapes the tool surface to **five tools** — `list_sessions`, `list_projects`, `get_session_outline`, `get_messages`, `export_session` — with hybrid position+UUID addressing, outline-first / messages-on-demand, and session-mtime cache invalidation. Outline summaries are cached append-only in SQLite under `~/.claude-exporter/`.

Tool descriptions get rewritten with explicit *"only call when the user explicitly asks…"* hardening to stop the client LLM from burning tokens on speculative calls. Measured fixed context cost: **~4,681 chars / ~1,200–1,600 tokens** across all 5 tool definitions, per conversation, regardless of whether the tools ever get called.

Distribution gotchas land as small but important corrections: `uv run --directory` (not `uvx`, because this is a local package rather than one published to PyPI); config goes in `~/.claude.json` or `.mcp.json` (not `settings.json`).

The self-test that closes the whole build is a single query from a fresh Claude Code session: *"Find all the sessions for project claude-desktop-message-exporter."* It returns 9 sessions; the main one — the session that just finished being built — leads the result. **This is also the query that seeds the Medium-series extraction pipeline** (covered separately in `PROCESS/76fe578b/summary.md`). The last line of the build session is the terminal's *"Catch you later!"* on `/exit`.

**Phases in this arc:** 20 (design + build), 21 (self-test).
**Anchors:** [a70251a5#pos=4844 msg=ff2ee72e…], [a70251a5#pos=4918 msg=2b09a3a9…], [a70251a5#pos=4949 msg=41b1fe2b…], [a70251a5#pos=4997 msg=e3690a05…], [a70251a5#pos=5005 msg=92683aab…]

## Commit anchors (arc-ordered)

- `8af8187` — Initial commit: project plans and documentation — *Arc 1*
- `c94ce6f` — fix missing tool calls (`render_all_tools=true`) — *Arc 4*
- `1915616` — project display, sorting, grouping — *Arc 4*
- `022c723` — natural sort defaults + file-path display — *Arc 4*
- `f05d6eb` — skip system messages when extracting conversation title — *Arc 4*
- `7a59616` — fix phantom session detection for Caveat-prefixed conversations — *Arc 4*
- `aa6e781` — Add two-pane keyboard navigation with Vim/Emacs modes — *Arc 5, Era 1*
- `826e794` — Improve keyboard navigation, search, and export — *Arc 5, Era 3*
- `85a07b1` — Optimize Cmd+G search navigation with prefetch and fast path — *Arc 5, Era 3 finale*
