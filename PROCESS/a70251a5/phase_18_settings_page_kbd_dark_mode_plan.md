# Phase 18 — settings_page_kbd_dark_mode_plan

- **Session:** `a70251a5-b932-4b61-aba1-16a70410b98e`
- **Positions:** `[3281..3810]`
- **Dates:** 2026-03-20 → 2026-03-20

## Goal
Kick off the "v2" UI polish pass via `/coding`: audit the `PLANS/` docs against the live implementation, then execute a single seven-item numbered directive — settings page, emacs/vi keyboard navigation, toast notifications, fleshed-out tests (unit / integration / Playwright E2E), a full docs refresh (main + fetcher READMEs + `CHANGELOG.md`), and dark mode with **system as the default**. Most of the implementation happens across context-continuation compactions inside this range.

## Opening prompt
> Where did we leave off?

— pos=3282 `msg=f5e78fb6…` (2026-03-20)

The real driver prompt lands a few turns later, once the front/back ends are running and the gap-analysis is on the table:

> /coding
> 1. CMD-K works...
> 2. What would be in a settings page?
> 3. Add keyboard navigation (allow the user to switch between emacs keybindings by default and vi bindings).
> 4. What do you mean by Toast notifications?
> 5. Flesh out the tests (unit, integration, end-to-end using Playwright).
> 6. Update / create comprehensive docs (main and fetcher).
> 7. Add dark mode; system mode should be the default.

— pos=3333 `msg=584faf50…` (2026-03-20)

## Key decisions
- Re-orient on the project with a "where did we leave off?" rather than diving straight back into code. [pos=3282 `msg=f5e78fb6…`]
- Before writing any code, **audit `PLANS/` against the live implementation** and produce an explicit "what's missing" table (CommandPalette, dark mode, bulk zip export, dedicated `/search` page, `/settings` page, virtualized list, keyboard navigation, toast notifications, READMEs, tests). [pos=3321 `msg=54a834ae…`, pos=3332 `msg=1668cce0…`]
- Treat the user's seven numbered items as a single `/coding` work order — item 1 (`CMD-K works...`) is explicitly a no-op, the other six drive the phase. [pos=3333 `msg=584faf50…`]
- Answer the user's clarifying sub-questions inline before touching code: define what belongs on a settings page (Theme, Keyboard mode, Data dir, Conversation count, Cache controls, About) and what "toast notifications" means (transient auto-dismiss popups, distinct from the existing connection-status dialog). [pos=3336 `msg=6b182fb3…`]
- Dark mode architecture: three-valued `theme` state (`'light' | 'dark' | 'system'`) with a computed `effectiveTheme`, `matchMedia('(prefers-color-scheme: dark)')` listener for system, applied via a `.dark` class on the document element, persisted through `SettingsContext`, with a sidebar-footer toggle that cycles Light → Dark → System. **System is the default**, per the user's explicit instruction. [pos=3333 `msg=584faf50…`, pos=3539 `msg=b05bb783…`]
- Keyboard-navigation architecture: dedicated `KeyboardNavigationContext` + `useKeyboardShortcuts` hook, **Emacs bindings default** (Ctrl+N/P, Ctrl+F/B, Ctrl+S, Escape), Vim bindings opt-in (j/k, l/h, /, gg/G), plus a `?` help modal listing every shortcut. [pos=3333 `msg=584faf50…`, pos=3539 `msg=b05bb783…`]
- Settings page gets its own `/settings` route with four sections — Appearance, Keyboard Navigation, Data, About — rather than a modal overlay. [pos=3539 `msg=b05bb783…`]
- Tests are broadened in one sweep across three layers: Vitest unit (`SettingsContext.test.tsx`), pytest backend (`test_config.py`, `test_conversations.py`, `test_search.py`, `test_export.py` + shared `conftest.py`), Playwright E2E (`settings.spec.ts`, `theme.spec.ts`, `keyboard-navigation.spec.ts`). [pos=3539 `msg=b05bb783…`]
- Docs refresh lands as three files together: update root `README.md` with a features section, create `CHANGELOG.md`, create `fetcher/README.md` with CLI usage. [pos=3539 `msg=b05bb783…`]
- After implementation, run the full test suite before declaring done — "run the tests to make sure everything works" is a hard gate, not a suggestion. [pos=3540 `msg=90aa7768…`]
- E2E tests require a live backend; starting the backend is part of running the suite, not a separate prerequisite. [pos=3575 `msg=fbcf2ca2…`]

## Code outcome
New files created across backend, frontend, and docs:
- Frontend UI: `frontend/src/routes/SettingsPage.tsx`, `frontend/src/components/ui/radio-group.tsx`, `frontend/src/contexts/KeyboardNavigationContext.tsx`, `frontend/src/hooks/useKeyboardShortcuts.ts`, `frontend/src/components/KeyboardHelpModal.tsx`.
- Frontend tests: `frontend/src/test/contexts/SettingsContext.test.tsx`, `frontend/e2e/settings.spec.ts`, `frontend/e2e/theme.spec.ts`, `frontend/e2e/keyboard-navigation.spec.ts`.
- Backend tests: `backend/tests/conftest.py`, `backend/tests/test_config.py`, `backend/tests/test_conversations.py`, `backend/tests/test_search.py`, `backend/tests/test_export.py`.
- Docs: `CHANGELOG.md` (new), `fetcher/README.md` (new), `README.md` (features section added).
- Touched: `SettingsContext` extended with `theme` + `effectiveTheme`, sidebar footer gets the theme-cycle button, `ConversationList` highlights the keyboard-selected row and auto-scrolls. [pos=3539 `msg=b05bb783…`]

No commits are landed inside this phase — the work is staged and the test run is what validates it. [pos=3540 `msg=90aa7768…`]

## Missteps / reverts
- First attempt to open the frontend via `open` failed because neither the backend nor the frontend was actually running; user had to prompt the assistant to notice and start them. [pos=3308 `msg=774077d1…`, pos=3312 `msg=ab51954c…`]
- Initial E2E test run failed with no backend up; the assistant had to start the backend and re-run. [pos=3575 `msg=fbcf2ca2…`]
- Two `/coding` invocations were interrupted by the user mid-flight and re-issued — one outright `[Request interrupted by user for tool use]` near the end of the range, and a re-launch with a more specific brief: "Debug and fix all the failing tests." [pos=3765 `msg=55b6d995…`, pos=3781 `msg=d213e655…`, pos=3782 `msg=d9a08e0b…`]
- The range straddles two context-continuation compactions (pos=3356 and pos=3577), meaning most of the actual code-writing happens inside summarized context rather than inline in the transcript.
- **Toast notifications shipped as scaffolding only.** `sonner ^2.0.7` was added to `frontend/package.json:42`, `import { Toaster } from 'sonner'` landed in `frontend/src/App.tsx:4`, and `<Toaster position="bottom-right" />` was mounted at `frontend/src/App.tsx:58` — but a repo grep (`toast\.` across `frontend/src`) finds **zero** call sites. Item #6 of the seven-item `/coding` order half-shipped: infrastructure landed, but no feature (refresh complete, export complete, copy-to-clipboard, fetcher done, API errors) ever actually fires a toast. [confirmed 2026-04-19 by repo inspection]

## Memorable moments
- > Where did we leave off?
  — pos=3282 `msg=f5e78fb6…` (sender: human) — the phase's understated opener.
- > It's not working. Are the front and back ends running? If not, start them.
  — pos=3312 `msg=ab51954c…` (sender: human) — the recurring "check your assumptions before opening a browser" nudge.
- > Take a look at our plans. What's missing from our implementation?
  — pos=3321 `msg=54a834ae…` (sender: human) — the pivot from "resume" to "audit-then-plan."
- > /coding
  > 1. CMD-K works... 2. What would be in a settings page? 3. Add keyboard navigation (allow the user to switch between emacs keybindings by default and vi bindings). 4. What do you mean by Toast notifications? 5. Flesh out the tests ... 6. Update / create comprehensive docs ... 7. Add dark mode; system mode should be the default.
  — pos=3333 `msg=584faf50…` (sender: human) — the seven-item work order that defines the v2 UI pass.
- > Toasts are those small popup messages that appear briefly ... they auto-dismiss after a few seconds. Currently you only have the connection status dialog - toasts would be for transient feedback.
  — pos=3336 `msg=6b182fb3…` (sender: assistant) — answering the clarifying sub-question before coding.
- > run the tests to make sure everything works
  — pos=3540 `msg=90aa7768…` (sender: human) — the non-negotiable verification gate.
- > Debug and fix all the failing tests.
  — pos=3782 `msg=d9a08e0b…` (sender: human) — the follow-up `/coding` re-launch after interruption.

## Tone / mood
Directive and list-driven. The user opens soft ("where did we leave off?") but the substantive prompt is a tightly numbered seven-item spec with preferences baked in (Emacs default, system theme default) and clarifying sub-questions treated as mandatory to answer before coding. The assistant does a gap-analysis table first, answers the sub-questions inline, then executes all six non-no-op items together across two compactions. User interrupts twice when the work drifts, and re-scopes the second `/coding` invocation to "fix the failing tests" — a tighter brief than the original.

## Cross-refs
- Upstream: Phase 17 (dev-env noise / pkill permissions) leaves the stack in the "need to actually run things to verify" posture that this phase opens on.
- Downstream: Phase 19 (merged `keyboard_and_search_navigation` phase) picks up item 3 of the seven — the keyboard-navigation feature — and develops it in depth (two-pane navigation, Vim/Emacs mode polish, Cmd+G search navigation). This phase seeds it; Phase 19 matures it. Settings page, dark mode, toasts, broader tests, and the docs refresh (`CHANGELOG.md`, `fetcher/README.md`) all trace their initial landing to this phase.
