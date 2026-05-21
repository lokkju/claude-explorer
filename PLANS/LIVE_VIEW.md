# Live Session Monitor — watch a CC session in the browser as it happens

## Context

The CC CLI gives the user almost no visibility into what Claude is doing during long-running tasks (hour-long sessions are common). They see the streaming text of the current response but lose track of:

- Which tools have been called and what arguments
- What the tool results actually returned
- Whether Claude is stuck in a long shell command vs. thinking vs. waiting for an LLM response
- The overall arc of the session

Claude Explorer already has the full conversation viewer. Goal: turn it into a **live monitor**. When the user opens a conversation that is currently being written to, they see new messages, tool calls, and tool results appear in real time as Claude works. No refresh, no polling.

This is post-V1 polish — gates on V1 shipping first.

## Empirical findings (the user's specific question)

JSONL write cadence on the active session `a70251a5-b932-4b61-aba1-16a70410b98e.jsonl`:

- **87,760 records / 328 MB** — files grow continuously throughout a session
- **mtime advances on every tool turn** (sub-second between append and observed mtime change)
- **Each event is a complete JSONL line** appended atomically: user message, assistant message, tool_use block, tool_result block. No per-token streaming — granularity is per-message-or-tool-call, which is plenty for "is something happening" visibility.
- **Schema** (from `cc_jsonl_io.py:_parse_jsonl_line`): each "message" record has top-level `uuid`, `parentUuid`, `isSidechain`, `type` (`user`/`assistant`), `message` (full Anthropic SDK response shape — `content` array of text/tool_use/tool_result blocks), `promptId`, `timestamp` ISO-8601. Some bookkeeping records (e.g. agent-init) do NOT have `uuid` — those are filtered out by the existing parser and irrelevant to resume tokens.
- **File watcher already fires on JSONL appends** (`backend/cc_watcher.py:_ProjectsEventHandler` at line 522). Today the only consumer is the search-index drift pass with a 2s debounce. We add a second consumer (live-tail dispatcher) running on the same observer.

## Council Decision Record (3-model, 2 rounds)

Three personas reviewed and converged via cross-critique:
- **Gemini-3-pro** (Platform Architect): synchronization + concurrency
- **GPT-5** (Adversarial Critic): failure modes + test theater
- **Gemini-2.5-pro** (Pragmatic Reviewer): user value + UX coherence

### Unanimous decisions (applied below)

| # | Decision | Rationale |
|---|---|---|
| 1 | **Resume token = top-level JSONL `uuid` + `last_known_size` + inode validation** | Closes the REST→SSE race; handles truncation/rotation. Single seek-to-EOF is unsafe. |
| 2 | **Newline-bounded reads with carry-buffer** | OS-level torn writes are real. Bytes after the last `\n` go into a per-subscription buffer and prepend to the next read. |
| 3 | **Drop pause button** | Scroll-pin already gives users the "freeze" affordance. Two ways to pause is one too many. |
| 4 | **Drop the header "● LIVE" pill** | Redundant with the sidebar dot AND with the appearance of new bubbles. |
| 5 | **Drop the backend `is_live: bool` mtime heuristic** | Falsely turns "off" during long-running tools. UI liveness should reflect the actual SSE connection state, not mtime. |
| 6 | **Single-process constraint documented** | Process-local `asyncio.Queue` registry doesn't survive `--workers=2`. Realistic deployment: localhost uvicorn `--workers=1` (default). Add a startup guard that disables live SSE if multi-worker is detected. |
| 7 | **Drop the 16-subscriber cap** | Single-user desktop app. OS limits more than sufficient. |
| 8 | **Long-running tool gap is a known limitation** | JSONL only flushes per-tool-call. During a 10-min bash, no events arrive. Documented; partial mitigation via two-tier liveness signal (below). Not fixable without modifying CC. |

### Two-tier liveness signal (Gemini-2.5-pro's amendment, council-endorsed)

V1 surfaces TWO distinct liveness axes, not one:

- **Connection health** (subtle): sidebar dot, color-coded:
  - 🟢 green = SSE connected, heartbeats arriving on schedule
  - 🟠 orange = reconnecting (exponential backoff active)
  - 🔴 red = failed after retries
- **Claude activity** (foreground): when the most recent JSONL event is a `tool_use` without its matching `tool_result`, render an **animated chip** ("Running `<tool>`…") below the bubble. This is the user's persistent reassurance that *something is happening* even when the file is silent during a long bash run. Disappears when the matching `tool_result` arrives.

These are independent: green dot + spinning chip = "connection healthy, Claude is working on a long tool". Green dot + no chip + no new messages = "Claude is thinking, no tool in flight".

### Sequence contract (load-bearing)

Client MUST issue the snapshot request before opening SSE:

1. `GET /api/conversations/{uuid}` → captures the current `messages` array including the last record's `uuid` and file `size`.
2. `GET /api/conversations/{uuid}/live?after_uuid=<last_uuid>&size=<size>` → SSE.

Server validates `after_uuid` exists in the file AND `size <= current_size` AND inode matches a recorded inode at snapshot time (we add inode to the detail response). If any of those fail, the server emits a `{"type":"reset"}` SSE control event; the client drops cache and re-fetches `/api/conversations/{uuid}` then re-opens SSE.

### Test fixes (drops rubber-stamps flagged by GPT-5)

| Old test | Failure mode | Fix |
|---|---|---|
| `test_initial_event_carries_offset` | Stub returning offset=0 passes | Assert `offset == os.stat(path).st_size` exactly |
| `test_append_event_emitted_after_disk_write` | Calling `dispatch_jsonl_change` bypasses watchdog→read path | Use real `watchdog.Observer` against a tmp directory; append real bytes; assert SSE within deadline |
| Frontend mock-EventSource tests | Backend SSE format can be wrong | Add at least one frontend integration test against a real backend via Playwright |
| `e2e/live-session.spec.ts` poking the live JSONL | Watcher only monitors `~/.claude/projects` | Override via env var `CLAUDE_EXPLORER_PROJECTS_DIR` pointing at the e2e fixture dir |
| (new) `test_truncate_emits_reset` | Truncation/rotation silently breaks offset resume | Truncate the fixture mid-stream; assert SSE emits `reset` |
| (new) `test_partial_line_not_flushed` | Half-written JSONL line shouldn't emit | Write `{"foo":` without newline; assert NO append SSE; then write `1}\n`; assert ONE append |

## Existing infrastructure we reuse

| Capability | Where | Reuse status |
|---|---|---|
| JSONL parser | `backend/cc_jsonl_io.py:parse_jsonl_file:57` | reuse as-is — already handles all event types |
| File watcher (JSONL appends) | `backend/cc_watcher.py:_ProjectsEventHandler:522` | add a second event consumer (live-tail dispatcher) |
| SSE endpoint pattern | `backend/routers/fetch.py:1150` (`/api/fetch/refresh`) | mirror the StreamingResponse + heartbeat pattern |
| TanStack Query cache | `frontend/src/hooks/useConversations.ts:7` | merge live deltas via `queryClient.setQueryData` |
| Conversation detail endpoint | `backend/routers/conversations.py:84` (`GET /api/conversations/{uuid}`) | extend response with `last_uuid`, `size`, `inode` for resume contract |
| Message rendering | `frontend/src/routes/ConversationPage.tsx` + `MessageBubble.tsx` | unchanged — new messages append to existing array |

What's missing and needs to be built (post-council):

1. Tail-and-stream SSE endpoint with resume-token validation
2. Watchdog → live-tail dispatcher (multi-subscriber pub/sub)
3. Frontend subscription hook + connection-state indicator
4. Animated in-flight tool chip
5. `{type:"reset"}` recovery path

## Approach (post-council)

**Tail-the-file → SSE → merge-into-TanStack-cache.** Read-only feature; cannot corrupt user data.

### Backend

**New endpoint**: `GET /api/conversations/{uuid}/live?after_uuid=<u>&size=<n>` — SSE stream.

1. Look up the JSONL path for `uuid` (already known via `discover_jsonl_files()`).
2. Validate the resume token: stat the file, compare `st_size >= size`, compare inode against the inode recorded at snapshot. If either check fails, emit `event: reset\ndata: {}\n\n` and close.
3. Locate `after_uuid` in the file (scan from a position estimated by `size` first, fall back to full scan). If absent, emit `reset` and close.
4. Send `event: ready\ndata: {"resumed_at_offset": N}\n\n`.
5. Subscribe to a process-local `asyncio.Queue` registered against the JSONL path. The watchdog dispatcher (new) pushes to all queues for that path on every append event.
6. On each queue item: read from `offset` to current EOF into a buffer that PRESERVES any bytes after the last `\n` for the next read. Parse each complete line. For each parsed record with a `uuid`, emit `event: append\ndata: <json>\n\n`. Records without `uuid` (bookkeeping) are skipped.
7. Inode/size sanity on every read tick: if inode changed or `st_size < offset`, emit `reset` and close. Client re-syncs.
8. Heartbeat: `: ping\n\n` every 15s.
9. Multi-subscriber registry: `Dict[Path, Set[Queue]]`. Detach on disconnect.
10. Startup guard in `backend/main.py`: if uvicorn `workers > 1` is detected (env var or warning at import), log a red WARN and disable the live router. Live SSE requires single-worker deployment. Documented in CLAUDE.md.

**Detail endpoint extension**: `GET /api/conversations/{uuid}` response gains:
- `last_uuid: str | null` — uuid of the final message in the file
- `size: int` — file size in bytes at snapshot time
- `inode: int` — file inode at snapshot time

These three fields are the resume token.

### Frontend

**New hook**: `frontend/src/hooks/useLiveConversation.ts`.

```ts
function useLiveConversation(uuid: string, enabled: boolean) {
  // 1. Read existing TanStack cache for conversations.detail(uuid)
  // 2. Compute last_uuid + size + inode from that snapshot
  // 3. Open EventSource('/api/conversations/{uuid}/live?after_uuid=...&size=...')
  // 4. On 'ready': mark connectionState='connected'
  // 5. On 'append': parse, push onto messages array via setQueryData
  // 6. On 'reset': invalidateQueries(detail), close ES, reopen on next render
  // 7. On 'error': exponential backoff (1→2→5→15s), then re-open with current cache state
  // 8. Track connectionState for the indicator
}
```

**Scroll behavior**: on append, if scroll position is within 200px of bottom, smooth-scroll to the new last message. If user has scrolled away, show "↓ N new" pill.

**Live badge** (sidebar): green dot with the three-color connection state.

**In-flight tool chip**: when last event is `tool_use` without matching `tool_result`, render an animated chip below the bubble showing "Running `<tool>`…" with a subtle spinner. Disappears on `tool_result` arrival.

**Reconnect after lid close / network blip**: silent EventSource reconnect; connection state dot turns orange briefly. No toast. The animated chip + dot color carries the signal.

### Files to create

- `backend/routers/live.py` — `GET /api/conversations/{uuid}/live`
- `backend/live_dispatcher.py` — `Dict[Path, Set[Queue]]` registry + `dispatch_jsonl_change(path)` + per-subscription carry-buffer
- `backend/tests/test_live.py` — endpoint, dispatcher, lifecycle, truncate, partial-line tests
- `frontend/src/hooks/useLiveConversation.ts` — EventSource + cache merge + reconnect
- `frontend/src/components/conversation/InFlightToolChip.tsx` — animated chip
- `frontend/src/components/conversation/NewMessagesPill.tsx` — "↓ N new" affordance
- `frontend/src/components/sidebar/LiveDot.tsx` — three-color connection state dot
- `frontend/src/test/hooks/useLiveConversation.test.ts` — mock EventSource merge tests
- `frontend/e2e/live-session.spec.ts` — Playwright e2e with `CLAUDE_EXPLORER_PROJECTS_DIR` override

### Files to modify

- `backend/cc_watcher.py` — call `dispatch_jsonl_change(path)` from `_ProjectsEventHandler.on_modified` alongside the existing search-drift call (line ~494)
- `backend/cc_jsonl_io.py` — populate `last_uuid`, `size`, `inode` on `ConversationDetail` (or new sibling response model)
- `backend/models.py` — add the three resume-token fields to the detail response model
- `backend/main.py` — register live router; add workers>1 startup guard
- `frontend/src/routes/ConversationPage.tsx` — instantiate `useLiveConversation`, wire pill + chip
- `frontend/src/components/sidebar/ConversationList.tsx` — show the `LiveDot`
- `frontend/src/lib/api.ts` — extend the runtime validator with the three new detail fields

## TDD discipline

Per the user's standing rule. RED tests committed before fixes.

Backend RED tests (committed before implementation):
1. `test_initial_event_offset_equals_file_size` — server's `ready` event reports `offset == os.stat(path).st_size`. Stub returning 0 fails.
2. `test_append_via_real_watchdog` — uses `watchdog.Observer` on a tmp dir; `open().write().flush()` of a real JSONL line; assert SSE `append` arrives within 1s. Bypassing the watcher fails.
3. `test_disconnect_unsubscribes` — bidirectional. After client disconnect, writing to the file does NOT keep the queue's refcount.
4. `test_concurrent_subscribers` — 2 simulated subscribers both get every append.
5. `test_truncate_emits_reset` — truncate the fixture mid-stream; assert SSE emits a `reset` control event.
6. `test_partial_line_buffered` — write `{"foo":` without newline; NO `append` SSE. Then write `1}\n`; exactly ONE `append`.
7. `test_inode_change_emits_reset` — `os.rename` the file out, write a new file with the same name; assert `reset`.
8. `test_resume_uuid_not_found_emits_reset` — connect with `after_uuid=nonexistent`; assert `reset`.

Frontend RED tests:
1. `merges_append_into_cache` — mock EventSource, push `append`, assert TanStack cache contains the new message at the end.
2. `paused_does_NOT_merge` (bidirectional negative — though "pause" is dropped, keep the test as "disabled hook doesn't merge")
3. `reset_event_invalidates_and_resyncs` — push `reset`, assert `queryClient.invalidateQueries(detail)` is called.
4. `error_event_triggers_backoff_reconnect` — fake `error`; assert next reconnect happens at 1s, then 2s on second failure.

Playwright E2E:
- `live-session.spec.ts::new_jsonl_line_appears_in_open_page` — start with `CLAUDE_EXPLORER_PROJECTS_DIR=$TEMP_FIXTURE`; create a JSONL fixture; navigate to the conversation; append a synthetic line via `fs.appendFile`; assert a new bubble with that text appears within 2s. Bidirectional: while user is scrolled up, no yank, and "↓ N new" pill appears.

## Verification

Manual:
1. Open Claude Explorer in browser. Open this very conversation (`a70251a5...`). Confirm green LIVE dot in sidebar.
2. From a separate terminal, run a `claude` session in any project. Open its conversation. Watch new messages stream in as Claude works.
3. Trigger a long `bash` tool call (e.g. `sleep 30`). Confirm: animated "Running `Bash`…" chip appears immediately; connection dot stays green; no false "dead" state. Chip disappears when result arrives.
4. Scroll up while live; confirm scroll position is preserved and "↓ N new" pill appears with growing N.
5. Truncate the JSONL on disk (`: > /Users/.../foo.jsonl`); confirm browser sees a `reset` → re-fetches → reconnects cleanly.

Automated:
- `cd backend && uv run pytest backend/tests/test_live.py -v`
- `cd frontend && npm test -- --run` (no regressions, +4 new tests)
- `cd frontend && npx playwright test e2e/live-session.spec.ts`

## Risks & open questions

1. **Project visibility scope**: any session in `~/.claude/projects/` becomes live-watchable. No auth (single-user desktop app). The user could see other CC sessions on their machine running in unrelated projects. This is the existing browse behavior — Claude Explorer already indexes everything. No new exposure.
2. **Backpressure**: a runaway CC session could write thousands of lines/minute. SSE handles this fine, but the in-memory message array in the frontend would grow without bound. Mitigation: cap the cache at N=2,000 messages per conversation (recent window); older messages re-fetched on scroll-up. **Not in scope for V1** of this feature — flag for follow-up.
3. **Sub-conversation `agent-*.jsonl` files**: today's `discover_jsonl_files()` skips them. The live monitor also skips them — subagent work isn't visible. Follow-up.
4. **Long-running tool gap**: per council, **a known limitation**. While `bash sleep 600` runs, no JSONL events fire. Mitigated by the animated in-flight tool chip carrying the "Claude is doing something" signal independent of file activity. Not fixable without modifying CC itself; out of scope.
5. **Multi-worker deployment**: process-local queue registry doesn't survive. Documented constraint: `uvicorn --workers=1` (the default). Startup guard logs a WARN and disables the live router if multi-worker is detected.
6. **NFS / network home dirs**: mtime semantics are unreliable, but since we no longer base UX on mtime (council decision #5), this risk is dropped. Watchdog itself works on most NFS via polling fallback — acceptable degraded mode.
7. **CC writes during conversation export**: PDF/markdown export is consistent up to mtime-at-snapshot. Live monitor doesn't change that contract.
8. **Cache invalidation on `reset`**: explicit via `queryClient.invalidateQueries(detail)` — clean.
9. **Heartbeat strategy on long idles**: `: ping\n\n` every 15s. If the comment fails, EventSource auto-reconnects with exponential backoff; the orange dot signals it.

## Implementation order

1. RED tests for backend `test_initial_event_offset_equals_file_size`, `test_partial_line_buffered`, `test_truncate_emits_reset`, `test_inode_change_emits_reset` — committed.
2. `backend/live_dispatcher.py` + `backend/routers/live.py` + detail endpoint extensions. Tests turn GREEN.
3. Cross-process test for real watchdog (`test_append_via_real_watchdog`). RED then GREEN.
4. RED frontend tests for `useLiveConversation`. Committed.
5. `useLiveConversation` hook + `LiveDot` + `InFlightToolChip` + `NewMessagesPill`. Tests GREEN.
6. RED Playwright e2e. Committed.
7. Wire into `ConversationPage` + `ConversationList`. E2E GREEN.
8. Manual smoke against a real live `claude` session in another project.
9. Update CLAUDE.md with the workers=1 constraint and the long-running-tool limitation.
