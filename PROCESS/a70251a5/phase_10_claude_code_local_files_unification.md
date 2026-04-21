# Phase 10 — claude_code_local_files_unification

- **Session:** `a70251a5-b932-4b61-aba1-16a70410b98e`
- **Positions:** `[1493..1818]`
- **Dates:** 2026-03-09 → 2026-03-09

## Goal
Rework how Claude Code (CLI / desktop-embedded) sessions enter the app: stop importing JSONL files into `~/.claude-exporter/conversations/` and instead read them directly from `~/.claude/projects/**/*.jsonl` at request time, unify the two sources (Desktop API + Code JSONL) behind a single listing with a source filter, clean up the now-stale imported copies, then chase the two regressions that fell out — Cmd-K search ignoring the type toggle, and a noticeable slowdown.

## Opening prompt
> I'm confused. Did you make the fetcher pull from the local files? I think it's be cleaner if the front end had a toggle to go between the fetched Claude Desktop files and the local Claude Code files (from both the CLI and CC in the desktop app). What are your thoughts?

— pos=1572 `msg=2e0bf2e8…` (2026-03-09)

## Key decisions
- Adopt a **unified view with a source filter** over either a mixed-without-distinction list or fully separate tabs — dropdown/toggle for "All / Desktop / Code". [pos=1572 `msg=2e0bf2e8…`, pos=1574 `msg=9c6d74a8…`]
- **Stop copying** Claude Code JSONL into `conversations/`. Single source of truth: Desktop stays file-backed (API is remote), Code is read live from `~/.claude/projects/**/*.jsonl`. [pos=1574 `msg=9c6d74a8…`]
- Rationale accepted: copying causes sync drift (continuing a CC session leaves the export stale), duplicate storage, and manual re-import steps. [pos=1574 `msg=9c6d74a8…`, pos=1575 assistant restatement]
- Approved the refactor plan verbatim: move JSONL parsing into the backend store, merge both sources with a `source` field, drop any `import-local` path, keep CLI surface to just `fetch` + `serve`. [pos=1576 `msg=ba64493d…`]
- **Retro-cleanup**: any CC JSONs previously imported into `conversations/` must be deleted, not left around as shadow copies. [pos=1676 `msg=ffb70f1c…`]
- On agent sub-conversations (258 JSONL total = 35 main + 223 `agent-*.jsonl`): chose option **3 — nested view, agents under their parent conversation** rather than hiding them or flattening them as peers. [pos=1706 `msg=201617fd…`, context pos=1705]
- First performance grumble of the project is logged alongside a correctness bug: Cmd-K search isn't respecting the source filter, and the whole app has gotten slower since the refactor. [pos=1772 `msg=6b2b9db1…`]

## Code outcome
- Backend store refactored to read two sources at request time: JSON files in `~/.claude-exporter/conversations/` (Desktop) and JSONL files under `~/.claude/projects/**/*.jsonl` (Code), merged with a `source` discriminator.
- Frontend gains a source filter in the sidebar (All / Desktop / Code); icons already distinguished the two (blue chat / green terminal).
- Import-to-JSON path for CC deleted; any previously imported CC JSONs purged from `conversations/`. [pos=1676 `msg=ffb70f1c…`, pos=1677 assistant confirm]
- Agent sub-conversations promoted from "filtered out" to nested-under-parent in the listing. [pos=1706 `msg=201617fd…`]
- Server restarted and smoke-tested in-session before the regression report. [pos=1680 `msg=d13621e0…`]

## Missteps / reverts
- Original implementation (before this phase) had the fetcher importing CC JSONL into `conversations/` — user called this out as a poor design choice and forced the rewrite. [pos=1574 `msg=9c6d74a8…`]
- Initial CC count looked too low; user demanded an independent count from the JSONL files rather than trusting the app's number, which surfaced the 223 hidden agent sub-conversations. [pos=1700 `msg=bd51590b…`]
- Two user-initiated interrupts of tool use during the long refactor (`continue` issued twice to resume). [pos=1714 `msg=04589383…`, pos=1740 `msg=b9801a3a…`]
- Post-refactor regressions surfaced immediately: Cmd-K global search bypassed the type/source toggle, and overall latency regressed — deferred to the next phase. [pos=1772 `msg=6b2b9db1…`]

## Memorable moments
- > unified + filter; but why copy conversations from the local JSONL to the conversations/ dir? That seems like a poor design choice; it's better to have a single source of truth, so it can't get out of sync
  — pos=1574 `msg=9c6d74a8…` (sender: human)
- > I'm confused. Did you make the fetcher pull from the local files? I think it's be cleaner if the front end had a toggle…
  — pos=1572 `msg=2e0bf2e8…` (sender: human)
- > Hm, there should be a lot more Claude Code conversations, I think. Please check the count in the JSONL file independently.
  — pos=1700 `msg=bd51590b…` (sender: human)
- > 1. CMD-K seems to ignore the type toggle. 2. It's gotten a log slower. What can we do about this?
  — pos=1772 `msg=6b2b9db1…` (sender: human)
- > Before this refactor did you fetch CC conversations into the conversations/ dir? If so, we should clean that up.
  — pos=1676 `msg=ffb70f1c…` (sender: human)

## Tone / mood
Architecturally assertive and skeptical — the user repeatedly reframes the design ("single source of truth", "poor design choice") and refuses to trust the app's own numbers ("check the count in the JSONL file independently"). Terse approvals (`yes, proceed`, `3`, `continue`) for steps that are clearly correct, but sharp pushback the moment the shape of the system looks wrong. First project moment where performance enters the conversation as a first-class concern alongside correctness.

## Cross-refs
- Upstream: phases that built the Desktop-only fetcher and the initial CC JSONL import path — this phase deletes the import path and replaces it with live reads.
- Downstream: next phase picks up the two regressions logged at pos=1772 — Cmd-K ignoring the source/type toggle, and the post-refactor latency regression. Also sets up the nested-agent listing that later phases will render in the sidebar tree.
