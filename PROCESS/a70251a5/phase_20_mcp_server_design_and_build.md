# Phase 20 — mcp_server_design_and_build

- **Session:** `a70251a5-b932-4b61-aba1-16a70410b98e`
- **Positions:** `[4843..4993]`
- **Dates:** 2026-04-19 → 2026-04-19

## Goal
Design and ship an MCP server (`mcp_server/`) that lets Claude Code and Claude Desktop query this project's saved sessions — so Claude can read past conversations bit-by-bit to find mistakes it made (to improve agent prompts / `CLAUDE.md`) and to "write a comprehensive blog post about the work" — while being ruthless about not burning client-LLM tokens unless the user explicitly asks for it. This phase is the meta keystone that feeds the Medium-series extraction pipeline itself.

## Opening prompt
> Let's think about another feature I'd like to add: I want to build an MCP server into this project, so that Claude Code and Claude Desktop can query our saved sessions. An example use case would be to read through an entire session bit by bit… and find mistakes that Claude Code made that we had to correct through followon prompts… Another use case would be to read through the session(s) for a project and write a comprehensive blog post about the work that went into it. We might use this session's project as a test case for this.

— pos=4844 `msg=ff2ee72e…` (2026-04-19), invoked via `/coding` to route to the `llm-council-coding` subagent.

## Key decisions
- Invoke `/coding` / `llm-council-coding` for the design pass rather than designing the tool surface solo — treat tool-description wording as a first-class design problem. [pos=4844 `msg=ff2ee72e…`]
- Scope the tool surface to **5 tools**: `list_sessions`, `list_projects`, `get_session_outline`, `get_messages`, `export_session` — outline-first, messages-on-demand, so clients can page through long sessions without loading everything. [pos=4844 `msg=ff2ee72e…`, pos=4949 `msg=41b1fe2b…`]
- Support full message bodies including tool calls / tool results, but gate them behind explicit flags on `get_messages` — not the default — so clients don't auto-blow context. [pos=4852 `msg=9bd17125…`]
- Outline summaries are **append-only cacheable**: since Claude Code / Claude Desktop session files only ever grow, summaries keyed by message UUID can be persisted (SQLite) and reused across queries. [pos=4852 `msg=9bd17125…`]
- SQLite cache lives under the existing cross-platform data dir (`~/.claude-exporter/`) so Windows/Linux users work without code changes; any pre-existing DB gets moved with a backup, not clobbered. [pos=4852 `msg=9bd17125…`]
- **Token-cost hard rule (durable MCP lesson):** rewrite every tool description and the server-level instructions with explicit "only call when the user explicitly asks…" language, so clients don't speculatively fan out across saved sessions. [pos=4918 `msg=2b09a3a9…`, pos=4919 `msg=5c7d4387…`]
- Measure the fixed context cost of having the server attached: **~4,681 chars / ~1,200–1,600 tokens** across the 5 tool definitions — the price paid per conversation even if no tool is ever called. [pos=4948 `msg=389485b9…`, pos=4949 `msg=41b1fe2b…`]
- Distribution: run via `uv run --directory <repo> python -m mcp_server.server`, not `uvx` — `uvx` is for published PyPI packages; this is a local project. Same config block works for both Claude Code and Claude Desktop. [pos=4936 `msg=8dcc22ba…`, pos=4937 `msg=c2fd60ad…`]
- Claude Code config location correction: MCP servers belong in `~/.claude.json` (root level) or a project-level `.mcp.json` — **not** `settings.json`. [pos=4954 `msg=4e07299c…`, pos=4955 `msg=28eda37a…`]

## Code outcome
- New module `mcp_server/` with `server.py` (~21 KB) implementing the 5 tools, with "only when explicitly asked" hardening baked into every tool description and the server-level instructions.
- Per-message-UUID outline summaries cached in SQLite under `~/.claude-exporter/` (append-only — safe because upstream session logs are append-only).
- Documented config blocks for both clients using `uv run --directory` so contributors on macOS / Windows / Linux get identical setup.
- Measured tool-definition cost: `list_sessions` 1,054 ch · `list_projects` 657 ch · `get_session_outline` 695 ch · `get_messages` 1,317 ch · `export_session` 958 ch → **4,681 ch total**. [pos=4949 `msg=41b1fe2b…`]

## Missteps / reverts
- User initially assumed `uvx` was the right runner; corrected to `uv run --directory` because the server is a local (unpublished) package. [pos=4936 `msg=8dcc22ba…`, pos=4937 `msg=c2fd60ad…`]
- User registered the server in Claude Code's `settings.json` and then noticed it wasn't showing up in `/mcp list`; fix was to move it into `~/.claude.json` (root-level `mcpServers`) or `.mcp.json`. [pos=4954 `msg=4e07299c…`, pos=4955 `msg=28eda37a…`]
- First pass of tool descriptions was too eager — clients would plausibly call them on any "past conversation" intent. Rewritten after pos=4918 to require explicit user request. [pos=4918 `msg=2b09a3a9…`]

## Memorable moments
- > write a comprehensive blog post about the work that went into it. We might use this session's project as a test case for this.
  — pos=4844 `msg=ff2ee72e…` (sender: human) — the self-referential beat: this MCP server is what the Medium-series extraction pipeline runs on top of.
- > Can we make the descriptions such that the client LLM should only call these when explicitly asked? I'm worried that Claude Code and Claude Desktop could burn through a zillion tokens using these, when it's not called for explicitly.
  — pos=4918 `msg=2b09a3a9…` (sender: human)
- > That's what I measured — the tool definitions that get injected into context are **~4,700 chars / ~1,200-1,600 tokens** total across all 5 tools… That's the fixed cost per conversation just for having the MCP server configured, regardless of whether the tools are ever called.
  — pos=4949 `msg=41b1fe2b…` (sender: assistant)
- > `uvx` is for published PyPI packages — since this is a local project, you'll use `uv run --directory`.
  — pos=4937 `msg=c2fd60ad…` (sender: assistant)
- > MCP servers in Claude Code don't go in `settings.json` — they go in `~/.claude.json` (at the root level) or a project-level `.mcp.json`.
  — pos=4955 `msg=28eda37a…` (sender: assistant)

## Tone / mood
Design-first and token-paranoid. The user treats prompt wording (tool descriptions) as a real engineering artifact, not boilerplate — and demands a measured answer ("how many tokens for the definitions") before accepting the server is shippable. Slight frustration at the `settings.json` vs `~/.claude.json` trap, resolved quickly.

## Cross-refs
- Upstream: builds directly on the saved-conversation store established in Phase 04 (fetcher) and the session model used throughout the backend / viewer phases — the MCP server is a read-only facade over that store.
- Downstream: this server **is** the substrate for the Medium-article pipeline (`PLANS/medium-article.md` + `PROCESS/a70251a5/phase_*.md`), which uses `get_session_outline` + `get_messages` exactly as designed here; the "only when asked" description rule becomes a portable MCP design lesson for future servers in this repo.
