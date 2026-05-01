"""Fetch router - trigger Claude Desktop conversation fetch from frontend."""

import json
import asyncio
import time
from pathlib import Path
from typing import AsyncGenerator

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# Import the fetcher
import sys
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from fetcher.bulk_fetch import ClaudeFetcher, load_credentials, DEFAULT_CREDENTIALS_PATH, DEFAULT_OUTPUT_DIR, DEFAULT_FILES_DIR
from fetcher.playwright_capture import capture_credentials, save_credentials


router = APIRouter(tags=["fetch"])


# Build-9: Concurrency guard for the combined capture+fetch pipeline.
# A single in-flight refresh is allowed per worker; a second concurrent
# request gets 409 Conflict. The lock pairs with the boolean so the route
# can fail-fast before establishing the SSE stream.
_refresh_lock: asyncio.Lock = asyncio.Lock()
_refresh_in_progress: bool = False


# Build-9: timeout the user has to complete login in the captured browser.
CAPTURE_TIMEOUT_SECONDS = 300

# Build-9: SSE keep-alive interval during the long capture wait. Must be
# under typical proxy idle timeouts (~30s) to prevent the browser silently
# reconnecting and triggering 409 against our own lock.
CAPTURE_KEEPALIVE_SECONDS = 25


SESSION_EXPIRED_MESSAGE = (
    "Session expired or Cloudflare-blocked. "
    "Re-run claude-explorer capture to refresh credentials."
)


def classify_fetch_error(error_msg: str) -> str:
    """Map a raw fetch error into a user-actionable message.

    Returns SESSION_EXPIRED_MESSAGE for any 401, any 403 (which Anthropic and
    Cloudflare both return on auth failures), or any 'cf-mitigated' marker.
    Otherwise returns the original message prefixed with 'Fetch failed: '.
    """
    if not error_msg:
        return "Fetch failed: unknown error"

    lowered = error_msg.lower()
    if "401" in error_msg or "403" in error_msg or "cf-mitigated" in lowered:
        return SESSION_EXPIRED_MESSAGE
    return f"Fetch failed: {error_msg}"


class FetchStatus(BaseModel):
    """Status response for fetch operations."""
    has_credentials: bool
    credentials_path: str
    output_dir: str
    existing_count: int
    credentials_age_days: int | None = None


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

    credentials_age_days: int | None = None
    if has_credentials:
        try:
            mtime = credentials_path.stat().st_mtime
            credentials_age_days = int((time.time() - mtime) // 86400)
        except OSError:
            credentials_age_days = None

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
        credentials_age_days=credentials_age_days,
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
                lowered = error_msg.lower()
                if "401" in error_msg or "403" in error_msg or "cf-mitigated" in lowered:
                    yield send_event({
                        "type": "error",
                        "message": SESSION_EXPIRED_MESSAGE,
                    })
                    return
                # Continue on other per-conversation errors
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
            "message": classify_fetch_error(str(e)),
        })


@router.post("/fetch/conversation/{uuid}")
async def force_refetch_conversation(uuid: str) -> dict:
    """Force re-fetch of a single conversation, bypassing the incremental skip.

    Useful when a Desktop-side rename or content change needs to propagate
    without a full --full-refresh.
    """
    try:
        creds = load_credentials(DEFAULT_CREDENTIALS_PATH)
    except Exception:
        raise HTTPException(status_code=400, detail="No credentials. Run 'claude-explorer capture' first.")

    session_key = creds.get("session_key")
    org_id = creds.get("org_id")
    if not session_key or not org_id:
        raise HTTPException(status_code=400, detail="Invalid credentials file.")

    fetcher = ClaudeFetcher(
        session_key=session_key,
        org_id=org_id,
        output_dir=DEFAULT_OUTPUT_DIR,
        files_dir=DEFAULT_FILES_DIR,
        delay=0.0,
        incremental=False,
        verbose=False,
        download_files=True,
        cf_bm=creds.get("cf_bm"),
        cf_clearance=creds.get("cf_clearance"),
    )

    DEFAULT_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    try:
        full_conv = fetcher.fetch_conversation(uuid)
    except Exception as e:
        msg = str(e)
        if "401" in msg or "403" in msg or "cf-mitigated" in msg.lower():
            raise HTTPException(status_code=401, detail=SESSION_EXPIRED_MESSAGE)
        raise HTTPException(status_code=500, detail=f"Fetch failed: {msg}")

    if not full_conv:
        raise HTTPException(status_code=404, detail=f"Conversation {uuid} not found upstream")

    fetcher.save_conversation(full_conv)
    return {"uuid": uuid, "status": "refetched", "name": full_conv.get("name", "")}


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


# ---------------------------------------------------------------------------
# Build-9: combined capture + fetch SSE pipeline.
# ---------------------------------------------------------------------------


def _is_session_expired_error(error_msg: str) -> bool:
    """True if the upstream error indicates expired creds or Cloudflare block."""
    if not error_msg:
        return False
    lowered = error_msg.lower()
    return "401" in error_msg or "403" in error_msg or "cf-mitigated" in lowered


def _send_event(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def _run_capture_with_keepalive(
    timeout: int = CAPTURE_TIMEOUT_SECONDS,
) -> AsyncGenerator[str | dict, None]:
    """Run capture_credentials and yield SSE-frame strings for keep-alives.

    The final value yielded is a dict (the captured credentials) or None.
    Intermediate yields are SSE-encoded strings — either capture_waiting_login
    progress events or `: ping` keep-alive comments. The caller distinguishes
    by isinstance.
    """
    capture_task = asyncio.create_task(
        capture_credentials(timeout=timeout, headless=False)
    )
    waited = 0
    try:
        while not capture_task.done():
            try:
                result = await asyncio.wait_for(
                    asyncio.shield(capture_task),
                    timeout=CAPTURE_KEEPALIVE_SECONDS,
                )
                yield {"_result": result}
                return
            except asyncio.TimeoutError:
                waited += CAPTURE_KEEPALIVE_SECONDS
                yield _send_event(
                    {
                        "type": "capture_waiting_login",
                        "message": (
                            f"Waiting for you to log in "
                            f"({waited}s elapsed, {timeout - waited}s remaining)..."
                        ),
                        "current": waited,
                        "total": timeout,
                    }
                )
                # SSE comment keep-alive in addition to the data event.
                yield ": ping\n\n"
        result = await capture_task
        yield {"_result": result}
    except Exception as exc:
        capture_task.cancel()
        yield {"_error": str(exc)}


async def _fetch_phase_stream(
    incremental: bool,
    limit: int | None = None,
) -> AsyncGenerator[tuple[str, str | None], None]:
    """Drive the fetch phase against currently-saved credentials.

    Yields (kind, payload) tuples where kind is one of:
        "event"    -> payload is an SSE-encoded data string to forward
        "expired"  -> payload is the underlying error message; caller may capture
        "fatal"    -> payload is the error message; caller emits final error
    """
    try:
        creds = load_credentials(DEFAULT_CREDENTIALS_PATH)
    except Exception as exc:
        yield ("fatal", f"No credentials: {exc}")
        return

    session_key = creds.get("session_key")
    org_id = creds.get("org_id")
    if not session_key or not org_id:
        yield ("fatal", "Invalid credentials file. Missing session_key or org_id.")
        return

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

    DEFAULT_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    existing_uuids: set[str] = set()
    if incremental:
        existing_uuids = {
            p.stem for p in DEFAULT_OUTPUT_DIR.glob("*.json") if p.stem != "_index"
        }

    yield (
        "event",
        _send_event(
            {
                "type": "start",
                "message": "Fetching conversation list...",
                "current": 0,
                "total": 0,
            }
        ),
    )

    loop = asyncio.get_event_loop()
    try:
        conversations = await loop.run_in_executor(
            None, fetcher.fetch_conversation_list
        )
    except Exception as exc:
        msg = str(exc)
        if _is_session_expired_error(msg):
            yield ("expired", msg)
            return
        yield ("fatal", classify_fetch_error(msg))
        return

    if limit:
        conversations = conversations[:limit]

    if incremental:
        to_fetch = [c for c in conversations if c.get("uuid") not in existing_uuids]
    else:
        to_fetch = conversations

    total = len(to_fetch)
    skipped = len(conversations) - total

    yield (
        "event",
        _send_event(
            {
                "type": "progress",
                "message": (
                    f"Found {len(conversations)} conversations, "
                    f"fetching {total} new"
                    + (f" (skipping {skipped} existing)" if skipped else "")
                ),
                "current": 0,
                "total": total,
            }
        ),
    )

    if total == 0:
        await loop.run_in_executor(None, fetcher.save_index, conversations)
        yield (
            "event",
            _send_event(
                {
                    "type": "complete",
                    "message": "No new conversations to fetch.",
                    "current": 0,
                    "total": 0,
                }
            ),
        )
        return

    fetched_count = 0
    for i, conv in enumerate(to_fetch, 1):
        uuid = conv.get("uuid", "")
        name = conv.get("name", "Untitled")[:50]

        yield (
            "event",
            _send_event(
                {
                    "type": "progress",
                    "message": f"Fetching: {name}",
                    "current": i,
                    "total": total,
                    "conversation_name": name,
                }
            ),
        )

        if not uuid:
            continue

        try:
            full_conv = await loop.run_in_executor(
                None, fetcher.fetch_conversation, uuid
            )
            if full_conv:
                await loop.run_in_executor(
                    None, fetcher.save_conversation, full_conv
                )
                fetched_count += 1
        except Exception as exc:
            msg = str(exc)
            if _is_session_expired_error(msg):
                yield ("expired", msg)
                return
            yield (
                "event",
                _send_event(
                    {
                        "type": "progress",
                        "message": f"Error fetching {name}: {msg}",
                        "current": i,
                        "total": total,
                    }
                ),
            )

        if i < total:
            await asyncio.sleep(0.3)

    await loop.run_in_executor(None, fetcher.save_index, conversations)
    yield (
        "event",
        _send_event(
            {
                "type": "complete",
                "message": f"Fetched {fetched_count} conversations successfully.",
                "current": total,
                "total": total,
            }
        ),
    )


async def _capture_phase_stream() -> AsyncGenerator[tuple[str, str | dict | None], None]:
    """Run a single capture and yield SSE frames + a terminal result tuple.

    Yields:
        ("event", sse_str)       — pass-through to client
        ("ping",  ": ping\\n\\n") — keep-alive
        ("done",  creds_dict)    — capture succeeded; caller persists creds
        ("error", str)           — capture failed; caller emits error
    """
    yield (
        "event",
        _send_event(
            {
                "type": "capture_start",
                "message": "Opening browser to log in to Claude...",
            }
        ),
    )

    try:
        async for item in _run_capture_with_keepalive():
            if isinstance(item, str):
                if item.startswith(":"):
                    yield ("ping", item)
                else:
                    yield ("event", item)
                continue
            if isinstance(item, dict):
                if "_error" in item:
                    yield ("error", item["_error"])
                    return
                creds = item.get("_result")
                if not creds:
                    yield ("error", "Capture cancelled or timed out.")
                    return
                yield ("done", creds)
                return
    except Exception as exc:
        yield ("error", str(exc))


async def refresh_pipeline_stream(
    incremental: bool = True,
    limit: int | None = None,
) -> AsyncGenerator[str, None]:
    """One-button Refresh: capture (if needed) -> fetch.

    Order of operations:
      1. If credentials are missing on disk, run capture immediately.
      2. Otherwise, attempt fetch. If fetch reports session-expired,
         run capture once and retry fetch exactly one more time.
      3. Capture is invoked at most once per request. No re-loop.
    """
    global _refresh_in_progress
    try:
        captured_already = False

        # ---- Phase 1: capture if creds missing ---------------------------
        if not DEFAULT_CREDENTIALS_PATH.exists():
            had_error = False
            async for kind, payload in _capture_phase_stream():
                if kind in ("event", "ping"):
                    yield payload
                elif kind == "done":
                    try:
                        save_credentials(payload, DEFAULT_CREDENTIALS_PATH)
                    except Exception as exc:
                        yield _send_event(
                            {
                                "type": "error",
                                "message": f"Failed to save credentials: {exc}",
                            }
                        )
                        return
                    yield _send_event(
                        {
                            "type": "capture_done",
                            "message": "Credentials captured. Fetching...",
                        }
                    )
                    captured_already = True
                elif kind == "error":
                    yield _send_event(
                        {
                            "type": "error",
                            "message": (
                                "Capture failed: "
                                + (payload or "browser closed or login timed out")
                            ),
                        }
                    )
                    had_error = True
                    break
            if had_error or not captured_already:
                return

        # ---- Phase 2: try fetch -----------------------------------------
        attempt = 1
        max_attempts = 2  # initial + post-capture retry
        while attempt <= max_attempts:
            expired_msg: str | None = None
            async for kind, payload in _fetch_phase_stream(
                incremental=incremental, limit=limit
            ):
                if kind == "event":
                    yield payload
                elif kind == "expired":
                    expired_msg = payload
                    break
                elif kind == "fatal":
                    yield _send_event({"type": "error", "message": payload})
                    return

            if expired_msg is None:
                return  # success

            if captured_already or attempt >= max_attempts:
                # Already captured once this request; do not loop.
                yield _send_event(
                    {"type": "error", "message": SESSION_EXPIRED_MESSAGE}
                )
                return

            # Capture once, then retry fetch.
            had_error = False
            async for kind, payload in _capture_phase_stream():
                if kind in ("event", "ping"):
                    yield payload
                elif kind == "done":
                    try:
                        save_credentials(payload, DEFAULT_CREDENTIALS_PATH)
                    except Exception as exc:
                        yield _send_event(
                            {
                                "type": "error",
                                "message": f"Failed to save credentials: {exc}",
                            }
                        )
                        return
                    yield _send_event(
                        {
                            "type": "capture_done",
                            "message": "Credentials captured. Fetching...",
                        }
                    )
                    captured_already = True
                elif kind == "error":
                    yield _send_event(
                        {
                            "type": "error",
                            "message": (
                                "Capture failed: "
                                + (payload or "browser closed or login timed out")
                            ),
                        }
                    )
                    had_error = True
                    break
            if had_error or not captured_already:
                return
            attempt += 1
    finally:
        _refresh_in_progress = False


@router.get("/fetch/refresh")
async def refresh_pipeline(
    incremental: bool = True,
    limit: int | None = None,
) -> StreamingResponse:
    """Combined capture + fetch SSE stream — Build-9 one-button Refresh.

    Returns 409 if a refresh is already in progress on this worker.
    """
    global _refresh_in_progress
    if _refresh_in_progress:
        raise HTTPException(
            status_code=409, detail="Refresh already in progress."
        )
    _refresh_in_progress = True

    return StreamingResponse(
        refresh_pipeline_stream(incremental=incremental, limit=limit),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )