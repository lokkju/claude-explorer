# Phase 14 — project_grouping_and_sidebar

- **Session:** `a70251a5-b932-4b61-aba1-16a70410b98e`
- **Positions:** `[2650..2787]`
- **Dates:** 2026-03-11 → 2026-03-12

## Goal
Round out the sidebar UX after the dual-source (Claude Desktop + Claude Code) unification: add a dual-refresh button, surface CLI-captured Claude Code sessions that were hiding behind a phantom-session filter, show local timestamps on every message, and fix project grouping so sessions with a `Caveat: ...` preamble still get a meaningful title and aren't silently dropped.

## Opening prompt
> 1. Add a refresh button at the top of the sidebar to refresh both CC and Claude Desktop conversations.
> 2. In the main message display, add timestamps (in local time) to all the messages on both sides of the conversation.

— pos=2650 `msg=088ac7ec…` (2026-03-11)

## Key decisions
- Single sidebar refresh button drives both Claude Desktop fetch and Claude Code re-scan in one click — not two separate controls. [pos=2650 `msg=088ac7ec…`]
- Per-message timestamps rendered in local time on both human and assistant sides, not just on conversation headers. [pos=2650 `msg=088ac7ec…`]
- Missing CLI sessions treated as a correctness bug in the unified source, not a user-visible filter to toggle — user flagged a specific missing session by ID to anchor the debug. [pos=2700 `msg=e57fb670…`]
- Phantom-session detection tightened: require BOTH the `Caveat: The messages below...` prefix AND zero assistant responses before hiding a session. A Caveat preamble alone is no longer enough to suppress a session. [pos=2780 `msg=ca191124…`]
- Title extraction walks past system-y content (Caveat preamble, `<bash-input>` / `<bash-stdout>` blocks, tool results) to the first *real* user message, instead of falling back to UUID. [pos=2754 `msg=edeb8bc5…`, pos=2780 `msg=ca191124…`]
- Landed as two separate commits (title fix, phantom-detection fix) rather than one squashed change — preserving the causal split in history. [pos=2784 `msg=930b6245…`]

## Code outcome
- Sidebar gained a top-of-panel refresh control that triggers both conversation sources.
- Message view now renders local-time timestamps on each turn.
- CLI-captured Claude Code sessions (e.g. `d1fcdd5c-d0c6-4b77-879f-fe0412fc1828` for `-Users-rpeck-Source-phillips-connect-ai`) appear correctly in the grouped/tree view.
- Commits landed: `f05d6eb` (skip system messages when extracting conversation title) and `7a59616` (fix phantom session detection for conversations with Caveat prefix). [pos=2787 `msg=aca0e8b3…`]

## Missteps / reverts
- First pass at unhiding CLI sessions showed the conversation but still labelled it "Caveat" — the phantom fix had worked, but the title path hadn't been updated to skip the Caveat message, so the UI looked broken even though the data was now present. [pos=2754 `msg=edeb8bc5…`]
- Fallback-to-UUID on title extraction was the tell that the first-user-message heuristic was too naive; it was walking into `<bash-input>pwd</bash-input>` and similar system content and giving up. [pos=2755 `msg=906fb0d6…`]
- Two "restart the frontend" interjections mid-phase — user driving the dev loop manually while fixes landed. [pos=2690 `msg=a4eee81b…`, pos=2748 `msg=c4eb384c…`]

## Memorable moments
- > I'm not seeing conversations that were done in the CLI, for example the ones for project -Users-rpeck-Source-phillips-connect-ai (I think that's session d1fcdd5c-d0c6-4b77-879f-fe0412fc1828).
  — pos=2700 `msg=e57fb670…` (sender: human)
- > Great! The conversation is displaying now. However, it still has the "Caveat" title rather than a proper title.
  — pos=2754 `msg=edeb8bc5…` (sender: human)
- > **The problem:** Two issues with sessions that start with local CLI commands: 1. **Phantom detection** — Sessions starting with "Caveat: The messages below..." were marked as phantom (hidden) even when they had real conversation content afterwards. Fixed by requiring BOTH the Caveat prefix AND zero assistant responses. 2. **Title extraction** — The title was taken from the first user message, which was often a system message like `<bash-input>pwd</bash-input>`. Fixed by skipping system messages (Caveat, bash I/O, tool results) to find the first *real* user message.
  — pos=2781 `msg=2601417c…` (sender: assistant)
- > Looks good! You committed, right?
  — pos=2784 `msg=930b6245…` (sender: human)

## Tone / mood
Tight debug loop with a specific reproducer in hand — user supplied the exact missing session UUID, asked "what was the problem?" after the fix landed, and verified the commits immediately. Overnight gap between 2026-03-11 and 2026-03-12 but no loss of context on resume.

## Cross-refs
- Upstream: Phase 10 (`claude_code_local_files_unification`) introduced the unified Claude Desktop + Claude Code source that this phase is polishing; Phase 12 (`caveat_filter_and_rename_explorer`) started the Caveat-message handling that this phase hardens.
- Downstream: sets up a cleaner grouped/tree sidebar as the stable surface that later UX and settings work builds on.
