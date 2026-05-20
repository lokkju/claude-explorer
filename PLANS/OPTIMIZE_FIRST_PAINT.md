# Plan: speed up `/api/conversations` from ~5s → <100ms warm

**Status:** approved, ready to implement.
**Owner:** llm-council-coding (per user direction).
**Related:** `articles/part_2_web_app.md:293` (the "around 5 s" sentence
this work is meant to retire), `backend/search_index.py` (sibling
SQLite database we'll piggyback on), `backend/cc_image_watcher.py`
(watcher we'll extend for drift detection).

## Context

The Part 2 article currently apologizes:

> First paint tells a different story. `/api/conversations` returns
> the full sidebar in around **5 s** for ~650 KB, dominated by JSON
> parse and serialization across thousands of files. That's slower
> than I'd like and a known target for optimization on the current
> corpus size.

This plan retires that apology before V1 ships.

**Measured corpus** (~2026-05-16):
- 4 Claude Desktop conversation JSONs
- ~1,200 Claude Code session JSONLs, ~1.5 GB total

**Where the 5 seconds actually goes** (traced end-to-end):

| Phase | Cost | Why |
|---|---|---|
| CC metadata scan | **2.5–4 s** | `read_conversation_summary_fast` opens every JSONL, reads every line, `orjson.loads` each. No early exit. No cache (the existing `FileCache` is only used on the `full_content=True` path). |
| Desktop JSON parse | 0.5–1.5 s cold / ~0.1 s warm | `FileCache` already covers this. |
| Pydantic + FastAPI default JSON encoder | ~0.5 s | Stdlib encoder, not orjson, on a 1.2 MB response. |
| Summary build + filter + sort | ~0.2 s | In-memory, fine. |

Plus: the React sidebar renders **all 1,200 rows** with NO
virtualization (despite `@tanstack/react-virtual` being in
`frontend/package.json`), so even a fast API response would still cost
real first-paint time on the browser side.

The plan below is the LLM-Council-approved recommendation: a
persistent sidebar metadata cache piggybacking on the existing
`~/.claude-explorer/search-index.sqlite` database, orjson serialization,
parallelized cold-scan misses, and unified drift detection with the
existing FTS5 watcher pass. Phase 2 covers field-removal (audit-gated)
and frontend virtualization (separate concern).

---

## Phase 1: ship-now (highest ROI, minimum risk)

### 1.1 `ORJSONResponse` on the endpoint — 15 minutes, do first

- `backend/routers/conversations.py:18` — add
  `response_class=ORJSONResponse` to the `@router.get("")` decorator.
- Verify `ConversationSummary` (`backend/models.py:78-110`) has no
  exotic fields that orjson refuses (datetimes are fine).
- **Win:** ~0.5 s → ~30 ms on the 1.2 MB serialization.

### 1.2 Persistent SQLite metadata cache (the main fix)

**Schema** (added to `backend/search_index.py:SCHEMA_SQL`):

```sql
CREATE TABLE IF NOT EXISTS conversation_summaries (
    path TEXT PRIMARY KEY,
    mtime REAL NOT NULL,
    size INTEGER NOT NULL,
    summary_json BLOB NOT NULL,   -- orjson-serialized ConversationSummary
    cached_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS conversation_summaries_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
-- One row: ('logic_version', '<sha256[:16]>')
```

**`LOGIC_VERSION` auto-invalidation** — at the top of
`backend/claude_code_reader.py`:

```python
import hashlib, inspect
LOGIC_VERSION = hashlib.sha256(
    inspect.getsource(read_conversation_summary_fast).encode()
).hexdigest()[:16]
```

Lifespan startup compares against `conversation_summaries_meta`;
mismatch → `DELETE FROM conversation_summaries` and rewrite the meta
row. Catches silent behavioural regressions without manual schema
bumps. (Trade-off: whitespace/comment changes also trigger a cache
wipe. Acceptable; the function is small and changes rarely.)

**New module — `backend/summary_cache.py`:**
- Module-level singleton via `get_summary_cache()` (same pattern as
  `backend/cache.py:get_conversation_cache` and
  `backend/search_index.py:get_search_index`).
- Holds a SQLite connection in WAL mode, `busy_timeout=5000`.
- API: `get_many(paths, stat_index) -> dict[Path, dict]`,
  `upsert_many(rows, stat_index)`, `clear_on_logic_mismatch()`.
- `get_store()` continues to return a new `ConversationStore` per
  request — fine because the cache is module-scoped.

**Hot-path integration** —
`backend/claude_code_reader.py:1331-1393 list_claude_code_conversations`,
metadata branch only:

```python
# Replace:  conversations_raw = [read_conversation_summary_fast(p) for p in jsonl_paths]
# With:
stat_index = {p: os.stat(p) for p in jsonl_paths}
cache = get_summary_cache()
cached = cache.get_many(jsonl_paths, stat_index)
misses = [p for p in jsonl_paths if p not in cached]
fresh = _read_summaries_parallel(misses)   # see 1.3
cache.upsert_many(fresh, stat_index)
conversations_raw = [*cached.values(), *fresh.values()]
```

**Cold-start fallback** — keep the existing linear path callable so
the endpoint works if the SQLite file is unwritable or missing FTS5
(same pattern `backend/search.py` uses today).

**Win:** 5 s → ~50 ms warm. **Effort:** 4–6 h.

### 1.3 Parallelize cache misses

- New helper in `backend/claude_code_reader.py`:
  `_read_summaries_parallel(paths) -> dict[Path, dict]` using
  `ThreadPoolExecutor(max_workers=8)`. Pattern mirrors
  `FileCache.load_many_parallel` (`backend/cache.py:107-152`).
- Each worker opens the file, runs `read_conversation_summary_fast`,
  returns only the small dict (~2 KB) — never bubbles raw bytes back.
- orjson releases the GIL during decode, so threads scale.
- First-install case (~1,200 misses, 8 workers): ~1 s wall clock.

**Win:** 4 s cold → ~1 s cold. **Effort:** 2 h.

### 1.4 Unify drift detection with the existing watcher

- `backend/cc_image_watcher.py:scan_once` already runs an FTS5 drift
  pass every 600 s (backstop). Have the same iteration write to
  `conversation_summaries` in the same transaction — single source
  of truth for "what files have been re-scanned since last mtime
  change."
- Lazy read-through (the endpoint filling cache misses on its own)
  remains the fast path for files modified between scans.
- ~20 lines added. **Effort:** 2 h.

### 1.5 ConnectionStatus dialog — diagnose first, fix only if needed

`frontend/src/components/ConnectionStatus.tsx` currently surfaces a
"Connecting to Backend / Last error: ..." dialog after 2+ failed
retries. After Phase 1.1–1.4 the warm endpoint is ~50 ms and the cold
endpoint is ~1 s — well under any retry threshold. The dialog should
stop firing organically. **Measure first.** If it still fires:

- Raise the threshold from 2 to 3, OR add a 2 s grace period.
- Do NOT disable the dialog entirely (it's the only signal we have
  for genuine backend-down conditions).

**Effort:** 30 min if needed, 0 if Phase 1 fixes it.

---

## Phase 2: incremental wins (after Phase 1 is measured)

### 2.1 Drop unused payload fields — audit-gated

`summary`, `human_message_count`, `is_temporary`, `git_branch` are
returned in `ConversationSummary` but appear unused by the sidebar.
**Audit before removing:**

```bash
grep -rn 'summary\|human_message_count\|is_temporary\|git_branch' \
  frontend/src backend
```

If clear: remove from `ConversationSummary`
(`backend/models.py:78-110`), remove computation from
`read_conversation_summary_fast`, update TypeScript types, update
fixtures. **Win:** ~40% cache-row size reduction, ~150 KB off the JSON
response. **Effort:** 1 h audit + 1–2 h removal.

### 2.2 Frontend virtualization with `@tanstack/react-virtual`

Even at <100 ms server response, rendering all 1,200 rows on the main
thread is a real first-paint cost. The library is already in
`frontend/package.json` — wire it up in
`frontend/src/components/conversation/ConversationList.tsx:321-426`:

- `useVirtualizer({ count, getScrollElement, estimateSize: () => 56 })`.
- Verify these still work after virtualization (Playwright test):
  scroll-to-bottom, scroll-to-middle, type-to-filter,
  starred-promotion, click-row, arrow-key nav, scroll-to-active.
- Native browser Cmd+F won't find rows below the fold any more —
  acceptable; the app already has its own search UI.

**Win:** TTI 1 s → <100 ms with 1,200 rows. **Effort:** 3–4 h.

---

## Out of scope (rejected by council)

- **Append-aware tail scan with `(byte_offset, partial_state)`.**
  orjson on 5 MB is single-digit ms; once the cache exists, hits
  dominate and re-parsing on miss is negligible.
- **Watchdog → per-line metadata upsert.** Long CC sessions write
  many lines/sec; per-line SQLite writes would thrash. 600 s
  backstop + lazy read-through suffices.
- **`202 Accepted` + indexing-in-progress UX.** Over-engineering for
  a local single-user app. Revisit only if first-install cold-scan
  comes back >5 s after parallelism.

---

## Critical files

**New:**
- `backend/summary_cache.py` — module-level SQLite-backed summary
  cache. Mirrors `backend/cache.py:FileCache` pattern.
- `backend/tests/test_summary_cache.py` — cache hit/miss,
  `LOGIC_VERSION` mismatch → table truncate, parallel-miss path.

**Modified:**
- `backend/routers/conversations.py:18` — `response_class=ORJSONResponse`.
- `backend/search_index.py` — add `conversation_summaries` +
  `conversation_summaries_meta` tables to `SCHEMA_SQL`.
- `backend/claude_code_reader.py:685-801` — add `LOGIC_VERSION`
  module constant computed from `inspect.getsource`.
- `backend/claude_code_reader.py:1331-1393` — replace sequential
  comprehension with cache-checking + parallel-misses path; add
  `_read_summaries_parallel`.
- `backend/main.py` (lifespan) — call
  `get_summary_cache().clear_on_logic_mismatch()` after FTS5 init.
- `backend/cc_image_watcher.py:scan_once` — extend drift pass to
  also upsert `conversation_summaries`.

**Reused (do not rewrite):**
- `backend/cache.py:FileCache.load_many_parallel` — copy the
  ThreadPoolExecutor pattern, don't re-invent it.
- `backend/search_index.py:get_search_index` — copy the
  module-level-singleton pattern.
- `backend/search.py` linear-scan fallback — model the
  cache-unavailable fallback on this.
- `backend/cc_image_watcher.py:_seen` — the idempotency pattern is
  the right model for "already-cached path."

---

## Verification

Measure before and after. Don't trust the council's estimates.

```bash
# Warm latency (FileCache + SQLite both hot)
hyperfine --warmup 1 --runs 10 \
  'curl -s http://localhost:8765/api/conversations > /dev/null'

# Cold-start latency (kill server, restart)
hyperfine --prepare 'pkill -f "uvicorn backend.main:app"; sleep 1; \
  DYLD_LIBRARY_PATH=/opt/homebrew/lib uv run uvicorn backend.main:app --port 8765 &> /tmp/uv.log & sleep 3' \
  'curl -s http://localhost:8765/api/conversations > /dev/null'

# First-install simulation (cache table empty, FS cache cold)
sqlite3 ~/.claude-explorer/search-index.sqlite \
  'DELETE FROM conversation_summaries;'
hyperfine 'curl -s http://localhost:8765/api/conversations > /dev/null'
```

**Targets (measure, don't guess):**
- Warm cache, full FS cache: **<100 ms** end-to-end.
- Cold SQLite cache, warm FS cache: **<300 ms**.
- First install, cold FS cache, 1,200 files: **<1.5 s**.

**Regression guards:**
- pytest: `read_conversation_summary_fast(path)` and
  `summary_cache.get_one(path)` produce byte-equal
  `ConversationSummary` dicts.
- pytest: `LOGIC_VERSION` mismatch triggers table truncate at startup.
- Playwright (Phase 2.2 only): virtualized list scroll / filter /
  click / keyboard-nav all work.

---

## Build order

1. **1.1** (`ORJSONResponse`, 15 min) — easy win, easy to measure.
2. **1.2 + 1.3 together** (persistent cache + parallel misses) — the
   main fix.
3. **1.4** (unify drift) — cleanup.
4. **Measure.** Update the article (see "Article writeup" below).
5. **1.5** only if dialog still fires after Phase 1.
6. **2.1** (field removal) — audit-first.
7. **2.2** (virtualization) — independent of all above.

---

## Article writeup (for `articles/part_2_web_app.md`)

After Phase 1 ships and the numbers come back, replace the
apologetic paragraph at `articles/part_2_web_app.md:293`:

> First paint tells a different story. `/api/conversations` returns
> the full sidebar in around **5 s** for ~650 KB, dominated by JSON
> parse and serialization across thousands of files. That's slower
> than I'd like and a known target for optimization on the current
> corpus size.

…with a section like this (numbers in **bold** are placeholders to be
filled in from the `hyperfine` runs above):

> **First paint used to be the painful one.** `/api/conversations`
> took around **5 s** to return a ~650 KB sidebar payload, dominated
> by walking every Claude Code session JSONL on disk (~1,200 files,
> ~1.5 GB) to recompute message counts, the latest custom title, and
> a few other metadata fields. It worked, but it felt slow, and the
> connection-status dialog had time to flash a "Last error" badge
> before the response came back. Three small changes fixed it.
>
> **The dominant cost: re-parsing files that hadn't changed.** A
> "fast" metadata reader still read every byte of every session
> JSONL on every sidebar request, just because no cache layer
> persisted across restarts. The fix is a thin SQLite table —
> `conversation_summaries(path PRIMARY KEY, mtime, size,
> summary_json)` — co-located in the existing search-index database
> at `~/.claude-explorer/search-index.sqlite`. On each request, the
> hot path does `SELECT … WHERE path IN (…) AND mtime = ?` for every
> JSONL path, and only re-scans the ones whose mtime or size has
> drifted. Cache hits cost a single SQLite read each. Cache misses
> still happen — when a CC session grows between requests — but
> they're now a small fraction of the corpus, fanned out across 8
> threads via `ThreadPoolExecutor` (orjson releases the GIL during
> decode, so the threads actually scale).
>
> **Auto-invalidation when the scan function changes.** Every
> persistent cache eventually faces the question "what happens when
> the code that populates it gets smarter?" Bumping a manual
> `SCHEMA_VERSION` works but only if you remember to bump it. The
> cleaner answer is to hash the source code of the producer:
>
> ```python
> LOGIC_VERSION = hashlib.sha256(
>     inspect.getsource(read_conversation_summary_fast).encode()
> ).hexdigest()[:16]
> ```
>
> The hash lives in a `conversation_summaries_meta` row, gets
> compared at lifespan startup, and any mismatch wipes the cache
> table. Whitespace and comment edits also trigger a wipe — a fair
> price for never shipping a silent regression where the cached
> rows say one thing and the live function says another.
>
> **Serialization: `ORJSONResponse` over FastAPI's default
> encoder.** Going from Pydantic-via-stdlib-json to orjson saved
> around **N00 ms** on a ~1 MB response. One line in the
> `@router.get("")` decorator.
>
> **Drift detection piggybacks on a watcher that already runs.** The
> image-cache watcher (`backend/cc_image_watcher.py`) was already
> doing a 600 s "backstop poll" pass that walks the live data
> directories for the FTS5 search index. The same iteration now
> upserts the summary cache in the same transaction — two purposes,
> one walk, single source of truth for "what files have we
> re-examined since last mtime change."
>
> **The new numbers** (`hyperfine`, 10 runs, warm caches):
>
> | Query | Before | After | Speedup |
> |---|---|---|---|
> | `/api/conversations` warm | ≈ **5 s** | ≈ **N0 ms** | **~Nx** |
> | `/api/conversations` cold SQLite, warm FS | n/a | ≈ **N00 ms** | — |
> | `/api/conversations` first-install (1,200 files, cold) | ≈ **5 s** | ≈ **N s** | **~Nx** |
>
> The connection-status dialog stopped firing on first paint, the
> sidebar paints essentially instantly on a warm cache, and the
> first-install case (everything cold) is now bounded by parallel
> disk I/O rather than by single-threaded JSONL parsing.
>
> One thing this *doesn't* fix: the React sidebar still renders all
> 1,200 list rows on the main thread, with no virtualization. At
> **N0 ms** of network time the frame after first paint is now the
> noticeable cost. That's a separate fix
> (`@tanstack/react-virtual`, already in `package.json`) and lives in
> its own follow-on.

The agent implementing this plan should:

1. Run the `hyperfine` benchmarks before any changes and capture
   the baseline numbers — store them in the commit message of the
   first change.
2. Run them again after each phase and capture the deltas — also in
   commit messages.
3. After Phase 1.4 lands, edit `articles/part_2_web_app.md` to
   replace the apology paragraph with the writeup above, filling in
   the bolded placeholder numbers from the post-Phase-1 hyperfine
   run.
