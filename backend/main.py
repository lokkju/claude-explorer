"""FastAPI application for Claude Explorer."""

import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .routers import conversations, search, export, config, fetch, bookmarks, orgs, files, preferences


log = logging.getLogger(__name__)


# Telemetry surfaced by /api/health when the lifespan migration repeatedly
# fails to acquire the .fetch.lock — see NEW4-P1-C.
_migration_state: dict = {
    "status": "pending",  # pending | done | deferred | stuck
    "attempts": 0,
    "last_error": None,
    "holder": None,
}


async def _lifespan_migration_task(data_dir, credentials_path) -> None:
    """Background task that runs migrate_to_v2 with retry-on-lock-contention.

    Per NEW3-P0-B + NEW4-P1-C:
      * Each iteration first checks for the sentinel and exits early if present.
      * On LockContentionError, sleep 60s and retry.
      * After 5 consecutive lock-contention failures, set status='stuck' and
        keep retrying — so /api/health can surface a banner suggesting
        `claude-explorer unlock-fetch`.
      * Cancellation by the lifespan teardown is honored.
    """
    from fetcher.migrate_to_v2 import (
        LockContentionError,
        MIGRATION_SENTINEL,
        migrate_to_v2,
    )

    sentinel_path = data_dir / MIGRATION_SENTINEL
    consecutive_failures = 0

    while True:
        if sentinel_path.exists():
            _migration_state["status"] = "done"
            return
        try:
            # Run the (synchronous) migration in a thread so we don't block
            # the event loop.
            await asyncio.to_thread(
                migrate_to_v2,
                data_dir=data_dir,
                credentials_path=credentials_path,
                lock_command="lifespan_migrate",
            )
            _migration_state["status"] = "done"
            _migration_state["attempts"] += 1
            log.info("Lifespan migration complete.")
            return
        except LockContentionError as e:
            _migration_state["attempts"] += 1
            consecutive_failures += 1
            _migration_state["last_error"] = str(e)
            _migration_state["status"] = (
                "stuck" if consecutive_failures >= 5 else "deferred"
            )
            log.warning(
                "Lifespan migration deferred (attempt %d, consecutive_failures=%d): %s",
                _migration_state["attempts"], consecutive_failures, e,
            )
            try:
                await asyncio.sleep(60)
            except asyncio.CancelledError:
                raise
        except Exception as e:
            # Any other error — log and stop. The user can run
            # `claude-explorer migrate` to retry manually.
            _migration_state["status"] = "stuck"
            _migration_state["last_error"] = str(e)
            log.error("Lifespan migration failed: %s", e, exc_info=True)
            return


def get_migration_state() -> dict:
    """Return a snapshot of the migration telemetry for /api/health."""
    return dict(_migration_state)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    # Startup: verify data directory exists
    settings = get_settings()
    if not settings.data_dir.exists():
        print(f"Warning: Data directory does not exist: {settings.data_dir}")
        print("Creating directory...")
        settings.data_dir.mkdir(parents=True, exist_ok=True)
    else:
        print(f"Data directory: {settings.data_dir}")

    # cowork-multi-org C4 (NEW2-P0-α + NEW3-P0-B + NEW4-P1-C):
    # Run migrate_to_v2 at startup. If the lock can't be acquired (a CLI
    # fetch is in progress), don't block startup — start the server and let
    # a background task retry. Skip entirely with CLAUDE_EXPORTER_SKIP_MIGRATION=1.
    migration_task: asyncio.Task | None = None
    if os.environ.get("CLAUDE_EXPORTER_SKIP_MIGRATION") == "1":
        log.info("Skipping lifespan migration (CLAUDE_EXPORTER_SKIP_MIGRATION=1).")
        _migration_state["status"] = "skipped"
    else:
        from fetcher.migrate_to_v2 import (
            LockContentionError,
            MIGRATION_SENTINEL,
            migrate_to_v2,
        )
        from fetcher.credentials import DEFAULT_CREDENTIALS_PATH

        sentinel_path = settings.data_dir / MIGRATION_SENTINEL
        if sentinel_path.exists():
            _migration_state["status"] = "done"
        else:
            # First, try a quick synchronous attempt with a short timeout.
            # Most users hit this path and it completes instantly.
            try:
                await asyncio.to_thread(
                    migrate_to_v2,
                    data_dir=settings.data_dir,
                    credentials_path=DEFAULT_CREDENTIALS_PATH,
                    timeout_seconds=10.0,
                    lock_command="lifespan_migrate",
                )
                _migration_state["status"] = "done"
                _migration_state["attempts"] = 1
                log.info("Lifespan migration complete.")
            except LockContentionError as e:
                # Lock held by a CLI fetch. Don't block startup; retry in
                # the background.
                log.warning(
                    "Lifespan migration deferred: .fetch.lock held; retrying in background. (%s)", e
                )
                _migration_state["status"] = "deferred"
                _migration_state["attempts"] = 1
                _migration_state["last_error"] = str(e)
                migration_task = asyncio.create_task(
                    _lifespan_migration_task(settings.data_dir, DEFAULT_CREDENTIALS_PATH)
                )
            except Exception as e:
                # Any other error — log and continue. Legacy fallback in
                # store.py keeps conversations visible.
                log.error("Lifespan migration failed: %s", e, exc_info=True)
                _migration_state["status"] = "stuck"
                _migration_state["last_error"] = str(e)

    # Spawn the CC image-cache watcher. Polls ~/.claude/image-cache/
    # every few seconds and copies new files to the permanent cache
    # before Claude Code rotates them. Best-effort: any internal error
    # is logged and swallowed.
    watcher_stop = asyncio.Event()
    watcher_task: asyncio.Task | None = None
    if os.environ.get("CLAUDE_EXPORTER_DISABLE_CC_WATCHER") != "1":
        from backend.cc_image_watcher import run_watcher

        watcher_task = asyncio.create_task(run_watcher(watcher_stop))

    # Auto-warm the CC image cache: walk every CC session JSONL and
    # ensure referenced [Image: source: ...] files are copied to the
    # permanent cache. Catches the case where a user has CC sessions
    # they haven't yet opened in the explorer (the lazy per-render
    # copy at /api/cc-image only triggers on view). Runs in the
    # background — non-blocking, so the server is up immediately.
    # User can never lose images to "I forgot to run warm-cc-cache".
    warm_task: asyncio.Task | None = None
    if os.environ.get("CLAUDE_EXPORTER_DISABLE_CC_WARM") != "1":
        from backend.cc_image_cache import warm_all_sessions_async

        warm_task = asyncio.create_task(warm_all_sessions_async())

    try:
        yield
    finally:
        # Shutdown: cancel the retry task cleanly.
        if migration_task is not None and not migration_task.done():
            migration_task.cancel()
            try:
                await migration_task
            except (asyncio.CancelledError, Exception):
                pass
        # Cooperative shutdown for the CC image watcher.
        if watcher_task is not None and not watcher_task.done():
            watcher_stop.set()
            try:
                await asyncio.wait_for(watcher_task, timeout=2.0)
            except (asyncio.CancelledError, asyncio.TimeoutError, Exception):
                watcher_task.cancel()
        # Cancel the auto-warm task if it's still running at shutdown.
        # Best-effort — partial warm pass is fine, the next startup
        # will pick up where it left off (idempotent).
        if warm_task is not None and not warm_task.done():
            warm_task.cancel()
            try:
                await warm_task
            except (asyncio.CancelledError, Exception):
                pass


app = FastAPI(
    title="Claude Explorer",
    description="API for browsing and exporting Claude Desktop conversations",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS middleware for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers under /api prefix
app.include_router(conversations.router, prefix="/api")
app.include_router(search.router, prefix="/api")
app.include_router(export.router, prefix="/api")
app.include_router(config.router, prefix="/api")
app.include_router(fetch.router, prefix="/api")
app.include_router(bookmarks.router, prefix="/api")
app.include_router(preferences.router, prefix="/api")
app.include_router(orgs.router, prefix="/api")
app.include_router(files.router, prefix="/api")


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "name": "Claude Explorer",
        "version": "0.1.0",
        "docs": "/docs",
    }


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "healthy"}


@app.get("/api/health")
async def api_health():
    """Health endpoint with migration telemetry (NEW4-P1-C)."""
    state = get_migration_state()
    return {
        "status": "healthy",
        "migration": state,
        "migration_stuck": state.get("status") == "stuck",
    }