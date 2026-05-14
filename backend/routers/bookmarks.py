"""Bookmarks router (Build-4).

Per-message bookmarks with notes, persisted to a single JSON file under the
Claude Explorer data directory. Schema:

    {
      "bookmarks": [
        {
          "id": "<uuid>",
          "conversation_id": "<uuid>",
          "message_uuid": "<uuid>",
          "source": "claude_desktop" | "claude_code",
          "created_at": "<iso8601>",
          "note": "<user-supplied string>",
          "snippet": "<auto-truncated message text, ~140 chars>"
        }
      ]
    }
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

router = APIRouter(prefix="/bookmarks", tags=["bookmarks"])


def _resolve_path() -> Path:
    """Resolve the bookmark file location.

    Honors CLAUDE_EXPLORER_BOOKMARKS_FILE for tests; otherwise stores
    under ~/.claude-explorer/ alongside the existing data dir. Legacy
    ``~/.claude-exporter/bookmarks.json`` is read as a fallback if the
    canonical path is missing (one-release deprecation window — the
    backend's lifespan migration will move the file to the canonical
    location on its next startup).
    """
    env = os.environ.get("CLAUDE_EXPLORER_BOOKMARKS_FILE")
    if env:
        return Path(env)
    canonical = Path.home() / ".claude-explorer" / "bookmarks.json"
    if canonical.exists():
        return canonical
    legacy = Path.home() / ".claude-exporter" / "bookmarks.json"
    if legacy.exists():
        return legacy
    # Neither exists yet — default to canonical for writes.
    return canonical


class Bookmark(BaseModel):
    id: str
    conversation_id: str
    message_uuid: str
    source: Literal["claude_desktop", "claude_code"]
    created_at: str
    note: str = ""
    snippet: str = ""


class BookmarkCreate(BaseModel):
    conversation_id: str
    message_uuid: str
    source: Literal["claude_desktop", "claude_code"]
    snippet: str = Field(default="", max_length=500)
    note: str = ""


class BookmarkUpdate(BaseModel):
    note: str | None = None
    snippet: str | None = None


class BookmarkList(BaseModel):
    bookmarks: list[Bookmark]


def _read_all() -> list[Bookmark]:
    path = _resolve_path()
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return []
    raw_list = data.get("bookmarks", []) if isinstance(data, dict) else []
    out: list[Bookmark] = []
    for item in raw_list:
        try:
            out.append(Bookmark(**item))
        except Exception:
            continue
    return out


def _write_all(bookmarks: list[Bookmark]) -> None:
    path = _resolve_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"bookmarks": [b.model_dump() for b in bookmarks]}
    tmp = path.with_suffix(path.suffix + ".tmp")
    try:
        tmp.write_text(json.dumps(payload, indent=2))
        tmp.replace(path)
    except BaseException:
        try:
            tmp.unlink()
        except FileNotFoundError:
            pass
        raise


@router.get("", response_model=BookmarkList)
async def list_bookmarks() -> BookmarkList:
    return BookmarkList(bookmarks=_read_all())


@router.post("", response_model=Bookmark, status_code=status.HTTP_201_CREATED)
async def create_bookmark(payload: BookmarkCreate) -> Bookmark:
    bookmark = Bookmark(
        id=str(uuid.uuid4()),
        conversation_id=payload.conversation_id,
        message_uuid=payload.message_uuid,
        source=payload.source,
        created_at=datetime.now(timezone.utc).isoformat(),
        note=payload.note,
        snippet=payload.snippet[:140],
    )
    bookmarks = _read_all()
    bookmarks.append(bookmark)
    _write_all(bookmarks)
    return bookmark


@router.patch("/{bookmark_id}", response_model=Bookmark)
async def update_bookmark(bookmark_id: str, payload: BookmarkUpdate) -> Bookmark:
    bookmarks = _read_all()
    for i, bm in enumerate(bookmarks):
        if bm.id == bookmark_id:
            updated = bm.model_copy(
                update={
                    k: v
                    for k, v in {"note": payload.note, "snippet": payload.snippet}.items()
                    if v is not None
                }
            )
            bookmarks[i] = updated
            _write_all(bookmarks)
            return updated
    raise HTTPException(status_code=404, detail="Bookmark not found")


@router.delete("/{bookmark_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_bookmark(bookmark_id: str) -> None:
    bookmarks = _read_all()
    next_list = [b for b in bookmarks if b.id != bookmark_id]
    if len(next_list) == len(bookmarks):
        raise HTTPException(status_code=404, detail="Bookmark not found")
    _write_all(next_list)
    return None
