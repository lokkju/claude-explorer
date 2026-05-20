# Plan: split `ConversationSummary` → `ConversationListItem` + `ConversationSummary`

**Status:** planned, ready to implement.
**Owner:** llm-council-coding (TDD; iterate until green).
**Related:** `PLANS/OPTIMIZE_FIRST_PAINT.md` Phase 2.1 (audit results),
`backend/models.py:78-117` (current model + inline why-this-field-stays
notes), `mcp_server/SPEC.md` (public MCP contract — fields here are
schema-stable, do not break them).

## Context

Phase 2.1 audited four fields on `ConversationSummary` thought to be
sidebar-unused and removed only `is_temporary` after the audit
confirmed three of them have non-sidebar consumers:

| Field | Consumer | Where |
|---|---|---|
| `summary` | MCP `get_session`, backend server-side search filter | `mcp_server/server.py:633`, `backend/store.py:_apply_search_filter` |
| `human_message_count` | MCP `list_sessions` | `mcp_server/server.py:429,449`, `mcp_server/SPEC.md:127` |
| `git_branch` | Conversation detail page disclosure | `frontend/src/routes/ConversationPage.tsx:424` |

The full payload-size win was therefore deferred. This plan revives
it by splitting `ConversationSummary` into:

- **`ConversationListItem`** — skinny, returned by `/api/conversations`.
  Carries only the fields the sidebar actually renders or needs for
  client-side filter / sort.
- **`ConversationSummary`** — kept as the superset. Continues to back
  `ConversationDetail` (inheritance unchanged) and the MCP
  `list_sessions` / `get_session` tool outputs.

Server-side `?search=` matching on `summary` still works because the
filter operates on the cached dict (full shape) BEFORE the
list-item subset gets serialized — the field stays in memory and in
the SQLite summary cache, it just doesn't ride the wire to the
sidebar.

## Goals

- Shrink `/api/conversations` payload by dropping `summary`,
  `human_message_count`, `git_branch`.
- Zero behavior change for the three non-sidebar consumers above.
- No cache rebuild required (summary cache continues to store the
  full `ConversationSummary` shape; only the wire-serialization
  changes).
- TDD: failing tests first, then implementation. The full suite
  (`backend/tests`, `mcp_server/tests`, `frontend/src/test`,
  `frontend/e2e`) must stay green at each step.

## Non-goals

- Versioning the API (`/api/v2/conversations`). Single-user local
  app; frontend ships with the backend; no external consumers to
  protect.
- Restructuring the cache shape.
- Touching `ConversationDetail` (the detail-page endpoint keeps its
  full payload — that's where `git_branch` is rendered).

## New model

`backend/models.py`, added between `SubagentSummary` and
`ConversationSummary`:

```python
class ConversationListItem(BaseModel):
    """Slim per-row payload for the sidebar list.

    Returned by `/api/conversations`. Strips `summary`,
    `human_message_count`, and `git_branch` from the full
    `ConversationSummary` shape — those three fields stay on
    `ConversationSummary` for MCP `list_sessions` / `get_session`
    output and the conversation-detail page disclosure.
    """

    uuid: str
    name: str
    model: str = ""
    created_at: datetime
    updated_at: datetime
    is_starred: bool = False
    message_count: int = 0
    has_branches: bool = False
    source: Literal["CLAUDE_AI", "CLAUDE_CODE"] = "CLAUDE_AI"
    project_path: str | None = None
    project_name: str | None = None
    organization_id: str | None = None
    organization_name: str | None = None
    subagents: list[SubagentSummary] = Field(default_factory=list)

    def model_post_init(self, __context: Any) -> None:
        if self.project_path and not self.project_name:
            path = self.project_path.rstrip("/")
            self.project_name = path.split("/")[-1] if "/" in path else path
```

`ConversationSummary` keeps its current shape verbatim — the
inline comments documenting MCP / detail-page consumers stay.

## Hot-path change

`backend/routers/conversations.py`:

```python
# Before:
@router.get("", response_model=list[ConversationSummary], response_class=ORJSONResponse)
async def list_conversations(...) -> list[ConversationSummary]:
    store = get_store()
    return store.list_conversations(...)

# After:
@router.get("", response_model=list[ConversationListItem], response_class=ORJSONResponse)
async def list_conversations(...) -> list[ConversationListItem]:
    store = get_store()
    full = store.list_conversations(...)  # still returns ConversationSummary[]
    return [
        ConversationListItem.model_validate(s, from_attributes=True)
        for s in full
    ]
```

Pydantic v2's `model_validate(..., from_attributes=True)` projects
fields from a richer source model into the skinny model without
copying the dropped fields. This keeps `store.list_conversations`
unchanged — it still owns the full-shape construction, server-side
filtering (which needs `summary`), and sorting.

Trade-off: per-request cost of constructing N `ConversationListItem`
instances from N `ConversationSummary` instances. For ~1,000 rows,
the projection is microseconds per row — well inside the
post-Phase-1 ~80 ms warm budget. Benchmark in verification.

## Frontend changes

`frontend/src/lib/types.ts`:

- Add new `ConversationListItem` TypeScript type matching the
  Pydantic shape.
- Change the return type of the `/api/conversations` API helper
  (`getConversations`) to `Promise<ConversationListItem[]>`.
- Keep the existing `ConversationSummary` TypeScript type — it's
  still used by the per-conversation endpoint chain
  (`ConversationDetail extends ConversationSummary` round-trips
  through `getConversation`).
- Update inline consumer comments on the kept fields
  (`summary`, `human_message_count`, `git_branch`) to clarify "stays
  on `ConversationSummary`, dropped from `ConversationListItem`".

Components that consume the list:

- `frontend/src/hooks/useConversations.ts` — type signature update.
- `frontend/src/components/conversation/ConversationList.tsx` — already
  doesn't read the three dropped fields (Phase 2 confirmed). Type
  swap only.
- `frontend/src/lib/mockData.ts` + `frontend/src/test/mocks/data.ts` —
  update list fixtures to the new shape.

## TDD test plan

Write these tests FIRST, watch them fail, then implement. They live
in two files:

### `backend/tests/test_conversation_list_item_split.py` (new)

1. **List response excludes the three dropped fields.** Fetch
   `/api/conversations`, assert each row's JSON has keys
   `{uuid, name, model, created_at, ...}` and does NOT have
   `summary`, `human_message_count`, `git_branch`.

2. **List response keeps every sidebar-required field.** Same fetch,
   assert presence of `uuid`, `name`, `is_starred`, `has_branches`,
   `source`, `model`, `updated_at`, `message_count`, `project_path`,
   `project_name`, `organization_id`, `organization_name`,
   `subagents`. (Mirrors the Phase 1 frontend audit findings.)

3. **Per-conversation response (`GET /api/conversations/{uuid}`)
   still includes `git_branch`.** Assert the field present on a CC
   conversation that has one.

4. **Server-side search filter (`?search=foo`) still matches against
   `summary`.** Fixture: a Desktop conversation with
   `summary="contains foo here"`, `name="unrelated"`. Hit
   `/api/conversations?search=foo`; assert the conversation IS in
   the response (proves filter operates on full shape before
   projection).

5. **Pydantic projection is loss-tolerant.** Construct a
   `ConversationSummary` with all fields set, project to
   `ConversationListItem`, assert no error and the right field
   subset.

6. **Payload-size regression guard.** Fetch
   `/api/conversations`, parse JSON, sum `len(json.dumps(row))` —
   assert delta vs the same fetch under a feature flag that returns
   the full shape (or hardcode a "before" byte count and assert
   "after" is at least N bytes smaller). Light-touch — primary win
   is correctness, not size.

### `mcp_server/tests/test_split_regression.py` (new)

7. **MCP `list_sessions` output includes `human_message_count`.**
   Invoke the tool, assert the field present and equals the value
   from the underlying store.

8. **MCP `get_session` output includes `summary`.** Same shape;
   different tool.

Each test is independent and uses the existing fixtures
(`conftest.py` for backend tests already isolates the search-index +
summary-cache singletons per test).

## Implementation order (TDD)

1. Branch from main: `perf/split-conversation-list-item`.
2. Add the eight tests above. Run; all fail.
3. Add `ConversationListItem` model. Run; tests 5 passes,
   1+2+6 still fail (router unchanged).
4. Update the router to project. Run; tests 1+2+3+4+5+6 pass.
   Re-run MCP suite; 7+8 must still pass (they're already
   exercising current behavior — should not regress).
5. Update frontend TypeScript types + fixtures. Run
   `npm run build` (catches type errors) + `npm run test`
   (vitest). Both green.
6. Run the full backend + MCP + frontend e2e suites. Any
   unrelated breakage: surface, don't silently fix.
7. Commit per logical step (model + router + tests as one perf
   commit; frontend types as one perf commit; article update as
   one docs commit).
8. Article update: edit `articles/part_2_web_app.md` (the
   "Trimming the payload" paragraph that currently says the
   schema split is "a deliberate not-now"). Replace with the
   actual measured payload-size delta and a brief description
   of the split.
9. Fast-forward merge to main.

## Critical files

**New:**
- `backend/tests/test_conversation_list_item_split.py` — six
  backend tests above.
- `mcp_server/tests/test_split_regression.py` — two MCP tests.

**Modified:**
- `backend/models.py` — add `ConversationListItem` between
  `SubagentSummary` and `ConversationSummary`. Don't touch
  `ConversationSummary` or `ConversationDetail`.
- `backend/routers/conversations.py` — change `response_model`
  + return-value projection.
- `frontend/src/lib/types.ts` — add TS `ConversationListItem`
  type; update `getConversations` return type.
- `frontend/src/hooks/useConversations.ts` — type update only.
- `frontend/src/lib/mockData.ts`, `frontend/src/test/mocks/data.ts` —
  list-fixture shape update.
- `articles/part_2_web_app.md` — "Trimming the payload" paragraph
  rewrite (final step).

**Reused (do not rewrite):**
- `backend/store.py:list_conversations` — keeps returning
  `list[ConversationSummary]`. Router does the projection.
- `backend/summary_cache.py` — cache stays
  `ConversationSummary`-shaped. No `LOGIC_VERSION` bump needed
  (the producer function `read_conversation_summary_fast` is
  unchanged).
- `mcp_server/server.py` — unchanged; relies on
  `ConversationSummary` shape which is preserved.

## Verification

1. **Targeted regression suite** (in order):
   - `uv run pytest backend/tests/test_conversation_list_item_split.py` — 6 green.
   - `uv run pytest mcp_server/tests/test_split_regression.py` — 2 green.
   - `uv run pytest backend/tests mcp_server/tests` — full suites green.
   - `cd frontend && npm run build` — TypeScript compiles.
   - `cd frontend && npm run test` — vitest green.
   - `cd frontend && npx playwright test --grep '@critical'` (or
     the conversation-list / sidebar / keyboard-nav specs) — green.

2. **Payload delta benchmark:**
   ```bash
   # Before merge:
   curl -s http://localhost:8765/api/conversations | wc -c

   # After merge (note: requires server restart to pick up
   # backend changes):
   curl -s http://localhost:8765/api/conversations | wc -c
   ```
   Expected: 629,829 → ~480,000 bytes (~25% reduction). Three
   fields removed; each is per-row, non-trivial sizes for the
   `summary` field on Desktop conversations.

3. **Warm-latency regression check:**
   ```bash
   hyperfine --warmup 1 --runs 10 \
     'curl -s http://localhost:8765/api/conversations > /dev/null'
   ```
   Must remain <100 ms (currently ~80 ms). The per-row projection
   cost is microseconds.

4. **Manual smoke test:**
   - Open the app at http://localhost:8765, confirm sidebar
     renders correctly (no missing names, models, dates,
     star/branch icons, subagent counts).
   - Click into a conversation, confirm the detail page
     "Details" disclosure still shows `git_branch`.
   - Server-side search: type a query whose match is in
     `summary` content only (Desktop convo); confirm hit shows
     in sidebar.
   - MCP tool exercises (if reachable in dev): `list_sessions`
     should still return `human_message_count`; `get_session`
     should still return `summary`.

## Risks

1. **Frontend e2e fixtures may carry the dropped fields and
   shadow real bugs.** Mitigation: update both
   `frontend/src/lib/mockData.ts` and `frontend/src/test/mocks/data.ts`
   to the skinny shape in the same commit as the type change, so
   TypeScript catches drift at build time.

2. **Pydantic `model_validate(..., from_attributes=True)` requires
   the source object to expose the target fields as attributes.**
   `ConversationSummary` does (it's a Pydantic model with the
   superset). Validate this assumption in the test step before
   adding the router projection.

3. **A future field added to `ConversationListItem` that's NOT on
   `ConversationSummary` will silently default to its declared
   default value.** Mitigation: keep `ConversationListItem` as a
   strict subset of `ConversationSummary` (enforce in a property
   test: `set(ConversationListItem.model_fields) <= set(ConversationSummary.model_fields)`).

4. **Subagent rows in nested `subagents[]`.** `SubagentSummary` is
   shared and unchanged — no projection needed at the nested
   level.

## Article update

After the merge and a measured `curl | wc -c` byte delta, replace
the **"Trimming the payload"** paragraph at
`articles/part_2_web_app.md` (starts around line 326 post-Phase-2)
with a 2-sentence "and then we did the split" follow-on that
records the actual payload-size delta and points at
`ConversationListItem` vs `ConversationSummary`. Active voice; no
em-dashes; match the existing perf-section voice.

## Estimated effort

~3–4 hours including tests + benchmarks + article update. The TDD
flow plus the small scope make this lower-risk than Phase 2.2.
