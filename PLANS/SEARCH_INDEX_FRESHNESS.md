# Plan: search-index freshness (drift-first build + event-driven updates)

**Status:** planned, ready to implement.
**Owner:** llm-council-coding (TDD; iterate until green).
**Related:** `PLANS/OPTIMIZE_COLD_START.md` (the 5 s heavy-task delay
this plan retires), `backend/search_index.py` (build + drift + index
state), `backend/cc_image_watcher.py` (event-driven watcher we'll
extend), `backend/main.py` (lifespan).

## Context

The cold-start work shipped a 5 s delay before the FTS5 build and
warm-image scan so the summary cache + first sidebar request get
disk priority. With that delay plus the ~10 s build itself, FTS5
search is ready about **15 s after restart**. During that window,
search falls back to linear scan (1.1–1.4 s per query) — slow but
correct.

But there's a separate correctness gap that's existed since the
search index landed:

**While the explorer is running, an updated CC session takes up to
600 s to appear in FTS5 search results.** The image-cache watcher
fires `watchdog` events sub-second for image-cache files, but only
fires `update_drifted_files` on its 600 s backstop poll. So if you
type for ten minutes in Claude Code and then ⌘+K-search for what
you just wrote, the result might not be in FTS5 yet. (Linear scan
would have caught it; FTS5 returns stale results.)

The user's stated load-bearing use case is:

> Update a session, immediately start Claude Explorer and begin
> searching.

This works today because `build_full_index` always runs at startup
and its per-file `needs_update(path, mtime)` check (see
`backend/search_index.py:862`) catches the drifted file before
`mark_ready()` fires. But the build also calls
`store.get_all_conversations_raw(source="all")` at line 843, which
loads every conversation's full content into memory FIRST — so even
when zero files have drifted, we pay ~10 s of disk I/O on every
restart. That's what the 5 s delay was working around.

This plan fixes both gaps:

1. **Option A — drift-first build.** Re-shape `build_full_index`
   (and `update_drifted_files`) to query `indexed_files` for
   current mtimes BEFORE loading conversation content. Only call
   `get_all_conversations_raw` (or a per-file equivalent) for the
   drifted set. Warm restarts become ~100–300 ms instead of ~10 s.
   Heavy-task delay drops back to 500 ms (or 0). Search ready
   in <1 s.

2. **Event-driven watcher drift.** Extend `cc_image_watcher` to
   also watch `~/.claude/projects/*.jsonl` and fire
   `update_drifted_files` (debounced) on changes. Search becomes
   fresh within ~1–2 s of an in-flight CC session update, not 600 s.

## Goals

- **Correctness invariant preserved:** `mark_ready()` only fires
  after any startup drift has been absorbed.
- **Use case works:** update session → restart explorer → ⌘+K
  finds the new content in FTS5 (not just linear scan) within
  ≤1 s.
- **Use case works while running:** ⌘+K finds in-flight CC content
  within ~2 s of the file modification, not 600 s.
- **Search-ready time after restart:** drops from ~15 s to <1 s.
- **Heavy-task delay** in `backend/main.py`: drops from 5 s back
  to 500 ms (or removed entirely, decision deferred to bench
  numbers).
- **No regressions:** all current search tests, watcher tests, and
  cold-start benchmarks remain green.
- **TDD throughout.** Failing tests first; iterate until all green.

## Non-goals

- Schema changes to the FTS5 tables.
- Touching the summary cache or its watcher integration.
- Changing what `_search_via_linear_scan` returns or how the
  fallback dispatch works.

## Option A: drift-first build

### Current code structure (the problem)

Both `build_full_index` (`backend/search_index.py:815`) and
`update_drifted_files` (`backend/search_index.py:884`) call
`store.get_all_conversations_raw(source="all")` at the top, which
loads every conversation's full content. Then they iterate, doing
per-file `needs_update(path, mtime)` skips. The expensive load
happens unconditionally.

### Refactor

Introduce a new helper, `_drift_first_scan(store, index)`, that:

1. Enumerates all conversation paths (Desktop JSONs + CC JSONLs)
   via the existing path-discovery helpers (`_get_conversation_files`,
   `discover_jsonl_files`). NO content load.
2. For each path, `os.stat()` the mtime + size.
3. Single SQL: `SELECT path, mtime FROM indexed_files
   WHERE path IN (...)`. Diff against the live stat results.
4. Returns `(drifted_paths, missing_paths)` where:
   - `drifted_paths` = on-disk but mtime mismatch (or not in
     `indexed_files` at all → new file).
   - `missing_paths` = in `indexed_files` but no longer on disk
     (cleanup).
5. For drifted paths only, load the conversation via a per-file
   loader (`_load_conversation_at(path)` — wraps the existing
   `read_claude_code_conversation` for CC and `_load_conversation`
   for Desktop). Upsert each.
6. Delete rows for missing paths.

`build_full_index` becomes: call `_drift_first_scan`, then
`mark_ready()`. No `get_all_conversations_raw` call. The behavior
is identical (every drift absorbed before ready), the cost is
proportional to drift size instead of corpus size.

`update_drifted_files` becomes a thin wrapper over the same helper
(or merges with it).

### Cost analysis

- **Warm restart, zero drift:** one stat-per-file (~1 ms each ×
  1,200 = ~50–200 ms with parallelism), one SELECT (~5 ms), one
  set diff (~1 ms). **Total: ~100–300 ms.**
- **Restart with 1 drifted file:** above + one file load + one
  upsert = **~150–350 ms.**
- **First install (no `indexed_files` rows):** every path is
  "drifted", so degrades to today's behavior of loading every
  file. **Same as today.** Not worse.

### Heavy-task delay decision

Once `build_full_index` is sub-second on warm restarts, the 5 s
delay before FTS5 + warm-image scan can drop back to 500 ms (or
zero). The decision is deferred to the bench numbers in the
verification step. Whichever value still hits the cold-start
targets (<300 ms cold-restart, <1.5 s first-install) is the right
one.

## Event-driven watcher drift

### Current state

`backend/cc_image_watcher.py` runs a `watchdog` Observer on
`~/.claude/image-cache/`. Events route to `handle_one_path` for
image-cache files. The 600 s backstop poll
(`scan_once`) does the search-index drift pass via
`update_drifted_files`.

### Extension

Watch a SECOND directory tree, `~/.claude/projects/`, for `*.jsonl`
modifications. On event:

1. Add the changed path to a module-level "needs-reindex" set.
2. Reset a debounce timer (default 2 s).
3. When the timer fires, run `_drift_first_scan` (or a per-file
   equivalent) on just the queued paths. Clear the set.

Debouncing matters because CC writes JSONLs append-only as the user
types — a single user message can trigger 5–20 `on_modified` events
in rapid succession. Without debouncing, we'd run 5–20 SQL upserts
for the same file in one second.

The implementation uses a `threading.Timer` reset pattern (simpler
than asyncio coordination here because the watchdog Observer runs in
its own background thread). The new code lives next to
`_try_start_observer` in `backend/cc_image_watcher.py`; same
file, same lifecycle hooks.

### Lifespan integration

The image-cache observer at `backend/cc_image_watcher.py:236-281`
already gets started by `run_watcher`. Add a second
`observer.schedule(...)` call for the projects directory with the
new handler. Both observers shut down via the same
`observer.stop()` + `observer.join()` in `run_watcher`'s cleanup
block.

## TDD test plan

Write all tests FIRST in two new files. Watch them fail with
expected reasons. Then implement.

### `backend/tests/test_drift_first_scan.py` (new, ~6 tests)

1. **Empty index → every path is drifted.** Construct a fresh
   `SearchIndex`, populate `indexed_files` with NOTHING. Call
   `_drift_first_scan(store, index)`. Assert returns
   `drifted_paths` containing every JSONL + Desktop path the
   store discovers.

2. **All files unchanged → zero drift.** Build index from
   scratch (so `indexed_files` is populated), call
   `_drift_first_scan` again. Assert returns empty drift +
   empty missing.

3. **One file modified → one drifted.** Build index, then `touch`
   one JSONL to bump mtime. Call `_drift_first_scan`. Assert
   exactly that path in `drifted_paths`.

4. **One file deleted → one missing.** Build index, then remove
   one JSONL from disk. Call `_drift_first_scan`. Assert exactly
   that path in `missing_paths`, none in `drifted`.

5. **`build_full_index` no longer calls
   `get_all_conversations_raw` when no drift.** Patch the store's
   method to record calls. Build once (drift everything),
   build again (no drift). Assert second build does NOT call
   `get_all_conversations_raw`.

6. **`mark_ready()` fires after drift absorbed, not before.**
   Patch `_load_conversation_at` to sleep 2 s. Spawn
   `build_full_index` in a thread. Assert `is_ready()` returns
   False until the thread completes (i.e., until the drifted
   file has been upserted).

### `backend/tests/test_watcher_projects_drift.py` (new, ~5 tests)

7. **Projects-dir observer exists.** Start `run_watcher`. Assert
   the observer has at least one watch on `~/.claude/projects/`
   (or its monkeypatched equivalent).

8. **JSONL `on_modified` event triggers debounced drift.** Use
   the `PollingObserver` for determinism. `touch` a JSONL,
   sleep > debounce window. Assert `update_drifted_files` was
   called exactly once (not per-event-storm).

9. **Multiple rapid events → one drift call.** Touch the same
   JSONL 5 times in 200 ms. Sleep > debounce. Assert exactly one
   `update_drifted_files` call covering all changes.

10. **Non-JSONL events are ignored.** Create a `.txt` file in
    projects dir. Assert no drift fired.

11. **Shutdown cancels pending debounce timer.** Touch a JSONL
    (timer starts), immediately stop the watcher. Assert no
    drift fires after shutdown.

### `backend/tests/test_lifespan_cold_start.py` (update, 1 test bump)

12. **Heavy-task delay can drop to 500 ms.** Existing test
    `test_fts5_build_honors_500ms_delay` already asserts ≥500 ms.
    Bump the production constant in `backend/main.py` back to
    `0.5` from `5.0`. Test stays green (it asserts the floor, not
    the exact value).

## Verification

After all unit tests pass, run the cold-start benchmarks again:

```bash
# Cold restart (warm FS, cold SQLite summary cache)
hyperfine --prepare 'pkill -f "uvicorn backend.main:app"; sleep 1; \
  DYLD_LIBRARY_PATH=/opt/homebrew/lib uv run uvicorn backend.main:app --port 8765 &> /tmp/uv.log & sleep 3' \
  'curl -s http://localhost:8765/api/conversations > /dev/null'

# First-install simulation
sqlite3 ~/.claude-explorer/search-index.sqlite \
  'DELETE FROM conversation_summaries;'
hyperfine 'curl -s http://localhost:8765/api/conversations > /dev/null'

# Warm regression check
hyperfine --warmup 1 --runs 10 \
  'curl -s http://localhost:8765/api/conversations > /dev/null'

# Search-ready time: how long after restart does the FTS5 path
# kick in? Bench against /api/search to see linear-scan vs FTS5
# latency.
for i in 1 2 3 4 5 6 7 8 9 10; do
  curl -s -o /dev/null -w "search at t=$((i*2))s: %{time_total}s\n" \
    "http://localhost:8765/api/search?q=test"
  sleep 2
done
```

**Targets:**
- Cold restart `/api/conversations`: <300 ms. (Already met; must not regress.)
- First install: <1.5 s. (Already met; must not regress.)
- Warm `/api/conversations`: <100 ms. (Currently 87 ms; must not regress.)
- **NEW: search-ready time after restart: <1 s.** (Currently ~15 s.)
- **NEW: search-fresh time during runtime: <3 s after CC session edit.**
  (Currently up to 600 s.) Verify manually: touch a JSONL, wait
  2–3 s, query its content via `/api/search?q=`.

## Manual smoke tests (after merge)

1. Stop CC explorer. Edit a recent CC session (`echo '{...}' >> file.jsonl`).
   Start CC explorer. Immediately ⌘+K-search for the just-added
   content. Should find within <1 s, in FTS5 (not linear scan —
   verify via response latency: <100 ms).
2. With CC explorer running, edit a CC session externally
   (or just use CC normally). Wait 2–3 s. ⌘+K-search for the
   added content. Should find via FTS5.
3. Stop CC explorer. Delete a JSONL from disk. Start explorer.
   Search for content that WAS in that file. Should return zero
   results (the cleanup pass removed the rows).

## Risks

1. **Watchdog event coalescing under high load.** FSEvents on
   macOS coalesces events under extreme load. The 600 s backstop
   poll remains as a safety net — already in place, no change.

2. **Debounce window too long → user-perceived staleness.** 2 s
   default; adjustable via env var
   `CLAUDE_EXPLORER_SEARCH_DRIFT_DEBOUNCE_SEC`.

3. **Stat-per-file cost on slow disks.** 1,200 stat calls is
   ~50–200 ms on SSD, possibly 1–2 s on slow network mounts. The
   user's primary case is local SSD. Document in the plan;
   parallelize via `ThreadPoolExecutor` if needed.

4. **`indexed_files` and live disk diverge in pathological cases
   (clock skew, NFS, time-traveling backups).** mtime is a
   heuristic, not a hash. If a user reports stale search results
   for a file with same-mtime modifications, the workaround is to
   `touch` the file or run `claude-explorer reindex-search`.
   Document in `CLAUDE.md`.

5. **The cleanup pass deletes rows for paths that vanished
   between stat and query.** Today's `update_drifted_files` does
   the same; not a regression. (E.g. user temporarily renames a
   file.) The watcher would re-add it on the next event.

6. **Backwards compat: `SCHEMA_VERSION` bump.** None expected —
   the schema doesn't change. The `LOGIC_VERSION` on
   `read_conversation_summary_fast` also doesn't change. No
   cache wipe needed.

## Critical files

**New:**
- `backend/tests/test_drift_first_scan.py` — 6 tests.
- `backend/tests/test_watcher_projects_drift.py` — 5 tests.

**Modified:**
- `backend/search_index.py:815-881 build_full_index` — replace
  body with drift-first scan + `mark_ready`.
- `backend/search_index.py:884-935 update_drifted_files` — thin
  wrapper over `_drift_first_scan` (or merge entirely).
- `backend/search_index.py` — add `_drift_first_scan` helper near
  the two functions above. Possibly add `_load_conversation_at`
  helper if not already exposed.
- `backend/cc_image_watcher.py:236-281 _try_start_observer` —
  add second `observer.schedule(...)` for the projects directory
  with a new handler. Add the debounce timer + needs-reindex set.
- `backend/main.py` — drop the 5 s heavy-task delay back to 0.5 s
  (or remove entirely after benchmarks).
- `backend/tests/test_lifespan_cold_start.py:test_fts5_build_honors_500ms_delay`
  — sanity update if needed (the test asserts ≥500 ms; should
  stay green).

**Reused (do not rewrite):**
- `backend/store.py:_get_conversation_files` and
  `backend/claude_code_reader.py:discover_jsonl_files` — path
  enumerators. No change.
- `backend/search_index.py:needs_update` — per-file mtime
  comparator. No change.
- `backend/search_index.py:upsert_conversation` and
  `delete_by_path` — already idempotent. No change.

## Implementation order (TDD)

1. Branch from main: `perf/search-index-freshness`.
2. Write all 11 new tests (RED commit). Verify expected failures.
3. Implement `_drift_first_scan` + refactor `build_full_index`.
   Run tests 1–6 → GREEN.
4. Refactor `update_drifted_files` to use `_drift_first_scan`.
   Run full search-index tests → GREEN.
5. Extend `cc_image_watcher` with the projects observer +
   debounce. Run tests 7–11 → GREEN.
6. Drop the 5 s delay in `backend/main.py` to 0.5 s.
   Run full `backend/tests` → GREEN.
7. Run the cold-start benchmarks. Confirm all four targets met
   (cold-restart, first-install, warm, search-ready).
8. Article update: edit `articles/part_2_web_app.md`
   "Performance (FTS5 index)" section. Replace the
   "search-ready at t≈15 s" framing (added in cold-start work)
   with the new <1 s number. Add a short paragraph on the
   event-driven watcher for in-flight freshness. Active voice;
   no em-dashes; match existing perf-section voice.
9. Commit per logical step. NO AI attribution.
10. Fast-forward merge to main.

## Estimated effort

~4–6 hours including tests + benchmarks + article update. The
refactor is mechanical; the trickier parts are the watcher
debounce + the test fixtures for event-driven behavior (use
`PollingObserver` for determinism, same pattern Phase 1's watcher
tests use).
