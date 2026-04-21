# Phase 07 — viewer_tool_calls_and_branches

- **Session:** `a70251a5-b932-4b61-aba1-16a70410b98e`
- **Positions:** `[988..1250]`
- **Dates:** 2026-03-04 → 2026-03-04

## Goal
Diagnose the mysterious "black boxes" in the viewer's rendered Claude responses, replace the unhelpful placeholder text with something informative, then plan and begin implementing the tool-call toggle, per-block copy-to-clipboard buttons, a copy-all-as-Markdown button, optional branch visualization, and CMD-K "scroll to the matching message" — all coherently threaded through both the viewer and the Markdown/PDF exports.

## Opening prompt
> What are these black boxes in the Claude responses?

— pos=996 `msg=fdf30467…` (2026-03-04)

## Key decisions
- First theory — "it's a Claude Desktop rendering bug" — rejected by the user after one sentence; the screenshot was of the **exporter's own viewer**, so the bug is ours to fix. [pos=996 `msg=fdf30467…`, pos=998 `msg=91dd4de1…`]
- Root cause identified in two layers: (a) `.prose pre` had `bg-zinc-900` but no text color, so dark-on-dark text rendered as solid black rectangles; (b) the actual payload inside many boxes was the placeholder string "This block is not supported on your current device yet." [pos=998 `msg=91dd4de1…`, pos=1039 `msg=eb13bac6…`]
- Fix (a): add `color: var(--color-zinc-100)` to `.prose pre` in `index.css`. Fix (b): detect the placeholder text in `MarkdownRenderer` and render an informative info-box instead of a useless code block. [pos=1039 `msg=eb13bac6…`, pos=1040 `msg=464e5cab…`]
- Branch visualization kicked off as Phase 4a — create `BranchIndicator`, `TreeView`, `TreeViewModal` with a "View branches" button on the conversation header, backed by mock tree data + tests. [pos=1049 `msg=1279d55a…`]
- Full branch switching gated on real data: "IFF we actually have conversations that branch." Investigation found **0 conversations with branches**, so full switching UI is deferred; the tree visualization ships, the switcher does not. [pos=1129 `msg=0e65108d…`, pos=1132 `msg=9bbb71c8…`]
- A single `SettingsContext` (`showToolCalls`) is the source of truth for the tool-call toggle, consumed by both the viewer and the export endpoints (`.md` and `.pdf`) — one switch, both surfaces. [pos=1129 `msg=0e65108d…`]
- Per-block copy buttons use a "two overlaid pages" icon; a matching button at the top of the conversation copies the whole thread as Markdown. Both must respect the `showToolCalls` toggle when serializing. [pos=1129 `msg=0e65108d…`]
- CMD-K command-palette selection must **scroll to the matching message**, not just navigate to the conversation — implemented via a `data-message-uuid` attribute on each `MessageBubble` for the scroll target. [pos=1129 `msg=0e65108d…`]
- Conversation hit its context limit mid-implementation; auto-compaction summary captured the pending task list (messageToMarkdown utility, toggle UI, copy-all button, CMD-K scroll, backend export params) for a clean handoff. [pos=1144 `msg=940f1394…`]

## Code outcome
- CSS fix landed: `frontend/src/index.css` gets `color: var(--color-zinc-100)` on `.prose pre` — black boxes gone.
- `MarkdownRenderer.tsx` now detects the "not supported" placeholder and renders an informative message in its place.
- New: `frontend/src/contexts/SettingsContext.tsx` providing `{ showToolCalls, setShowToolCalls }`, wired in via `App.tsx`.
- New branch-visualization components: `components/branch/BranchIndicator.tsx`, `TreeView.tsx`, `TreeViewModal.tsx`, plus a "View branches" entry point on the conversation header.
- `MessageBubble.tsx` gains: `data-message-uuid` attribute (CMD-K scroll target), hover-revealed per-block copy button, `useSettings()` integration to hide `tool_use`/`tool_result` blocks when the toggle is off.
- Still pending at the compaction boundary: `messageToMarkdown` utility in `lib/utils.ts`, the toggle UI in the conversation header, the copy-all-Markdown header button, backend export endpoints taking `showToolCalls`, and CMD-K scroll wiring in `CommandPalette`.

## Missteps / reverts
- Assistant's first response blamed Claude Desktop for the black boxes — it was our own viewer. User corrected with "That screenshot was from your viewer, not Claude Desktop! Debug and fix." [pos=996 `msg=fdf30467…`, pos=998 `msg=91dd4de1…`]
- First pass at rendering the unsupported-block payload just showed the raw "This block is not supported on your current device yet." string inside a code block — user flagged it as useless: "Uh, ok... These aren't super helpful!" Replaced with a proper info box. [pos=1039 `msg=eb13bac6…`, pos=1040 `msg=464e5cab…`]
- Started branch visualization with a mock-data `TreeView`, then discovered no real conversations branch at all — had to narrow scope to visualization-only and drop the branch-switcher work. [pos=1049 `msg=1279d55a…`, pos=1132 `msg=9bbb71c8…`]
- `MessageBubble.tsx` was modified to import `messageToMarkdown` from `lib/utils.ts` before that function existed — a latent build break captured in the compaction summary as the next task to fix. [pos=1144 `msg=940f1394…`]

## Memorable moments
- > That screenshot was from your viewer, not Claude Desktop! Debug and fix.
  — pos=998 `msg=91dd4de1…` (sender: human)
- > Uh, ok... These aren't super helpful!
  — pos=1039 `msg=eb13bac6…` (sender: human)
- > Implement full branch switching, IFF we actually have conversations that branch. I'm not sure we do.
  — pos=1129 `msg=0e65108d…` (sender: human)
- > Add "two overlaid pages" icons to each block, which will copy to the clipboard. Also add one to the top, which will copy the Markdown to the clipboard. They should respect the toggle.
  — pos=1129 `msg=0e65108d…` (sender: human)
- > Finally, when the user searches with CMD-K you should scroll to the message that matches.
  — pos=1129 `msg=0e65108d…` (sender: human)
- > No branching conversations exist, so I'll skip full branch switching. Let me implement the other features:
  — pos=1132 `msg=9bbb71c8…` (sender: assistant)

## Tone / mood
Tight debugging loop with a blunt editor. Two assistant misfires (wrong bug attribution, then an ugly placeholder) drew short, sharp corrections; once the diagnosis landed, the user pivoted immediately into a dense multi-feature spec — toggle + copies + CMD-K scroll — delivered as a single paragraph with an explicit "IFF" conditional that saved a day of branch-switcher work.

## Cross-refs
- Upstream: builds on the CMD-K command palette created earlier in the session (pre-pos=988, per the compaction summary at pos=1144) and on the PDF/Markdown export pipeline from Phase 05 — both now need to honor `showToolCalls`.
- Downstream: the auto-compaction at pos=1144 hands off five concrete pending tasks (messageToMarkdown, toggle UI, copy-all, backend `showToolCalls`, CMD-K scroll) which the next phase must land. Branch-switching UI is parked until a real branching conversation appears in the corpus.
