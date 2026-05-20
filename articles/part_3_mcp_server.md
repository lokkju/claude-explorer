<!--
  Medium series: Unlocking Your Claude History
  Part 3 of 5 — Draft (Council synthesis: Gemini 3 Pro + GPT-5.2 drafters via OpenRouter, Opus synthesis)
  Sources: Part 1 + Part 2 tone threading, PROCESS/99_voice_cheatsheet.md, mcp_server/SPEC.md (ground truth)
  Voice: Raymond Peck's "Best Practices for Modern REST APIs in Python" series
-->

# Part 3 — Claude Querying Its Own History: The MCP Server

***In this part of the series, we'll set up the built-in Model Context Protocol (MCP) server and walk through the five tools that let a fresh Claude session search, browse, outline, read, and export your saved Claude history programmatically.***

> **Disclaimer**: This is an independent, community-built project. It is not affiliated with, endorsed by, sponsored by, or supported by Anthropic, PBC. "Claude" and "Claude Code" are trademarks of Anthropic, PBC. This project consumes Anthropic's products as a user would, via the same APIs and on-disk file formats the official clients use, but nothing here represents an Anthropic-sanctioned interface, and the formats this project depends on may change without notice.

In the previous installation of this series, we covered the web app: how it unifies Claude Desktop conversations (fetched down to disk) and Claude Code sessions (read live from `~/.claude/projects/`), plus search, keyboard navigation, and exports. If you missed that, make sure to go back and read [Part 1](https://medium.com/@raymondpeck/unlocking-your-claude-history-part-1-f19000c05655) and [Part 2](https://medium.com/@raymondpeck/part-2-using-the-web-app) first; Part 3 assumes you already have a mental model of the on-disk corpus, because the MCP server is simply another way to read it.

## Why an MCP Server?

The web UI is how *we* read: scan a sidebar, run a full-text query, hop between matches, export a session, move on. That's a human workflow, and it's right for the kinds of questions humans ask when we're willing to put our eyeballs on the page.

The MCP server exists for the other workflow, the one that becomes obvious the first time you've got a few hundred sessions and a question that sounds like: *"Find the three conversations where we discussed X, extract the decisions, and quote the relevant turns."* That is still a human goal, but it's a machine's *execution plan*, and once you have a local corpus, it is deeply satisfying to let another Claude session do the rummaging for you.

Put differently: the UI is how you browse your archive; the MCP server is how Claude browses your archive. Same underlying files, same definitions of "session" and "project", same exports; different consumer.

## What MCP Is (One Paragraph, Promise)

**Model Context Protocol (MCP)** is a standard for letting an LLM client (Claude Desktop, Claude Code, and other MCP-aware clients) call tools exposed by a local or remote server, with structured arguments and structured results. If you want the canonical reference, the spec lives at <https://modelcontextprotocol.io/>. In this project we implement the server side using [FastMCP](https://github.com/jlowin/fastmcp), which handles JSON-RPC over stdio, tool registration, and schema generation from Python type hints, so our job stays focused on the interesting part: translating "search my history" into a safe, explicit, token-efficient query interface. I love it when a library just gets out of your way and lets you focus on the business logic!

## Install and First Run

There are two practical ways you'll run this server: from the released tool (the same way you run the rest of `claude-explorer`), or from a local clone (which is what you'll do if you're hacking on it). Either way, the MCP server is launched as a subprocess by your MCP client and spoken to over stdio. No ports, no listeners, no "is my firewall open" debugging, which is exactly how I want local developer tooling to behave.

### Start the server by hand (sanity check)

You typically won't "start" the server yourself because Claude (or your MCP client) spawns it, but it's useful to know the entry points:

```bash
# If you installed the tool (for example via uvx), you can run:
uvx claude-explorer mcp

# If you have a local clone, run it from that directory:
uv run --directory /absolute/path/to/claude-explorer claude-explorer mcp

# And if you're in Python-module land:
python -m mcp_server.server
```

When the client launches it, the process speaks JSON-RPC on stdin/stdout. If you run it directly, you'll mostly see "waiting for handshake" behavior, which is fine; the important part is that it starts without crashing.

![[Pasted image 20260514010722.png]]

### Configure Claude Code

Claude Code supports MCP servers in either user scope (`~/.claude.json`) or project scope (`.mcp.json` in a repo). I like user scope when I want the tool everywhere, and project scope when I'm working in a codebase with stricter boundary rules.

There's also a CLI helper that writes the config for you, which is the path I use because I'm lazy, and as I often say, laziness is the mother of invention!

```bash
# Add a server named "claude-sessions" using Claude Code's helper.
# Note the "--" separator, it tells Claude "everything after this is the command to run".
claude mcp add claude-sessions -- \
  uv run --directory /absolute/path/to/claude-explorer claude-explorer mcp
```

If you prefer to edit JSON yourself, here is the user-scope config in `~/.claude.json`. This is a common newcomer trap, so I'll say it plainly: **MCP servers do not live in `~/.claude/settings.json`**.

```json
{
  "mcpServers": {
    "claude-sessions": {
      "command": "uv",
      "args": ["run", "--directory", "/absolute/path/to/claude-explorer", "claude-explorer", "mcp"]
    }
  }
}
```

For project scope, drop the same `mcpServers` block into `.mcp.json` at the repo root. I often keep this one committed for team projects, but only when everyone on the team agrees about the data boundary, because attaching a history-reading tool to a work repo has real policy implications.

### Verify in Claude Code

Once added, verify it from the CLI:

```bash
claude mcp list
```

You should see your server name (`claude-sessions`) and, once you start a session, the tools should be available. The MCP server advertises itself as `Claude Session Explorer`, and the tool list is the same five we'll tour below:

```text
Tools
• list_sessions       (claude-sessions) - Search and list saved Claude conversation sessions.
• list_projects       (claude-sessions) - List distinct projects that have saved conversation sessions.
• get_session_outline (claude-sessions) - Get lightweight per-message summaries for a session.
• get_messages        (claude-sessions) - Get full message content for specific messages.
• export_session      (claude-sessions) - Export a session (or portion) as Markdown text.
```

![[Pasted image 20260514011205.png]]

### Configure Claude Desktop (macOS, Windows, Linux)

Claude Desktop reads its MCP config from a `claude_desktop_config.json` file, and the path varies by OS:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json` (typically `C:\Users\<you>\AppData\Roaming\Claude\claude_desktop_config.json`)
- Linux: `~/.config/Claude/claude_desktop_config.json`

The JSON block is the same shape as Claude Code. Add it under `mcpServers`, then fully quit and relaunch Claude Desktop (it reads the config at startup, so a "close window" does not always cut it).

```json
{
  "mcpServers": {
    "claude-sessions": {
      "command": "uv",
      "args": ["run", "--directory", "/absolute/path/to/claude-explorer", "claude-explorer", "mcp"]
    }
  }
}
```

If you installed `claude-explorer` as a tool and want to use `uvx`, you can; the important part is that the command you configure must be something Claude Desktop can run as a subprocess. I tend to stick to `uv run --directory` for the local-clone case because `mcp_server/` ships inside the project as a co-located module.

Once it's configured, Claude Desktop should expose the tools in its MCP tooling UI for the conversation. I'm intentionally not being prescriptive about where every toggle lives in Desktop, because that UI moves; the invariant is that after relaunch, you can start a new chat and see the five tools available from the attached server.

![[Pasted image 20260514012144.png]]

### A note about "explicit-only"

Before we get into the fun part, there's a design decision baked into the server that matters operationally. The server-level instructions passed at handshake are:

```text
These tools query saved Claude conversation history. ONLY use them when the
user EXPLICITLY asks to search, browse, analyze, or export past conversation
sessions. Never call these tools proactively or speculatively.
```

That is not decoration. Attaching an MCP server has a fixed context cost (we'll quantify it later), and it also creates the temptation for an LLM client to "helpfully" call tools in the background. The instruction is a guardrail, and it's written in the bluntest language I could justify.

## The Five Tools (Tour)

The server exposes five tools, all read-only, all operating on the same on-disk corpus the UI reads. We'll walk them in the order you'll use them in practice: `list_sessions`, `list_projects`, `get_session_outline`, `get_messages`, and finally `export_session`. As we go, I'll show the user-facing prompt you might type, then a sketch of the tool call Claude would make. The exact tool-call envelope differs by client, so I'm going to focus on the part that matters: the arguments and the returned shape.

### `list_sessions`

`list_sessions` is the bread-and-butter entry point. It either lists everything, or it runs a full-text search across session titles and message content and returns the matching sessions.

A prompt I regularly use looks like this:

> *"Search my saved sessions for 'FTS5', show me the most relevant ones, and tell me which source they came from."*

Conceptually, that becomes:

```json
{
  "tool": "list_sessions",
  "arguments": {
    "query": "FTS5",
    "source": null,
    "project": null,
    "limit": 20,
    "offset": 0
  }
}
```

The returned payload includes a `sessions` list plus a `total` count (the total matches *before* paging), and when you provided a `query`, each session row includes a `match_count` indicating how many messages matched in that session.

A representative result looks like:

```json
{
  "sessions": [
    {
      "uuid": "8f2c3c1e-....",
      "name": "Investigate slow search and indexing options",
      "source": "CLAUDE_CODE",
      "project": "claude-explorer",
      "message_count": 214,
      "human_message_count": 71,
      "model": "claude-sonnet-4-6",
      "created_at": "2026-05-10T14:22:18Z",
      "updated_at": "2026-05-10T18:07:55Z",
      "match_count": 9
    }
  ],
  "total": 6
}
```

A few details here are intentionally pragmatic:

- `source` filters accept only `"CLAUDE_AI"` and `"CLAUDE_CODE"`; any other value silently falls back to "all". That makes it tolerant of client-side typos, but it also means you should not assume a bad filter will fail loudly.
- `project` filtering is a case-insensitive substring match against the stored `project_name`, and it's applied *after* the list or search step. That keeps the tool implementation simple and predictable, and since project filtering is usually a coarse narrowing, the post-filter cost is fine.
- `limit` is clamped to `[1, 100]`, which keeps a single tool call from returning an absurd payload and burning context for no reason.

If you're thinking "this sounds like the REST endpoint the UI uses", you're exactly right; the MCP server is a facade over the same `backend.store` and `backend.search` logic. I wanted one definition of "search", because the alternative is the kind of subtle drift you only notice after you've trusted the tool for a month.

### `list_projects`

If you use Claude Code heavily, you tend to remember work by directory or repo before you remember it by session title. `list_projects` is the tool that turns that into a first-class query: *"What projects even exist in my saved archive, and how many sessions does each have?"*

A prompt might be:

> *"List my projects with the most sessions, then narrow to just Claude Code."*

Conceptually:

```json
{
  "tool": "list_projects",
  "arguments": {
    "source": "CLAUDE_CODE"
  }
}
```

The return value is a list (not a wrapped object), each entry containing `project` and `session_count`, sorted descending by count:

```json
[
  { "project": "claude-explorer", "session_count": 42 },
  { "project": "client-foo", "session_count": 17 }
]
```

One caveat: conversations that have `project_name == null` are excluded from the aggregation entirely. That's deliberate, because the alternative is to invent a fake "(none)" project and then teach every consumer to special-case it; it's cleaner to say "projects are only the sessions that actually have one".

### `get_session_outline`

This is the load-bearing idea in the whole server: **outline-first, messages-on-demand**.

Long sessions are the norm once you start doing real engineering work with Claude Code, and the naive way to query a long session is also the expensive way: dump the entire transcript into context. That fails for three reasons at once: token cost you can't justify, the model wading through material you didn't need to surface, and workflows that become unreliable because context limits hit at unpredictable points.

`get_session_outline` solves that by returning a lightweight summary per message, with stable positions, message UUIDs, sender, a 200-character summary, character count, tool count, and timestamp. You use the outline to decide which messages are worth reading, then you call `get_messages` for the exact positions you want.

A prompt looks like:

> *"Open session `8f2c3c1e-...`, give me an outline, and point out where the decision about indexing was made."*

The tool call is simple:

```json
{
  "tool": "get_session_outline",
  "arguments": {
    "session_id": "8f2c3c1e-...."
  }
}
```

The response is:

```json
{
  "session_id": "8f2c3c1e-....",
  "name": "Investigate slow search and indexing options",
  "model": "claude-sonnet-4-6",
  "source": "CLAUDE_CODE",
  "project": "claude-explorer",
  "message_count": 214,
  "created_at": "2026-05-10T14:22:18Z",
  "updated_at": "2026-05-10T18:07:55Z",
  "messages": [
    {
      "message_uuid": "2a73...",
      "position": 0,
      "sender": "human",
      "summary": "We need faster full-text search across Desktop JSON and Code JSONL; current linear scan feels slow and...",
      "char_count": 182,
      "tool_count": 0,
      "timestamp": "2026-05-10T14:22:18Z"
    },
    {
      "message_uuid": "9b11...",
      "position": 1,
      "sender": "assistant",
      "summary": "Proposes indexing approaches; suggests SQLite FTS5 with a background builder and fallback path...",
      "char_count": 612,
      "tool_count": 1,
      "timestamp": "2026-05-10T14:22:37Z"
    }
  ]
}
```

A few semantics matter if you plan to use this for real work:

- The `summary` is derived from `text` blocks only. Tool calls and tool results do not contribute; this keeps the outline readable and cheap.
- Whitespace is normalized (newlines collapse), then the text is truncated at 200 characters at a word boundary, with `"..."` appended when truncated.
- The outline is for the session's **active branch**. Branching exists in Claude transcripts, and this server chooses the active branch rather than trying to return a tree in V1; when the "leaf" changes, the cache regenerates (we'll talk about that in the caching section).

Why am I spending so much prose on this tool? Because it turns "query history" from a gimmick into a workflow. Once you can ask for an outline, you can ask for a plan: *"find the four most important decision points, then fetch those messages, then write me a summary."* That is the mental model I wanted when I designed this server.

### `get_messages`

Once the outline tells you where the interesting parts are, `get_messages` pulls full content for specific messages.

You can address messages in two ways:

- By `positions` (0-indexed positions from the outline)
- By `message_uuids`

In practice, I use positions almost every time because they're easy to select after scanning an outline; UUIDs exist for clients that want stable identifiers.

A prompt might be:

> *"Fetch positions 47 through 55, and include tool calls and results."*

Conceptually:

```json
{
  "tool": "get_messages",
  "arguments": {
    "session_id": "8f2c3c1e-....",
    "positions": [47, 48, 49, 50, 51, 52, 53, 54, 55],
    "message_uuids": null,
    "include_tool_calls": true,
    "include_tool_results": true
  }
}
```

The return value is a list of message dicts. In "text-only mode" (the default, with tools off) each message is:

```json
{
  "position": 50,
  "uuid": "c1d2...",
  "sender": "assistant",
  "timestamp": "2026-05-10T15:03:09Z",
  "text": "Here is the approach: build a SQLite FTS5 index at startup, then keep a fallback linear scan..."
}
```

When you include tools, the payload becomes structured content blocks:

```json
{
  "position": 51,
  "uuid": "d4e5...",
  "sender": "assistant",
  "timestamp": "2026-05-10T15:04:11Z",
  "content": [
    { "type": "text", "text": "Let's verify sqlite3 was built with FTS5 support on this machine." },
    { "type": "tool_use", "name": "bash", "input": { "cmd": "python -c \"import sqlite3; print(sqlite3.sqlite_version)\"" } },
    { "type": "tool_result", "content": [{ "type": "text", "text": "3.45.1" }] }
  ]
}
```

And there are a few important quirks, which I'm calling out because they're the kind of thing you only notice after you've wired this into another workflow:

- If you pass `positions`, any out-of-range positions are silently dropped. The tool returns what it can and keeps moving.
- If you pass both `positions` and `message_uuids`, `positions` wins and UUIDs are ignored (without warning).
- If `include_tool_results=True`, it implies `include_tool_calls=True`, since a tool result without a tool call is meaningless.

One known gap in the current implementation is worth saying explicitly: **image content blocks are not emitted** in the structured output mode. The server filters `text`, `tool_use`, and `tool_result` blocks, but it does not currently emit `image` blocks, so if you are trying to reconstruct a session that included screenshots, `export_session` is the better "faithful rendering" path today. I filed this as a follow-up because it's fixable, and because it's the kind of rough edge you want to know about before you build something on top of it.

### `export_session`

Finally, `export_session` is how you turn "we found the right place" into "now I want an artifact I can paste into a doc".

A prompt might be:

> *"Export the session as Markdown, including tools, but only the portion around the final decision."*

Conceptually:

```json
{
  "tool": "export_session",
  "arguments": {
    "session_id": "8f2c3c1e-....",
    "start_position": 40,
    "end_position": 78,
    "include_tools": true
  }
}
```

The return value is a single Markdown string, produced by the same export function the UI uses (the Inline Markdown variant). Slicing uses **inclusive** `end_position`, and out-of-range values clamp instead of erroring, which makes it tolerant when the model guesses a range and then corrects itself.

Also note a subtle, practical detail: `export_session(include_tools=...)` defaults to `True`, while `get_messages(include_tool_calls=...)` defaults to `False`. That's intentional. When you ask for an export, you're usually asking for something you want to preserve as a record, and tool calls are part of the record; when you ask to read messages, you're often trying to keep the payload small. I commented the heck out of it in the source so I would not forget why I built it that way.

![[Pasted image 20260514013433.png]]

## A Real Workflow (End to End): Writing This Series From the Archive

Part 2 ended by teasing the self-referential fact: I used this MCP server to mine this project's own history to write the series you're reading. Here is what that looks like when it's done on purpose, with the outline-first approach as the spine.

The human goal is straightforward:

> *"Summarize the development history of this project, extract the decisions, find the memorable quotes, and produce a drafting brief that can become a Medium series."*

If you try to do that by hand, you open the UI, search a few terms, click around, copy a bunch of snippets, then lose an afternoon. That can be pleasant, but it doesn't scale; the point of having your archive queryable is to do the boring rummaging once, then keep the interesting synthesis for the human.

So the flow I used was, in order: (1) find the relevant sessions project-wide; (2) for each one, pull an outline to find the important phases; (3) fetch specific message ranges where the decisions were made; (4) export the most relevant chunks as Markdown so they can be quoted accurately; (5) write the synthesized brief, then draft articles from that brief. Here's what that looks like as a transcript of intent plus tool calls.

### Step 1: list projects, then list sessions

The first prompt to the drafting Claude was something like:

> *"I'm writing a retrospective about the `claude-explorer` project. List the projects in my archive, then find the sessions that belong to `claude-explorer`."*

It starts with `list_projects` to get an inventory:

```json
{
  "tool": "list_projects",
  "arguments": { "source": "CLAUDE_CODE" }
}
```

Then it narrows via `list_sessions` with a `project` filter (the filter is substring match, so `"claude-explorer"` is enough):

```json
{
  "tool": "list_sessions",
  "arguments": {
    "query": null,
    "source": "CLAUDE_CODE",
    "project": "claude-explorer",
    "limit": 100,
    "offset": 0
  }
}
```

At this stage, we're not "reading" anything; we're building an index of what exists.

### Step 2: outline-first on the sessions that matter

From the sessions list, the agent picks the most relevant ones (by recency, message count, or title) and starts asking for outlines:

```json
{
  "tool": "get_session_outline",
  "arguments": { "session_id": "..." }
}
```

The outline is where the workflow becomes token-efficient. It lets the agent do a pass that feels like "skimming", because the outline is mostly short, and because it carries `tool_count` and `char_count`, which are surprisingly useful signals; tool-heavy stretches are often where something concrete happened on disk, while long assistant messages are often where a decision was explained.

And this is where you see why "position" is such a good API. Once the agent identifies a chunk (say, positions 120 through 160) as "this is where the decision was made", it can fetch only that range.

### Step 3: fetch only the relevant messages

Now `get_messages` comes in. For drafting, I often start without tools:

```json
{
  "tool": "get_messages",
  "arguments": {
    "session_id": "...",
    "positions": [120, 121, 122, 123, 124, 125],
    "include_tool_calls": false,
    "include_tool_results": false
  }
}
```

If the text references tool output (*"the grep showed…"*, *"the traceback said…"*) then I re-fetch the same positions with tool results on, which is a nice pattern because it keeps the common case small while still letting you zoom in:

```json
{
  "tool": "get_messages",
  "arguments": {
    "session_id": "...",
    "positions": [120, 121, 122, 123, 124, 125],
    "include_tool_calls": true,
    "include_tool_results": true
  }
}
```

At this point, the agent can quote exact user phrasing, exact assistant wording, and exact tool output. That matters if you want your retrospective to be honest, because otherwise you end up paraphrasing technical details, and paraphrased technical details are where errors breed.

### Step 4: export the chunk as Markdown for a durable artifact

When I wanted to hand the drafting pipeline a stable text artifact (for example, *"this is the section where we realized the search path needed FTS5"*), I used `export_session` to produce Markdown slices:

```json
{
  "tool": "export_session",
  "arguments": {
    "session_id": "...",
    "start_position": 112,
    "end_position": 168,
    "include_tools": true
  }
}
```

That string is pasteable into notes, checklists, or a drafting brief, and because it's the same export logic the UI uses, it matches what you would have gotten if you had clicked "Markdown export" in the browser.

### Step 5: synthesize the retrospective

Once you have outlines, targeted message pulls, and a few exported slices, the final step is the part the LLM is actually good at: turning a pile of excerpts into structure. That's the part where I can say:

> *"Now write a five-part article series outline; Part 1 should explain what the project is and why, Part 2 should tour the UI, Part 3 should explain the MCP server, then bridge to the reverse-engineering story."*

It's also the part where you can ask for second-order artifacts: *"give me the memorable quotes,"* *"extract the durable decisions,"* *"list the times we corrected wrong assumptions."* Those are exactly the kinds of things that are present in transcripts but hard to mine manually, and once you've got a tool surface that makes the transcripts queryable, the friction drops.

![[Pasted image 20260514015009.png]]

One personal note here, because it is the reason I keep working on this project: the loop is fun. I mean "fun" in the substantive sense; this changes how I work.

When a new Claude Code session can read my old sessions as structured data, I stop treating my prior work as something I vaguely remember, and start treating it as something I can query. I figured out a way, and you're reading this!

## Token Cost and Caching Architecture

Now for the "be paranoid about the tax" section.

When you attach an MCP server, you pay two kinds of cost: (1) a **fixed context cost** on every conversation, because the client injects the tool definitions and server instructions into the prompt; and (2) a **per-call cost** when you actually invoke tools, which depends on how much data you retrieve. The server is designed to keep the per-call cost controllable via outline-first querying, but the fixed cost is unavoidable, so we should treat it as a real budget item.

### The fixed context cost (tool definitions)

Measured on the live server, the five tool definitions total about **4,681 characters**, which is roughly **1,200 to 1,600 tokens** depending on tokenization. That is paid per conversation even if you never call the tools.

The breakdown is:

- `list_sessions`: 1,054 chars
- `list_projects`: 657 chars
- `get_session_outline`: 695 chars
- `get_messages`: 1,317 chars
- `export_session`: 958 chars
- Total: 4,681 chars

This is why the "explicit-only" instruction exists at both the server level and tool level. Without it, it's too easy for an agent to say *"I have tools, I should use them"*, and now you're spending tokens on tool calls you never asked for, on top of the fixed attachment tax you already paid.

### The outline cache (SQLite, append-only)

The second part of the architecture is the one that makes `get_session_outline` viable as a default operation. If the server had to re-summarize every message in a long session every time you asked for an outline, you'd either wait too long or you'd stop using it, because latency is how a good idea becomes a dead feature.

So the server caches outlines in SQLite at:

- `~/.claude-explorer/cache.db` by default (specifically, it's stored at `<data_dir>.parent / "cache.db"`)

The schema is small and practical:

```sql
CREATE TABLE IF NOT EXISTS session_files (
    session_id TEXT PRIMARY KEY,
    file_path TEXT NOT NULL,
    file_mtime REAL NOT NULL,
    leaf_message_uuid TEXT NOT NULL DEFAULT '',
    message_count INTEGER NOT NULL,
    cached_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS message_summaries (
    message_uuid TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    sender TEXT NOT NULL,
    summary TEXT,
    char_count INTEGER NOT NULL,
    tool_count INTEGER DEFAULT 0,
    timestamp TEXT,
    FOREIGN KEY (session_id)
        REFERENCES session_files(session_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_msg_session
    ON message_summaries(session_id, position);
```

The caching behavior is where the "append-only" idea shows up:

- If the cache has no row for a session, it builds the outline and stores it.
- If the cache matches the on-disk session's `file_mtime`, `message_count`, and `leaf_message_uuid`, it returns cached rows without doing work.
- If the active branch leaf changes, or the message count shrinks, it regenerates the whole outline.
- If the leaf is the same and the message count increased, it summarizes only the new messages and appends them.

That last case is the common one for Claude Code sessions, because sessions tend to grow over time; if you keep working in the same session, the outline grows incrementally and the server pays only for the new tail.

Why store `leaf_message_uuid`? Because *"same session ID, different active branch"* is a real state, and you want the cache to reflect the actual active conversation path. Caching the wrong branch outline would be worse than not caching at all, because you'd trust it.

Also, a small but important operational detail: the server opens a new SQLite connection per call, rather than holding a global connection. It's boring, but boring is correct here, because `sqlite3.Connection` thread-safety pitfalls are not the kind of excitement I want in a local tool.

## Security Considerations (Short, Because It's Simple)

When you hear *"I attached my entire conversation history to an agent"*, the reasonable question is: *"Did I just open a hole in my machine?"*

The MCP server's security boundary is intentionally narrow:

- It is **read-only**. None of the tools mutate your conversation store.
- It is **local-only** and **stdio-only**. There is no network listener; the client must spawn the server as a subprocess and speak over stdin/stdout.
- It does **not** handle credentials. The Desktop fetch credentials live in `~/.claude-explorer/credentials.json` for the fetcher, but the MCP server does not read them.
- It is resistant to path traversal because sessions are addressed by UUID and resolved through the store's enumeration logic, not by user-supplied file paths.

This doesn't absolve you of the human responsibility piece. If you attach this to a work context, it can read whatever is in your local archive; data hygiene is still on you. The tool is a file reader with a schema.

## What This Is Not For

The MCP server is powerful, but it's intentionally scoped.

It's not a "memory daemon" that should be consulted on every prompt; the server-level instructions explicitly tell the client to never call tools proactively or speculatively, because that behavior burns tokens and surprises users.

It's not workflow automation across sessions. This server does not run your commands, change files, or create tickets. It reads your history and returns structured slices of it; any "automation" happens in the client's reasoning step after you asked for it.

It's not a substitute for good note-taking, good READMEs, or a well-maintained `CLAUDE.md`. In fact, one of the best uses of this server is to improve those artifacts by mining your own correction patterns, but the artifacts still matter, because they are the human-readable contract your future self will thank you for.

If you want to use it well, use it on purpose: *"Search for X,"* *"Outline session Y,"* *"Fetch positions 40 to 55,"* *"Export this chunk."* That's the rhythm.

## Wrapping Up!

Ok, that's enough for today! We covered the MCP server end to end: why it exists (same archive, different consumer), a quick MCP primer, install and configuration for Claude Code and Claude Desktop, and a tour of the five tools (`list_sessions`, `list_projects`, `get_session_outline`, `get_messages`, `export_session`) with the outline-first pattern as the key design idea. We also talked about the fixed token cost of attaching the server (about 4,681 characters, roughly 1,200 to 1,600 tokens per conversation) and the SQLite outline cache that keeps "outline-first" fast by staying append-only when sessions grow.

Next time we'll pivot from "using the tool" to "how the tool got made." Part 4 starts the reverse-engineering story: mitmproxy capture, the unofficial `chat_conversations` API shape, the early credential-capture approach, and the eventual pivot to Playwright for a cleaner login flow. If you enjoyed the systems-archaeology side of Part 1, you'll like Part 4.

Like last time, please comment below with any questions, corrections, or pushback. I'd especially love to hear what you'd ask a fresh Claude session to do with your history, because the best workflows here tend to be the ones nobody thinks of until the tool exists.

If you liked this, please clap and follow me here and on LinkedIn.

See you next time! 🤓
