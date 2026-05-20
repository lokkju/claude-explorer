# Plan: fix the cold-start contention that defeats `/api/conversations`

**Status:** planned, not yet implemented.
**Owner:** TBD (user to assign — likely llm-council-coding).
**Depends on:** `PLANS/OPTIMIZE_FIRST_PAINT.md` Phase 1 (merged 2026-05-16,
commits `7fa7843`..`658ff13`).

## Context

`PLANS/OPTIMIZE_FIRST_PAINT.md` Phase 1 brought warm `/api/conversations`
from ~5 s to ~80 ms (a ~58× speedup) by introducing a persistent
SQLite summary cache. **But two target cases still miss:**

| Scenario | Result | Target | Met |
|---|---|---|---|
| Warm (FS + SQLite both hot) | ~80 ms | <100 ms | ✅ |
| Cold SQLite, warm FS | ~5.6 s | <300 ms | ❌ |
| First install (cold everything) | ~6 s | <1.5 s | ❌ |

The Phase 1 agent isolated the new cache layer in a one-off run and
measured **1.55 s for 970 files cold** — i.e. the cache layer itself
would hit the <1.5 s first-install target. The remaining 4–5 s in
the cold-restart benchmark is **lifespan task contention**: at
`backend/main.py:197-266`, the lifespan handler kicks off three
heavy background tasks immediately:

1. `run_watcher(...)` — initial `scan_once` walks
   `~/.claude/image-cache/` recursively.
2. `warm_all_sessions_async()` — walks **every** CC session JSONL
   looking for `[Image: source: ...]` markers and copies referenced
   files to the permanent cache.
3. `_build_search_index()` — parses every message in every JSONL
   into SQLite FTS5 over ~13,000 messages.

All three race the first `/api/conversations` request for CPU and
disk bandwidth, so the cold-restart benchmark measures the
contention, not the actual cache miss.

## Goal

Make the cold-restart and first-install cases hit their plan-stated
targets (<300 ms cold SQLite, <1.5 s first-install) **without
regressing the warm case** (currently ~80 ms), without losing any
correctness guarantee of the three lifespan tasks, and without
introducing a Phase-3 follow-up.

## Recommended approach: eager-fill summary cache + delay the others

Two changes, both in `backend/main.py:lifespan`.

### Change 1: eagerly populate the summary cache at startup

Today, `summary_cache.clear_on_logic_mismatch(LOGIC_VERSION)` runs
synchronously at lifespan (`backend/main.py:275-293`) — fast (one
SELECT + maybe one DELETE), but it does NOT fill the cache. The
first `/api/conversations` request after a cold restart still pays
the full ~1.5 s parallel JSONL re-parse cost.

Add a new background task that does the fill:

```python
# At backend/main.py lifespan, alongside the existing
# search_index_task and warm_task creations:

async def _build_summary_cache() -> None:
    """Eagerly fill the summary cache so the first sidebar request
    after restart hits a warm cache, not a cold-rebuild path."""
    try:
        from backend.summary_cache import get_summary_cache
        from backend.claude_code_reader import _read_summaries_parallel, discover_jsonl_files
        from backend.config import get_settings
        import os, time

        cache = get_summary_cache()
        if cache is None:
            return  # FTS5 unavailable; falls through to legacy path
        paths = list(discover_jsonl_files(get_settings().claude_dir))
        stat_index = {p: os.stat(p) for p in paths}
        cached = cache.get_many(paths, stat_index)
        misses = [p for p in paths if p not in cached]
        if not misses:
            return
        t0 = time.monotonic()
        fresh = _read_summaries_parallel(misses)
        cache.upsert_many(fresh, stat_index)
        elapsed = time.monotonic() - t0
        print(
            f"summary cache: filled {len(fresh)} entries in {elapsed:.2f}s",
            flush=True,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"summary cache: eager fill failed: {exc!r}", flush=True)

summary_cache_task = asyncio.create_task(_build_summary_cache())
```

The task is **non-blocking**: the server is up at `:8765` the
moment the lifespan yields. If a request lands before the eager
fill finishes, it falls through to the existing on-demand parallel
fill (Phase 1's `list_claude_code_conversations` hot path). So
correctness is unchanged; we're only changing *who pays the cost
first*.

### Change 2: delay the other two heavy tasks slightly

The FTS5 build (13k+ messages) and the warm-image scan (every
JSONL byte for image markers) are heavier than the summary-cache
fill and contend for the same disk + CPU. Both are
correctness-non-critical for first-paint — neither feeds the
sidebar. Delay them so the summary cache and the first request get
disk priority for the first half-second.

```python
# Inside _build_search_index() and warm_all_sessions_async, OR at
# the create_task site:

await asyncio.sleep(0.5)
# ...rest of the task body...
```

`asyncio.sleep(0.5)` is a thousand times cheaper than the 1.5 s
summary cache fill we're racing against. The other tasks still
complete in <30 s as today; we just give the summary cache a
half-second head start.

Don't gate on "first request landed" — that introduces a
correctness wart (if no request ever lands, the indexes never
warm) and the simple delay is enough.

### Why this works

- **Cold-restart case:** lifespan yields at port-bind, eager fill
  starts immediately, FTS5 and warm scan delayed 500 ms. First
  `/api/conversations` request (a fraction of a second post-bind)
  hits a partially-warm or fully-warm cache; remaining misses get
  served on-demand via the existing parallel path. Should land at
  ~200–300 ms.
- **First-install case:** same flow, but eager fill takes the full
  ~1.5 s. First request that races it falls through to on-demand
  fill — same code path as today, so worst-case is current behavior
  (~6 s). Best-case (request lands after fill completes) is ~80 ms.
- **Warm case:** unchanged. Lifespan tasks no-op (cache is full,
  FTS5 already built); ~80 ms.

## Risks

1. **Eager fill blocks shutdown if the process is killed before it
   completes.** Mitigation: same `try / except CancelledError`
   pattern as the existing tasks at lines 312–330. Partial fill is
   idempotent — next startup picks up the misses.

2. **The 0.5 s delay could push search-index ready time out a hair.**
   Today FTS5 takes ~10–20 s to build the full corpus; an extra
   500 ms is noise. Confirm with the existing
   `print("search index build complete...")` timing in the log.

3. **`_read_summaries_parallel` uses `ProcessPoolExecutor` for
   miss-sets > 50 files** (Phase 1 finding — `ThreadPoolExecutor`
   was slower because of GIL-bound per-line iteration). The lifespan
   spawning a ProcessPool may interact oddly with FastAPI's worker
   model in production deployments. Today this only fires inside an
   HTTP request, where the interaction is well-understood. Verify
   that the lifespan-spawned pool shuts down cleanly via the
   existing `finally` block — likely needs a `concurrent.futures`
   import + explicit `executor.shutdown(wait=True)` to avoid
   orphaned workers if lifespan is cancelled mid-fill.

4. **Watcher's initial `scan_once`** also walks the image cache at
   startup. Not on the same critical path as the JSONL re-parse,
   but still I/O. Lower priority — consider adding the same 0.5 s
   delay if benchmarks show it matters; otherwise leave it.

## Out of scope

- **Wait-for-first-request gating.** Considered; rejected as overly
  cute. The delay-then-go pattern is simpler and just as effective.
- **Splitting FTS5 build into smaller batches with yields between.**
  The build runs in `asyncio.to_thread` and is already off the
  event loop. Splitting would add complexity without changing the
  disk-bandwidth picture.
- **Skipping the warm-image scan on startup entirely** and relying
  on the watcher to catch new images. Considered, but the warm
  scan exists precisely to catch images CC rotated off disk before
  the watcher started — losing that defeats its purpose.

## Critical files

**Modified:**
- `backend/main.py:268-293` (immediate area) and `:197-266` (the
  three heavy tasks) — add `_build_summary_cache`, add
  `asyncio.sleep(0.5)` to the other two tasks, add the new task to
  the `finally` cleanup block at `:312-330`.

**Reused (do not rewrite):**
- `backend/claude_code_reader.py:_read_summaries_parallel` — the
  Phase 1 parallel-miss helper.
- `backend/claude_code_reader.py:discover_jsonl_files` — the path
  enumerator.
- `backend/summary_cache.py:get_summary_cache` — the singleton
  accessor.
- Existing `try / except CancelledError` shutdown pattern at
  `backend/main.py:312-330` — extend, don't replace.

**New:**
- None expected. Possibly `backend/tests/test_lifespan_cold_start.py`
  if the council deems it worth the fixture cost.

## Verification

```bash
# Cold restart bench — same as PLANS/OPTIMIZE_FIRST_PAINT.md
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
```

**Targets:**
- Cold SQLite + warm FS: **<300 ms** (current ~5.6 s).
- First install, cold FS, ~1,200 files: **<1.5 s** (current ~6 s).
- Warm: **<100 ms** (current ~80 ms — must not regress).

**Regression guards:**
- pytest `test_lifespan_*` if added: cold-restart with eager-fill
  enabled produces a non-empty summary cache before any HTTP
  request fires.
- Existing watcher tests + FTS5 tests must continue to pass —
  these tasks aren't deleted, just delayed 500 ms.

## Article update (mandatory; not optional)

After the numbers land, update the **"Performance (FTS5 index)"**
section of `articles/part_2_web_app.md`. The user has explicitly
asked that every perf improvement land in this section — don't
ship the code change without the article edit in the same branch.

Two specific edits the implementer MUST make:

1. **Line 323** currently reads: *"The cold-restart numbers
   aren't a win, and that's worth being honest about. The first
   request after a server restart still takes 5–6 s because the
   FastAPI lifespan hook kicks off two heavy background tasks at
   the same time…"* Replace with the new measured numbers and a
   short description of the eager-fill + small-delay approach.
   Drop the "untangling that is a separate, larger change" sentence
   — that's what this work IS.

2. **Lines 317–319 table** — update the cold-SQLite and
   first-install rows with the new measured numbers. If both hit
   target, add a "✓ target met" annotation; if either misses,
   say so honestly.

Keep the voice and structure of the existing Phase 1 writeup
(`articles/part_2_web_app.md:293-325`). Active voice. No
em-dashes. No "X, not Y" constructions. Verify these stylistic
constraints in `CLAUDE.md` before editing.

## Estimated effort

~2–3 hours including tests + benchmarks. The bulk of the work is
in measurement; the code change is ~30 lines in `backend/main.py`.
