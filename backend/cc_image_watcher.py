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

This watcher closes that gap with an **event-driven primary +
backstop poll**:

  * ``watchdog`` (FSEvents on macOS, inotify on Linux,
    ReadDirectoryChangesW on Windows) gives us per-file create/modify
    events with ~sub-second latency and ~zero idle CPU. Events fire
    into ``handle_one_path``, which delegates to the same
    ``copy_marker_image_to_cache`` the eager and lazy paths use.
  * A periodic backstop poll (default 600s — ten minutes) re-runs
    the full ``scan_once`` walk to catch anything events missed.
    Documented edge cases for missed events: FSEvents coalescing
    under extreme load; inotify watch-queue overflow; sandboxed/NFS
    Pythons where the OS-native backend isn't available
    (watchdog falls back to ``PollingObserver`` automatically — we
    log which backend got selected so misconfigurations are
    diagnosable).

The destination layout is unchanged:
``~/.claude-explorer/cc-images/<sess>/<sess>--<N>.<sha8>.<ext>``.
For CC sessions the conversation UUID equals the session UUID equals
the parent dir name in the live tree, so the destination layout
matches what the eager and lazy paths produce.

The watcher is best-effort: any error is logged and swallowed so a
transient I/O failure never crashes the backend.
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from .cc_image_cache import copy_marker_image_to_cache
from .config import get_settings, read_env


logger = logging.getLogger(__name__)


def _resolve_interval() -> float:
    """Backstop-poll interval in seconds. Overridable via
    ``CLAUDE_EXPLORER_CC_WATCHER_INTERVAL_SEC`` (legacy
    ``CLAUDE_EXPORTER_CC_WATCHER_INTERVAL_SEC`` honored for one release).

    Default 600s (10 min). With event-driven capture handling the
    latency-critical path, the backstop only exists for correctness
    against the rare OS-event miss; longer intervals are fine.

    History: original 5s, bumped to 60s (08e9458) as wakeup-cost
    optimization, reverted to 5s for V1 ("data integrity > idle CPU"
    — citing an anecdotal report of an image rotated off disk within
    hours of creation), bumped back to 60s with empirical evidence
    that CC's rotation cadence is not seconds-scale, then bumped
    again to 600s once the watchdog migration moved the fast path
    onto FSEvents/inotify/RDCW. The env var meaning is now "backstop
    poll interval"; users overriding it pre-migration get the same
    behavior just at a less critical timer.
    """
    raw = read_env(
        "CLAUDE_EXPLORER_CC_WATCHER_INTERVAL_SEC",
        "CLAUDE_EXPORTER_CC_WATCHER_INTERVAL_SEC",
    )
    if raw:
        try:
            return max(1.0, float(raw))
        except ValueError:
            logger.warning(
                "Bad CC watcher interval %r; using default", raw
            )
    return 600.0


# Public name preserved for backward compat with anything reading it
# (the install-watcher launcher script captures this at install time).
SCAN_INTERVAL_SEC = _resolve_interval()
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


def handle_one_path(path: Path) -> bool:
    """Process a single candidate image-cache file.

    Idempotent: if the path is already in ``_seen`` (from any earlier
    event or scan), return False without doing any work. Otherwise
    copy via :func:`copy_marker_image_to_cache` and mark seen.

    Returns True iff a NEW file was successfully cached on this call.
    Used by:
      * :func:`scan_once` (one call per file in the rglob walk)
      * the watchdog event handler
        (:class:`_ImageCacheEventHandler`) — one call per OS event
    """
    if path in _seen:
        return False
    if not path.is_file():
        return False
    if path.suffix.lower() not in ALLOWED_SUFFIXES:
        _seen.add(path)
        return False
    sess = path.parent.name
    try:
        copy_marker_image_to_cache(str(path), sess)
    except Exception:  # noqa: BLE001
        logger.exception("watcher: failed to cache %s", path)
        # Don't add to _seen so a transient error retries next pass.
        return False
    _seen.add(path)
    return True


def scan_once() -> int:
    """Walk every file under ``~/.claude/image-cache/`` and ensure it
    has been copied into the permanent cache. Returns the count of
    paths newly handled this pass (i.e. not in ``_seen`` before).

    Used by:
      * :func:`run_watcher` (initial warm pass + periodic backstop)
      * the ``claude-explorer warm-cc-cache`` CLI command
      * the FastAPI lifespan task that fires once at startup

    Side effect: also runs the search-index drift-detection pass
    (:func:`backend.search_index.update_drifted_files`). Co-locating
    the two passes here means the backstop catches both
    image-cache and search-index drift in one shot. Failures in
    each pass are isolated by their own try/except so an
    image-cache error can't break search and vice versa.
    """
    root = _live_image_cache_root()
    handled = 0
    if root.exists():
        for path in root.rglob("*"):
            if handle_one_path(path):
                handled += 1
        if handled:
            logger.info(
                "CC image watcher backstop: handled %d new path(s)",
                handled,
            )

    # Search-index drift pass. Isolated from the image-cache pass —
    # any error here is logged and swallowed; image-cache continues to
    # run regardless.
    try:
        from backend.search_index import get_search_index, update_drifted_files
        from backend.store import ConversationStore

        idx = get_search_index()
        if idx is not None and idx.is_ready():
            updated = update_drifted_files(ConversationStore(), index=idx)
            if updated:
                logger.info(
                    "search index drift pass: re-indexed %d file(s)", updated
                )
    except Exception:  # noqa: BLE001
        logger.exception("watcher: search-index drift pass failed")

    return handled


def reset_seen_for_tests() -> None:
    """Test hook: clear the process-level _seen set so back-to-back
    scans re-process the same paths. Production code should never call
    this."""
    _seen.clear()


# ---------------------------------------------------------------------------
# Event-driven path
# ---------------------------------------------------------------------------

# Imported lazily so a missing watchdog wheel (extremely unusual on
# supported platforms — it ships wheels for everything ≥ Python 3.7)
# doesn't break the polling fallback. See _try_start_observer.

def _build_event_handler():
    """Return a watchdog FileSystemEventHandler that funnels events
    through :func:`handle_one_path`. Lazy import so test environments
    without watchdog can still exercise the polling path.

    Handles ``on_created`` AND ``on_modified`` because some editors /
    file copy operations fire either or both. ``on_moved`` covers the
    "atomic rename into cache" pattern. The shared ``_seen`` memo
    plus ``handle_one_path``'s idempotency means redundant events
    are cheap.
    """
    from watchdog.events import FileSystemEventHandler

    class _ImageCacheEventHandler(FileSystemEventHandler):
        def _handle(self, src: str) -> None:
            try:
                handle_one_path(Path(src))
            except Exception:  # noqa: BLE001
                logger.exception("watcher event handler failed for %s", src)

        def on_created(self, event) -> None:  # type: ignore[no-untyped-def]
            if not event.is_directory:
                self._handle(event.src_path)

        def on_modified(self, event) -> None:  # type: ignore[no-untyped-def]
            if not event.is_directory:
                self._handle(event.src_path)

        def on_moved(self, event) -> None:  # type: ignore[no-untyped-def]
            if not event.is_directory and getattr(event, "dest_path", None):
                self._handle(event.dest_path)

    return _ImageCacheEventHandler()


def _try_start_observer():
    """Build and start a watchdog Observer on the live image-cache
    root. Returns the started Observer or None on any failure
    (missing wheel, sandboxed Python, NFS mount, etc.). The caller
    falls back to polling-only if None.
    """
    try:
        from watchdog.observers import Observer
    except ImportError:
        logger.warning(
            "CC image watcher: watchdog not installed; falling back "
            "to pure polling. Install with `pip install watchdog`."
        )
        return None

    root = _live_image_cache_root()
    # We need the dir to exist BEFORE Observer.schedule, otherwise
    # we'd silently fail to register a watch. Create it eagerly; CC
    # will populate it on first paste / tool result.
    try:
        root.mkdir(parents=True, exist_ok=True)
    except Exception:  # noqa: BLE001
        logger.exception(
            "CC image watcher: failed to create %s; events disabled", root,
        )
        return None

    handler = _build_event_handler()
    observer = Observer()
    observer.schedule(handler, str(root), recursive=True)
    try:
        observer.start()
    except Exception:  # noqa: BLE001
        logger.exception(
            "CC image watcher: Observer failed to start; falling back "
            "to pure polling",
        )
        return None

    backend_name = type(observer).__name__
    logger.info(
        "CC image watcher: event-driven Observer started (%s) on %s",
        backend_name, root,
    )
    return observer


async def run_watcher(stop_event: asyncio.Event) -> None:
    """Run the watcher until ``stop_event`` is set.

    Lifecycle:
      1. Eager initial :func:`scan_once` — catch anything already on
         disk before the Observer is even started.
      2. Start a watchdog Observer for sub-second event-driven
         capture. If that fails for any reason (missing wheel,
         sandboxed Python, mount type without inotify support,
         etc.) we keep going with poll-only — strictly worse
         latency, same correctness.
      3. Periodic backstop loop: every ``SCAN_INTERVAL_SEC`` seconds
         (default 600s = 10 min) run :func:`scan_once` again to
         catch any events the OS dropped or coalesced.
      4. On ``stop_event``, cleanly stop the Observer (with a
         bounded join timeout) and return.

    Spawned as a background task by FastAPI's lifespan hook, and as
    the supervised process started by ``claude-explorer install-watcher``.
    """
    logger.info(
        "CC image watcher starting; backstop_interval=%.0fs root=%s",
        SCAN_INTERVAL_SEC,
        _live_image_cache_root(),
    )

    # Eager first pass before events start, so any pre-existing files
    # are captured even if events would have missed them on launch.
    try:
        scan_once()
    except Exception:  # noqa: BLE001
        logger.exception("CC image watcher initial scan failed")

    observer = _try_start_observer()

    while not stop_event.is_set():
        try:
            await asyncio.wait_for(
                stop_event.wait(), timeout=SCAN_INTERVAL_SEC
            )
            # If we exit the wait without TimeoutError, stop_event was set.
            break
        except asyncio.TimeoutError:
            pass
        try:
            scan_once()
        except Exception:  # noqa: BLE001
            logger.exception("CC image watcher backstop scan failed")

    if observer is not None:
        try:
            observer.stop()
            observer.join(timeout=5)
        except Exception:  # noqa: BLE001
            logger.exception("CC image watcher Observer shutdown failed")

    logger.info("CC image watcher stopped")
