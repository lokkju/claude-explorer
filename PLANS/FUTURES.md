# Futures

A running list of things we'd like to add to `claude-explorer` down the road.
Not committed work, not scheduled, just the parking lot. When an item graduates
to real work, give it its own dated `PLANS/<date>-<slug>.md` and link it here.

## Conversation management

- **Star and archive management for conversations** (feasibility TBD). Today the
  UI surfaces Desktop-side stars and the Cowork "archived" state read-only; the
  goal is to let the user star/unstar and archive/unarchive from within
  `claude-explorer` itself. Open question: how much of this we can actually write
  back. Claude Desktop conversations live behind the unofficial API (writes may
  not be supported or safe), and Claude Code / Cowork state lives in on-disk
  formats we don't own. Decide per-source what's a genuine round-trip vs. a
  local-only overlay we maintain ourselves.

## In-app assistant

- **A chatbot window that talks to the current conversation via our MCP server.**
  A panel in the web app where you chat with a Claude instance that has the open
  conversation (and the wider archive) available through the MCP tools we already
  expose. Ship it with prepackaged skills the user can invoke with one click, e.g.:
  - summarize this conversation
  - extract the decisions / action items
  - "learn from the bugs" — pull the mistakes and fixes out of a debugging session
  - draft a retrospective
  Skills should be data-driven (a small library the user can extend), not
  hard-coded. This leans on the same MCP server Part 3 describes, pointed at the
  local archive.
