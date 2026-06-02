# Use Cases for Part 1

Five concrete use cases grounded in the actual build sessions — suitable for Part 1 ("What This Thing Is and Why You'd Want It"). Every use case ties back to specific moments from the extractions so the prose doesn't have to invent hypotheticals.

**Part-1 hook guidance (from `PLANS/medium-articles.md`):** the original "lost access to my account" framing was explicitly pivoted away from on 2026-04-19; the user deemed it "sketchy, makes me seem like I'm stealing IP." **The lost-access edge case was removed entirely from Part 1** on 2026-04-20 after the LLM Council review — the user felt it still read as sketchy even when framed as an edge case. The capability stays in the codebase (mitmproxy addon + documentation in the README), but *zero* references to it should appear in Part 1. The company-IP caveat in Use Case 3 stays.

The new framing is around **searching and accessing full session transcripts with a UI that shows the entirety of each session, plus programmatically via Claude Code and Claude Desktop.** The use cases below are **interleaved UI ↔ MCP** (not grouped), because grouping all the UI uses first risks the reader thinking "cool, I get it" and bailing before the MCP use cases — which are arguably the more leveraged ones.

**A grounding fact that threads through every use case below:** Claude Desktop stores your conversation history **server-side only** — the local macOS / Windows / Linux app is a thin view onto the Anthropic backend. If you lose access to the account (email rotation, SSO revocation, subscription lapse, employer offboarding), the history is effectively gone. Claude Code stores sessions locally as JSONL under `~/.claude/projects/`, but there's no shipped UI to browse them. This project gives you a **local, unified, searchable archive of both**, so none of the above events can take your history from you — and opens up programmatic access to the combined corpus via an MCP server.

## 1. Unified local archive with full-text search — Claude Desktop + Claude Code in one place *(UI)*

Claude Desktop **does** ship full-text search (don't claim otherwise — that error was caught in review), and it's a genuinely good feature. The catch is that the data Claude Desktop searches lives server-side on Anthropic's infrastructure, reachable only through a logged-in Desktop or web session. Claude Code keeps its sessions in `~/.claude/projects/*.jsonl` on your machine, but there's no built-in UI for browsing or searching them. Between the two of them, everything you've ever asked Claude (and everything Claude has ever asked back, every tool call, every tool result) is spread across two storage systems, accessed through two different interfaces, owned by different parties. This project pulls both into a single local corpus and a single searchable UI.

**There are TWO distinct searches in the UI — don't conflate them (2026-04-20 directive after a user catch):**

1. **Sidebar title filter** (left pane). Narrows the conversation list as you type, against titles and summaries only. For when you remember *roughly* what a session was about. Focused via:
   - Emacs mode: `Ctrl+S` (see `useKeyboardShortcuts.ts` line ~366-369).
   - Vim mode: `/` (see `useKeyboardShortcuts.ts` line ~313-316).

2. **Full-text SearchPanel** (right pane, persistent overlay, post-commit `d69439c`). Walks through every match across every message in the combined corpus. For when you need to find the exact turn where something got said. Key bindings:
   - `Cmd+K` *or* `Cmd+F` — toggle the SearchPanel open/closed (`useKeyboardShortcuts.ts` line 130).
   - `Cmd+G` — next match. Opens the panel if closed, so `Cmd+G` works as a one-key entry point.
   - `Cmd+Shift+G` — previous match. Also opens the panel if closed.
   - `Escape` — close the panel (cascade-aware; only intercepts when the panel owns focus).

**Part-1 framing rule:** Part 1 should mention that *both* searches exist and should emphasize the keyboard-first philosophy ("everything important is one keystroke from your left hand"), **without** listing specific key bindings. The full key map belongs in Part 2. This was a user directive on 2026-04-20 after a first-draft conflation.

Relevant frontend files: `frontend/src/components/search/SearchPanel.tsx`, `frontend/src/contexts/SearchPanelContext.tsx`, `frontend/src/components/search/navigateToMatch.ts`, `frontend/src/hooks/useKeyboardShortcuts.ts`. Drafters for Parts 2, 3, and 5 should use this current UX, not the old Cmd+K-modal language.

The build session surfaces exactly the gap the SearchPanel was built to fill: "The full-text search hook (`useSearch`) exists but **isn't used anywhere in the UI**. The sidebar search only filters by title/summary." [a70251a5#pos=869 msg=4b710ca3…] The first fix was a `Cmd+K` command palette against the real search endpoint; then `Cmd+G` with a fast path and background prefetch of adjacent conversations (so navigating hits feels instant) [a70251a5#pos=4831 msg=015920bd…]; then the persistent right-side panel replaced the modal entirely (commit `d69439c`, reflected in 92_timeline.md's arc 5).

The user also explicitly framed the unified-browser scope during Phase 09: "Claude Desktop only shows the Claude Code sessions that I ran inside Claude Desktop under the Code tab. That's fine, but I'd like our front end (conversation browser) to show and be able to search all Claude Code sessions, whether they are from the CLI or from inside Claude Desktop." [a70251a5#pos=1474 msg=6b33711a…]

**Where it appears:** anchor use case for **Part 1**; full SearchPanel walkthrough in **Part 2**.

## 2. MCP-powered retrospective: query your own build history from inside a new Claude Code session *(MCP)*

The MCP server's five tools (`list_sessions`, `list_projects`, `get_session_outline`, `get_messages`, `export_session`) expose the exact same corpus to Claude Code and Claude Desktop that the web UI browses — but through a schema that's designed for outline-first, messages-on-demand querying, so a new Claude Code session can walk your old sessions message-by-message without blowing context.

This is the use case the user explicitly named when kicking off the MCP server work: "I want to build an MCP server into this project, so that Claude Code and Claude Desktop can query our saved sessions… An example use case would be to read through an entire session bit by bit… and find mistakes that Claude Code made that we had to correct through followon prompts. Another use case would be to read through the session(s) for a project and write a comprehensive blog post about the work that went into it. We might use this session's project as a test case for this." [a70251a5#pos=4844 msg=ff2ee72e…]

That is literally how this Medium series is being written. Phase 20 designed the tool surface; Phase 21 proved it works with a single dogfood query — "Find all the sessions for project claude-desktop-message-exporter" [a70251a5#pos=4997 msg=e3690a05…] — and the planning session (`76fe578b`) then drove the MCP server across the 5,005-position main build session to produce the 20 per-phase extractions, the quotes in this file, and the timeline next door. The tool eats its own tail on purpose.

A second instantiation of the same use case is planned for **another project I'm working on** once this Medium series ships: run the MCP server over that project's entire session archive and ask Claude Code to produce a comprehensive summary of the work that was done — who asked for what, which approaches were tried and abandoned, which durable decisions shaped the codebase, and which mistakes are worth codifying as standing rules. The general pattern ("summarize all work done for a project across every session") is arguably the highest-leverage use of the MCP server for a team, because project context that would otherwise live only in the heads of the engineers who did the work gets written down in a form a new collaborator can read in an afternoon.

**Naming note for drafters:** the user will name specific projects in a *separate* future series, not in this series. Keep it generic ("another project I'm working on") across Parts 1–5. The full project names can stay in `PLANS/future_articles/llm_council.md` since that's where they'll eventually be published.

**Where it appears:** mentioned in **Part 1** as the "why you want programmatic access" beat (with both the self-referential Medium-series example and a project-summary use case for another project); detailed technical walk-through in **Part 3**; the demo itself is the closing story of **Part 5** (the build-story retrospective is literally powered by the tool being described).

## 3. Cross-device / cross-account consolidation: merge Claude Desktop + Claude Code histories *(UI)*

Until you run this project, Claude Desktop conversations and Claude Code sessions don't live in the same place and aren't searchable together. Claude Desktop talks to a remote API; Claude Code writes JSONL locally under `~/.claude/projects/`. This project reads both — the Desktop one via fetched JSON in `~/.claude-exporter/conversations/`, the Code one live from disk at request time — and merges them behind a single listing with a source filter.

The decision to read Claude Code live instead of importing it is deliberate: "unified + filter; but why copy conversations from the local JSONL to the conversations/ dir? That seems like a poor design choice; it's better to have a single source of truth, so it can't get out of sync." [a70251a5#pos=1574 msg=9c6d74a8…] The same phases (09, 10, 13, 14) also land project grouping (Claude Code sessions organized by the project / git repo they ran in) and surfaces 258 Claude Code sessions where the initial naive count had been 35 — the other 223 were agent sub-conversations that the original listing quietly filtered out. [a70251a5#pos=1700 msg=bd51590b…]

This also matters if you use Claude across **personal and work contexts**, across **multiple work accounts** (contractor plus full-time, two jobs, client-by-client), or across multiple machines. The unified browser treats every source as first-class and lets you search the combined corpus rather than flipping between interfaces. The real payoff is **learning across silos** — a prompt, pattern, or solution you worked out in one context becomes discoverable in another, rather than siloed and forgotten the moment you switch hats.

**A caveat worth stating plainly in the article prose:** you remain responsible for protecting your employer's intellectual property. As always, the user is responsible for their own IP handling — unifying everything in one local archive doesn't change that. It doesn't mean you should archive your employer's conversations onto a personal machine, or search your work sessions from a personal one. Use the source and project filters in Claude Explorer to keep contexts separate when the data model requires it, and when in doubt, keep work history under your employer's control, not yours.

**Where it appears:** UI use case for **Part 1**, placed between the first MCP use case (retrospective) and the second (find-mistakes) to keep UI and MCP alternating; project-grouping and source-filter UX shown in **Part 2**. The IP caveat should be in Part 1's prose, not just a footnote.

## 4. Find mistakes Claude Code made so you can tune your agent prompts or `CLAUDE.md` *(MCP)*

**Scope clarification (2026-04-20, post-Council review):** keep Use Cases 2 and 4 cleanly distinct.
- **Use Case 2** is about summarizing *what you did* on a project across all its sessions.
- **Use Case 4** is about mining *what went sideways with the agent* and feeding that back into `CLAUDE.md`.

The originating prompt names Use Case 4 directly: "find mistakes that Claude Code made that we had to correct through followon prompts." [a70251a5#pos=4844 msg=ff2ee72e…] But the pattern is **broader than proposal → pushback → fix**. Drafters should cover at least these five sub-patterns:

1. **Proposal → pushback → fix.** Claude suggests an approach, user rejects, Claude corrects. These are preference signals for what *your* codebase wants.
2. **Wrong-assumption bugs.** Claude coded against an imagined API / data shape without looking at actual data. The codifiable rule: *read the actual JSON before coding against your mental model of the JSON.* The `files_v2` nested-shape bug (Phase 05) is the canonical example in this project's own history.
3. **Context loss across compactions.** Claude forgot a codebase convention after a context compaction — test fixture location, naming scheme, deploy script. These belong in `CLAUDE.md` so they survive compaction automatically.
4. **Rule violations.** Claude did something explicitly banned. `pkill uvicorn` blowing away another project's server [a70251a5#pos=4308 msg=1854813a…]. Self-credit in commit messages landing twice [a70251a5#pos=35 msg=eeebeb16…, pos=958 msg=237d6350…]. `cat | grep` instead of `rg`. Each violation is a rule that wasn't explicit until it was violated.
5. **Over-eager optimization.** Claude quietly broke correctness to make something look fast. The `message_count=0` hard-code during the perf pass (Phase 11) is the canonical example — hard to find without a retrospective pass because the symptom and cause are days apart.

**Cadence and curation (user directive, 2026-04-20):** weekly, not quarterly. Pull the last week's sessions, have a fresh Claude Code instance with the MCP server propose `CLAUDE.md` diffs, and **a human reviews and edits the diffs before anything lands**. The human-curation gate is explicit because without it, `CLAUDE.md` accumulates cruft, overfits to one bad session, or contradicts itself. Frame this in article prose as *personal workflow* ("I like running this as a small weekly loop"), not prescription ("you should run this weekly") — Council flagged prescriptive cadence as preachy. The cadence is less important than the loop plus the gate.

**Where it appears:** called out in **Part 1** as one of the headline MCP use cases; mechanics in **Part 3**; the demo itself (on this project's own sessions) in **Part 5**.

## 5. Self-contained archive: keep the attachments, not just the text *(UI)*

The fetcher downloads attachment bytes — images, canvas/artifact text, and PDFs via the nested `files_v2.document_asset.url` / `thumbnail_asset.url` shape — into a per-conversation `files/` directory next to the JSON. That means the archive survives Claude server-side expiry of attachment URLs: your PDFs stay, your canvas transcripts stay, your screenshots stay.

The PDF case is the illustrative one: a specific conversation was missing its PDF because the fetcher's first implementation assumed `files_v2` had the flat shape of `files` (top-level `thumbnail_url`, `preview_url`). The real shape nests the URLs one level deeper. Only caught because the user spot-checked a specific conversation: "I just fetched a new conversation, `d2ce8cd7…`. It should have a PDF attachment. I see it in the Claude Desktop app, but our fetcher utility didn't get it." [a70251a5#pos=659 msg=82391f1f…, pos=680 msg=895d7bb9…]

**Where it appears:** minor callout in **Part 1** ("the archive is self-contained"); fetcher details in **Part 3**; the bug story itself fits well in **Part 5** as a "read the actual JSON before coding against your mental model" beat.

<!-- Use Case 6 (Data portability / lost access) was REMOVED on 2026-04-20 after LLM
     Council review. The user felt the framing still read as sketchy even as an
     edge case, and asked for zero references to "lost access" anywhere in the
     Part 1 article. The mitmproxy capability stays in the codebase and is still
     documented in the README. The company-IP caveat stays in Use Case 3.

     Drafters for Parts 3 and 5 should also avoid leading with the lost-access
     framing. If Part 3 needs to explain *why* both credential-capture paths
     exist, frame it as complementary failure modes ("these two paths exist
     because they cover different environments") without turning the account-
     lockout case into the hook. -->

## Removed: Use Case 6 (Data portability before SSO revocation / account closure)

See the HTML comment above for the removal rationale and downstream drafter guidance.
