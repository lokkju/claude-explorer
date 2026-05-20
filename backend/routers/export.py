"""Export router."""

import asyncio
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response, StreamingResponse
import io

from ..deps import get_store
from ..store import ConversationStore
from ..export import (
    conversation_to_markdown,
    create_markdown_bundle,
    create_pdf,
    create_markdown_zip,
    sanitize_filename,
)

router = APIRouter(tags=["export"])


# WeasyPrint PDF renders take 2-10s for typical conversations and can
# spike higher on very long ones with many images. 30s is a generous
# ceiling that surfaces pathological cases as a 504 (frontend Task A5
# turns this into a toast) rather than hanging the request indefinitely.
#
# Concurrency note: ``asyncio.to_thread`` uses the event loop's default
# ThreadPoolExecutor (~32 workers). For the V1 single-user local-hosted
# deployment model this is fine. If telemetry ever shows concurrent PDF
# renders in the wild, swap to a dedicated bounded executor to prevent
# CPU/RAM exhaustion from timeout-and-abandoned render threads.
PDF_RENDER_TIMEOUT_SECONDS = 30.0


@router.get("/conversations/{uuid}/export/markdown")
async def export_markdown(
    uuid: str,
    include_tools: bool = True,
    store: ConversationStore = Depends(get_store),
) -> Response:
    """Export a conversation as Markdown."""
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


@router.get("/conversations/{uuid}/export/markdown-bundle")
async def export_markdown_bundle(
    uuid: str,
    include_tools: bool = True,
    dialect: Literal["commonmark", "obsidian"] = Query(
        "commonmark",
        description="Markdown dialect: 'commonmark' for ![alt](path), 'obsidian' for ![[path]] wikilinks",
    ),
    store: ConversationStore = Depends(get_store),
) -> Response:
    """Issue #4 — Bundle a conversation as a self-contained zip
    (Markdown + ``images/`` directory).

    Replaces the dangling ``/api/...`` image URLs in the plain
    Markdown export with bundled copies under ``images/<filename>``,
    so the user can email the zip to a colleague who doesn't have
    Claude Explorer running.

    Currently bundles Claude Code images (inline base64 + on-disk
    ``[Image: source: <path>]`` markers). Desktop ``Message.files[]``
    previews require an authenticated proxy fetch and remain
    out-of-scope; the bundled .md surfaces them as a footnote.
    """
    conversation = store.get_conversation(uuid)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    bundle = create_markdown_bundle(
        conversation,
        include_tools=include_tools,
        dialect=dialect,
    )
    filename = f"{sanitize_filename(conversation.name)}.zip"
    return Response(
        content=bundle,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/conversations/{uuid}/export/pdf")
async def export_pdf(
    uuid: str,
    include_tools: bool = True,
    store: ConversationStore = Depends(get_store),
) -> Response:
    """Export a conversation as PDF.

    WeasyPrint renders are CPU-bound (CFFI to libpango/libcairo, which
    releases the GIL during the heavy native work) and take 2-10s for
    typical conversations. Running ``create_pdf`` directly inside the
    async route handler would pin the event loop for the full render
    and queue every other request behind it. We offload to a worker
    thread via ``asyncio.to_thread`` and bound the wait with
    ``asyncio.timeout`` so a runaway render returns ``504`` instead of
    hanging the client indefinitely.

    Cancellation caveat: ``asyncio.timeout`` cancels the awaiting task
    but cannot kill the worker thread. The thread keeps running until
    WeasyPrint returns; its result and the captured ``conversation`` /
    HTML buffer are then GC'd. We do not own any tempfile or BytesIO
    handle at this layer, so there is no caller-side cleanup needed on
    the timeout path.
    """
    conversation = store.get_conversation(uuid)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    try:
        async with asyncio.timeout(PDF_RENDER_TIMEOUT_SECONDS):
            pdf_bytes = await asyncio.to_thread(
                create_pdf, conversation, include_tools
            )
    except TimeoutError:
        raise HTTPException(
            status_code=504,
            detail=(
                f"PDF render exceeded {PDF_RENDER_TIMEOUT_SECONDS:.0f}s timeout. "
                "Try exporting as Markdown instead."
            ),
        )
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    filename = f"{sanitize_filename(conversation.name)}.pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/export/all/markdown")
async def export_all_markdown(
    store: ConversationStore = Depends(get_store),
) -> StreamingResponse:
    """Export all conversations as a ZIP of Markdown files.

    Empty-corpus contract (C6 (c)): the route never 404s on an empty
    data dir. The fresh-install state (no fetches yet) is a legitimate
    user path — clicking "Export all" before the first fetch should
    download a self-explanatory zip (single README) instead of an
    error. ``create_markdown_zip([])`` owns that stub.
    """
    # Get all conversations with full details
    conversations = []
    for summary in store.list_conversations():
        detail = store.get_conversation(summary.uuid)
        if detail:
            conversations.append(detail)

    zip_bytes = create_markdown_zip(conversations)

    return StreamingResponse(
        io.BytesIO(zip_bytes),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="conversations.zip"'},
    )