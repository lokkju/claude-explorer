"""FastAPI application for Claude Explorer."""

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import get_settings, migrate_legacy_data_dir, read_env
from .routers import conversations, search, export, config, fetch, bookmarks, orgs, files, preferences


log = logging.getLogger(__name__)


def _resolve_static_dir() -> Path | None:
    """Locate the bundled frontend assets, or return None if absent.

    Resolution order:
      1. **Installed mode**: ``<backend package>/_static/`` — written by the
         hatch build hook during ``uv build``. This is what end users get
         from PyPI wheels.
      2. **Dev mode**: ``<repo_root>/frontend/dist/`` — written by
         ``npm run build`` in the frontend dir. Lets contributors run
         ``uv run uvicorn backend.main:app`` against a locally-built bundle
         without re-running ``uv build``.

    Returns the first directory containing ``index.html``, or None if
    neither exists (API-only mode).
    """
    # 1. Installed-wheel location (bundled by hatch_build.py).
    installed = Path(__file__).resolve().parent / "_static"
    if (installed / "index.html").is_file():
        return installed

    # 2. Repo dev location.
    repo_dev = Path(__file__).resolve().parent.parent / "frontend" / "dist"
    if (repo_dev / "index.html").is_file():
        return repo_dev

    return None


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
    # V1 data-dir rename migration: ~/.claude-exporter/ -> ~/.claude-explorer/.
    # MUST run BEFORE the first get_settings() call so the cached Settings
    # picks up the new path. Idempotent and best-effort — see
    # backend.config.migrate_legacy_data_dir for full semantics.
    migrate_legacy_data_dir()

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
    # a background task retry. Skip entirely with
    # CLAUDE_EXPLORER_SKIP_MIGRATION=1 (or legacy CLAUDE_EXPORTER_SKIP_MIGRATION).
    migration_task: asyncio.Task | None = None
    if read_env(
        "CLAUDE_EXPLORER_SKIP_MIGRATION", "CLAUDE_EXPORTER_SKIP_MIGRATION"
    ) == "1":
        log.info("Skipping lifespan migration (CLAUDE_EXPLORER_SKIP_MIGRATION=1).")
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
    if read_env(
        "CLAUDE_EXPLORER_DISABLE_CC_WATCHER", "CLAUDE_EXPORTER_DISABLE_CC_WATCHER"
    ) != "1":
        from backend.cc_image_watcher import run_watcher

        watcher_task = asyncio.create_task(run_watcher(watcher_stop))

    # Auto-warm the CC image cache: walk every CC session JSONL and
    # ensure referenced [Image: source: ...] files are copied to the
    # permanent cache. Catches the case where a user has CC sessions
    # they haven't yet opened in the explorer (the lazy per-render
    # copy at /api/cc-image only triggers on view). Runs in the
    # background — non-blocking, so the server is up immediately.
    # User can never lose images to "I forgot to run warm-cc-cache".
    #
    # 5-second head-start so the first /api/conversations request
    # lands before this scan starts walking every JSONL byte for
    # `[Image: source: ...]` markers. The scan is ~10s of contended
    # disk reads on a ~1k-session corpus and competes directly with
    # the request's metadata read. Same trade as the FTS5 build:
    # image protection latency shifts from t≈0 to t≈5s, invisible
    # against typical user behavior. See PLANS/OPTIMIZE_COLD_START.md.
    warm_task: asyncio.Task | None = None
    if read_env(
        "CLAUDE_EXPLORER_DISABLE_CC_WARM", "CLAUDE_EXPORTER_DISABLE_CC_WARM"
    ) != "1":
        async def _delayed_warm_all_sessions() -> None:
            await asyncio.sleep(5.0)
            from backend.cc_image_cache import warm_all_sessions_async

            await warm_all_sessions_async()

        warm_task = asyncio.create_task(_delayed_warm_all_sessions())

    # Build the FTS5 search index in the background. Search falls back
    # to the linear-scan path until this completes, so the server is
    # immediately responsive. Set CLAUDE_EXPLORER_DISABLE_SEARCH_INDEX=1
    # (or legacy CLAUDE_EXPORTER_DISABLE_SEARCH_INDEX) to skip
    # (useful when debugging linear-scan equivalence).
    #
    # We use print() not log.info() because uvicorn's default log
    # config doesn't propagate to ``backend`` package loggers (the
    # existing "Data directory:" print at lifespan top is the same
    # pattern). The user wants to see "search index build complete"
    # on stdout without configuring a logging.dictConfig.
    search_index_task: asyncio.Task | None = None
    if read_env(
        "CLAUDE_EXPLORER_DISABLE_SEARCH_INDEX",
        "CLAUDE_EXPORTER_DISABLE_SEARCH_INDEX",
    ) != "1":
        async def _build_search_index() -> None:
            # 5-second head-start so the first /api/conversations request
            # (~85ms warm, ~225ms even on cold restart with the other
            # heavy tasks deferred) lands BEFORE the FTS5 build starts
            # hogging disk + CPU. The FTS5 build's
            # `get_all_conversations_raw(source="all", full_content=True)`
            # is the dominant cold-start contention source: it loads
            # every message of every conversation into memory and the
            # walk takes ~10s of contended disk reads. With a 500ms
            # delay the request lands during peak contention (~10s
            # observed); with a 5s delay the request gets clear runway.
            #
            # UX trade: search readiness shifts from t≈10s post-restart
            # to t≈15s — invisible against typical user behavior (people
            # don't ⌘+K within 10 seconds of opening the app). Search
            # falls back to the linear-scan path until the build
            # completes, so search never goes "down".
            #
            # See PLANS/OPTIMIZE_COLD_START.md.
            await asyncio.sleep(5.0)
            try:
                from backend.search_index import build_full_index, get_search_index
                from backend.store import ConversationStore

                idx = get_search_index()
                if idx is None:
                    print(
                        "search index: skipped (FTS5 not available in sqlite3)",
                        flush=True,
                    )
                    return
                files, msgs = await asyncio.to_thread(
                    build_full_index, ConversationStore(), index=idx
                )
                print(
                    f"search index build complete: {files} files / {msgs} messages",
                    flush=True,
                )
            except Exception as exc:  # noqa: BLE001
                print(
                    f"search index: initial build failed: {exc!r}",
                    flush=True,
                )

        search_index_task = asyncio.create_task(_build_search_index())

    # Initialize the sidebar metadata cache and wipe it if the source
    # hash of read_conversation_summary_fast has changed since the last
    # process start. Cheap (one SELECT + maybe one DELETE) so we run
    # synchronously rather than spawning a task — finishes before the
    # first /api/conversations request comes in. Failures are non-fatal:
    # the metadata path falls back to the legacy sequential reader if
    # the cache module returns None.
    try:
        from backend.summary_cache import get_summary_cache
        from backend.claude_code_reader import LOGIC_VERSION

        summary_cache = get_summary_cache()
        if summary_cache is not None:
            wiped = await asyncio.to_thread(
                summary_cache.clear_on_logic_mismatch, LOGIC_VERSION
            )
            if wiped:
                print(
                    "summary cache: logic version changed; cache wiped",
                    flush=True,
                )
    except Exception as exc:  # noqa: BLE001
        print(
            f"summary cache: startup init failed: {exc!r}",
            flush=True,
        )

    # Eagerly populate the summary cache. Without this, the first
    # /api/conversations request after a cold start (or after the
    # logic-version wipe above) pays the full parallel JSONL re-parse
    # cost — ~1.5s on a ~1,000-session corpus — inline with the
    # request. Spawning the fill at lifespan startup means the first
    # request lands on a warm cache (or, if it races the fill, only
    # pays for the still-unparsed subset).
    #
    # The entire body runs in asyncio.to_thread so the ~1,200 os.stat
    # calls and the ProcessPoolExecutor join don't stall the event
    # loop while other lifespan tasks are still spinning up. Failures
    # are logged and swallowed: a missing cache row just means the
    # request takes the legacy path, same as before this change.
    #
    # Skip via CLAUDE_EXPLORER_DISABLE_SUMMARY_CACHE_WARM=1 (or legacy
    # CLAUDE_EXPORTER_*). See PLANS/OPTIMIZE_COLD_START.md.
    summary_cache_task: asyncio.Task | None = None
    if read_env(
        "CLAUDE_EXPLORER_DISABLE_SUMMARY_CACHE_WARM",
        "CLAUDE_EXPORTER_DISABLE_SUMMARY_CACHE_WARM",
    ) != "1":
        def _sync_build_summary_cache() -> None:
            import os
            import time
            from backend import claude_code_reader as ccr
            from backend.summary_cache import get_summary_cache

            cache = get_summary_cache()
            if cache is None:
                # FTS5 unavailable; fall through to the legacy path on
                # demand. Same gate as the cache singleton itself.
                return
            paths = list(ccr.discover_jsonl_files(get_settings().claude_dir))
            if not paths:
                return
            stat_index: dict = {}
            for p in paths:
                try:
                    stat_index[p] = os.stat(p)
                except OSError:
                    # Vanished between discover and stat; on-demand
                    # path will skip it via the same OSError handler.
                    continue
            cached = cache.get_many(paths, stat_index)
            misses = [p for p in paths if p not in cached and p in stat_index]
            if not misses:
                return
            t0 = time.monotonic()
            # NOTE: resolve _read_summaries_parallel via the module
            # attribute (not a `from … import` at the top of the
            # function) so tests that `patch(...)._read_summaries_parallel`
            # actually see the patched version.
            fresh = ccr._read_summaries_parallel(misses)
            cache.upsert_many(fresh, stat_index)
            elapsed = time.monotonic() - t0
            print(
                f"summary cache: filled {len(fresh)} entries in {elapsed:.2f}s",
                flush=True,
            )

        async def _build_summary_cache() -> None:
            try:
                await asyncio.to_thread(_sync_build_summary_cache)
            except asyncio.CancelledError:
                # Cooperative cancellation during shutdown is fine —
                # any rows already upserted survive in SQLite; the
                # next startup picks up the misses idempotently.
                raise
            except Exception as exc:  # noqa: BLE001
                print(
                    f"summary cache: eager fill failed: {exc!r}",
                    flush=True,
                )

        summary_cache_task = asyncio.create_task(_build_summary_cache())

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
        # Cancel the search-index build task if still running.
        # Idempotent: every conversation it indexed survives in the
        # SQLite file, and the next startup picks up where it left off
        # (the drift-detection pass catches any stragglers).
        if search_index_task is not None and not search_index_task.done():
            search_index_task.cancel()
            try:
                await search_index_task
            except (asyncio.CancelledError, Exception):
                pass
        # Cancel the eager summary-cache fill if still running.
        # Idempotent: any rows already upserted survive in SQLite, and
        # the next startup picks up the remaining misses. The
        # ProcessPoolExecutor inside _read_summaries_parallel is a
        # `with` block, so its __exit__ joins workers before the
        # threadpool thread returns to asyncio (worst case shutdown
        # blocks for ~1.5s on a cold-corpus startup-then-shutdown).
        if summary_cache_task is not None and not summary_cache_task.done():
            summary_cache_task.cancel()
            try:
                await summary_cache_task
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


@app.get("/api/info")
async def api_info():
    """API metadata endpoint.

    Lives at /api/info (not /) so that / can serve the SPA when bundled
    assets are present. The previous JSON-at-root behavior moved here in
    the v0.1.0 PyPI packaging migration.
    """
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


# -----------------------------------------------------------------------------
# Static SPA mount + catch-all
# -----------------------------------------------------------------------------
# IMPORTANT: these routes are registered AFTER all /api/* routers + /docs +
# /openapi.json so that FastAPI's first-match-wins ordering routes API
# traffic correctly. The catch-all also explicitly rejects /api/* and the
# OpenAPI surface to belt-and-suspenders the ordering guarantee.

_STATIC_DIR = _resolve_static_dir()

if _STATIC_DIR is not None:
    # Serve hashed Vite bundle assets verbatim.
    _assets_dir = _STATIC_DIR / "assets"
    if _assets_dir.is_dir():
        app.mount(
            "/assets",
            StaticFiles(directory=_assets_dir),
            name="assets",
        )

    # Anything Vite drops in dist/ that isn't /assets (favicon, vite.svg,
    # robots.txt, etc.) — serve from a single fall-through handler below.

    _RESERVED_PREFIXES = ("api/", "docs", "redoc", "openapi.json", "health")

    @app.get("/")
    async def _spa_root() -> FileResponse:
        return FileResponse(_STATIC_DIR / "index.html")

    @app.get("/{full_path:path}")
    async def _spa_catchall(full_path: str) -> FileResponse:
        """Serve static files for known paths, else fall through to index.html
        so client-side React routing works for deep links.

        Explicit /api/, /docs, /openapi.json rejection is defense-in-depth:
        FastAPI's route order already routes those before this catch-all,
        but if a developer reorders router registration in the future this
        guards against returning the SPA HTML for a missing API endpoint.
        """
        if any(full_path == p or full_path.startswith(p) for p in _RESERVED_PREFIXES):
            raise HTTPException(status_code=404)
        # If a real file exists (e.g. vite.svg at the repo dist root),
        # serve it. Otherwise serve index.html for the SPA's client router.
        candidate = _STATIC_DIR / full_path
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(_STATIC_DIR / "index.html")
else:
    log.warning(
        "UI assets not found at %s or %s; backend will run as API-only. "
        "Run `npm run build` in frontend/ for dev mode, or install a "
        "pre-built wheel for end-user usage.",
        Path(__file__).resolve().parent / "_static",
        Path(__file__).resolve().parent.parent / "frontend" / "dist",
    )

    # Preserve the legacy JSON-at-root behavior so anyone scripting against
    # `/` still gets something useful in API-only mode.
    @app.get("/")
    async def _root_json() -> dict:
        return {
            "name": "Claude Explorer",
            "version": "0.1.0",
            "docs": "/docs",
            "ui": "not bundled — install from PyPI or run `npm run build` in frontend/",
        }