"""Search router.

Two transports supported (2026-05-14, sidebar-scope propagation):

  * **GET /api/search?...** — existing query-string contract. All scope
    knobs accepted as query params. CSV (``conversation_uuids=a,b,c``)
    is supported but kept for small scopes; large active-filter sets
    blow past h11 / proxy URL-length limits.

  * **POST /api/search** — new variant. Same scope knobs in a JSON body.
    The frontend defaults to POST when it has a ``conversation_uuids``
    list to send; this avoids 414/431 at proxies and dodges SQLite's
    ``SQLITE_MAX_VARIABLE_NUMBER`` (often 999) on the underlying
    ``IN (...)`` clauses.

Both methods delegate to :func:`backend.search.search_conversations` with
identical kwargs — only the transport differs.
"""

from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from ..deps import get_store
from ..models import SearchResponse
from ..store import ConversationStore
from ..search import search_conversations


# HTTP route LIMIT. Keeps the FTS5 fast path bounded so the snippet()
# pass stays in the ~140 ms ballpark on the user's corpus. The MCP
# server uses a higher LIMIT (5000) for programmatic / LLM consumers
# that can usefully reason about broader result sets; the difference is
# wired in via the per-route ``limit=`` kwarg on
# ``search_conversations`` (plan §C).
HTTP_SEARCH_LIMIT = 1000

router = APIRouter(tags=["search"])


def _parse_csv_uuid_set(raw: str | None) -> set[str] | None:
    """Parse a CSV string into a set of UUIDs, mirroring the bookmarks parser.

    * ``None`` → ``None`` (no constraint)
    * ``""`` → ``set()`` (filter excludes everything; caller short-circuits)
    * ``"a,b,c"`` → ``{"a", "b", "c"}``
    * Whitespace around tokens is stripped; empty tokens are dropped.
    """
    if raw is None:
        return None
    return {u.strip() for u in raw.split(",") if u.strip()} if raw.strip() else set()


@router.get("/search", response_model=SearchResponse)
async def search(
    q: str = Query(..., min_length=1, description="Search query"),
    source: Literal["all", "CLAUDE_AI", "CLAUDE_CODE"] = Query(
        "all", description="Filter by source"
    ),
    context_size: Literal["snippet", "full"] = Query(
        "snippet", description="Amount of context per match"
    ),
    sort: Literal["updated_at", "created_at", "name", "project"] = Query(
        "updated_at", description="Sort field"
    ),
    sort_order: Literal["asc", "desc"] = Query(
        "desc", description="Sort order"
    ),
    conversation_uuid: str | None = Query(
        None, description="Restrict search to this conversation"
    ),
    project_path: str | None = Query(
        None, description="Restrict to conversations with this project_path"
    ),
    bookmarks: str | None = Query(
        None,
        description="Comma-separated UUIDs to restrict search to bookmarked conversations",
    ),
    organization_id: str | None = Query(
        None,
        description=(
            "Workspace UUID — restrict to conversations whose organization_id "
            "matches exactly. None means no constraint."
        ),
    ),
    conversation_uuids: str | None = Query(
        None,
        description=(
            "Comma-separated UUIDs to restrict search to a specific set "
            "(used by the UI to honor the active-filter graph). "
            "None means no constraint; empty string means the active "
            "filter excludes everything (returns []). For large sets, "
            "prefer POST /api/search with a JSON body — GET has URL-length "
            "limits at proxies and h11."
        ),
    ),
    include_tool_calls: bool = Query(
        True,
        description=(
            "When False, search ignores tool_use / tool_result / thinking "
            "blocks so the sidebar only shows results whose owning message "
            "is rendered in the conversation pane (mirrors the UI's "
            "showToolCalls toggle). Default True preserves backward "
            "compat for external scripts hitting /api/search directly."
        ),
    ),
    store: ConversationStore = Depends(get_store),
) -> SearchResponse:
    """Search across all conversations (GET form)."""
    bookmark_set = _parse_csv_uuid_set(bookmarks)
    conversation_uuids_set = _parse_csv_uuid_set(conversation_uuids)
    return search_conversations(
        store,
        q,
        source=source,
        context_size=context_size,
        sort=sort,
        sort_order=sort_order,
        conversation_uuid=conversation_uuid,
        project_path=project_path,
        bookmarks=bookmark_set,
        include_tool_calls=include_tool_calls,
        organization_id=organization_id,
        conversation_uuids=conversation_uuids_set,
        limit=HTTP_SEARCH_LIMIT,
    )


class SearchRequest(BaseModel):
    """JSON body for ``POST /api/search``.

    Mirrors the GET query params, but with native types: ``bookmarks``
    and ``conversation_uuids`` are JSON arrays (not CSV) — that's the
    whole point of having a POST variant. Spec §2 (2026-05-14, Council
    convergence): GET CSV blows past URL-length limits at ~1500 UUIDs.
    """

    q: str = Field(..., min_length=1, description="Search query")
    source: Literal["all", "CLAUDE_AI", "CLAUDE_CODE"] = "all"
    context_size: Literal["snippet", "full"] = "snippet"
    sort: Literal["updated_at", "created_at", "name", "project"] = "updated_at"
    sort_order: Literal["asc", "desc"] = "desc"
    conversation_uuid: str | None = None
    project_path: str | None = None
    bookmarks: list[str] | None = Field(None, max_length=5000)
    organization_id: str | None = None
    # Hunt #4 (API boundaries): cap at 5000 to bound work in the
    # filter pipeline. The frontend's active-filter UI never sends
    # more than the visible-list size (~1500 at the 99th percentile);
    # 5000 gives 3x headroom AND keeps the underlying SQLite IN(...)
    # clause well under SQLITE_MAX_VARIABLE_NUMBER. Without this cap,
    # a 100k-UUID POST takes ~21s.
    conversation_uuids: list[str] | None = Field(None, max_length=5000)
    include_tool_calls: bool = True


@router.post("/search", response_model=SearchResponse)
async def search_post(
    body: SearchRequest,
    store: ConversationStore = Depends(get_store),
) -> SearchResponse:
    """Search across all conversations (POST form).

    Identical semantics to the GET endpoint; the only difference is
    transport. Used by the UI when the active-filter set is large
    enough that GET CSV would risk a 414/431 at proxies. The same
    `search_conversations()` internals back both paths so any
    per-method drift is caught by ``test_post_search_get_parity_*``.
    """
    return search_conversations(
        store,
        body.q,
        source=body.source,
        context_size=body.context_size,
        sort=body.sort,
        sort_order=body.sort_order,
        conversation_uuid=body.conversation_uuid,
        project_path=body.project_path,
        bookmarks=set(body.bookmarks) if body.bookmarks is not None else None,
        include_tool_calls=body.include_tool_calls,
        organization_id=body.organization_id,
        conversation_uuids=(
            set(body.conversation_uuids)
            if body.conversation_uuids is not None
            else None
        ),
        limit=HTTP_SEARCH_LIMIT,
    )
