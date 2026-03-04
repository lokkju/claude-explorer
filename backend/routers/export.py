"""Export router."""

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response, StreamingResponse
import io

from ..store import ConversationStore
from ..export import (
    conversation_to_markdown,
    create_pdf,
    create_markdown_zip,
    sanitize_filename,
)

router = APIRouter(tags=["export"])


@router.get("/conversations/{uuid}/export/markdown")
async def export_markdown(uuid: str, include_tools: bool = True) -> Response:
    """Export a conversation as Markdown."""
    store = ConversationStore()
    conversation = store.get_conversation(uuid)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    content = conversation_to_markdown(conversation, include_tools)
    filename = f"{sanitize_filename(conversation.name)}.md"

    return Response(
        content=content.encode("utf-8"),
        media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/conversations/{uuid}/export/pdf")
async def export_pdf(uuid: str, include_tools: bool = True) -> Response:
    """Export a conversation as PDF."""
    store = ConversationStore()
    conversation = store.get_conversation(uuid)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    try:
        pdf_bytes = create_pdf(conversation, include_tools)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    filename = f"{sanitize_filename(conversation.name)}.pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/export/all/markdown")
async def export_all_markdown() -> StreamingResponse:
    """Export all conversations as a ZIP of Markdown files."""
    store = ConversationStore()

    # Get all conversations with full details
    conversations = []
    for summary in store.list_conversations():
        detail = store.get_conversation(summary.uuid)
        if detail:
            conversations.append(detail)

    if not conversations:
        raise HTTPException(status_code=404, detail="No conversations found")

    zip_bytes = create_markdown_zip(conversations)

    return StreamingResponse(
        io.BytesIO(zip_bytes),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="conversations.zip"'},
    )