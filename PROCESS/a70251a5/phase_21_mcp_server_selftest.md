# Phase 21 — mcp_server_selftest

- **Session:** `a70251a5-b932-4b61-aba1-16a70410b98e`
- **Positions:** `[4994..5005]`
- **Dates:** 2026-04-19 → 2026-04-19

## Goal
Dogfood the MCP server that was just designed, built, and wired into Claude Code's config at the end of Phase 20 — by firing a single "find all the sessions for this project" query from a fresh Claude Code session and confirming the `claude-sessions` MCP tools actually answer. This is the closing scene of the build arc: the server was installed manually at the end of the previous phase, the user `/exit`s that session, opens a new one, and asks the question that proves the whole meta-loop works.

## Opening prompt
> Find all the sessions for project claude-desktop-message-exporter

— pos=4997 `msg=e3690a05…` (2026-04-19)

## Key decisions
- End the Phase-20 build session cleanly with `/exit` before running the self-test, so the dogfood query runs in a completely fresh Claude Code context against the newly-registered MCP server. [pos=4994 `msg=3bfc5586…`, pos=4995 `msg=4c8a35ef…`]
- Self-test query is deliberately scoped to a single concrete ask ("sessions for *this* project") rather than a synthetic "hello world" — if it works, it also answers the real question that motivated the server. [pos=4997 `msg=e3690a05…`]
- Assistant routes the query through the MCP server by calling `mcp__claude-sessions__list_sessions` with `project="claude-desktop-message-exporter"` and `limit=100`, not a shell/glob fallback — confirming the tool is actually being invoked via MCP and not hand-rolled. [pos=5000 `msg=2bd50df9…`]
- Close the loop immediately on success with a second `/exit` — no follow-up queries, no stress tests. The one real query is the whole phase. [pos=5004 `msg=8de6678c…`, pos=5005 `msg=92683aab…`]

## Code outcome
- No code changes. This phase is pure runtime validation of the Phase-20 deliverable.
- MCP call path exercised end-to-end: Claude Code → `mcp__claude-sessions__list_sessions` → local SQLite/outline cache → structured response rendered as a markdown table. [pos=5000 `msg=2bd50df9…`, pos=5002 `msg=f8dd72c3…`]
- Result: **9 sessions** returned for `claude-desktop-message-exporter`, led by this session itself (`a70251a5…`, 5,202 messages, the main dev history), followed by one tiny untitled session from the same day and seven stray "Scan Gmail for meeting invites…" sessions from 2026-04-08 that got directory-associated by accident. [pos=5002 `msg=f8dd72c3…`]

## Missteps / reverts
- Nothing broke on first use. The tool answered on the first call with a well-formed result; no schema errors, no empty list, no auth/path issues despite the server having been manually wired into Claude Code's config only minutes earlier. [pos=5000 `msg=2bd50df9…`, pos=5002 `msg=f8dd72c3…`]
- One minor surprise surfaced in the data, not the tool: seven unrelated "Scan Gmail" sessions showed up grouped under this project's directory — a project-grouping / cwd-inference artifact in the underlying session store, not an MCP-server bug. Flagged in the response but not chased in this phase. [pos=5002 `msg=f8dd72c3…`]

## Memorable moments
- > Find all the sessions for project claude-desktop-message-exporter
  — pos=4997 `msg=e3690a05…` (sender: human) — the entire dogfood query, typed into a brand-new Claude Code session against the freshly-installed MCP server.
- > The MCP server is working. The first session (5,202 messages) is the main development history for this project.
  — pos=5002 `msg=f8dd72c3…` (sender: assistant) — the moment the build arc visibly pays off: the 5,202-message session that this very extraction pipeline reads from is now queryable from inside Claude Code.
- > The 7 "Scan Gmail" sessions from April 8 were apparently stray Gmail-related runs that got associated with this project directory.
  — pos=5002 `msg=f8dd72c3…` (sender: assistant) — first-day-of-dogfood surfacing a real data-quality finding about the session store itself.
- > Catch you later!
  — pos=5005 `msg=92683aab…` (local-command-stdout on `/exit`) — the literal last line of the 5,005-position session; the build-and-self-test arc ends with the user walking away from a working tool.

## Tone / mood
Low-key, matter-of-fact, and quietly triumphant. After the sprawling Phase-20 design/build session, the close is tiny: one `/exit`, one question, one correct answer, one `/exit`. No celebration, no victory lap — just the characteristic beat of "it works, moving on." The implicit hand-off is unmistakable though: the session that just proved the MCP server works *is itself the raw material* the server will now be used to mine for the Medium article series.

## Cross-refs
- Upstream: Phase 20 (`phase_20_mcp_server_design_and_build.md`) designed the 5-tool surface, built `mcp_server/`, and manually registered the server with Claude Code — this phase is the acceptance test of that deliverable. The `list_sessions` tool invoked here is exactly the one scoped in Phase 20's decisions.
- Downstream: closes the session at position 5005 and implicitly opens the Medium-article pipeline — every `phase_*.md` file in `PROCESS/a70251a5/`, including this one, is produced by feeding this same session back through the very MCP tools validated here (`list_sessions`, `get_session_outline`, `get_messages`). The self-test is the pivot from "build the tool" to "use the tool to write the article about building the tool."
