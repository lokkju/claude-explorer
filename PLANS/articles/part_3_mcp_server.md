<!--
  Medium series: Unlocking Your Claude History
  Part 3 of N — OUTLINE (not yet drafted)
  Locked: 2026-05-13 (MCP gets its own Part, confirmed)
  Voice: Raymond Peck's "Best Practices for Modern REST APIs in Python" series
-->

# Part 3 — Claude Querying Its Own History: The MCP Server

## Status

**OUTLINE ONLY**. Part 2 (web app + exports) is the V1 launch piece.
Part 3 (MCP server) ships after Part 2 lands and we have reader pull.

## What this Part is about

The Claude Explorer ships a **second** surface beyond the web UI: an
MCP (Model Context Protocol) server that lets Claude — or any
MCP-aware agent — query your conversation archive directly. Five tools
in `mcp_server/server.py` (`FastMCP`-based):

| Tool | What it does |
|---|---|
| `list_sessions` | Search + list conversation sessions (filter by source, project, date, text match) |
| `list_projects` | Distinct projects with session counts (Claude Code workspace bins) |
| `get_session_outline` | Lightweight per-message summaries (cached in SQLite) |
| `get_messages` | Full message content for a specified set of message UUIDs |
| `export_session` | Markdown export of a full or partial session |

The headline value prop: **you can ask Claude about Claude's own
history.** "When did I last discuss FTS5?" or "Summarize all the
times we touched the migration code in `backend/store.py`" or
"Export the conversation where I figured out the broken-image bug
and paste it into a follow-up PR description" — all natural-language
prompts that Claude answers by calling these tools, no manual sidebar
scrolling required.

## Article structure (proposed)

1. **Why an MCP server?** — Two-paragraph framing: the web UI is for
   humans; this is for the LLM that already lives on your machine.
   Same archive, different consumer.
2. **What MCP is** — One-paragraph primer for readers who haven't met
   it yet. Link to the official MCP spec + `FastMCP` library.
3. **Install + first run** — `claude-explorer mcp` (the CLI entry
   point) + a one-time `~/.claude/mcp_servers.json` config entry that
   points Claude Desktop / Claude Code at the local server. Show
   verifying the connection.
4. **Tool tour, one per subsection**:
   - `list_sessions` — the bread-and-butter; show a Claude prompt
     that uses it, and the resulting tool call.
   - `list_projects` — most useful for Claude Code users with many
     workspace bins.
   - `get_session_outline` — the "lightweight summary" trick; per-
     message TL;DRs cached in SQLite for token efficiency.
   - `get_messages` — full-fidelity content when summaries aren't
     enough.
   - `export_session` — the "and now I want it in my doc" finisher.
5. **A real workflow** — end-to-end example. Probably the user asking
   Claude something like *"find the conversation where I debugged
   the FTS5 index drift, summarize the resolution, and write a
   short retrospective I can paste into a doc"* and walking through
   the tool calls Claude makes.
6. **Token cost + caching architecture** — what's cached, why, and
   how the SQLite outline cache keeps `list_sessions` calls cheap even
   on large archives.
7. **Security considerations** — MCP server runs over stdio (Claude
   Desktop) or local TCP. No remote exposure. Reads only — no writes
   back to the archive.
8. **What it's NOT for** — proactive querying (the server instructions
   explicitly tell Claude *"never call these tools proactively or
   speculatively"*); workflow automation across sessions; long-term
   memory replacement.

## Source material

- `mcp_server/server.py` — 5 tools, FastMCP boilerplate, server
  instructions.
- `mcp_server/__init__.py` — module docstring covers the use cases
  succinctly.
- Tool implementations reuse `backend/search.py`,
  `backend/store.py`, `backend/export.py` — natural cross-references
  back to Part 2.
- SQLite outline cache schema in `mcp_server/server.py` (search for
  `CREATE TABLE outlines`).

## Voice + length

Same voice as Part 1 + Part 2 (technical, opinionated, specific). Aim
for the same length budget (~5000-7000 words). Lead with the *"Claude
querying Claude"* hook because it's the load-bearing reason a reader
keeps scrolling.

## Screenshots to capture (deferred to drafting)

1. Claude Desktop side panel showing the configured MCP server as
   connected.
2. A Claude conversation in-progress where Claude has just called
   `list_sessions` and the tool result is visible inline.
3. The SQLite outline-cache file in a hex/text viewer showing what
   gets stored (token-budget transparency).
4. End-to-end example transcript: the prompt that triggered tool
   calls, the calls themselves, the synthesized answer.

## Out of scope for Part 3

- Building your own MCP server (that's a separate tutorial).
- Comparison vs other Claude-history tools (defer to a separate
  Part if useful).
- Multi-user / hosted MCP (this server is single-user, local-only
  by design).

## Cross-references

- **From Part 2**: one-line forward reference in the closing section.
- **From Part 1**: forward reference in the "five reasons" list — add
  *"and you can let Claude itself query the archive via MCP"* as a
  sixth reason once Part 3 is drafted.
