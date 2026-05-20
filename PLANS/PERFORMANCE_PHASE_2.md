# Performance Phase 2: Cold-load, image-warm, detail bottleneck, bench infra

[[#Table of Contents|Jump to Table of Contents]]

## Status

Investigation complete; awaiting the user's go/no-go on the four workstreams plus one new bug fix that surfaced during measurement. Implementation will be delegated to `llm-council-coding` per workstream.

**LLM Council on this plan:** Systems Architect (Claude Opus 4.7) + Platform & Reliability Architect (Gemini 3 Pro). The Architecture Critic (GPT-5.2-pro) was unavailable for this session (PAL quota exhausted on the openai key); Gemini was prompted with an explicit adversarial second pass to fill the gap. The user should re-read the "Risks the critic flagged" sub-sections with extra skepticism since they didn't get an independent provider's eyes.

## Context

V1 release imminent. Five perf workstreams already landed: `[[OPTIMIZE_FIRST_PAINT]]`, `[[OPTIMIZE_COLD_START]]`, `[[SEARCH_INDEX_FRESHNESS]]`, `[[SPLIT_CONVERSATION_SCHEMA]]`, virtualization. Warm `/api/conversations` is 87 ms, FTS5 search ready in <1 s after restart, in-flight search freshness ~2-3 s.

The investigation revealed FIVE items, not four. The conversation-detail measurement uncovered a missing-cache bug at `backend/store.py:490` that turns every CC detail/export request into a full JSONL re-parse. That's the single highest-ROI fix in the entire plan and is called out as a separate workstream below.

## Table of Contents

- [[#Status]]
- [[#Context]]
- [[#Decision principles]]
- [[#Headline measurements (numbers, not adjectives)]]
- [[#Workstream A: Search snippet generation (the 15 s cold load)]]
- [[#Workstream B: CC image-warm 5 s delay]]
- [[#Workstream C1: Conversation detail cache bypass (the new bug)]]
- [[#Workstream C2: Export (folds into C1)]]
- [[#Workstream C3: Frontend bundle]]
- [[#Workstream D: Benchmark infrastructure]]
- [[#Recommended ordering & ROI table]]
- [[#Risks the critic flagged across workstreams]]
- [[#Clarifying questions for the user]]
- [[#Out of scope for this phase]]

---

## Decision principles

- **Measure before changing anything.** Every number in this plan came from a `hyperfine` run or direct in-process timing against the live `~/.claude-explorer/` corpus (991 conversations, ~3 GB of CC JSONLs, 861 MB FTS5 index file). Adjectives appear only in section titles.
- **Solo-dev operational realism.** No managed services, no distributed caches, no infrastructure that ships with the wheel except SQLite and a watchdog observer.
- **Less code beats more code.** Where two paths produce equivalent UX, the simpler one wins even if it's slightly slower.
- **No invisible regressions.** Every change ships with a benchmark assertion and a hand-test sentence the user can copy-paste.
- **Skip cold-start "headroom" delays when the underlying work is fast.** The 5 s `asyncio.sleep` in `backend/main.py:230` was needed when the warm pass took 10 s of contended disk I/O; once the underlying work drops below ~500 ms it's a hold on the user's perception for no benefit.

---

## Headline measurements (numbers, not adjectives)

Measured against the live local corpus 2026-05-16, in-process where possible, via `hyperfine` against `127.0.0.1:8765` otherwise.

| Surface | Cold (s) | Warm (s) | Notes |
|---------|----------|----------|-------|
| `/api/conversations` (sidebar) | 0.41 | 0.087 | Post Phase-1 numbers (no change in this plan) |
| `/api/search?q=python` | 20.85 | 1.69-2.46 | 154 conv hits, 5,124 message hits |
| `/api/search?q=claude` | n/a | 1.77-1.95 | 142 conv hits |
| `/api/search?q=foobar` | n/a | 0.77 | 6 conv hits (substring title-sweep) |
| `/api/conversations/{LARGE}` 288 MB JSONL | n/a | 1.47 | First measurement that should not be 1.47 s |
| `/api/conversations/{MED}` 41 MB JSONL | n/a | 0.36 | |
| `/api/conversations/{SMALL_CC}` 485 KB JSONL | n/a | 0.015 | |
| `/api/conversations/{DESKTOP}` ~30-msg JSON | n/a | 0.011 | |
| `/api/conversations/{LARGE}/export/markdown` | n/a | 1.46 | Output 22 MB |
| `/api/conversations/{MED}/export/markdown` | n/a | 0.40 | |
| `/api/conversations/{SMALL_CC}/export/markdown` | n/a | 0.016 | |
| Frontend bundle (post `npm run build`) | n/a | n/a | `index-*.js` = 1,004 KB, gzip 301 KB |

In-process breakdown of the cold search (the user-visible "16 s" pain):

| Stage | Cold (ms) | Warm (ms) |
|-------|-----------|-----------|
| Raw FTS5 MATCH only (`SearchIndex.query`) | 140 | 140 |
| `get_all_conversations_raw()` (first walk, cold disk) | 15,073 |, |
| `get_all_conversations_raw()` (second walk, FileCache warm) | 307 | 61 |
| End-to-end `_search_via_index` cold | 15,838 |, |
| End-to-end `_search_via_index` warm (fully primed) |, | 751 |
| FTS5 `snippet()` in pure SQL for 5,000 rows |, | 965 |

Two facts pop out:

1. **The 15-second cold cost is `get_all_conversations_raw()`** in `backend/search.py:813`, not snippet building. The function walks every JSONL byte even when the FTS5 index has already told us which conversations matter.
2. **The warm 326 ms floor for `xyzzyqq` (1 hit) is also the corpus walk**, not snippet work. The snippet for 1 conv is trivial. End-to-end warm latency for `python` (154 convs) is 751 ms; subtract the 326 ms walk floor and the actual snippet build is ~425 ms.

Index file sizes that matter for the snippet decision:

- `~/.claude-explorer/search-index.sqlite`, **861 MB**
- `SUM(LENGTH(body))`, **453 MB** (text duplicated: once in the FTS5 inverted index, once in the `body UNINDEXED` column)

---

## Workstream A: Search snippet generation (the 15 s cold load)

[[#Table of Contents|Back to TOC]]

### Current state

`backend/search.py:813` walks the entire conversation corpus on every search query (`for conv in store.get_all_conversations_raw(source=source):`) even though FTS5 has already narrowed the match set to a few dozen UUIDs. On a cold cache that walk is 15 s (file I/O for 991 JSONLs); on a fully primed warm cache it's still 60-300 ms of dict iteration + per-file `os.stat`.

Per-message snippet work happens in Python via `create_snippet` (`backend/search.py:284`): ±150 char window around the first regex match with a 25-char word-boundary nudge. Caches the flattened searchable text on the cached conversation dict under `__search_text_full__` / `__search_text_textonly__` so repeated searches don't re-run `_extract_searchable_text`.

### Options considered

**Option A. Pre-warm matched-file content into FileCache after every FTS5 query.**
After `idx.query()` returns the matched UUIDs, dispatch an async `cache.load_many_parallel(matched_paths, read_claude_code_conversation)` so the snippet pass that follows runs warm.

- **Pros:** Mechanical fix, no schema change, no frontend change, keeps the existing scatter-gather logic.
- **Cons:** Still pays the file-read cost on first match per file; needs async lifecycle (what if the user cancels?); doesn't shrink the corpus walk that's the actual 15-s offender; ADDS code complexity rather than removing it; doesn't address the 326 ms warm floor.

**Option B. Use FTS5's built-in `snippet()` function (user's leaning).**
Change `SearchIndex.query` to emit `snippet(messages, 8, '<mark>', '</mark>', '...', 30) AS snippet` alongside the existing `(conv_uuid, message_uuid, sender, created_at)`. Drop the post-query corpus walk entirely. The body column is already populated with the exact same `_extract_searchable_text(msg)` projection the Python path snippets over, so output character semantics match. Measured: 965 ms for 5,000 rows, zero file I/O.

- **Pros:** Eliminates the 15-s cold path by construction (no JSONL reads needed at search time); eliminates the 326 ms warm floor (no corpus iteration); ~200 lines of Python deleted (`_search_via_index` collapses to a thin wrapper); BM25-driven window selection picks the densest match cluster across multi-token queries instead of arbitrarily marking the first hit.
- **Cons:** Frontend `<HighlightedSnippet>` swaps from `(snippet, match_start, match_end)` to inline `<mark>` tags, small but real change. `context_size="full"` mode can't be served by `snippet()` and needs the old path as a fallback. Doesn't shrink the 861 MB index file (the body column is what `snippet()` reads from).

**Hybrid (recommended). Option B for snippet mode, keep Python path ONLY for the `context_size="full"` branch.**
The fast path becomes pure SQL with no file reads. The slow path (`context_size="full"`, used only when a user expands a result card to "show whole message") falls back to the existing `_search_via_index` + FileCache. That path is rare and tolerates the 750 ms warm cost.

### Recommendation

Ship the Hybrid. Specifically:

1. Extend `SearchIndex.query` to return `snippet(messages, 8, '<mark>', '</mark>', '...', 30) AS snippet`. Keep the existing `(conv_uuid, message_uuid, sender, created_at, snippet)` row shape.
2. Add a `_search_via_index_fast` path that builds `SearchResult` objects directly from the SQL rows, grouping by `conv_uuid`. Title pseudo-message becomes a second cheap `SELECT snippet(messages, 7, ...) FROM messages WHERE title MATCH ? AND ...` query reusing the existing title-sweep machinery. Two SQL queries; zero file reads.
3. Reserve the existing `_search_via_index` (slow) path for `context_size="full"` only.
4. Frontend: `HighlightedSnippet` accepts a pre-marked HTML string. The body column does NOT carry user-supplied HTML (it's stored as the flat newline-join of message text, so a `<` is literally `<`), so the `<mark>` injection itself doesn't introduce new XSS surface BUT the surrounding text now needs to be rendered as raw text with the marks interpreted. Two safe paths:
   - **(Preferred)** A small server-side wrapper that returns the snippet as a structured `MarkedSnippet { fragments: [{text: string, mark: boolean}, ...] }` and the frontend renders each fragment with regular React text + a `<mark>` wrapper. Zero `dangerouslySetInnerHTML`. The wrapper is a 15-line regex split.
   - (Acceptable) Render the inline `<mark>` string with `dangerouslySetInnerHTML` after passing through DOMPurify with an allowlist of `<mark>` only. Heavier dependency, more risk surface.

Use the structured-fragments approach. Same cost on the server; no new sanitization concerns.

### Risks the critic flagged

- **R1 (sev 3, lik high): Body column surfaces tool_use JSON.** `_extract_searchable_text` calls `_stringify_tool_input` which JSON-dumps the entire `tool_use` block. Searching `"python"` could surface a snippet like `..."command": "uv run <mark>python</mark> -m pytest"...`. That's not strictly a regression (the linear-scan path produces the same snippet), but it's worth checking against user expectation. Mitigation: keep the existing `include_tool_calls=False` projection key in the body column populated separately, OR add a SQL `CASE WHEN include_tool_calls=0 THEN text_only_body ELSE body END` switch.
  - **Decision:** Ship as-is for V1. The linear-scan path has the same behavior today; we're not making this worse. If a user complains, add a `text_only_body` column in a follow-up schema bump.
- **R2 (sev 2): Snippet length unpredictability (token vs char window).** FTS5 `max_tokens=30` is approximately 150 chars for English prose, less for code. UI may show slightly variable-height cards. Acceptable; the current ±150-char window also wobbles due to the word-boundary nudge.
- **R3 (sev 1): Doesn't shrink the 861 MB index file.** Confirmed not a goal of this workstream. The index file is acceptable for a local-first tool. Index-shrink is a Phase-3 item if it ever becomes one.
- **R4 (sev 2): `context_size="full"` needs the old path.** Yes, call out in the migration that the Python path stays alive for that branch. Tests should cover both.

### Estimated effort

- Backend: 1 PR, ~300 lines changed (`search.py` simplification + `search_index.py` extension + new `MarkedSnippet` model). Tests should be straightforward since the linear-scan fallback stays as the equivalence oracle.
- Frontend: 1 PR, ~80 lines changed (`HighlightedSnippet` accepts the structured fragments shape; sidebar search result rendering unchanged).
- Total: 1-2 days of focused work for one engineer.

### Expected payoff

Cold search drops from ~16 s → **<200 ms** (pure SQL). Warm search drops from ~750-2,500 ms → **<200 ms**. Largest single perf win on the user surface in this plan.

---

## Workstream B: CC image-warm 5 s delay

[[#Table of Contents|Back to TOC]]

### Current state

`backend/main.py:229` defines `_delayed_warm_all_sessions` which sleeps 5 s before invoking `warm_all_sessions_async`. The function walks every CC JSONL on disk (~991 files, ~3 GB) looking for `[Image: source: ...]` markers and copies each referenced image into the permanent cache at `~/.claude-explorer/cc-images/`. The 5 s delay was added so the first `/api/conversations` request lands before the contended disk walk starts (per the comment at `backend/main.py:218-224`).

Three other paths also protect images:

1. **`backend/cc_image_watcher.py:177` event-driven observer** on `~/.claude/image-cache/`. Fires sub-second on every new image CC writes. Once the explorer is running, NEW images are caught here.
2. **Lazy path**, `read_claude_code_conversation` calls `cache_all_markers` on every conversation read. Any session a user views protects its images on first view.
3. **600 s backstop poll** re-runs `scan_once` periodically.

The startup scan exists for ONE specific failure mode: sessions that exist on disk before the explorer was ever installed/started, that the user hasn't yet opened. For those sessions, CC may have already rotated the images by the time the user clicks. The startup scan is the safety net.

### What the council found (critical correction)

The first draft of this plan proposed mtime-caching the image scan in SQLite, mirroring the drift-first FTS5 refactor. The adversarial pass killed that proposal: **the FTS5 build already reads every JSONL during its drift-first scan.** The image-warm scan reads them AGAIN. Building a separate drift cache for images would solve a symptom and ignore the duplicate-I/O architectural defect.

The right structural fix is to **piggyback `cache_all_markers` onto the FTS5 build's existing reads.** When `build_full_index` calls `_load_conversation_at(path, store)` and gets a conv dict back, that dict is exactly the input `cache_all_markers` needs. Run them together. Cost: ~5 extra lines per drifted file in `build_full_index`. The standalone `warm_all_sessions_async` task and its 5 s delay then become redundant and can be removed.

### Options considered

**Option 1, mtime-cache the image scan in SQLite.**
Add a `(path, mtime, marker_count)` table; skip files whose mtime matches the cached value.

- **Pros:** Independent of FTS5, drops warm-restart cost to milliseconds.
- **Cons:** Doesn't fix the duplicate I/O pattern; adds another SQLite table coupled to claude_code_reader; first-install cost unchanged.

**Option 2. Piggyback on the FTS5 build's reads (recommended).**
In `backend/search_index.py:build_full_index` and `update_drifted_files`, after `_load_conversation_at` returns the conv dict, call `cache_all_markers(conv)` inline. Delete the standalone `warm_all_sessions_async` task and its 5 s delay from `backend/main.py:226-235`. The startup scan effectively becomes free, it costs nothing beyond the FTS5 build that's already happening.

- **Pros:** Eliminates duplicate I/O entirely. Removes the 5 s delay AND the 10-15 s warm-pass cost. Removes ~80 lines from `main.py` lifespan plus the `warm_all_sessions_async` wrapper. The watchdog observer + lazy path + 600 s backstop continue to cover new sessions.
- **Cons:** Couples image-warm correctness to FTS5 build correctness. If FTS5 is disabled (`CLAUDE_EXPLORER_DISABLE_SEARCH_INDEX=1`) we lose the startup image-warm pass. Mitigation: keep `warm_all_sessions_async` as a fallback gated on `if FTS5 disabled`. Or just document: if you disable FTS5, the explorer needs the lazy path to do the image work and you risk rotation gaps on never-viewed sessions.

**Option 3. Drop the startup scan entirely; rely on watcher + lazy.**
Risk: sessions that existed before the explorer first ran and that the user never views could lose their images to CC rotation.

**Option 4. Reduce delay 5 s → 500 ms.**
Doesn't fix the underlying duplicate I/O. Stop-gap.

### Recommendation

**Ship Option 2.** Wire `cache_all_markers` into `build_full_index` and `update_drifted_files`. Remove the standalone `warm_all_sessions_async` startup task and its delay. Keep the `warm_all_sessions` function in `backend/cc_image_cache.py` available for the `claude-explorer warm-cc-cache` CLI override path and as a fallback when FTS5 is disabled. The watchdog observer + lazy path + 600 s backstop keep their existing roles.

If FTS5 is disabled (`CLAUDE_EXPLORER_DISABLE_SEARCH_INDEX=1`), keep the standalone warm task active, but drop its delay to 500 ms since at that point the user is opting out of search anyway and the contended-disk argument is weaker.

### Risks

- **R5 (sev 3, lik low): Disabling FTS5 silently loses image-warm coverage.** Mitigation above: keep the standalone task gated on the disable flag and document the dependency in `backend/main.py` and the CLI README.
- **R6 (sev 2): The FTS5 build runs in a background task; image-warm now also waits for that task.** Today the image-warm task starts after 5 s. After this change it starts whenever the FTS5 task reaches each drifted file. On warm restarts the drifted set is small or empty, so image-warm finishes faster than before. On first install the FTS5 build IS the corpus walk, so image-warm finishes at the same wallclock time as the build, strictly better than today's "FTS5 build + 5 s + image-walk" sequence.
- **R7 (sev 1): Tests that mock FTS5 will need to also mock the image-marker side effect.** Real cost: low. Add a test fixture flag `include_image_warm: bool = True`.

### Estimated effort

1 PR, ~150 lines changed across `backend/search_index.py`, `backend/main.py`, and 1-2 test files. Half a day of focused work.

### Expected payoff

Startup time-to-image-protection: from t=5s + ~10 s walk = t≈15 s → t≈ same as FTS5 build (already <1 s warm, <60 s first install). The 5 s delay disappears entirely.

---

## Workstream C1: Conversation detail cache bypass (the new bug)

[[#Table of Contents|Back to TOC]]

### Current state: and the bug

`backend/store.py:476` defines `_find_conversation_data` which iterates EVERY Desktop JSON file (via `_get_conversation_files`) AND every CC JSONL (via `discover_jsonl_files`) until it finds one whose `.stem == uuid`. Then at line 490 it calls **`read_claude_code_conversation(jsonl_path)` directly**, bypassing the `_load_conversation_cached` wrapper at `backend/claude_code_reader.py:1431` which exists specifically to memoize this read via FileCache.

Net effect: every `/api/conversations/{uuid}` call for a CC session re-parses the entire JSONL from disk. Measured warm latency scales linearly with file size:

| JSONL size | Message count | Warm `/api/conversations/{uuid}` |
|------------|---------------|----------------------------------|
| 288 MB     | 16,103        | 1,474 ms                         |
| 41 MB      | 11,119        | 359 ms                           |
| 485 KB     | ~50           | 15 ms                            |
| Desktop ~50 KB | ~30       | 11 ms                            |

The Desktop branch correctly uses `self._load_conversation(path)` (line 484), which DOES use FileCache. CC was missed when the cache wrapper was added in a prior refactor.

### Options considered

**Option 1. Replace the direct call with `_load_conversation_cached(jsonl_path)`.**
Trivial diff: change line 490 from `read_claude_code_conversation(jsonl_path)` to `_load_conversation_cached(jsonl_path)`. Same call signature. Same return shape. Test impact: any test that asserts on a fresh re-parse per call will need updating (probably zero, most tests don't peek at parse counts).

- **Pros:** One-line behavior change with massive payoff. Brings CC into parity with the Desktop branch.
- **Cons:** FileCache has no eviction. Heavy users could accumulate GB of cached parsed dicts.

**Option 2. Same as 1, plus add LRU eviction to FileCache.**
Wrap the cache dict with an `OrderedDict`-based LRU capped at, say, `max_entries=20` for the heavy-conv use case OR cap total `len(json.dumps(...))` at ~500 MB. Evict on insert when over cap.

- **Pros:** Caps memory growth. Same payoff as Option 1.
- **Cons:** More code. LRU policy needs a sensible cap default and possibly a config override. Choosing the wrong cap can cause cache thrashing for users with many medium-sized convs.

**Option 3. Build a UUID → file-path index at startup.**
Replace the O(N) directory walk in `_find_conversation_data` with an O(1) dict lookup. Index built lazily, refreshed on watchdog file events. Pairs naturally with FileCache.

- **Pros:** Solves a SECOND O(N) cost (the directory iteration to find the file) that today is masked by being small. Future-proofs as the corpus grows past 10k convs.
- **Cons:** Another in-memory data structure to keep fresh. The watcher already watches `~/.claude/projects/` for FTS5 drift, so wiring the index update is cheap, but it's still more code.

### Recommendation

**Ship Option 1 immediately as a fix-on-its-own PR.** It's a one-line change with a near-30x warm latency improvement on the heaviest sessions. Block the V1 release on this fix landing.

**Then ship Option 2 (LRU cap) as a follow-up in the same Phase-2 sprint.** Default cap: `max_entries=10`. The 10 most-recently-touched convs cover virtually all interactive UI use cases (sidebar of N, viewing 1-2 at a time, export of 1). The cap is a soft guarantee, not a correctness invariant. The cache is purely an optimization.

**Defer Option 3** to a Phase-3 plan if/when the corpus grows past ~3k convs. At today's 991-conv scale, the directory-walk cost is sub-millisecond per request (it's the parse that hurts, not the find).

### Risks

- **R8 (sev 3, lik high without Option 2): FileCache unbounded growth.** If a user opens the 5 heaviest CC sessions in a row, their FastAPI process holds ~1 GB resident. Workaround today: restart the server. With Option 2, capped at ~500 MB. Either way, document the cache behavior in CLAUDE.md.
- **R9 (sev 2, lik low): mtime race.** If CC writes a file at mtime T and the explorer's `os.stat` reads mtime T at T+ε, then CC's later append at T+2ε goes undetected for the lifetime of that cache entry. Window is microseconds and the next FTS5 watcher event drives a re-stat anyway. Acceptable risk for V1.
- **R10 (sev 1): Tests that pre-warm the cache and mutate the file may behave differently.** Likely 0-3 test updates needed. The `clear_cache()` helper exists for exactly this.

### Estimated effort

- Option 1: 30 minutes (1-line change + a regression test that asserts warm latency stays below ~50 ms for a synthetic large CC fixture).
- Option 2: 2-3 hours (LRU wrapper + cap + test for eviction order).

### Expected payoff

Heaviest-session warm latency: **1,474 ms → ~30-50 ms** (cache-hit dict lookup + Pydantic model build).
Medium-session warm: **359 ms → ~10-20 ms**.
Cumulative impact across every page-load of a CC detail page AND every Markdown/PDF export AND every Markdown bundle ZIP, see C2 below.

---

## Workstream C2: Export (folds into C1)

[[#Table of Contents|Back to TOC]]

### Current state

Markdown export warm latency tracks conversation-detail warm latency almost exactly:

| Conv size | Detail warm | Markdown export warm |
|-----------|-------------|----------------------|
| 288 MB JSONL | 1,474 ms | 1,460 ms |
| 41 MB JSONL  | 359 ms   | 400 ms   |
| 485 KB JSONL | 15 ms    | 16 ms    |

The export endpoints in `backend/routers/export.py:24, 64, 87` all call `store.get_conversation(uuid)`, which in turn calls `_find_conversation_data`, same bottleneck as C1. The actual Markdown rendering in `conversation_to_markdown` is microsecond-scale; the time is entirely conversation load.

PDF export wasn't measured cleanly because the `DYLD_LIBRARY_PATH=/opt/homebrew/lib` env var doesn't survive `uv run`'s subprocess SIP barrier (per CLAUDE.md), so the worker couldn't dlopen `libgobject-2.0-0` and every PDF request returned 500. The Markdown export path is a good proxy though: PDF = Markdown work + a WeasyPrint render pass. On the small fixture the render pass alone has been measured at <20 ms in prior work, so PDF latency on a fixed-and-cached corpus will be approximately `detail_load + ~20 ms`.

### Recommendation

**No separate workstream.** Ship C1 and export gets the same payoff for free. Verify by re-running the export bench numbers after C1 lands.

The DYLD issue is unrelated to this perf plan but worth a one-line follow-up: `backend/tests/conftest.py` already bootstraps `DYLD_FALLBACK_LIBRARY_PATH` for tests, but the dev-server launch path doesn't. Adding a small "DYLD bootstrap on macOS" helper to the `claude-explorer serve` command would let `uv run claude-explorer serve` work without the manual `DYLD_LIBRARY_PATH=/opt/homebrew/lib` prefix. Out of scope for this plan, called out for the user's awareness.

### Estimated effort

Zero. Falls out of C1.

### Expected payoff

Large-conv Markdown export: **1,460 ms → ~30-50 ms**. Same proportional gain on PDF, JSON, and Markdown-bundle (ZIP) exports.

---

## Workstream C3: Frontend bundle

[[#Table of Contents|Back to TOC]]

### Current state

`npm run build` output:

```
dist/index.html                     0.46 kB │ gzip:   0.30 kB
dist/assets/index-BMN9UgnY.css     57.29 kB │ gzip:  10.24 kB
dist/assets/index-Coal6l_7.js   1,004.64 kB │ gzip: 301.07 kB

(!) Some chunks are larger than 500 kB after minification.
```

Vite warns about the chunk size. 2,720 modules in the bundle. Top likely contributors (from `du` on `node_modules/` + grep of imports):

- `react-markdown` + `rehype-highlight` + 37 `common` languages from `lowlight`/`highlight.js`: roughly 350-500 KB pre-min. Confirmed at `frontend/node_modules/lowlight/lib/common.js` registering 37 languages by default.
- React 19 + React DOM + React Router 7 + TanStack Query 5: roughly 200 KB pre-min.
- `@radix-ui/*` (collapsible, dialog, dropdown-menu, radio-group, scroll-area, select, separator, slot, tooltip): roughly 100-150 KB pre-min.
- App code (`frontend/src/**`): roughly 100-200 KB pre-min.
- `date-fns` v3 (tree-shaken via named imports, only `format`, `formatDistanceToNow`, `isToday`, `isYesterday`): probably 10-20 KB.
- `lucide-react` (28 named-import sites, individual icons): probably 30-50 KB.

The bundle is shipped over `localhost` to a single user. Gzip 301 KB transfers in well under 50 ms over loopback.

### What the council found

The adversarial pass was unambiguous: **slimming the frontend bundle is premature optimization for V1.** A 50 ms cost on every page-load (and ZERO ms on subsequent loads thanks to browser cache) is in the noise next to a 1,474 ms detail load. Fix the detail load first; the bundle isn't a real user-pain point.

### Options considered

- **Option 1. Slim `rehype-highlight` to ~10 hand-picked languages** (`js`, `ts`, `py`, `bash`, `json`, `md`, `css`, `html`, `sql`, `yaml`, `diff`). Saves ~300 KB pre-min. Risk: code blocks in unfamiliar languages (Go, Rust, Elixir, etc.) render as plain text. CC tool_result blocks contain ENORMOUS variety; users will see this as a regression.
- **Option 2, `React.lazy` route splitting.** Saves a small initial bundle but adds a fetch on first navigation. On localhost the saving is unmeasurable; the UX cost (Suspense fallback flash) is measurable.
- **Option 3. Lazy-load `react-markdown` itself.** Only `MessageBubble` uses it, not the sidebar. Could shave 100+ KB from the sidebar-render path. Real but not urgent.
- **Option 4. Defer entirely; revisit in a hypothetical V2 if/when the explorer ships over a non-localhost transport.**

### Recommendation

**Ship Option 4 for now, defer entirely.** Add a `vite.config.ts` change to silence the chunk-size warning (raise `build.chunkSizeWarningLimit` to 1500 so it doesn't become noise) and move on. Re-open this workstream if the explorer ever supports remote access OR if we have concrete user feedback that page-load feels sluggish.

If the user disagrees and wants to ship at least something: **Option 3 is the best ROI** (only one MarkdownRenderer is using the heavy deps; lazy-loading it has near-zero UX cost since users always see the sidebar before they click into a conversation). Option 1 is the WORST ROI, code blocks losing color is visible immediately to every user.

### Risks

- **R11 (sev 1, lik certain): Vite chunk-warning becomes accepted noise.** If we don't raise `chunkSizeWarningLimit`, every CI build will yell. If we DO raise it, we lose the signal for a future genuine bundle bloat. Trade-off: keep the warning, accept the noise.

### Estimated effort

- Option 4 (defer): 5 minutes for the vite config bump.
- Option 3 (lazy react-markdown): 2-3 hours for the `React.lazy` + Suspense wrapper + skeleton-screen test.

### Expected payoff

Negligible at V1 scale.

---

## Workstream D: Benchmark infrastructure

[[#Table of Contents|Back to TOC]]

### Current state

`benchmarks/bench_perf.py`. HTTP-level bench over `/api/conversations` and `/api/search`. mean/median/p95/max over N runs against a running server.

`benchmarks/bench_search_paths.py`, in-process comparison of `_search_via_linear_scan` vs `_search_via_index` for a fixed query list (`cron`, `python`, `claude`, no-match).

Both scripts work and produce comparable numbers. Neither covers detail-load or export. Neither is wired into CI or pre-commit.

### Design goals

From the user: *"a developer working on perf can run one command and get reliable numbers."*

- **Covers every perf-sensitive surface:** sidebar, search (cold + warm), conv detail (small/med/large), Markdown export.
- **Reproducible across machines:** absolute numbers will differ by hardware, but the RATIOS between before/after on the SAME machine should be stable enough to commit a PR diff against.
- **Fast enough that a dev will actually run it:** target <60 s end-to-end for the default profile.
- **Easy to extend:** new perf workstream → 5-10 lines added to the bench.

### What the council pushed back on

- **Don't commit per-developer baseline JSON.** Will produce noisy git diffs as each dev's machine and corpus differ. Instead: keep a `benchmarks/results/last.json` in `.gitignore` and let the user diff `git stash`'d before-and-after manually.
- **Don't put bench in pre-commit.** 60 s is too much friction; devs will `--no-verify`. Make it an explicit `make bench` (or `uv run python benchmarks/run_all.py`).
- **Auto-pick fixture UUIDs from the live corpus at runtime**, small/medium/large based on file-size percentiles. Print the chosen UUIDs in the output so devs can verify and pin them via flag if they want reproducibility.
- **Don't ship a synthetic fixture corpus.** Synthetic CC sessions miss the long tail (288 MB JSONLs, deeply nested tool_use blocks, image markers). Use the user's real corpus.
- **Cold benchmarks need `sudo purge` (macOS) or equivalent.** Provide a `--cold` flag that the user runs manually with `sudo`, never automate that in CI.

### Proposed design

A single `benchmarks/run_all.py` script with these features:

1. **Auto-detected fixture UUIDs.** At startup, walk `~/.claude/projects/` for CC JSONLs and `~/.claude-explorer/conversations/` for Desktop JSONs. Pick the file at the 5th, 50th, and 95th percentile of file size. Print the UUIDs.
2. **Server lifecycle.** Optionally start its own uvicorn subprocess against a chosen port (default 8765) and tear it down at the end. `--no-spawn` to reuse an already-running server.
3. **Suite of measurements (run sequentially):**
   - `/api/conversations` (list), 10 runs after 2 warm-ups
   - `/api/conversations/{small_uuid}`, 5 runs each
   - `/api/conversations/{medium_uuid}`, 5 runs each
   - `/api/conversations/{large_uuid}`, 3 runs each
   - `/api/search?q=python`, cold (1 run after fresh server start) + 5 warm runs
   - `/api/search?q=foobar`, cold + 5 warm
   - `/api/conversations/{medium_uuid}/export/markdown`, 3 runs
4. **Output formats:**
   - Default: human-readable table on stdout (mean, median, p95, max, payload bytes).
   - `--json`: machine-readable to stdout for piping into a diff tool.
   - Optionally write `benchmarks/results/{git_sha}.json` (gitignored) for the user's own diff workflows.
5. **`--cold` flag:** prints reminder to run `sudo purge` (macOS) or `sync && echo 3 > /proc/sys/vm/drop_caches` (Linux) BEFORE re-running. Doesn't try to invoke sudo itself.
6. **No `hyperfine` dependency in the script itself.** Pure Python `time.perf_counter` + stdlib `urllib.request`, mirroring the existing `bench_perf.py`. (User can use `hyperfine` separately for any one-off measurement.)
7. **Wrapped in a `Makefile` target** `make bench` for the one-command experience.

### Recommendation

**Ship the proposed design.** The two existing scripts (`bench_perf.py`, `bench_search_paths.py`) are kept as-is, they're useful focused tools, but the new `run_all.py` becomes the canonical "did I regress anything" gate.

Add a `make bench-cold` target documented to require `sudo purge` first; default `make bench` runs warm only.

### Risks

- **R12 (sev 2): Devs without CC sessions installed get only Desktop bench numbers.** Mitigation: the bench script gracefully degrades (skips the large-CC bucket if no CC files exist) and prints a "skipped: no CC sessions on this machine" line. Document the limitation.
- **R13 (sev 1): Server startup adds 5-10 s to every bench run.** Acceptable. The script prints a banner when it's spawning vs. reusing.
- **R14 (sev 3): It's a script, not enforced.** Devs may not actually run it. Mitigation: PR template lists "run `make bench` and paste before/after numbers" as a checklist item. Won't catch every regression but raises awareness.

### Estimated effort

1 PR, ~250-400 lines of Python + a Makefile target + a README section. 1 day of focused work.

### Expected payoff

A common language for "did this PR regress sidebar/search/detail/export performance?" One command, one output, easy to copy-paste into PR descriptions.

---

## Recommended ordering & ROI table

| # | Workstream | Effort | Latency win | Risk | Ship now? |
|---|------------|--------|-------------|------|-----------|
| 1 | **C1**: cache CC reads in `_find_conversation_data` | 30 min + 2 hrs LRU | 1,474 ms → ~50 ms warm on heaviest sessions | Low (LRU caps memory) | **Yes, V1 blocker** |
| 2 | **A**: FTS5 `snippet()` replaces Python scatter-gather | 1-2 days | 16 s cold → <200 ms; 750 ms warm → <200 ms | Low (linear-scan stays as fallback for `context_size="full"`) | **Yes, V1 blocker** |
| 3 | **B**: piggyback image-warm on FTS5 build | half day | 5 s startup delay → 0; eliminates duplicate I/O | Low (watcher + lazy + 600 s backstop unchanged) | **Yes, Phase-2 sprint** |
| 4 | **D**: `make bench` script | 1 day | n/a (tooling) | Low | **Yes, Phase-2 sprint** |
| 5 | **C3**: frontend bundle slim | varies | Negligible at V1 scale | Medium (UX regression risk on hljs slim) | **No, defer to V2** |

C2 (export) is bundled with C1; no separate workstream.

The ordering is by "user-visible payoff per hour of work." C1 is the highest priority because it's a tiny change that fixes the heaviest user-perceived latency (loading a long CC session). A is second because it unlocks the cold-search story that's a frequent user pain. B is operational cleanup that simplifies `main.py`. D is the meta-protection that ensures we don't regress.

---

## Risks the critic flagged across workstreams

Highlights from the adversarial pass that span multiple workstreams (individual risks called out in each section above):

- **Memory growth in FileCache without eviction (R8).** Fixed by C1's Option 2. Document the cache policy in CLAUDE.md.
- **XSS surface from inline `<mark>` (R1 mitigation).** Use structured fragments, not `dangerouslySetInnerHTML`.
- **Coupling image-warm to FTS5 (R5 mitigation).** Keep `warm_all_sessions` as a fallback when FTS5 is disabled.
- **GPT critic was unavailable for this round.** The user should re-read the "Risks" sub-sections with extra skepticism on shipping day, OR re-run the council against a future GPT/Claude/Anthropic alternative once API quota refills.

---

## Clarifying questions for the user

Three crisp questions where the user's preference matters more than the council's recommendation:

1. **Workstream A snippet rendering: server-side structured fragments vs. inline `<mark>` + DOMPurify?** The council recommends structured fragments (zero new XSS surface). Inline `<mark>` is slightly simpler on the server (no parse) and adds DOMPurify on the frontend (~5 KB gzip). Both work; the user picks the trade.

2. **Workstream C3: defer entirely, OR ship Option 3 (lazy-load react-markdown)?** Defer is the council recommendation. The user has expressed perf-focus, so if they DO want a bundle-shrink touch landed in this phase, Option 3 is the lowest-risk path. Single yes/no.

3. **Workstream D: should `make bench` be a HARD pre-PR-merge gate (CI enforced) or soft (PR template checklist)?** The council recommends soft for V1 because hard gating requires per-machine baseline storage which is a separate plan. User confirms.

---

## Out of scope for this phase

For the record so we don't lose the threads:

- **Index file shrink (861 MB → smaller).** Would require dropping the `body UNINDEXED` column and re-reading from JSONL on every snippet. That is exactly the opposite of Workstream A. Park for V3.
- **UUID → path index for `_find_conversation_data` (Option 3 in C1).** Defer until corpus crosses ~3k convs.
- **DYLD bootstrap in `claude-explorer serve` CLI.** Operational nit unrelated to perf; file as a separate task.
- **Vite v7 `manualChunks` configuration.** Tied to Workstream C3 deferral.
- **Remote-deployment perf characteristics.** Not a V1 concern.

