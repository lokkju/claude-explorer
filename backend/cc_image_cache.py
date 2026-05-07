"""Permanent cache for Claude Code image-cache attachments (P4a).

Claude Code stores image attachments at
``~/.claude/image-cache/<sess>/<N>.<ext>`` and references them inside
message text as a literal ``[Image: source: <abs-path>]`` marker.
Claude Code rotates / deletes those files; the explorer's viewer then
breaks. To keep them around forever, at fetch time we copy each
referenced file into:

    ``<data_dir>/cc-images/<conv-uuid>/<sess>--<N>.<sha8>.<ext>``

The ``sha8`` suffix prevents collisions if a re-fetch produces
different bytes for the same ``<sess>--<N>`` slot. We do **not** delete
old copies — both survive on disk; the fallback endpoint (P4b) resolves
the conversation marker to the most recent.
"""

from __future__ import annotations

import hashlib
import logging
import re
from pathlib import Path

from .config import get_settings


log = logging.getLogger(__name__)


_MARKER_RE = re.compile(r"\[Image: source: ([^\]]+)\]")


def cache_dir() -> Path:
    """Root of the permanent CC image cache.

    Production layout puts ``conversations/`` and ``cc-images/`` as
    siblings under ``~/.claude-exporter/``. We derive ``cc-images/``
    from ``settings.data_dir`` (which points at the ``conversations/``
    subdir in production and is overridden by ``CLAUDE_EXPORTER_DATA_DIR``
    in tests). When the override points at a directory whose name is
    NOT ``conversations``, we fall back to ``data_dir / "cc-images"``
    so older test layouts still work. Mirrors the
    ``backend.routers.files._attachments_root`` precedent.
    """
    data_dir = get_settings().data_dir
    if data_dir.name == "conversations":
        return data_dir.parent / "cc-images"
    return data_dir / "cc-images"


def cache_path_for(
    conv_uuid: str, sess: str, n: str, sha8: str, ext: str = "png"
) -> Path:
    """Compute the destination path for a given (conv, sess, slot, sha8)."""
    return cache_dir() / conv_uuid / f"{sess}--{n}.{sha8}.{ext}"


def copy_marker_image_to_cache(abs_path: str, conv_uuid: str) -> Path | None:
    """Read bytes from ``abs_path``, hash, copy into permanent cache.

    Returns the destination path, or ``None`` if ``abs_path`` is missing
    or unreadable. Missing paths are logged at WARNING (Claude Code may
    have already rotated them out) and do NOT raise.
    """
    p = Path(abs_path)
    if not p.exists() or not p.is_file():
        log.warning(
            "CC image referenced by conv %s not on disk: %s", conv_uuid, abs_path
        )
        return None
    try:
        bytes_ = p.read_bytes()
    except OSError as e:
        log.warning(
            "Could not read CC image %s for conv %s: %s", abs_path, conv_uuid, e
        )
        return None

    sha8 = hashlib.sha256(bytes_).hexdigest()[:8]
    # Parse "<sess>" and "<N>" from the path: parent dir name is the
    # session uuid, stem is the slot number.
    sess = p.parent.name
    n = p.stem
    ext = p.suffix.lstrip(".") or "png"

    dst = cache_path_for(conv_uuid, sess, n, sha8, ext)
    dst.parent.mkdir(parents=True, exist_ok=True)
    if not dst.exists():
        dst.write_bytes(bytes_)
    return dst


def cache_all_markers(conversation_json: dict) -> list[Path]:
    """Walk a conversation JSON for ``[Image: source: ...]`` markers
    and copy each referenced file to the permanent cache.

    Returns the list of destination paths actually written (or
    pre-existing). Skipped/missing references are logged at WARNING
    and do not appear in the returned list.
    """
    conv_uuid = conversation_json.get("uuid")
    if not conv_uuid:
        return []

    out: list[Path] = []
    for msg in conversation_json.get("chat_messages", []):
        for block in msg.get("content", []) or []:
            if not isinstance(block, dict):
                continue
            if block.get("type") != "text":
                continue
            text = block.get("text") or ""
            for m in _MARKER_RE.finditer(text):
                dst = copy_marker_image_to_cache(m.group(1).strip(), conv_uuid)
                if dst is not None:
                    out.append(dst)
    return out
