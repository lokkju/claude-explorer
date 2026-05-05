"""Search router."""

from typing import Literal

from fastapi import APIRouter, Query

from ..models import SearchResult
from ..store import ConversationStore
from ..search import search_conversations

router = APIRouter(tags=["search"])


@router.get("/search", response_model=list[SearchResult])
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
) -> list[SearchResult]:
    """Search across all conversations."""
    store = ConversationStore()
    bookmark_set = (
        {u.strip() for u in bookmarks.split(",") if u.strip()}
        if bookmarks
        else None
    )
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
    )