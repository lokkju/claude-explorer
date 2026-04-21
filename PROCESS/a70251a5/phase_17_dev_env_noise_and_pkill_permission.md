# Phase 17 — dev_env_noise_and_pkill_permission

- **Session:** `a70251a5-b932-4b61-aba1-16a70410b98e`
- **Positions:** `[3113..3280]`
- **Dates:** 2026-03-16 → 2026-03-16

## Goal
Cut down the friction of the dev-inner-loop: stop getting permission-prompted for the backend-restart incantation the assistant kept running, stop being alarmed by red-ink browser-console errors that weren't from this app, and diagnose a hung front end. Along the way, establish a durable safety rule about the blast radius of `kill`/`pkill` on a machine that hosts multiple Python projects at once.

## Opening prompt
> How can we add this command you keep running to our project permissions?
>
> `lsof -ti:8000 | xargs kill -9 2>/dev/null; sleep 2 && DYLD_LIBRARY_PATH=/opt/homebrew/lib ~/.local/bin/uv run uvicorn backend.main:app --port 8000`
>
> Can we add the sub-commands to our permissions?
>
> Also add permission to run sed.

— pos=3205 `msg=661bddf3…` (2026-03-16)

## Key decisions
- Codify the backend-restart one-liner into project permissions so the assistant stops triggering a permission prompt on every iteration. [pos=3205 `msg=661bddf3…`]
- **Never broad-`pkill uvicorn` / `pkill vite`.** User runs multiple Python projects simultaneously; a bare `pkill uvicorn` would nuke unrelated servers. Scope every kill to a specific port via `lsof -ti:PORT | xargs kill`. [pos=3222 `msg=36b396b2…`, pos=3223 `msg=dc205c8f…`]
- Port-specific `lsof -ti:8000 | xargs kill -9` is acceptable; the surgical scope is what makes it safe to preauthorize. [pos=3205 `msg=661bddf3…`, pos=3223 `msg=dc205c8f…`]
- Also preauthorize `sed` as a sub-command so text edits stop hitting a prompt each time. [pos=3205 `msg=661bddf3…`]
- Classify browser-console noise as **not ours** and stop chasing it: `refresh.js` WebSocket on `ws://localhost:8081` is a live-reload browser extension; `content.js` "You haven't signed in yet" is an injected content script (user confirmed: TinaMind AI extension). [pos=3230 `msg=22048c60…`, pos=3231 `msg=3fab7285…`, pos=3232 `msg=db763567…`, pos=3233 `msg=9f69bcce…`]
- Treat the "listener indicated an asynchronous response… message channel closed before a response was received" error the same way — canonical Chrome-extension noise, not an app bug — but still verify the named conversation loads. [pos=3234 `msg=6223b291…`, pos=3235 `msg=5d68d998…`]
- When "front end isn't responding in the browser," the loop is: kill port 5173, restart vite, reload — not "pkill node." [pos=3214 `msg=3fc1e0e5…`]

## Code outcome
- `.claude/settings.json` (or equivalent project permissions file) updated to preauthorize the narrow, port-scoped restart pipeline and `sed`. No broad `pkill` entry added.
- No application-code changes — this phase is environment/permissions hygiene plus triage of false-positive console errors.
- Hung front end resolved by a port-scoped restart; the 500 on `/api/conversations/:id/tree` observed at pos=3121 was the trailing symptom that led into the restart churn.

## Missteps / reverts
- Early assistant instinct was to reach for `pkill` as the easy-to-allowlist primitive; user vetoed ("I'm kinda scared of allowing pkill!") and the rule got narrowed to port-scoped `lsof | xargs kill`. [pos=3222 `msg=36b396b2…`, pos=3223 `msg=dc205c8f…`]
- Spent attention on browser-console red text that turned out to be entirely third-party extensions — recoverable only because the user named the offending extension (TinaMind) rather than letting the assistant keep digging. [pos=3230 `msg=22048c60…`, pos=3232 `msg=db763567…`]

## Memorable moments
- > I'm kinda scared of allowing pkill!
  — pos=3222 `msg=36b396b2…` (sender: human)
- > How can we add this command you keep running to our project permissions? `lsof -ti:8000 | xargs kill -9 …`
  — pos=3205 `msg=661bddf3…` (sender: human)
- > Good call! Let me make it more specific and safer:
  — pos=3223 `msg=dc205c8f…` (sender: assistant)
- > Ah, the login thing is from my TinaMind AI extension.
  — pos=3232 `msg=db763567…` (sender: human)
- > Those are from **browser extensions**, not our app… You can ignore these — they're just noise from extensions running in your browser, not related to Claude Explorer.
  — pos=3231 `msg=3fab7285…` (sender: assistant)
- > The front end isn't responding in the browser.
  — pos=3214 `msg=3fc1e0e5…` (sender: human)

## Tone / mood
Pragmatic housekeeping with a sharp safety instinct. The user is willing to loosen permissions to reduce friction, but only at a precisely-scoped granularity — and is explicit about the threat model ("scared of pkill") rather than hand-waving it. The assistant adjusts quickly from "allowlist the easy primitive" to "allowlist the narrow one."

## Cross-refs
- Upstream: Phase 01's commit-hygiene rule ("NEVER give yourself credit in commit messages") set the pattern that this session produces durable, codified operational rules, not just one-off fixes. This phase extends that pattern to permissioning.
- Downstream: This phase is the origin point for the standing rule later memorialized as `feedback_pkill_uvicorn.md` in auto-memory — "Never broad-pkill uvicorn/vite; user runs multiple projects." Every subsequent phase that restarts a dev server inherits the port-scoped-kill constraint from here.
