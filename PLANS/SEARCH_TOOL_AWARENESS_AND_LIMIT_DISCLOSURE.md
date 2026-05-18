# Plan: tool-aware search projection + search-result limit disclosure

**Status:** planned, ready to implement.
**Owner:** llm-council-coding (TDD; iterate until green; use Gemini 3 Pro + GPT-5.2-pro for council reasoning).
**Related:** `PLANS/PERFORMANCE_PHASE_2.md` Workstream A (the FTS5
`snippet()` fast path that introduced the two issues this plan
addresses), `backend/search.py:_search_via_index_fast`,
`backend/search_index.py:query_with_snippets`,
`backend/models.py:SearchResult` / `MessageSnippet`.

## Context

Phase 2 Workstream A swapped the Python scatter-gather snippet
build for an in-SQL FTS5 `snippet()` fast path. Massive perf win
(cold search 20.8 s → 780 ms; warm 1.4 s → 750 ms), but it shipped
two known residuals the user has now decided to address:

1. **`include_tool_calls=False` divergence.** The FTS5 `body`
   column stores the full message projection (text + tool_use +
   tool_result + thinking). When the UI's **Tools** toggle is
   OFF, search results can highlight a token whose only
   occurrence is inside a hidden tool block. The user clicks
   through expecting to see the match, the bubble that contains
   it is hidden by the Tools toggle, no highlight appears in the
   pane. Documented at `backend/search.py:632-642` as an accepted
   residual; the user has decided it's NOT accepted and wants
   parity with the linear-scan path's behavior.

2. **Silent LIMIT 1000 truncation.** The FTS5 fast path caps
   results at 1000 messages (BM25-ordered) to keep `snippet()`
   cost bounded. Today there's no signal in the response that
   truncation happened — a query that hits 12,000 messages
   returns the top 1000 with no indication. Users assume they
   see everything.

The user also wants the MCP path to allow higher (but still
bounded) result sets so programmatic / LLM consumers can reason
about broader queries.

## Goals

- **Exact parity with the linear-scan path** on `include_tool_calls=False`:
  hits inside tool_use / tool_result / thinking blocks are
  excluded BEFORE bm25 ranking, never returned. No mid-result
  drops, no post-filter false positives on mixed messages.
- **Total-match disclosure on every response.** Every
  `/api/search` and MCP search response includes
  `total_messages_matched` + `returned_messages` so the UI (and
  the LLM consuming MCP) can detect truncation without asking.
- **Different LIMIT for HTTP vs MCP:** HTTP 1000 (current), MCP
  5000.
- **Zero added query latency** for the `include_tool_calls=True`
  default case. The fast path stays fast.
- **TDD throughout.** Failing tests first; iterate until green.

## Non-goals

- Changing the linear-scan fallback path or its semantics.
- Touching `SearchResult.matching_messages` shape (we keep
  `MessageSnippet`s including the Phase-2 `fragments`).
- Bundling external client backwards-compatibility shims —
  frontend + MCP are in-tree, both update in this PR.

## Design

### A. Two-column FTS5 schema for tool-aware projection

Bump `SCHEMA_VERSION` in `backend/search_index.py` (current value
6 → 7). The schema-version bump auto-triggers a full rebuild on
next process start via the existing column-drift detector.

Add a second body column to the `messages` virtual table:

```sql
CREATE VIRTUAL TABLE messages USING fts5(
    conv_uuid UNINDEXED,
    message_uuid UNINDEXED,
    sender UNINDEXED,
    created_at UNINDEXED,
    source UNINDEXED,
    project_path UNINDEXED,
    organization_id UNINDEXED,
    conv_created_at UNINDEXED,
    conv_updated_at UNINDEXED,
    title,
    body,           -- full projection: text + tool_use + tool_result + thinking
    body_text,      -- text-only projection: tool_use/tool_result/thinking stripped
    tokenize = "porter unicode61 remove_diacritics 1"
);
```

`_EXPECTED_MESSAGES_COLS` (the drift-detector frozenset) gains
`"body_text"`.

**Projection logic for `body_text`:** reuse the existing
linear-scan path's text-only projector. The function lives near
`backend/search.py:_extract_searchable_text` (or wherever the
`include_tool_calls=False` projection is computed today —
investigate; reuse, don't duplicate). Wire it into
`backend/search_index.py:upsert_conversation` so each upsert
populates both columns from the same source message.

**Query-time column selection.** FTS5 supports column-scoped
matches via `{column}: query` syntax. The fast path becomes:

```python
# query_with_snippets, query parameter:
include_tool_calls: bool = True

# In SQL builder:
column_qualifier = "{body}" if include_tool_calls else "{body_text}"
match_expr = f"{column_qualifier} : ({translate_query(user_query)})"

# snippet() call uses the matching column's index:
body_col_idx = (
    self._SNIPPET_BODY_COL_IDX if include_tool_calls
    else self._SNIPPET_BODY_TEXT_COL_IDX
)
body_snippet_expr = f"snippet(messages, {body_col_idx}, ?, ?, ?, ?)"
```

`_search_via_index_fast` plumbs `include_tool_calls` down to
`query_with_snippets`. The `title_match_snippets` path is
unchanged — title isn't affected by the Tools toggle.

**Index-size cost:** the user's current index is 861 MB at 13k
messages. Text-only projection is most of the body (tool args /
results are the minority for typical CC sessions). Estimated
new index size ~1.1 GB (a ~30% increase). One-time disk cost,
zero query-time cost.

**Schema-bump UX:** the existing lifespan code in
`backend/main.py` already handles the rebuild as a non-blocking
background task. The summary cache eager-fill (Phase 1.2)
remains the sidebar's fast path during the rebuild. Linear scan
covers search until the new index is ready. The user sees
unchanged behavior except a longer "search index build
complete" delay one time.

### B. Wrapped response envelope with truncation disclosure

Today `/api/search` returns `list[SearchResult]` directly. Wrap
in a new model:

```python
class SearchResponse(BaseModel):
    """Wrapped /api/search response with total-match disclosure.

    `total_messages_matched` is the exact COUNT(*) from the FTS5
    MATCH (cheap — single µs per row, no snippet overhead).
    `returned_messages` is the actual number of MessageSnippet
    rows in `results` (capped at the route-level LIMIT).
    `truncated` is derived as `returned_messages < total_messages_matched`.

    `results` keeps the existing list[SearchResult] shape verbatim
    so the per-conv rollup, the snippet fragments, and the title
    pseudo-snippets all remain wire-compatible.
    """

    results: list[SearchResult]
    total_messages_matched: int
    returned_messages: int
    truncated: bool  # convenience, derived from above
```

Reasoning for message-level not conversation-level counts:
- FTS5's COUNT is at the row (message) level — that's the cheap query.
- "Showing 1,000 of 12,400 matches" is more honest than "Showing 47 of 200 conversations" when the difference is what got truncated.
- UI can still show "47 conversations matching" derived from `len(results)` for sidebar header rollup.

**Total-count query:** add a method to `SearchIndex`:

```python
def count_matches(
    self,
    user_query: str,
    *,
    source, conversation_uuid, project_path, bookmarks,
    organization_id, conversation_uuids,
    include_tool_calls: bool = True,
) -> int:
    """COUNT(*) of FTS5 MATCH rows under the same WHERE clauses
    as `query_with_snippets`. ~5-10 ms on the user's corpus.
    Single µs per row; no snippet overhead.
    """
    # Same WHERE-clause builder as query_with_snippets,
    # but SELECT COUNT(*) FROM messages WHERE messages MATCH ?
    # AND <filters>. No ORDER BY, no LIMIT, no snippet.
```

`_search_via_index_fast` runs the snippet query AND the count
query (in that order — the count is faster, but parallelizing
adds complexity for a few ms win). Both numbers populate the
envelope.

### C. Per-route LIMIT configuration

`backend/routers/search.py` GET + POST routes pass `limit=1000`
to `_search_via_index_fast` → `query_with_snippets`.

`mcp_server/server.py` — investigate which tool uses search. If
there's an MCP search tool (or one that internally queries
search), pass `limit=5000`. If no MCP search path exists yet,
this requirement applies only to the HTTP route and we document
that in the plan-completion report.

Make `limit` a parameter on the existing dispatcher chain so
the routes pick their own value. Default in the underlying
function stays at 1000 (the safe value for HTTP).

### D. Frontend wiring

`frontend/src/lib/api.ts` — `search()` response type changes from
`SearchResult[]` to `SearchResponse`.

`frontend/src/hooks/useConversations.ts` (or whichever hook
calls `api.search`) — adapt to the new shape; `data.results`
replaces the bare array.

`frontend/src/components/search/SearchPanel.tsx` — render a
truncation footer when `data.truncated`:

> Showing first {returned_messages} of {total_messages_matched}
> message matches. Refine your query to see the rest.

Style: small, muted, beneath the results list. Active voice. No
em-dash. No prescriptive "click here" / "do X." Match the
existing perf-stat footer voice in the sidebar.

`frontend/src/lib/types.ts` — add `SearchResponse` TypeScript
type mirroring the Pydantic model.

## TDD test plan

Write these tests FIRST (in two new test files), watch them
fail, then implement. Confirm RED commit with `pytest -v`
output in commit message.

### `backend/tests/test_search_tool_awareness.py` (new, ~7 tests)

1. **Schema has `body_text` column.** Open a fresh `SearchIndex`,
   query `PRAGMA table_info(messages)`, assert `body_text` is
   present.

2. **Schema version bumped + auto-rebuild fires.** Open an index
   with the OLD schema (manually create a `messages` table without
   `body_text`), construct a `SearchIndex`, verify the rebuild
   fires (table dropped + recreated, `indexed_files` empty).

3. **Upsert populates both columns.** Build a one-message
   conversation with both text and tool content. Upsert into the
   index. Query both columns directly: `body` contains the full
   projection; `body_text` excludes the tool content.

4. **Body match with `include_tool_calls=True` finds tool-only
   content.** Fixture: a message whose only token of "ripgrep"
   appears inside a tool_use block. Query `query_with_snippets`
   with `include_tool_calls=True`. Assert the message appears.

5. **Body match with `include_tool_calls=False` does NOT find
   tool-only content.** Same fixture. Query with
   `include_tool_calls=False`. Assert the message does NOT appear.

6. **Mixed-content message: query matches text part with Tools OFF
   is still found.** Fixture: message with text "Let me check this"
   and tool_use{args: "ripgrep foo"}. Query "check" with
   `include_tool_calls=False`. Assert message appears with the
   highlight on "check".

7. **Mixed-content message: query matches tool part with Tools OFF
   is correctly dropped.** Same fixture. Query "ripgrep" with
   `include_tool_calls=False`. Assert message does NOT appear.

8. **Equivalence with linear-scan path.** Parameterized over a
   handful of fixtures and queries: assert the
   `(conv_uuid, message_uuid)` set from the FTS5 fast path
   matches the linear-scan path for both
   `include_tool_calls=True` and `=False`.

### `backend/tests/test_search_response_envelope.py` (new, ~5 tests)

9. **`/api/search` returns wrapped envelope.** GET
   `/api/search?q=python`. Response JSON has keys
   `{results, total_messages_matched, returned_messages, truncated}`.

10. **`truncated=False` when matches ≤ limit.** Fixture with <100
    matching messages. Query. Assert
    `returned == total == len(results' flattened messages)` and
    `truncated is False`.

11. **`truncated=True` when matches > limit.** Fixture with 1500
    matching messages (or lower the test-fixture limit to make this
    cheap). Query. Assert `returned == limit`,
    `total > limit`, `truncated is True`.

12. **HTTP route uses `limit=1000`.** Patch the underlying
    `query_with_snippets` to record its `limit` kwarg. Hit
    `/api/search`. Assert `1000`.

13. **MCP search path uses `limit=5000`.** (Conditional on an
    MCP search path existing — see Workstream C above. If none
    exists, this test asserts the absence and the plan-completion
    report documents this.)

### `backend/tests/test_search_count_matches.py` (new, ~3 tests)

14. **`count_matches` returns the exact COUNT(*) without snippet
    overhead.** Fixture with N known matches. Call
    `count_matches`. Assert `== N`.

15. **`count_matches` honors filters identically to
    `query_with_snippets`.** Build a multi-conv fixture, filter
    by `source=CLAUDE_CODE`, assert both calls agree on the
    matching message set's size.

16. **`count_matches` cost.** Time the call on the user's
    corpus (or a synthetic 13k-row index). Assert <50 ms warm.
    Soft assertion; print actual ms for later tuning.

### Frontend e2e (Playwright, new spec or extend existing)

17. **Truncation footer appears when total > returned.** Fixture
    backend response: `{results: […], total_messages_matched: 5000,
    returned_messages: 1000, truncated: true}`. Search palette
    renders. Assert the footer text matches the spec ("Showing
    first 1,000 of 5,000…"). Active-voice assertion: text contains
    "Refine your query to see the rest."

18. **Truncation footer absent when total == returned.** Same
    component, response with `truncated: false`. Assert no footer.

## Verification

After all unit + e2e tests pass:

```bash
# Restart server so the schema rebuild fires under realistic
# corpus size.
make bench

# Spot check: search a tool-block-only term with Tools off vs on.
# Today (broken): with Tools off, hit appears in sidebar but
# bubble is hidden in pane.
# After: with Tools off, hit does NOT appear in sidebar.
curl -s "http://localhost:8765/api/search?q=tool_only_term&include_tool_calls=false" | jq '.results | length'

# Cold-restart latency target: warm search stays under 1 s on
# user's corpus (allow ~50 ms for COUNT(*) overhead).
hyperfine --warmup 1 --runs 10 \
  'curl -s "http://localhost:8765/api/search?q=python" > /dev/null'
```

**Targets:**
- Warm `q=python`: <850 ms (currently 750 ms; +5-10 ms COUNT + +negligible column-MATCH overhead).
- Cold `q=python`: <1 s (currently 780 ms; same).
- `q=foobar` (narrow): <350 ms (currently 317 ms).
- Index size: <1.2 GB (currently 861 MB; +~30% expected).
- Schema rebuild time on user's corpus: <30 s (one-time, non-blocking).

**Regression guards:**
- pytest: parameterized equivalence test (test 8 above) covering
  ~5 queries × 2 toggle states = 10 assertions that fast path
  matches linear-scan path for `(conv_uuid, message_uuid)` sets.
- pytest: every existing `backend/tests/test_search*.py` test
  passes unchanged. The wire shape change to `SearchResponse`
  affects tests that JSON-decode the search endpoint; those need
  updates BUT shouldn't drift in behavior.
- Playwright: existing search-related specs all pass.

## Risks

1. **Index-size growth.** ~30% bigger index on disk. Acceptable
   for a local tool. Document in plan completion.

2. **Schema-rebuild perceived as "broken" by users on upgrade.**
   The lifespan rebuild is background + non-blocking; linear scan
   covers during the gap. But the user sees "search index build
   complete" much later than usual. Mitigation: log a clear
   "rebuilding for schema v7" message at lifespan start so the
   user knows what's happening.

3. **Mixed-message edge cases beyond text/tool split.** Image
   content (`type:image`) — does it belong in body_text or
   body_only? Today it's projected as `[Image: ...]` markers via
   the existing extractor. Specify: image markers go in BOTH
   columns (they're visible in the pane regardless of Tools
   toggle).

4. **`{body_text} : query` FTS5 syntax interaction with phrase
   queries.** The user's queries go through `translate_query`
   which already handles quotation, AND, etc. Verify the
   column-qualifier prefix composes cleanly with the existing
   translated expression. Test fixtures should include a phrase
   query (`"foo bar"`) and a multi-word AND query (`foo bar`).

5. **`count_matches` divergence from `query_with_snippets`.**
   If the two SQL statements have any WHERE-clause skew, the
   total count would be wrong. Mitigation: extract a shared
   `_build_match_where_clause(filters) -> (sql, params)` helper
   that both queries call. Pin with test 15.

6. **MCP path may not have search.** If no MCP search exists yet,
   the MCP LIMIT 5000 is a no-op for V1 ship. Plan-completion
   report must clearly state this so we don't ship a stale claim.

7. **`SearchResponse` envelope is a breaking change** for any
   external consumer of `/api/search`. The frontend is in-tree
   and updates in the same PR. CLAUDE.md / external doc claims:
   none today that reference the bare-list shape.

## Critical files

**New:**
- `backend/tests/test_search_tool_awareness.py` — 8 tests.
- `backend/tests/test_search_response_envelope.py` — 5 tests.
- `backend/tests/test_search_count_matches.py` — 3 tests.

**Modified:**
- `backend/search_index.py` — SCHEMA_VERSION bump 6→7; add
  `body_text` column to `SCHEMA_SQL`; add to
  `_EXPECTED_MESSAGES_COLS`; add `_SNIPPET_BODY_TEXT_COL_IDX`;
  modify `upsert_conversation` to populate both columns; add
  `include_tool_calls` parameter to `query_with_snippets`; add
  new `count_matches` method.
- `backend/search.py` — `_search_via_index_fast` plumbs
  `include_tool_calls` to `query_with_snippets`; calls
  `count_matches`; builds `SearchResponse`; adjusts dispatch in
  `search_conversations` to return the envelope.
- `backend/models.py` — add `SearchResponse` model.
- `backend/routers/search.py` — GET + POST routes return
  `SearchResponse`; pass `limit=1000` explicitly.
- `mcp_server/server.py` — if a search path exists, pass
  `limit=5000`. Surface in plan-completion if no search path.
- `frontend/src/lib/types.ts` — add `SearchResponse` TS type.
- `frontend/src/lib/api.ts` — `search()` return type update +
  unwrap `.results` for backward-compat callers OR plumb the
  envelope through.
- `frontend/src/contexts/SearchPanelContext.tsx` — carry
  `total_messages_matched` / `truncated` through context.
- `frontend/src/components/search/SearchPanel.tsx` — render
  truncation footer.
- `articles/part_2_web_app.md` — Performance section: update the
  `include_tool_calls=False divergence` note (now resolved) +
  add a paragraph on the truncation disclosure.
- `README.md` — Performance section bullet list: update the
  FTS5 `snippet()` bullet to mention the two-column projection
  + the truncation disclosure.

**Reused (do not rewrite):**
- The existing linear-scan path's text-only projector — find it
  in `backend/search.py` and import / reuse.
- The existing `translate_query` for FTS5 expression building.
- The existing `_build_match_where_clause` pattern (extract a
  shared helper if not already extracted).
- The `LOGIC_VERSION` / `SCHEMA_VERSION` auto-rebuild machinery
  from Phase 1 — already handles the rebuild trigger.

## Implementation order (TDD)

1. Branch from main: `perf/search-tool-aware-and-limit-disclosure`.
2. Write all 16+2 tests (RED commit). Verify expected failures.
3. Bump `SCHEMA_VERSION` + add `body_text` column +
   `_EXPECTED_MESSAGES_COLS` update + index rebuild verified
   via tests 1, 2.
4. Modify `upsert_conversation` to populate both columns.
   Tests 3 passes.
5. Add `include_tool_calls` param to `query_with_snippets` and
   wire column-scoped MATCH. Tests 4, 5, 6, 7, 8 pass.
6. Add `count_matches` method. Tests 14, 15, 16 pass.
7. Define `SearchResponse`. Wire `_search_via_index_fast` to
   return the envelope. Tests 9, 10, 11, 12 pass.
8. Wire MCP if applicable. Test 13 conditional.
9. Update frontend types + components. Vitest + Playwright
   green.
10. Run the full backend + MCP + frontend test suites. Green.
11. Run `make bench`. Confirm latency targets met.
12. Article + README docs commit.
13. Fast-forward merge to main.

## Article update (mandatory)

`articles/part_2_web_app.md` "Performance (FTS5 index)" section:

- **Remove** the existing note (added by Phase 2 Workstream A) that
  cited `include_tool_calls=False` as an accepted residual.
- **Add** a paragraph describing the two-column index design and
  what it costs (index size, schema rebuild) vs. what it buys
  (parity with linear scan, zero query overhead).
- **Add** a paragraph on the truncation disclosure (1000 HTTP /
  5000 MCP / total in envelope / UI footer).

`README.md` Performance section bullet list:

- Update the FTS5 `snippet()` bullet to: "...with a two-column
  projection (full body + text-only body) so the Tools toggle
  behaves the same on the fast path as on the linear-scan path."

Active voice. No em-dashes. Match existing perf-section style.

## Estimated effort

~5–7 hours including tests + benchmarks + article. The
mechanical work is small; the trickier parts are the FTS5
column-qualifier syntax verification (do it via a small
exploratory test against `:memory:` before commit), the
schema-rebuild trigger verification, and the
extract-shared-WHERE-builder refactor in `search_index.py`.
