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
) -> list[SearchResult]:
    """Search across all conversations."""
    store = ConversationStore()
    return search_conversations(store, q, source=source, context_size=context_size)