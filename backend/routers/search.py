"""Search router."""

from fastapi import APIRouter, Query

from ..models import SearchResult
from ..store import ConversationStore
from ..search import search_conversations

router = APIRouter(tags=["search"])


@router.get("/search", response_model=list[SearchResult])
async def search(
    q: str = Query(..., min_length=1, description="Search query"),
) -> list[SearchResult]:
    """Search across all conversations."""
    store = ConversationStore()
    return search_conversations(store, q)