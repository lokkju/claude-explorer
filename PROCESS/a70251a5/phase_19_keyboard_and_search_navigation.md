# Phase 19 — keyboard_and_search_navigation

- **Session:** `a70251a5-b932-4b61-aba1-16a70410b98e`
- **Positions:** `[3811..4842]`
- **Dates:** 2026-03-21 → 2026-04-18

## Goal
Design and ship full two-pane keyboard navigation (Vim + Emacs modes) across the sidebar and the message detail panel, then iterate on it across roughly a month of real use — tightening the focus model, restoring symmetric Ctrl+N/P behavior, adding CMD-C/CMD-F/CMD-G search-and-copy, surfacing a "Match N of M" overlay, and finally making CMD-G blazing fast via an in-conversation fast path plus background prefetch of adjacent match conversations.

## Opening prompt
> ^P / ^N navigate the sidebar, but not the detail window. I'd like to be able to think through control of focus across these two panes, as a team of world-class UX designers, and propose a way to be able to navigate both between conversations and between turns, all using the keyboard.

— pos=3955 `msg=146425ff…` (2026-03-21, invoked via `/coding`)

## Key decisions

### Era 1 — First version: two-pane Vim/Emacs bindings (2026-03-21)
- Kick off with `/coding` LLM-council ultrathink to design focus control across the sidebar/detail panes rather than just patching `^N`/`^P` in one place. [pos=3955 `msg=146425ff…`]
- Adopt the Vim-column pattern for Emacs mode too: **Enter** to descend from the sidebar into the detail panel, **Esc** to pop back. "It seems very natural." [pos=3960 `msg=f32f630d…`]
- Rethink the jump keys for the detail pane: `u`/`a` = next user / next assistant message, `U`/`A` = previous; leave Vim `j`/`k` navigate keys as-is; `M-p`/`M-n` = page up/down. [pos=3962 `msg=8c87fb38…`]
- Greenlight the plan and implement it. [pos=3964 `msg=3732a4c6…`]
- Extend sidebar navigation into the starred-sessions group, and add arrow-key mappings alongside the modal bindings. [pos=4024 `msg=c0330a67…`]
- Bind **CMD-R** to the existing refresh button so reload doesn't dump the SPA. [pos=4112 `msg=bed109bb…`]
- Ship the first cut: commit `aa6e781 Add two-pane keyboard navigation with Vim/Emacs modes`. [pos=4052 `msg=d71e90b6…`]

### Era 2 — User experience reveals the gaps (2026-03-21 → 2026-04-13)
- After hands-on use, ESC from detail leaves the sidebar with no visible selection highlight. [pos=4090 `msg=fc07317f…`, pos=4100 `msg=ae260ed8…`]
- Detail-view focus highlighting also broken — the selected message cell isn't outlined. [pos=4132 `msg=ab48d751…`]
- Tool-call bubbles render in the detail view even when the tool-call toggle is off — and the toggle should be off by default. [pos=4068 `msg=ff222b94…`]
- Multi-bug report after a long quiet stretch: Emacs bindings in the message pane regressed; PDF and Markdown exports contain "weird blank messages" that look like tool calls — we need an export-time toggle for tool calls (screenshot attached). [pos=4251 `msg=3f914e4c…`, pos=4252]
- `^N`/`^P` now work in the messages panel but not in the sidebar — the whole focus model needs to be explicit. [pos=4326 `msg=49d158c4…`]
- Spec the focus model formally: "**We need to have a clear notion of focus in being in one or the other, and how the focus switches: `<enter>` in the sidebar should switch focus to the messages panel; `<esc>` should switch back to the sidebar. Then, `^n`/`^p` and the vi keybindings and arrow keys should work within the panel which has focus.**" [pos=4326 `msg=49d158c4…`]
- Global rule surfaced mid-phase after a broad `pkill uvicorn`: "I'm working on multiple projects that use Uvicorn. You need to be more selective with your `pkill` commands! Remember this." [pos=4308 `msg=1854813a…`]

### Era 3 — Iterative UX improvements (2026-04-14 → 2026-04-18)
- Sidebar symmetry pass: `^N`/`^P` in the sidebar, plus click-to-focus on either the sidebar row or anywhere in the message pane (background included). [pos=4398 `msg=e80a7c77…`]
- Still broken after one attempt: "`^p`/`^n` don't work in the sidebar." — iterate until they do. [pos=4422 `msg=2b245534…`]
- Decouple sidebar navigation from detail loading: when `^P`/`^N` changes the selection in the sidebar, blank the conversation pane and render a hint "*Hit `<enter>` to select this conversation.*" rather than eagerly loading every neighbor. [pos=4540 `msg=f647d6f2…`]
- Search-and-copy spec: **CMD-C** copies the focused cell (`^C` non-Mac); **CMD-F** jumps to and selects the find text from anywhere; **CMD-G** repeats forward; **CMD-Shift-G** repeats backward. [pos=4580 `msg=450b72ef…`]
- Restore per-message selection outline in the conversation panel — currently only the first message highlights. [pos=4722 `msg=b2467425…`]
- CMD-G/CMD-Shift-G bug: sidebar selection drifts by one after Enter, and search only jumps to a conversation — it should jump to the specific matching turn. [pos=4730 `msg=cd8bd867…`]
- Add a visible affordance so the user knows how to iterate matches. [pos=4752 `msg=df1bbe92…`]
- Tighten the full search loop: "When navigating between searches, focus should be given to the conversation pane and the current search result should be selected. This way, we can CMD-F `<some-string>` and then CMD-C to copy the message." [pos=4760 `msg=7356c2e4…`]
- Ship the big iteration: commit `826e794 Improve keyboard navigation, search, and export`.
- Performance complaint triggers a `/plan` + LLM-council step: CMD-G works but is "super slow, and there's no indication to the user that it's 'thinking'" — commit what's there, then have the council think step-by-step about a fast path ("the initial search results should have direct indexes to the messages, right?"). [pos=4796 `msg=9671cb18…`]
- Final ship: in-conversation matches take a synchronous fast path; background task prefetches the ±2 adjacent conversations with matches so cross-conversation CMD-G feels instant. Committed as `85a07b1 Optimize Cmd+G search navigation with prefetch and fast path`. [pos=4831 `msg=015920bd…`]

## Code outcome
- Commits landed (in order):
  - `aa6e781` — Add two-pane keyboard navigation with Vim/Emacs modes (Era 1).
  - `826e794` — Improve keyboard navigation, search, and export (Era 2 fixes + Era 3 search/copy spec; focus model, `^N`/`^P` symmetry, CMD-C/CMD-F/CMD-G, tool-call export toggle, "Match N of M" overlay, per-message selection outline).
  - `85a07b1` — Optimize Cmd+G search navigation with prefetch and fast path.
- Frontend changes span `frontend/src/App.tsx`, components for the sidebar/detail panes, search UI, and a new settings surface (see `frontend/src/routes/SettingsPage.tsx`, `frontend/src/components/ui/radio-group.tsx`) for keybinding-mode selection.
- Backend export path gained a tool-call include/exclude toggle wired through `backend/routers/conversations.py`.
- Playwright E2E expanded to lock behavior down: `frontend/e2e/conversations.spec.ts`, `mobile.spec.ts`, `search.spec.ts`, plus new `connection-status.spec.ts`, `settings.spec.ts`, `theme.spec.ts`.

## Missteps / reverts
- First Era-1 ship claimed Emacs `^N`/`^P` worked in both panes, but by Era 2 the detail pane had regressed to not responding — required focus-model rework rather than a point fix. [pos=4251 `msg=3f914e4c…`]
- Multiple rounds of "still broken" on sidebar `^N`/`^P` before the click/focus model was made explicit. [pos=4398 `msg=e80a7c77…`, pos=4422 `msg=2b245534…`]
- Early CMD-G jumped only to a conversation, not to the matching turn — had to be redone to track per-message matches and steer focus into the conversation pane with the matching cell selected. [pos=4730 `msg=cd8bd867…`, pos=4760 `msg=7356c2e4…`]
- First working CMD-G was correct but "super slow" with no spinner — required a dedicated perf pass (fast path + prefetch) before it felt right. [pos=4796 `msg=9671cb18…`]
- A broad `pkill uvicorn` blew away other projects' servers mid-phase, earning a standing rule to scope process-kills narrowly. [pos=4308 `msg=1854813a…`]

## Memorable moments
- > For emacs mapping, let's use Enter/Esc the same way as in your Vim Mode column. It seems very natural to Enter on a conversation in the sidebar to load it and change focus to the detail panel, and Esc from the detail panel moving back to the sidebar. think very hard
  — pos=3960 `msg=f32f630d…` (sender: human)
- > How about u and a to go to the NEXT user or assistant message, and U / A to move backward?
  — pos=3962 `msg=8c87fb38…` (sender: human)
- > We need to have a clear notion of focus in being in one or the other, and how the focus switches: `<enter>` in the sidebar should switch focus to the messages panel; `<esc>` should switch back to the sidebar.
  — pos=4326 `msg=49d158c4…` (sender: human)
- > When in the conversation panel, have CMD-c copy the cell … have CMD-F jump to and select the find (search) text, and have CMD-G search again. CMD-SHIFT-G should go backwards through the search results.
  — pos=4580 `msg=450b72ef…` (sender: human)
- > When the user changes the conversation in the sidebar, erase the conversation panel and just render a hint to the user: "Hit `<enter>` to select this conversation."
  — pos=4540 `msg=f647d6f2…` (sender: human)
- > When navigating between searches, focus should be given to the conversation pane and the current search result should be selected. This way, we can CMD-F `<some-string>` and then CMD-C to copy the message.
  — pos=4760 `msg=7356c2e4…` (sender: human)
- > CMG-G and CMD-SHIFT-G seem to be working. But they are super slow, and there's no indication to the user that it's "thinking" while going to the next match. … Have the llm coding council think step by step … the initial search results should have direct indexes to the messages, right?
  — pos=4796 `msg=9671cb18…` (sender: human)
- > That worked. Commit it.
  — pos=4831 `msg=015920bd…` (sender: human — the CMD-G prefetch ship)
- > Hey, I'm working on multiple projects that use Uvicorn. You need to be more selective with your pkill commands! Remember this.
  — pos=4308 `msg=1854813a…` (sender: human)

## Tone / mood
Patient, iterative, and UX-led. The user treats the first Vim/Emacs ship as a draft, not a destination: each follow-up prompt is grounded in actually using the product — "ESC out of the detail view … isn't highlighted," "only the first message is highlighted," "super slow, and there's no indication." The fixes come in waves separated by days, but each wave lands on a clearer mental model than the last, ending with an explicit focus model and a measurable perf win.

## Cross-refs
- Upstream: builds on the Vim-mode two-pane layout and search UI from earlier frontend phases; relies on the full-text search index established when the backend search endpoint was introduced.
- Downstream: the focus-model invariant ("exactly one of {sidebar, detail} has focus; Enter descends, Esc pops") becomes load-bearing for subsequent UX work — settings page navigation, connection-status popup dismissal, and any future modal surfaces inherit the same rules. The CMD-G prefetch pattern (fast path in-conversation + background prefetch of ±2 neighbors) is the template for any later "navigate across server-paged results" feature.
- Medium-series note: **this is the Part 5 retrospective centerpiece** — the arc from Vim-column-inspired first cut → user-informed iteration → perf-driven final ship is the cleanest single example in the whole session of "ship, use, fix, repeat" done deliberately across weeks.
