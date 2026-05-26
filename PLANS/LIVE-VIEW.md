# Live Session Monitor — watch a CC session in the browser as it happens

## Context

The Claude Code CLI gives the user very little visibility into a long-running
session: streaming text of the current turn, no view of tool calls or results,
no overall arc. Claude Explorer already has a polished conversation viewer; the
goal is to make it a **live monitor** for sessions that are currently being
written to. Open the conversation, see new messages, tool calls, and tool
results appear in real time. No refresh, no polling.

Read-only feature. Post-V1 polish, gates on V1 shipping first.

## Empirical findings (verified against current HEAD `7119639`)

JSONL on-disk semantics (sampled from a live session under
`~/.claude/projects/-home-user-repo/`):

- Files grow append-only as CC writes. Each event is a single JSONL line
  terminated by `\n`, but **a single assistant turn is split across multiple
  lines, one per content block**:
  ```
  {type:"assistant", uuid:"9c4e500c", message:{id:"msg_X", content:[{type:"thinking"}], stop_reason:"tool_use"}}
  {type:"assistant", uuid:"a0acf674", message:{id:"msg_X", content:[{type:"text"}],     stop_reason:"tool_use"}}
  {type:"assistant", uuid:"363d5dd5", message:{id:"msg_X", content:[{type:"tool_use"}], stop_reason:"tool_use"}}
  ```
  The existing parser at `backend/cc_message_transforms.py:_merge_entries_to_message:649`
  groups these lines by `_get_message_key` (`cc_message_transforms.py:632` —
  assistant: `f"assistant:{message.id}"`, user: `f"user:{entry.uuid}"`) and
  folds them into one `Message`. The naive "emit each line with a uuid as one
  SSE event" would render the three lines as three bubbles. The chunk-merge
  engine on the server is the right fix.
- Top-level JSONL records include bookkeeping types like `queue-operation` and
  `attachment` that have no `uuid` and contribute no message — `_get_message_key`
  returns `None` and the existing parser silently skips them. We do the same.
- `discover_jsonl_files` (`backend/cc_jsonl_io.py:208`) yields top-level session
  JSONLs only and excludes `agent-*.jsonl`. Live monitor inherits this scope —
  subagent files are out of scope for V1, same as today's reader.
- Filename stem may not equal internal `sessionId`. The detail endpoint already
  resolves UUID→file path via `ConversationStore._find_conversation_data`
  (`backend/store.py:580`), which is what we'll reuse. The result already
  populates `ConversationDetail.file_path` (`backend/models.py:215`).
- The existing watcher (`backend/cc_watcher.py:_ProjectsEventHandler:522`)
  already fires on JSONL `on_modified` events. Today it only feeds a
  search-index debounce timer (`_schedule_drift`). We add a second, immediate
  fanout into the live-tail dispatcher alongside it.

## Council Decision Record — 3 rounds, 3 models

Three personas reviewed and converged via cross-critique over three rounds:
- **Gemini-3-pro-preview** (Platform Architect): synchronization + concurrency
- **GPT-5** (Adversarial Critic): failure modes + test theater
- **Gemini-2.5-pro** (Pragmatic Reviewer): user value + UX coherence

### Round-1/2 unanimous decisions (carried forward)

| # | Decision | Rationale |
|---|---|---|
| 1 | **Resume token: `?after_size=N&inode=I`** | (size, inode) pair is robust against truncation/rotation; per-event UUID lookup is not needed once dedup key is stable (see #9 below) |
| 2 | **Newline-bounded reads with carry-buffer** | OS-level torn writes are real. Bytes after the last `\n` go into a per-subscription buffer and prepend to the next read. |
| 3 | **Drop pause button** | Scroll-pin already provides the "freeze" affordance. |
| 4 | **Drop the header "● LIVE" pill** | Redundant with the sidebar dot AND with the appearance of new bubbles. |
| 5 | **Drop the backend `is_live: bool` mtime heuristic** | Falsely turns "off" during long-running tools. UI liveness reflects the actual SSE connection state, not mtime. |
| 6 | **Two-tier liveness signal** | Sidebar dot (connection health: green/orange/red) + animated in-flight tool chip (Claude activity, derived from `content` blocks). Independent axes. |
| 7 | **Single-process / single-worker constraint** | Process-local `asyncio.Queue` registry doesn't span workers. (Strengthened in round 3 — see #13 below.) |
| 8 | **Long-running tool gap is a known limitation** | JSONL only flushes per-tool-call. During a 10-min bash, no events arrive. Mitigated by the animated tool chip. Not fixable without modifying CC. |

### Round-3 amendments (after Ultraplan delta review)

The Ultraplan iteration introduced server-side merge-engine reuse, which is correct and elegant. But the council caught a P0 bug it introduced and several missing safety properties.

| # | Decision | Rationale |
|---|---|---|
| **9** | **P0: dedup by Anthropic `message.id`, not by per-chunk `uuid`** | `cc_message_transforms.py:690` sets `Message.uuid = first_entry.get("uuid", "")` — the FIRST chunk seen at merge time. In the live path, server only sees POST-snapshot chunks, so `entries[0].uuid` differs from the snapshot's. Frontend's "replace-by-uuid" would NOT match → permanent duplicate bubble (NOT a sub-second flicker as Ultraplan claimed). Both Gemini-3-pro and GPT-5 independently caught this. Fix: extend `_merge_entries_to_message` to expose the Anthropic msg-id at the top level. |
| **10** | **Per-line `orjson.loads` wrapped in try/except** | A single corrupt line must not kill the SSE stream. Skip + log; the rest of the carry buffer still parses. |
| **11** | **`threading.Lock` on dispatcher registry** | Watchdog fires on a background thread; SSE handler runs in asyncio. `Dict[Path, Set[Queue]]` mutation across threads needs explicit synchronization. Copy the set BEFORE iterating fanout. |
| **12** | **`groups` dict completion-bound** | When a NEWER assistant `message.id` arrives, drop the prior key from `groups`. CC writes sequentially — the prior turn is by definition complete. Prevents O(session-length) memory growth. |
| **13** | **Multi-worker: DISABLE the live router, don't WARN** | Ultraplan softened to "warn but still serve". Council reverted to disable. Silent split-brain (some subscribers connected to the worker without the watchdog event) is worse than a 503. Detected via `WEB_CONCURRENCY > 1` env var or uvicorn `--workers` arg sniffing at startup. |

### Test fixes (drops rubber-stamps flagged across rounds)

| Test | Anti-pattern eliminated | Fix |
|---|---|---|
| `test_initial_event_offset_equals_file_size` | Stub returning offset=0 passes | Assert `offset == os.stat(path).st_size` exactly |
| `test_append_via_real_watchdog` | Calling `dispatch_jsonl_change` directly bypasses watchdog→read path | Use real `watchdog.Observer` against a tmp directory; append real bytes; assert SSE within deadline |
| Mock-EventSource-only frontend tests | Backend SSE format can be wrong with all tests green | Add one Playwright integration test against a real backend |
| E2E poking `~/.claude/projects` | Watcher hardcodes the home dir | Override via env var `CLAUDE_DIR` pointing at fixture |
| (new) `test_dedup_across_snapshot_boundary` | Ultraplan's P0 bug: duplicate bubble | Snapshot returns chunks 1-2 of an assistant turn; SSE delivers chunks 3-4; frontend MUST see exactly ONE merged bubble, not two |
| (new) `test_corrupt_line_does_not_kill_stream` | One bad line crashing the parser kills the connection | Write a corrupt line, then a valid one; assert valid one still emits |
| (new) `test_truncate_emits_reset` | Truncation/rotation silently breaks offset | Truncate the fixture mid-stream; assert SSE emits `reset` |
| (new) `test_partial_line_buffered` | Half-written JSON shouldn't emit | Write `{"foo":` without newline; assert NO append; then `1}\n`; assert ONE append |
| (new) `test_streaming_chunks_merge_into_one_message` | Three chunks would render as three bubbles | Append three lines for the same `message.id`; assert THREE SSE events (one per tick) and the LAST one carries a Message with all three blocks |
| (new) `test_groups_drops_completed_keys` | Memory growth O(session length) | Append turn A's chunks, then turn B's first chunk; assert `groups` dict has length 1 (A dropped) |
| (new) `test_multi_worker_disables_router` | Silent split-brain under multi-worker | Set `WEB_CONCURRENCY=2`, hit endpoint, assert 503 |

## Existing infrastructure to reuse (verified at HEAD)

| Capability | Where | Status |
|---|---|---|
| JSONL parser (line→dict) | `backend/cache.py:parse_jsonl_fast` via `backend/cc_jsonl_io.py:parse_jsonl_file:57` | reuse |
| Message-chunk merge (load-bearing) | `backend/cc_message_transforms.py:_get_message_key:632`, `_merge_entries_to_message:649` | **reuse + extend with `message_id` top-level field (see Round 3 #9)** |
| Conversation full read (snapshot) | `backend/claude_code_reader.py:read_claude_code_conversation:177` | unchanged |
| UUID→path resolution | `backend/store.py:_find_conversation_data:580` | reuse |
| Watchdog handler for JSONL changes | `backend/cc_watcher.py:_ProjectsEventHandler:522` | extend (add a second fanout) |
| SSE endpoint pattern | `backend/routers/fetch.py:1149` (`/api/fetch/refresh`) | mirror |
| TanStack detail cache & query key | `frontend/src/hooks/useConversations.ts:65` (`useConversation`), `frontend/src/lib/queryClient.ts:58` (`queryKeys.conversations.detail`) | merge deltas via `queryClient.setQueryData` |
| Message rendering | `frontend/src/routes/ConversationPage.tsx:37` → `MessageBubble` | unchanged; merged messages replace/append in the existing array |
| Conversation detail model | `backend/models.py:210` (`ConversationDetail` — already has `file_path`) | extend with two resume-token fields |

## Approach

**Tail-the-file → merge-on-server → SSE → cache-merge-on-frontend.** Read-only,
single-user desktop app, single uvicorn worker (`claude-explorer serve` default).

The server keeps a small in-memory state per subscription and re-merges
post-snapshot chunks of each `message_key` on every read tick. It always emits
the FULL merged `Message` JSON object (with the new `message_id` top-level
field) on every tick that touches a key. The frontend dedupes by the
Anthropic `message.id` (assistant) or `uuid` (user), so it never has to
reason about content-block ordering or streaming chunks.

### End-to-end flow

```
┌─────────────┐   1. GET /api/conversations/{uuid}              ┌──────────┐
│             │ ────────────────────────────────────────────►   │          │
│  Frontend   │     (snapshot incl. file_path, file_size,       │ Backend  │
│  Conversa-  │      file_inode; every Message has              │  router  │
│  tionPage   │      .message_id for assistants)                │          │
│             │                                                 │          │
│             │   2. GET /api/conversations/{uuid}/live         │          │
│             │      ?after_size=N&inode=I  (SSE)               │          │
│             │ ────────────────────────────────────────────►   │   live   │
│             │ ◄── event: ready    {resumed_at_offset: N}      │  router  │
│             │ ◄── event: message  <merged Message JSON>       │          │
│             │ ◄── event: message  <merged Message JSON>       │          │
│             │ ◄── event: reset    {reason: "..."}             │          │
└─────────────┘                                                 └────┬─────┘
                                                                     │
                                                               subscribes to
                                                                     │
                                                                     ▼
                                                           ┌───────────────────┐
                                                           │ live_dispatcher   │
                                                           │  Dict[Path,       │
                                                           │       Set[Queue]] │
                                                           │  guarded by Lock  │
                                                           └─────────▲─────────┘
                                                                     │ call_soon_threadsafe
                          watchdog ~/.claude/projects/                │
                          existing _ProjectsEventHandler ─────────────┘
                          (new fanout alongside _schedule_drift)
```

### Backend — server-side merging with stable dedup key

```python
# state per subscription
path: Path
inode: int
offset: int                  # next byte to read
carry: bytes = b""           # bytes after the last \n
groups: dict[str, list[dict]]  # message_key -> entries seen post-snapshot

# on tick (woken by dispatcher OR initial connect)
def tick(self):
    try:
        st = os.stat(self.path)
    except FileNotFoundError:
        yield reset("file-missing")
        return
    if st.st_ino != self.inode or st.st_size < self.offset:
        yield reset("inode-or-truncate")
        return
    with open(self.path, "rb") as f:
        f.seek(self.offset)
        buf = self.carry + f.read()
    *complete_lines, partial = buf.split(b"\n")
    self.carry = partial
    self.offset = st.st_size - len(partial)

    touched_keys: set[str] = set()
    latest_key: str | None = None
    for line in complete_lines:
        if not line:
            continue
        try:
            entry = orjson.loads(line)  # ← Round 3 #10: guarded
        except Exception:
            logger.warning("live: skipping unparseable JSONL line at offset ~%d", self.offset)
            continue
        key = _get_message_key(entry)
        if not key:
            continue                    # bookkeeping line (no uuid)
        self.groups.setdefault(key, []).append(entry)
        touched_keys.add(key)
        latest_key = key

    # Round 3 #12: drop completed prior keys
    if latest_key:
        for prior in list(self.groups.keys()):
            if prior != latest_key:
                del self.groups[prior]

    for key in touched_keys:
        merged = _merge_entries_to_message(self.groups[key])
        if merged:
            yield {"event": "message", "data": merged}
```

### `_merge_entries_to_message` extension (Round 3 #9 — the P0 fix)

Add ONE field to the merged output. Snapshot and live paths both benefit; URLs/bookmarks pointing to `uuid` stay valid because `uuid` is unchanged.

```python
# backend/cc_message_transforms.py:_merge_entries_to_message, near the existing return
first_msg = first_entry.get("message", {})
return {
    "uuid": first_entry.get("uuid", ""),           # unchanged — preserves URL stability
    "message_id": first_msg.get("id") if entry_type == "assistant" else None,  # NEW
    "sender": "human" if entry_type == "user" else "assistant",
    # ...rest unchanged...
}
```

Frontend dedup rule:

```ts
function dedupKey(msg: Message): string {
  return msg.sender === 'assistant' && msg.message_id
    ? `a:${msg.message_id}`
    : `u:${msg.uuid}`
}

// On SSE 'message' event:
setQueryData(detailKey, (old) => {
  const incomingKey = dedupKey(incoming)
  const idx = old.messages.findIndex(m => dedupKey(m) === incomingKey)
  const messages = idx >= 0
    ? [...old.messages.slice(0, idx), incoming, ...old.messages.slice(idx + 1)]
    : [...old.messages, incoming]
  return { ...old, messages, message_count: messages.length, updated_at: incoming.updated_at }
})
```

This eliminates the duplicate-bubble bug across the snapshot/live boundary. Assistant turns dedup by Anthropic msg-id (stable across chunks); user turns dedup by uuid (single-line, also stable).

### Resume token

Snapshot endpoint extension (Pydantic optionals — Desktop conversations have no JSONL):

```python
class ConversationDetail(ConversationSummary):
    ...
    file_path: str | None = None        # already present
    file_size: int | None = None        # NEW — bytes at snapshot
    file_inode: int | None = None       # NEW — inode at snapshot
```

Populated in `backend/store.py:get_conversation` from `os.stat(file_path)` when path is non-None. Frontend reads them and passes them on the SSE URL: `?after_size=N&inode=I`.

Server validates on connect:
1. Look up path via `_find_conversation_data` (same as snapshot).
2. `st = os.stat(path)`. If `st.st_ino != inode` OR `st.st_size < after_size`: emit `event: reset` and close.
3. Otherwise `offset = after_size`, emit `event: ready {resumed_at_offset: after_size}`, enter the tick loop.

Per-tick re-validation: if inode changes or `st_size < offset` mid-stream → `reset` and close.

Heartbeat: `: ping\n\n` SSE comment every 15s (mirrors `/fetch/refresh`).

### Watchdog fanout (single new line in existing handler)

`backend/cc_watcher.py:_ProjectsEventHandler._maybe_queue` already runs on every `*.jsonl` event. One line added alongside the existing `_schedule_drift`:

```python
def _maybe_queue(self, src: str) -> None:
    path = Path(src)
    if path.suffix.lower() != ".jsonl":
        return
    try:
        _schedule_drift(path)
        from backend.live_dispatcher import dispatch_jsonl_change
        dispatch_jsonl_change(path)   # NEW — non-blocking; wakes any subscribers
    except Exception:
        logger.exception(...)
```

### `live_dispatcher.py` — thread-safe registry (Round 3 #11)

```python
_registry: dict[Path, set[asyncio.Queue]] = {}
_registry_lock = threading.Lock()

def subscribe(path: Path, queue: asyncio.Queue, loop: asyncio.AbstractEventLoop) -> None:
    with _registry_lock:
        _registry.setdefault(path, set()).add(queue)
    # queue is bound to this loop; dispatch will marshal cross-thread

def unsubscribe(path: Path, queue: asyncio.Queue) -> None:
    with _registry_lock:
        subscribers = _registry.get(path)
        if subscribers is not None:
            subscribers.discard(queue)
            if not subscribers:
                del _registry[path]

def dispatch_jsonl_change(path: Path) -> None:
    # Called from watchdog background thread. Wake all subscribers.
    with _registry_lock:
        subscribers = list(_registry.get(path, ()))  # copy before iterating
    for q in subscribers:
        loop = q._loop  # asyncio.Queue exposes its bound loop
        loop.call_soon_threadsafe(q.put_nowait, None)
```

SSE handler holds its queue in a `try/finally` to guarantee `unsubscribe` on disconnect.

### Multi-worker disable (Round 3 #13)

In `backend/main.py`'s lifespan startup hook:

```python
worker_count = int(os.environ.get("WEB_CONCURRENCY", "1"))
if worker_count > 1:
    logger.warning("live monitor disabled: multi-worker deployment detected (WEB_CONCURRENCY=%d)", worker_count)
    app.state.live_disabled = True
```

`live` router's dependency checks `app.state.live_disabled`; if true, return `503 Service Unavailable` with a JSON body: `{"detail":"Live monitor requires single-worker deployment (WEB_CONCURRENCY=1)."}`. Documented in CLAUDE.md.

### Frontend

**New hook** `frontend/src/hooks/useLiveConversation.ts`:

```ts
function useLiveConversation(uuid: string, enabled: boolean) {
  // 1. Read snapshot from queryClient cache (already populated by useConversation)
  // 2. If snapshot.source !== 'CLAUDE_CODE' OR no file_path/file_size/file_inode → no-op
  // 3. Open EventSource(`/api/conversations/${uuid}/live?after_size=${size}&inode=${inode}`)
  // 4. On 'ready' → connectionState='connected'
  // 5. On 'message' → parse Message; setQueryData(detailKey, mergeByDedupKey)
  // 6. On 'reset' → invalidateQueries(detailKey); close ES; reopen after refetch with fresh size/inode
  // 7. On 'error' → connectionState='reconnecting'; exponential backoff (1→2→5→15s); after retries → 'failed'
  // 8. Cleanup: close ES on unmount or uuid change; unsubscribe via cleanup
  return { connectionState: 'idle' | 'connected' | 'reconnecting' | 'failed' }
}
```

**Wire into `ConversationPage.tsx`**: one call gated by `conversation?.source === 'CLAUDE_CODE' && conversation?.file_path != null`. Existing rendering at the `messages.map(...)` site is unchanged — merged messages either replace-in-place or append, and React's normal subscription handles re-render.

**Scroll behavior**:
- If scroll container is within 200px of bottom on new message: smooth-scroll to it.
- Otherwise: increment "↓ N new" pill counter; clicking the pill scrolls to latest.

**Two-tier liveness signal**:
- Sidebar `LiveDot`: green/orange/red driven by `connectionState`.
- `InFlightToolChip` below the bubble: when the most recent assistant message has a `content` block of type `tool_use` whose `id` is NOT matched by any later user message's `tool_result` block with the same `tool_use_id`. Pure derived state from `conversation.messages`; no extra wire format.

### Files to create

- `backend/live_dispatcher.py` — thread-safe registry + `subscribe(path, queue, loop)` + `unsubscribe(path, queue)` + `dispatch_jsonl_change(path)`
- `backend/routers/live.py` — `GET /api/conversations/{uuid}/live` SSE; per-subscription state (`offset`, `inode`, `carry`, `groups`); `try/finally` lifecycle
- `backend/tests/test_live.py` — see TDD below
- `frontend/src/hooks/useLiveConversation.ts` — EventSource lifecycle, dedup-key merge, reconnect with backoff
- `frontend/src/lib/messageDedup.ts` — pure helper: `dedupKey(msg)` + `mergeByDedupKey(messages, incoming)`. Pure-function unit-testable.
- `frontend/src/components/conversation/InFlightToolChip.tsx`
- `frontend/src/components/conversation/NewMessagesPill.tsx`
- `frontend/src/components/sidebar/LiveDot.tsx`
- `frontend/src/test/lib/messageDedup.test.ts` — pure helper tests
- `frontend/src/test/hooks/useLiveConversation.test.tsx` — mock EventSource
- `frontend/e2e/live-session.spec.ts` — Playwright e2e with `CLAUDE_DIR` env override

### Files to modify

- `backend/cc_message_transforms.py:_merge_entries_to_message` — add `message_id` top-level field (Round 3 #9)
- `backend/cc_watcher.py:_ProjectsEventHandler._maybe_queue` — add `dispatch_jsonl_change(path)` call
- `backend/store.py:get_conversation` — populate `file_size` + `file_inode` via `os.stat(file_path)` when path is non-None
- `backend/models.py` — add the two optional fields to `ConversationDetail`; add `message_id` to `Message` model
- `backend/main.py` — register live router; set `app.state.live_disabled` on multi-worker
- `frontend/src/lib/types.ts` — extend `Message` type with optional `message_id`; extend Conversation with `file_size`, `file_inode`
- `frontend/src/lib/api.ts` — extend runtime validators
- `frontend/src/routes/ConversationPage.tsx` — instantiate `useLiveConversation`; wire `NewMessagesPill` + `InFlightToolChip`
- `frontend/src/components/sidebar/ConversationList.tsx` — show `LiveDot`

## TDD (RED tests committed before implementation)

Backend (`backend/tests/test_live.py`):
1. `test_initial_event_offset_equals_file_size` — assert `resumed_at_offset == os.stat(path).st_size` exactly.
2. `test_append_via_real_watchdog` — real `watchdog.Observer` on tmp dir (via `CLAUDE_DIR` env override). Append real JSONL line. SSE `message` event arrives within 1s.
3. `test_streaming_chunks_merge_into_one_message` — append three lines for same `message.id` (thinking, text, tool_use). Exactly THREE SSE events fire; LAST carries all three blocks merged.
4. **`test_dedup_across_snapshot_boundary`** — fixture with chunks 1+2 of an assistant turn already on disk; snapshot fetches → snapshot Message has uuid=chunk1.uuid AND message_id=msg_X. Open SSE with `after_size = byte-offset-after-chunk-2`. Append chunks 3+4. Assert SSE Message has DIFFERENT uuid (chunk3.uuid) but SAME message_id (msg_X). **Frontend integration: simulate apply; assert one merged bubble, not two.**
5. `test_corrupt_line_does_not_kill_stream` — write `{not valid json\n`, then a valid line; assert valid line still emits.
6. `test_partial_line_buffered` — write `{"foo":` without `\n`; assert NO event. Then `1}\n`; assert event.
7. `test_truncate_emits_reset` — truncate fixture mid-stream; assert `reset`.
8. `test_inode_change_emits_reset` — `os.rename` aside, create new file with same name; assert `reset`.
9. `test_resume_size_beyond_eof_emits_reset` — connect with `after_size > current_size`; assert `reset`.
10. `test_concurrent_subscribers_both_receive` — two subscriptions; one append; both queues woken.
11. `test_disconnect_unsubscribes` — bidirectional: after disconnect, the registry no longer holds the queue.
12. `test_bookkeeping_lines_skipped` — write `{"type":"queue-operation",...}` (no uuid); assert NO event.
13. `test_groups_drops_completed_keys` — append turn A's chunks, then turn B's first chunk; assert subscription's `groups` dict has only B.
14. `test_multi_worker_disables_router` — set `WEB_CONCURRENCY=2`; hit endpoint; assert 503.

Frontend (vitest, mock EventSource):
1. `messageDedup::asks_by_message_id_for_assistant` — pure-function: same `message_id`, different `uuid` → same dedup key.
2. `messageDedup::asks_by_uuid_for_user` — user message dedup is uuid.
3. `appends_new_message_into_cache` — push `message` with brand-new key.
4. **`replaces_by_message_id_across_uuid_change`** — push two `message` events with same `message_id` but different `uuid`; assert cache has exactly ONE message with the second's content blocks.
5. `reset_invalidates_and_resyncs` — `queryClient.invalidateQueries(detailKey)` called; ES re-opens after refetch.
6. `error_backs_off` — fake `error`; reconnect at 1s, then 2s on second failure (fake timers).
7. `disabled_hook_does_not_open_es` — bidirectional negative: `enabled=false` never constructs an EventSource.

Playwright e2e (`frontend/e2e/live-session.spec.ts`):
- `new_jsonl_line_appears_in_open_page` — fixture: `CLAUDE_DIR=$TMP` with seeded JSONL. Navigate; `fs.appendFile` new line; new bubble appears within 2s.
- `scroll_position_preserved_pill_appears` — scroll up; append line; no yank, pill appears.
- **`assistant_streaming_dedup_no_duplicate`** — seed JSONL with assistant chunks 1+2; navigate (snapshot shows partial bubble); append chunks 3+4; assert ONE merged bubble in DOM, not two.

## Verification

Manual:
1. `uv run uvicorn backend.main:app --reload --port 8765` + `cd frontend && npm run dev`.
2. Open Claude Explorer; open the conversation for an active `claude` CLI session in another project. Confirm green LIVE dot.
3. While the session runs a long `Bash` tool (e.g. `sleep 30`), confirm animated "Running `Bash`…" chip; dot stays green; no false "dead" state; chip disappears on `tool_result`.
4. Watch a CC assistant streaming turn (thinking → text → tool_use): confirm a SINGLE bubble grows across three blocks (not three bubbles, not one+duplicate).
5. Scroll up; confirm "↓ N new" pill appears and increments.
6. Truncate the JSONL on disk (`: > <path>`); confirm reset → re-fetch → reconnect.

Automated:
- `uv run pytest backend/tests/test_live.py -v`
- `cd frontend && npm test -- --run`
- `cd frontend && npx playwright test e2e/live-session.spec.ts`

## Risks & known limitations

1. **Long-running tool gap** — between `tool_use` write and `tool_result` write, the JSONL is silent. Mitigated by the in-flight tool chip (derived state, not file activity). Not fixable without modifying CC.
2. **Single-worker constraint** — process-local registry. Hard requirement; live router returns 503 under multi-worker (Round 3 #13).
3. **Subagent files** (`agent-*.jsonl`) — skipped by `discover_jsonl_files` today. Live monitor inherits the skip. Follow-up.
4. **`groups` memory** — bounded by Round 3 #12 (drop on newer key). Worst case: one in-flight turn's chunks (~tens of KB).
5. **Backpressure on huge sessions** — frontend `messages` array grows without bound for very long live sessions. Same memory characteristic as today's static viewer. Future cap at N=2,000 with on-scroll re-fetch. Out of scope for V1 of this feature.
6. **NFS / network home dirs** — mtime semantics unreliable, but no longer load-bearing (we use connection-state, not mtime). Watchdog works on most NFS via polling fallback — acceptable degraded mode.

## Implementation order

1. Commit RED tests for `test_initial_event_offset_equals_file_size`, `test_streaming_chunks_merge_into_one_message`, `test_dedup_across_snapshot_boundary`, `test_corrupt_line_does_not_kill_stream`, `test_partial_line_buffered`, `test_truncate_emits_reset`, `test_inode_change_emits_reset`, `test_groups_drops_completed_keys`, `test_multi_worker_disables_router`.
2. Implement `_merge_entries_to_message` extension (add `message_id`). All existing tests stay GREEN. New `Message` model field added.
3. Implement `backend/live_dispatcher.py` + `backend/routers/live.py` + snapshot endpoint extensions in `backend/models.py` + `backend/store.py`. Backend tests turn GREEN.
4. Add `test_append_via_real_watchdog` (RED); wire `dispatch_jsonl_change` into `_ProjectsEventHandler._maybe_queue`. GREEN.
5. Backend tests (concurrent subscribers, disconnect unsubscribe, bookkeeping lines). GREEN.
6. Commit RED frontend vitest tests for `messageDedup` + `useLiveConversation`. Implement helpers + hook + `LiveDot` + `InFlightToolChip` + `NewMessagesPill`. GREEN.
7. Commit RED Playwright e2e (including `assistant_streaming_dedup_no_duplicate`). Wire `useLiveConversation` into `ConversationPage.tsx`. GREEN.
8. Manual smoke against a real live `claude` session in another project.
9. CLAUDE.md update: single-worker hard constraint + new endpoint contract + dedup-key field on `Message`.
