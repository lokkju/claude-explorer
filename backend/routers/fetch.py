"""Fetch router - trigger Claude Desktop conversation fetch from frontend."""

import json
import asyncio
from pathlib import Path
from typing import AsyncGenerator

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# Import the fetcher
import sys
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from fetcher.bulk_fetch import ClaudeFetcher, load_credentials, DEFAULT_CREDENTIALS_PATH, DEFAULT_OUTPUT_DIR, DEFAULT_FILES_DIR


router = APIRouter(tags=["fetch"])


class FetchStatus(BaseModel):
    """Status response for fetch operations."""
    has_credentials: bool
    credentials_path: str
    output_dir: str
    existing_count: int


class FetchProgress(BaseModel):
    """Progress update during fetch."""
    type: str  # "start", "progress", "complete", "error"
    message: str
    current: int = 0
    total: int = 0
    conversation_name: str | None = None


@router.get("/fetch/status", response_model=FetchStatus)
async def get_fetch_status() -> FetchStatus:
    """Check if credentials are available and get current state."""
    credentials_path = DEFAULT_CREDENTIALS_PATH
    output_dir = DEFAULT_OUTPUT_DIR

    has_credentials = credentials_path.exists()

    # Count existing conversations
    existing_count = 0
    if output_dir.exists():
        existing_count = len([
            p for p in output_dir.glob("*.json")
            if p.stem != "_index"
        ])

    return FetchStatus(
        has_credentials=has_credentials,
        credentials_path=str(credentials_path),
        output_dir=str(output_dir),
        existing_count=existing_count,
    )


async def fetch_conversations_stream(
    incremental: bool = True,
    limit: int | None = None,
) -> AsyncGenerator[str, None]:
    """Stream fetch progress as Server-Sent Events."""

    def send_event(data: dict) -> str:
        return f"data: {json.dumps(data)}\n\n"

    try:
        # Load credentials
        try:
            creds = load_credentials(DEFAULT_CREDENTIALS_PATH)
        except Exception as e:
            yield send_event({
                "type": "error",
                "message": f"No credentials found. Run 'claude-explorer capture' first.",
            })
            return

        session_key = creds.get("session_key")
        org_id = creds.get("org_id")

        if not session_key or not org_id:
            yield send_event({
                "type": "error",
                "message": "Invalid credentials file. Missing session_key or org_id.",
            })
            return

        # Create fetcher
        fetcher = ClaudeFetcher(
            session_key=session_key,
            org_id=org_id,
            output_dir=DEFAULT_OUTPUT_DIR,
            files_dir=DEFAULT_FILES_DIR,
            delay=0.3,
            incremental=incremental,
            verbose=False,
            download_files=True,
            cf_bm=creds.get("cf_bm"),
            cf_clearance=creds.get("cf_clearance"),
        )

        # Ensure output directory exists
        DEFAULT_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

        # Get existing UUIDs if incremental
        existing_uuids = set()
        if incremental:
            existing_uuids = {
                p.stem for p in DEFAULT_OUTPUT_DIR.glob("*.json") if p.stem != "_index"
            }

        yield send_event({
            "type": "start",
            "message": "Fetching conversation list...",
            "current": 0,
            "total": 0,
        })

        # Fetch conversation list (run in thread to not block)
        loop = asyncio.get_event_loop()
        conversations = await loop.run_in_executor(
            None, fetcher.fetch_conversation_list
        )

        if limit:
            conversations = conversations[:limit]

        # Filter out existing if incremental
        if incremental:
            to_fetch = [c for c in conversations if c.get("uuid") not in existing_uuids]
        else:
            to_fetch = conversations

        total = len(to_fetch)
        skipped = len(conversations) - total

        yield send_event({
            "type": "progress",
            "message": f"Found {len(conversations)} conversations, fetching {total} new" +
                       (f" (skipping {skipped} existing)" if skipped else ""),
            "current": 0,
            "total": total,
        })

        if total == 0:
            yield send_event({
                "type": "complete",
                "message": "No new conversations to fetch.",
                "current": 0,
                "total": 0,
            })
            return

        # Fetch each conversation
        fetched_count = 0
        for i, conv in enumerate(to_fetch, 1):
            uuid = conv.get("uuid", "")
            name = conv.get("name", "Untitled")[:50]

            yield send_event({
                "type": "progress",
                "message": f"Fetching: {name}",
                "current": i,
                "total": total,
                "conversation_name": name,
            })

            if not uuid:
                continue

            # Fetch and save conversation
            try:
                full_conv = await loop.run_in_executor(
                    None, fetcher.fetch_conversation, uuid
                )
                if full_conv:
                    await loop.run_in_executor(
                        None, fetcher.save_conversation, full_conv
                    )
                    fetched_count += 1
            except Exception as e:
                error_msg = str(e)
                if "401" in error_msg:
                    yield send_event({
                        "type": "error",
                        "message": "Session expired. Please re-capture credentials.",
                    })
                    return
                # Continue on other errors
                yield send_event({
                    "type": "progress",
                    "message": f"Error fetching {name}: {error_msg}",
                    "current": i,
                    "total": total,
                })

            # Small delay between requests
            if i < total:
                await asyncio.sleep(0.3)

        # Save index
        await loop.run_in_executor(
            None, fetcher.save_index, conversations
        )

        yield send_event({
            "type": "complete",
            "message": f"Fetched {fetched_count} conversations successfully.",
            "current": total,
            "total": total,
        })

    except Exception as e:
        yield send_event({
            "type": "error",
            "message": f"Fetch failed: {str(e)}",
        })


@router.get("/fetch/start")
async def fetch_conversations(
    incremental: bool = True,
    limit: int | None = None,
) -> StreamingResponse:
    """Fetch conversations from Claude Desktop API.

    Returns Server-Sent Events stream with progress updates.

    Args:
        incremental: If True, skip already-downloaded conversations
        limit: Max number of conversations to fetch
    """
    return StreamingResponse(
        fetch_conversations_stream(incremental=incremental, limit=limit),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )