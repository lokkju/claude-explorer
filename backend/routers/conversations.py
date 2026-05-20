"""Conversations router."""

from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import ORJSONResponse

from ..models import ConversationSummary, ConversationDetail, ConversationTree
from ..store import ConversationStore

router = APIRouter(prefix="/conversations", tags=["conversations"])


def get_store() -> ConversationStore:
    """Get a ConversationStore instance."""
    return ConversationStore()


# ORJSONResponse on the list endpoint cuts serialization of the ~1 MB
# sidebar payload from ~500 ms (Pydantic-via-stdlib-json) to ~30 ms.
# orjson handles datetimes natively, so ConversationSummary
# (backend/models.py:78) needs no shape change.
@router.get("", response_model=list[ConversationSummary], response_class=ORJSONResponse)
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
    include_subagents: bool = Query(
        False, description="Include subagent session details in response"
    ),
    organization_id: str | None = Query(
        None, description="Filter by organization (workspace) UUID"
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
        include_subagents=include_subagents,
        organization_id=organization_id,
    )


@router.get("/{uuid}", response_model=ConversationDetail)
async def get_conversation(
    uuid: str,
    leaf: str | None = Query(None, description="Override active branch leaf UUID"),
) -> ConversationDetail:
    """Get a single conversation by UUID, optionally on a specific branch."""
    store = get_store()
    conversation = store.get_conversation(uuid, leaf_override=leaf)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@router.get("/{uuid}/tree", response_model=ConversationTree)
async def get_conversation_tree(uuid: str) -> ConversationTree:
    """Get the full message tree for a conversation."""
    store = get_store()
    try:
        tree = store.get_conversation_tree(uuid)
        if not tree:
            raise HTTPException(status_code=404, detail="Conversation not found")
        return tree
    except RecursionError:
        raise HTTPException(
            status_code=422,
            detail="Conversation has too many messages for tree visualization"
        )