# Phase 16 — connection_status_popup

- **Session:** `a70251a5-b932-4b61-aba1-16a70410b98e`
- **Positions:** `[2862..3112]`
- **Dates:** 2026-03-15 → 2026-03-15

## Goal
Give the front end a real story for "backend is down": a retry loop with visible progress, a "backend unreachable" popup with a reconnect button when retries are exhausted, Playwright coverage for both states, and a clean recovery once the backend comes back — without the dialog flashing on a healthy first load.

## Opening prompt
> If after N retries the back end still isn't usable I want you to show a popup explaining it to the user, and implement a reconnect button there.
>
> While you're at it, I also want a floating translucent "jump to the bottom" button in the detail pane, like many sites have.

— pos=2911 `msg=e62573ef…` (2026-03-15)

## Key decisions
- Keep React Query as the retry primitive but retune it: 5 attempts with exponential backoff (1s → 2s → 4s → 8s → 10s cap) rather than the default 3. [pos=2906 `msg=49480093…`, pos=2910 `msg=4615edd8…`]
- Add a dedicated `ConnectionStatus` component that owns both the "Attempt X of 5" progress and the terminal "backend unreachable" dialog, instead of bolting state onto the list view. [pos=2952 `msg=fc228974…`, pos=2960 `msg=4b25c221…`]
- Reuse the same dialog shell for retrying and failed states so the UI doesn't jump between a banner and a modal. [pos=3014 `msg=96e64ee9…`, pos=3025 `msg=418f0434…`]
- Lighten the modal backdrop from `bg-black/80` to `bg-black/40` — user judgment call, not a design-system change. [pos=3026 `msg=1f6ba7ad…`, pos=3054 `msg=76d76d16…`]
- Add a Playwright e2e suite covering the retry/failure/reconnect flow (`frontend/e2e/connection-status.spec.ts`) — 8 tests, exercised by stopping/starting the real backend. [pos=3026 `msg=1f6ba7ad…`, pos=3052 `msg=6901c628…`]
- Manual validation protocol: user shuts down the backend, restarts only the front end, watches for retry → popup, then asks for the backend to be restarted to verify reconnect. [pos=2953 `msg=c50f0a1f…`]

## Code outcome
- New: `frontend/src/components/ConnectionStatus.tsx`; `frontend/e2e/connection-status.spec.ts`.
- Modified: `frontend/src/components/ui/dialog.tsx` (lighter backdrop), `frontend/src/App.tsx` (mount `ConnectionStatus`), React Query retry config.
- Behavior: on load, the dialog only appears after the first failure (not during the optimistic first request); while retrying it shows "Attempt N of 5"; on exhaustion it flips to an unreachable message with a Reconnect button that re-kicks the query. [pos=3066 `msg=f81ecd55…`, pos=3098 `msg=89e42a7d…`]
- Playwright suite: 8 tests green locally. [pos=3052 `msg=6901c628…`]
- Deferred in this phase: the "jump to bottom" floating button was requested in the same prompt but ended up tracked separately — this phase stayed focused on connection status.

## Missteps / reverts
- First pass: user got only a red "Failed to load conversations" notice and no popup, no attempt counter — the retry was happening but nothing surfaced it. [pos=2959 `msg=8713dfcd…`]
- After the dialog landed, user reported "It seems like it connected to the back end, but then I got a retry popup" — the dialog was flashing during the initial request because `retryCount` was being set to 1 before the first result was known. Fix: only increment retry state after an actual failure. [pos=3055 `msg=934d36b2…`, pos=3066 `msg=f81ecd55…`]
- Same console dump surfaced an unrelated `<button>` nested inside `<button>` hydration warning in `ConversationListItem` (outer wrapper was a button, inner subagent toggle also a button). Fixed by converting the outer to a `<div>`. [pos=3055 `msg=934d36b2…`, pos=3062 `msg=287e5c27…`]
- Long Playwright re-run after the fixes was timing out on the retry intervals; killed and verified manually instead. [pos=3084 `msg=e3f8a8c1…`]
- Final twist: once reconnection was working, the backend itself was stuck — "98.7% CPU and 22GB RAM" — requiring a force-kill of port 8000 to actually finish the session cleanly. [pos=3099 `msg=78a21901…`, pos=3106 `msg=5a7ccbd3…`, pos=3112 `msg=6004b4f3…`]
- Two user interrupts mid-tool-use during the initial build (`[Request interrupted by user]` at pos=2923 and pos=2928, both followed by "continue") — a sign the first implementation attempt was wandering.

## Memorable moments
- > If after N retries the back end still isn't usable I want you to show a popup explaining it to the user, and implement a reconnect button there.
  — pos=2911 `msg=e62573ef…` (sender: human)
- > test the connection popup by shutting down the back end and restarting just the front end. I'll check if the retry loop ends with the popup, and if it does I'll have you restart the back end so I can reconnect.
  — pos=2953 `msg=c50f0a1f…` (sender: human)
- > The front end should keep the user apprised of its attempts to connect... and I didn't get any popup / connect button, just a red notice "Failed to load conversations".
  — pos=2959 `msg=8713dfcd…` (sender: human)
- > It looks pretty good. Make the background 50% lighter; it's too black. Then, create a Playwright end to end test for this connectity / retry stuff.
  — pos=3026 `msg=1f6ba7ad…` (sender: human)
- > Hm. It seems like it connected to the back end, but then I got a retry popup... And conversation details aren't loading.
  — pos=3055 `msg=934d36b2…` (sender: human)
- > Is the back end running?
  — pos=3099 `msg=78a21901…` (sender: human)
- > The backend is running but stuck — using **98.7% CPU and 22GB RAM**! Something is causing it to spin.
  — pos=3106 `msg=5a7ccbd3…` (sender: assistant)

## Tone / mood
Hands-on QA loop — user drives the test matrix manually (stop backend, reload, watch, restart backend), catches every regression the automation missed (no popup at all, then popup flashing on success, then a nested-button hydration warning surfaced by the same reload), and keeps the scope honest: don't just ship the happy path, prove the unhappy one and the recovery.

## Cross-refs
- Upstream: builds on the React Query data layer established for the conversation list/detail panes; reuses the shadcn `dialog.tsx` primitive whose backdrop gets softened here.
- Downstream: the Playwright suite (`frontend/e2e/connection-status.spec.ts`) joins a growing e2e set (`conversations.spec.ts`, `search.spec.ts`, `mobile.spec.ts`, `theme.spec.ts`, `settings.spec.ts`); the "jump to bottom" button requested at pos=2911 is picked up in a later phase. The `<button>`-in-`<button>` fix in `ConversationListItem` is a side-quest bugfix that predates subsequent keyboard-navigation work on the list.
