"""Continuous CC image-cache protection.

Claude Code drops image attachments into ``~/.claude/image-cache/<sess>/<N>.<ext>``
and rotates them off disk on its own schedule (often within minutes
of the conversation ending). The conversation JSONL keeps the
``[Image: source: ...]`` marker intact, so the explorer's viewer
breaks the moment CC reaps the file.

The eager fetch-time path (`backend.cc_image_cache.cache_all_markers`)
and the lazy request-time path (`/api/cc-image` Option B) only catch
images that are referenced by a conversation we've already read. New
images that CC writes between reads can be rotated before any read
ever sees them.

This watcher closes that gap with a periodic polling loop. Every
``SCAN_INTERVAL_SEC`` seconds it walks the live image-cache root and
copies any file we haven't already seen this process into
``~/.claude-exporter/cc-images/<sess>/<sess>--<N>.<sha8>.<ext>``.
For CC sessions the conversation UUID equals the session UUID equals
the parent dir name in the live tree, so the destination layout
matches what the eager and lazy paths produce.

The watcher is lightweight: most scans walk a tiny tree (the live
cache rarely holds more than a handful of files at any moment) and
the per-process ``_seen`` set short-circuits already-processed paths
without re-reading bytes. The watcher is best-effort: any error is
logged and swallowed so a transient I/O failure never crashes the
backend.
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from .cc_image_cache import copy_marker_image_to_cache
from .config import get_settings


logger = logging.getLogger(__name__)

SCAN_INTERVAL_SEC = 5.0
ALLOWED_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}

# Per-process record of source paths we've already attempted to cache
# (regardless of whether the destination already existed). CC writes
# new files with incrementing slot numbers rather than modifying in
# place, so path uniqueness is sufficient — we never need to re-hash a
# file we've already processed.
_seen: set[Path] = set()


def _live_image_cache_root() -> Path:
    """Where Claude Code stores image-cache files. Honors CLAUDE_DIR."""
    return get_settings().claude_dir / "image-cache"


def scan_once() -> int:
    """Walk every file under ``~/.claude/image-cache/`` and ensure it
    has been copied into the permanent cache. Returns the count of
    paths newly handled this pass (i.e. not in ``_seen`` before).
    """
    root = _live_image_cache_root()
    if not root.exists():
        return 0
    handled = 0
    for path in root.rglob("*"):
        if path in _seen or not path.is_file():
            continue
        if path.suffix.lower() not in ALLOWED_SUFFIXES:
            _seen.add(path)
            continue
        sess = path.parent.name
        try:
            copy_marker_image_to_cache(str(path), sess)
        except Exception:  # noqa: BLE001
            logger.exception("watcher: failed to cache %s", path)
            # Don't add to _seen so a transient error retries next pass.
            continue
        _seen.add(path)
        handled += 1
    if handled:
        logger.info("CC image watcher: handled %d new path(s) this pass", handled)
    return handled


def reset_seen_for_tests() -> None:
    """Test hook: clear the process-level _seen set so back-to-back
    scans re-process the same paths. Production code should never call
    this."""
    _seen.clear()


async def run_watcher(stop_event: asyncio.Event) -> None:
    """Run :func:`scan_once` every ``SCAN_INTERVAL_SEC`` seconds until
    ``stop_event`` is set. Spawned as a background task by FastAPI's
    lifespan hook.
    """
    logger.info(
        "CC image watcher starting; interval=%.1fs root=%s",
        SCAN_INTERVAL_SEC,
        _live_image_cache_root(),
    )
    # Eager first pass: catch anything that's already on disk before
    # waiting for the first interval.
    try:
        scan_once()
    except Exception:  # noqa: BLE001
        logger.exception("CC image watcher initial scan failed")

    while not stop_event.is_set():
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=SCAN_INTERVAL_SEC)
            # If we exit the wait without a TimeoutError, stop_event is set.
            break
        except asyncio.TimeoutError:
            pass
        try:
            scan_once()
        except Exception:  # noqa: BLE001
            logger.exception("CC image watcher scan failed")
    logger.info("CC image watcher stopped")
