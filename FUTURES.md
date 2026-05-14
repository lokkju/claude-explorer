# Futures — post-V1 opportunities

Tracked-but-deferred work. Each entry should be tractable enough to
spin out into its own plan when picked up. Group by area.

---

## Search

The V1 search shipping in
`PLANS/2026.05.10-search-fts5.md` lays a SQLite FTS5 foundation. The
following build naturally on top of it — pick when there's user
demand or quiet engineering capacity.

### S1. Vector / semantic search

Embed every message with a small local model (e.g.
`all-MiniLM-L6-v2`, 384-dim, ~80 MB) and store vectors in
`sqlite-vss` or `chromadb` alongside the FTS5 index. Query path
becomes "find conversations about X concept", which the lexical
index can't do (e.g., "tax planning" matches conversations that
say "1099", "Roth conversion", "AMT" etc.).

**Why interesting:** users searching their own history often
forget exact terminology. Semantic match catches what lexical
misses.

**Why deferred:** different UX (relevance != exact-string match;
ranking explanation harder); model-download bloats install (~80 MB
+ tokenizer); embedding-at-write adds 50–200 ms per message; only
worthwhile if S1 use cases are common.

**Sketch:** add `embeddings` table keyed by `message_uuid`;
populate in the same lifecycle hook as FTS5 indexing; new
`/api/search/semantic` endpoint that does cosine-similarity top-K
then joins to the FTS5 metadata.

### S2. Faceted search UI

Counts of search hits broken down by source / project / model /
date-bucket / sender. UI: thin facet rail beside the result list;
clicking a facet narrows the result set.

**Why interesting:** a search for "deploy" across thousands of
sessions is much more useful when you can see "237 in
`/work/api`, 12 in `/personal/blog`" and click to drill in.

**Why deferred:** the FTS5 index already supports facet queries
in one extra GROUP BY — backend work is small. The UX work
(designing the facet rail, narrow-viewport behavior, keyboard
navigation) is bigger and benefits from real V1 user feedback
about what facets matter.

**Sketch:** new `/api/search/facets?q=...` endpoint returning
`{by_source: {CLAUDE_AI: 12, CLAUDE_CODE: 237}, by_project:
{...}}`; React component renders as a left-rail (or top-row on
narrow); clicking writes the URL filter.

### S3. Search-as-you-type partial-result streaming

SSE-stream the first batch of ranked results within ~10 ms instead
of blocking on the full top-200 query. Subsequent batches arrive
as the BM25 sort completes.

**Why interesting:** even at 5–50 ms (the FTS5 latency),
sub-perception speed FEELS faster when results paint
progressively. Anchors users to the top-of-list quickly.

**Why deferred:** premature for the V1 latency profile; the FTS5
top-200 query usually finishes in <50 ms on the existing corpus,
and SSE adds frontend complexity (streaming ResultList component,
abort handling on next-keystroke, handling of result-set churn
mid-stream). Pick up if user data shows SOME queries are slow
(e.g., very large corpora or expensive ranking experiments).

**Sketch:** new `/api/search/stream` SSE endpoint; reuse the
existing `data:`-frame SSE pattern from `fetch.py:_send_event`;
frontend `useSearchStream` hook replaces TanStack `useQuery` for
search; handles abort on query change.

---

## Conventions for adding to this file

When a deferred idea matures into something we'd actually build:

1. Move it from FUTURES.md into a dated plan in `PLANS/`.
2. Leave a one-line stub in FUTURES.md pointing to the plan
   (so the historical "we considered this" trail isn't lost).
3. When the plan ships, delete the stub.

Don't grow this file unboundedly. If something has been here
> 6 months without movement, either pick it up or admit it's
not happening and delete it.
