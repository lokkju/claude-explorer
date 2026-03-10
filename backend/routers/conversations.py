"""Conversations router."""

from typing import Literal

from fastapi import APIRouter, HTTPException, Query

from ..models import ConversationSummary, ConversationDetail, ConversationTree
from ..store import ConversationStore

router = APIRouter(prefix="/conversations", tags=["conversations"])


def get_store() -> ConversationStore:
    """Get a ConversationStore instance."""
    return ConversationStore()


@router.get("", response_model=list[ConversationSummary])
async def list_conversations(
    search: str | None = Query(None, description="Search in name/summary"),
    starred: bool | None = Query(None, description="Filter by starred status"),
    model: str | None = Query(None, description="Filter by model"),
    source: Literal["all", "CLAUDE_AI", "CLAUDE_CODE"] = Query(
        "all", description="Filter by source (all, CLAUDE_AI, CLAUDE_CODE)"
    ),
    sort: Literal["updated_at", "created_at", "name", "project"] = Query(
        "updated_at", description="Sort field"
    ),
    sort_order: Literal["asc", "desc"] = Query(
        "desc", description="Sort order (asc or desc)"
    ),
    include_phantom: bool = Query(
        False, description="Include phantom sessions (local command artifacts)"
    ),
) -> list[ConversationSummary]:
    """List all conversations with optional filtering."""
    store = get_store()
    return store.list_conversations(
        search=search,
        starred=starred,
        model=model,
        source=source,
        sort=sort,
        sort_order=sort_order,
        include_phantom=include_phantom,
    )


@router.get("/{uuid}", response_model=ConversationDetail)
async def get_conversation(uuid: str) -> ConversationDetail:
    """Get a single conversation by UUID."""
    store = get_store()
    conversation = store.get_conversation(uuid)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@router.get("/{uuid}/tree", response_model=ConversationTree)
async def get_conversation_tree(uuid: str) -> ConversationTree:
    """Get the full message tree for a conversation."""
    store = get_store()
    tree = store.get_conversation_tree(uuid)
    if not tree:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return tree