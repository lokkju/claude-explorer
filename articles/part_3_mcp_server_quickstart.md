<!--
  Medium series: Unlocking Your Claude History
  Part 3 of 7: Quickstart (five-minute version)
  Source: articles/part_3_mcp_server_userdoc.md
  Voice: PROCESS/99_styleguide.md (Raymond Peck's "Best Practices for Modern REST APIs in Python" series)
-->

# Part 3 Quickstart: Query Your Claude History in Five Minutes

***In this quickstart companion to Part 3, we connect a small MCP server so a brand-new Claude chat can search, read, and reason over your saved Claude history, in about five minutes.***

New here? Start with [Part 1](https://medium.com/@raymondpeck/unlocking-your-claude-history-part-1-f19000c05655) for what this project is, and [Part 2](https://medium.com/@raymondpeck/unlocking-your-claude-history-part-2-using-the-claude-explorer-web-app-user-guide-109191dc24d4) to get your Claude history onto your disk, since this server reads only what Part 2 captured there. For the full walkthrough (each workflow in depth, plus how I used the server to mine this very series), read the [user guide](part_3_mcp_server_userdoc.md); for the real numbers and design decisions, read the [deep-dive](part_3_mcp_server.md).

![An ouroboros: the MCP server reading the very session that built it](Attachments/ouroboros.png)

## What you get

Once it's connected, a brand-new chat can reach into your saved Claude Code, Claude Desktop, and Claude Cowork history and answer real questions about it. You ask one high-level question, and Claude composes the steps behind the scenes: find the conversation, skim it, read the parts that matter, and answer.

> *"In my longest Claude Code conversation on this project, what did we decide about the database, and what's still open?"*

## Connect it (macOS, Windows, Linux)

You connect the tool once. Nothing runs in the background and nothing listens on your network; Claude starts it on demand. It uses `uvx`, which ships with `uv`, so [install that first](https://docs.astral.sh/uv/getting-started/installation/) if you need it.

**Claude Code.** One command in a terminal:

```bash
claude mcp add --scope user claude-sessions -- uvx claude-explorer mcp
```

Confirm it took with `claude mcp list`; you should see `claude-sessions`.

**Claude Desktop.** Open the config from **Settings → Developer → Edit Config** (or by hand: `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, `%APPDATA%\Claude\claude_desktop_config.json` on Windows, `~/.config/Claude/claude_desktop_config.json` on Linux). Add this block, then fully quit and reopen Claude Desktop:

```json
{
  "mcpServers": {
    "claude-sessions": {
      "type": "stdio",
      "command": "uvx",
      "args": ["claude-explorer", "mcp"]
    }
  }
}
```

## Your first query

You don't learn any commands; you just ask. Good openers:

> *"Find all my conversations for the claude-explorer project."*

> *"Find my conversations about the new onboarding flow and summarize the decision points."*

> *"Find the conversation where we fixed the login bug, and walk me through how we solved it."*

Claude finds and lists the matches first, then, when you ask it to dig in, reads only the parts that matter without dragging the whole conversation into view.

## The one pattern to know

Some conversations run to thousands of messages, and reading a whole one is the expensive way to work. So the tool hands Claude an *outline* first: a one-line-per-message summary. Claude skims that, picks the handful of messages that matter, and reads only those. You mostly don't have to ask for any of this; Claude works outline-first on its own. It keeps querying a giant archive fast and cheap.

## Three things worth asking

**Summarize a sprawling conversation down to its decisions.**

> *"What did we decide in my longest conversation on the foo project, and what's still open?"*

It works the same outside code: a product manager can fold a week of brainstorming and prototyping chats into an engineering handoff, or a first-draft PRD:

> *"Pull together my prototyping sessions on the new feature into a handoff for engineering: the problem, what we decided, the open questions, and what to build first."*

**Turn Claude's recurring mistakes into better rules.**

> *"Look at my last week of conversations in this project, find the mistakes Claude keeps making, and write me a short list of rules to add to my CLAUDE.md."*

**Export a clean slice.**

> *"Export the part of that conversation where we wrote the deploy script in Markdown."*

You get a paste-ready copy back in the chat.

## Good to know

The server is **read-only** (it can't change or delete anything), **local** (nothing leaves your machine, and there's no server to phone home to), and **restrained by design** (Claude uses it only when you ask). It reads only what's already on your disk, so keep your archive current with the Part 2 **Refresh** and the one-time `install-watcher` step.

## Next

That's the whole loop: connect once, then ask. For the full walkthrough, read the Part 3 [user guide](part_3_mcp_server_userdoc.md); for the build numbers and the design story, including how I used this server to mine the series itself, read the [deep-dive](part_3_mcp_server.md). Part 4 turns from *using* the project to *building* it, starting with how Claude Desktop's conversations get onto your disk in the first place.

---

*This is an independent, community-built project, not affiliated with or endorsed by Anthropic. "Claude" and "Claude Code" are trademarks of Anthropic, PBC; this tool consumes Anthropic's public APIs and on-disk formats the way any client would, and those formats may change without notice.*
