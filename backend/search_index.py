"""SQLite FTS5 inverted index for full-text search.

Replaces the linear-scan search path (``backend/search.py``) for queries that
can be answered by a token-based inverted index. The linear-scan code remains
as the fallback whenever the index is unavailable, not yet built, or returns
a SQLite error.

Architecture (Scatter-Gather):
    The FTS5 index is used purely as an inverted index — it returns
    ``(conv_uuid, message_uuid)`` tuples for matched messages and nothing
    else. The body text is NOT pulled across the SQLite/Python boundary.
    The query path then loads each matched conversation from
    :class:`backend.cache.FileCache` (already warm from listing/rendering)
    and runs the existing :func:`backend.search.create_snippet` on the
    flattened message text. This guarantees the response is byte-for-byte
    compatible with the linear-scan path: same snippet boundaries, same
    title pseudo-message, same sort order, same ``MessageSnippet`` shape.

Lifecycle:
    1. **Initial build**: a background task in the FastAPI lifespan calls
       :func:`build_full_index`, which walks every JSON/JSONL file via
       ``store.get_all_conversations_raw()`` and inserts rows.
    2. **Incremental updates**: the existing CC image watcher
       (``backend/cc_image_watcher.py``) calls :func:`update_drifted_files`
       once per scan pass (5s). Mtime check short-circuits no-op cases.
    3. **Drift safety**: every search query, if the index is ready, queries
       it directly. The watcher catches any drift on its next pass.
    4. **Fallback**: if the index isn't ready (initial build still running)
       OR FTS5 isn't available in this sqlite3 build OR a sqlite3.Error
       fires at query time, the search code falls back to linear scan.

Schema:
    See :data:`SCHEMA_SQL`. Bumping :data:`SCHEMA_VERSION` causes a full
    drop+rebuild on next open.

Threading:
    Read connections are per-thread via ``threading.local()`` (FastAPI
    runs sync route handlers in a thread pool). Writes go through a
    single dedicated connection guarded by ``threading.Lock``. WAL mode
    lets readers proceed concurrently with the writer without blocking.
"""

from __future__ import annotations

import logging
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Callable, Literal

from .config import get_settings
from .search import _extract_searchable_text


logger = logging.getLogger(__name__)


# Bump to force a full drop+rebuild on next open. Used when the schema
# below changes in a way the existing data can't satisfy.
#
# IMPORTANT: bumping this triggers a drop+rebuild only when the
# `SearchIndex` constructor next runs — i.e. on the NEXT PROCESS START.
# A running uvicorn worker that hot-reloads only the Python source will
# NOT pick up the version change until restart. In dev with
# `--reload`, uvicorn restarts workers on .py edits, so this is
# sufficient. In production, deploying new code restarts the workers.
# A documented manual escape hatch (`claude-explorer reindex-search`)
# also forces a fresh rebuild without bumping.
#
# Version history:
#   * v1: initial FTS5 index over message text + content blocks.
#   * v2 (2026-05-12, V1 polish round 3): also indexes the
#     `slash_command` field on CC command markers so searches for
#     `/coding` (literal) or `coding` (FTS5 token) hit the marker
#     bubble even when the user's args body doesn't contain the word.
#   * v3 (2026-05-13, V1 polish): `thinking` content blocks are no
#     longer indexed (see backend/search.py:_extract_searchable_text).
#     Bumping the version forces a one-time rebuild on next startup so
#     stale entries with thinking-only token matches don't poison FTS5
#     top-N ranking (e.g., a thinking-only hit displacing a real prose
#     match from the top 5000). Index rebuild is non-blocking via the
#     existing lifespan task.
#   * v4 (2026-05-13, V1 polish cleanup): argless command markers
#     (`is_command_marker=True` — `/exit`, `/clear`, `/compact`,
#     plus leading-prelude rows) are no longer indexed. They're
#     chrome that the viewer hides behind SessionPreludeAffordance /
#     SlashCommandBadge and the export surfaces drop via
#     export._is_excludable_marker; mirroring that exclusion in
#     search closes the "one truth, three surfaces" invariant.
#     Argful markers (`/coding <prose>`, `/plan <prose>`) carry
#     is_command_marker=False and continue to be searchable on
#     both the user's prose body and the slash_command token.
#     Bumping the version forces a one-time rebuild on next startup
#     so existing argless-marker body rows in the index get cleared.
#   * v5 (2026-05-14, sidebar-scope propagation): adds an
#     ``organization_id UNINDEXED`` column so the workspace dropdown
#     can narrow search results in SQL (mirrors how source and
#     project_path already work). Bumping the version forces a one-
#     time rebuild so the new column gets populated for every row.
#     Cost: ~36 chars per row UNINDEXED — negligible. The lifespan
#     task (backend/main.py:253, asyncio.to_thread) makes the
#     rebuild non-blocking; queries fall back to linear scan during
#     the rebuild window.
SCHEMA_VERSION = 5


# ``messages`` is the FTS5 virtual table. UNINDEXED columns store metadata
# we want to retrieve / filter on without paying the inverted-index cost.
# ``title`` and ``body`` are the only indexed columns. With FTS5's default
# ``MATCH`` semantics, an unqualified query searches both — which is what
# we want (the linear-scan path also matches both).
#
# ``indexed_files`` tracks which on-disk files we've already indexed and
# the mtime they had at indexing time. The drift-detection pass uses this
# to decide which files need re-upserting.
#
# ``schema_version`` holds a single integer row. Comparing it to
# :data:`SCHEMA_VERSION` at open time triggers a drop+rebuild on mismatch.
SCHEMA_SQL = """
CREATE VIRTUAL TABLE IF NOT EXISTS messages USING fts5(
    conv_uuid UNINDEXED,
    message_uuid UNINDEXED,
    sender UNINDEXED,
    created_at UNINDEXED,
    source UNINDEXED,
    project_path UNINDEXED,
    organization_id UNINDEXED,
    title,
    body,
    tokenize = "porter unicode61 remove_diacritics 1"
);

CREATE TABLE IF NOT EXISTS indexed_files (
    path TEXT PRIMARY KEY,
    mtime REAL NOT NULL,
    indexed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER NOT NULL
);
"""


# Match FTS5 reserved-keyword tokens that, if a user typed them
# unquoted, would be interpreted as query operators. The escape function
# below quotes EVERY token, so this is mostly defensive — but if the
# escape policy ever changes, this list documents the trap.
_FTS5_OPERATORS = {"AND", "OR", "NOT", "NEAR"}


def fts5_available() -> bool:
    """Probe whether the local sqlite3 build supports FTS5.

    macOS Homebrew Python (3.11+) and the python.org installer ship FTS5
    by default. Some Linux distros' system Python builds do not. If FTS5
    is missing, the caller MUST fall back to linear scan.
    """
    try:
        with sqlite3.connect(":memory:") as conn:
            conn.execute("CREATE VIRTUAL TABLE _probe USING fts5(c)")
        return True
    except sqlite3.OperationalError:
        return False


def default_index_path() -> Path:
    """Return the canonical on-disk index location.

    Lives at ``<data_dir>.parent / "search-index.sqlite"`` so it's a sibling
    of the conversations dir (typically ``~/.claude-explorer/``). Same
    pattern the preferences file uses.
    """
    return get_settings().data_dir.parent / "search-index.sqlite"


def translate_query(user_query: str) -> str:
    """Translate a free-form user query into an FTS5 MATCH expression.

    Modes:
      * **Phrase mode** — when the user wraps the whole query in double
        quotes (e.g. ``"foo bar baz"``), emit a single FTS5 phrase
        ``"foo bar baz"`` so MATCH requires the tokens to be adjacent
        in order. No trailing wildcard (an exact phrase shouldn't
        morph as the user types).
      * **Token mode** — unquoted whitespace-separated tokens are each
        quoted (defends FTS5 reserved keywords ``AND/OR/NOT/NEAR`` and
        punctuation) and AND'd. The LAST token gets a ``*`` prefix
        wildcard so search-as-you-type matches: typing ``"pyth"`` finds
        ``"python"``. A single-character last token does NOT get a
        wildcard — FTS5 prefix queries on single letters explode the
        result set.

    Internal ``"`` characters in tokens are doubled so FTS5's phrase
    grammar stays valid.

    Returns the empty string if the user query has no usable tokens; the
    caller treats that as "no query" and skips the SQL.
    """
    stripped = user_query.strip()
    if not stripped:
        return ""

    # Phrase mode: leading + trailing " and at least one char inside.
    if len(stripped) >= 3 and stripped[0] == '"' and stripped[-1] == '"':
        inner = stripped[1:-1].strip()
        if inner:
            clean = inner.replace('"', '""')
            return f'"{clean}"'

    tokens = stripped.split()
    if not tokens:
        return ""

    parts: list[str] = []
    last_idx = len(tokens) - 1
    for i, tok in enumerate(tokens):
        clean = tok.replace('"', '""')
        if i == last_idx and len(tok) >= 2:
            # Trailing prefix wildcard for search-as-you-type.
            parts.append(f'"{clean}" *')
        else:
            parts.append(f'"{clean}"')
    return " AND ".join(parts)


class SearchIndex:
    """A single SQLite/FTS5 file-backed inverted index.

    One instance per index file. The module-level :func:`get_search_index`
    singleton wraps this for the canonical location.
    """

    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)

        # Per-thread read connections. SQLite forbids sharing a connection
        # across threads by default; check_same_thread=False relaxes that
        # but still doesn't make a single connection safe under concurrent
        # access. The robust pattern is one connection per thread.
        self._read_local = threading.local()

        # Single dedicated write connection guarded by a lock. WAL mode
        # ensures readers don't block on this writer.
        #
        # NOTE: we deliberately do NOT pass isolation_level=None here.
        # Python's sqlite3 default ("legacy" mode) auto-BEGINs a deferred
        # transaction before DML statements, and ``with conn:`` commits on
        # success / rolls back on exception. That's exactly the
        # crash-safety we need for upsert_conversation's DELETE+INSERT.
        # In autocommit (isolation_level=None) ``with conn:`` is a no-op
        # so a failed INSERT after a successful DELETE would leave the
        # rows GONE. A failing test in test_search_index.py
        # (test_upsert_rollback_on_executemany_failure) pins this.
        self._write_conn = sqlite3.connect(
            str(self.path),
            check_same_thread=False,
        )
        self._write_lock = threading.Lock()

        # Configure WAL + sensible pragmas. Done on the write connection
        # but applies to the whole database file.
        self._write_conn.execute("PRAGMA journal_mode = WAL")
        self._write_conn.execute("PRAGMA synchronous = NORMAL")
        self._write_conn.execute("PRAGMA temp_store = MEMORY")

        # _is_ready toggles to True after the first full build pass
        # finishes. Queries fall back to linear scan while this is False.
        self._is_ready = False
        # Set to False during a destructive schema migration so in-flight
        # queries fall back gracefully while the rebuild runs.
        self._schema_ok = True

        self._init_schema()

    # ----- schema ----------------------------------------------------

    # Expected user-facing columns of the ``messages`` FTS5 table for the
    # current SCHEMA_VERSION. Used at open time to detect when an on-disk
    # ``messages`` table predates the current code (column-level drift),
    # which the version-row check alone can miss — see below.
    _EXPECTED_MESSAGES_COLS = frozenset({
        "conv_uuid", "message_uuid", "sender", "created_at",
        "source", "project_path", "organization_id",
        "title", "body",
    })

    def _init_schema(self) -> None:
        """Create tables if missing; drop+rebuild if the on-disk schema
        doesn't match the current code.

        We trigger a drop+rebuild on ANY of:

          * the ``schema_version`` row is missing (legitimately fresh DB
            falls into this branch too — drop+rebuild on an empty file is
            cheap and ensures a clean state);
          * the ``schema_version`` row doesn't equal ``SCHEMA_VERSION``;
          * the existing ``messages`` table's column set doesn't match
            ``_EXPECTED_MESSAGES_COLS`` (defensive: catches the historical
            bug where a prior process stamped the version row but failed
            to actually rebuild the table, leaving the DB in a state where
            ``upsert_conversation`` raises "no column named X" forever
            because the version-row check declares the schema "current").

        On rebuild we set ``_schema_ok=False`` BEFORE the DROP so any
        concurrent query falls back to linear scan instead of seeing a
        half-rebuilt index. Once the rebuild finishes we restore the flag
        but leave ``_is_ready=False`` until :func:`build_full_index`
        completes its first pass.
        """
        with self._write_lock:
            cur = self._write_conn.cursor()

            # Inspect what's actually on disk BEFORE running CREATE IF NOT
            # EXISTS — otherwise we'd lose the ability to distinguish a
            # genuinely fresh DB from a stale-tables-without-version-row
            # case. ``PRAGMA table_info`` works on FTS5 virtual tables and
            # returns the user-defined column list.
            existing_cols = {
                r[1] for r in cur.execute("PRAGMA table_info(messages)").fetchall()
            }

            # ``schema_version`` may not exist yet on a fresh file; guard
            # the SELECT with a table-existence check.
            sv_exists = cur.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_version'"
            ).fetchone() is not None
            row = (
                cur.execute("SELECT version FROM schema_version LIMIT 1").fetchone()
                if sv_exists else None
            )

            cols_ok = (not existing_cols) or existing_cols == self._EXPECTED_MESSAGES_COLS
            version_ok = row is not None and row[0] == SCHEMA_VERSION

            if cols_ok and version_ok:
                # On-disk schema matches; ensure all tables exist (no-op if
                # already there) and we're done.
                cur.executescript(SCHEMA_SQL)
                self._write_conn.commit()
                return

            logger.info(
                "search_index: rebuilding (version on-disk=%s code=%s; messages cols match=%s)",
                row[0] if row else None, SCHEMA_VERSION, existing_cols == self._EXPECTED_MESSAGES_COLS,
            )
            self._schema_ok = False
            try:
                cur.execute("DROP TABLE IF EXISTS messages")
                cur.execute("DROP TABLE IF EXISTS indexed_files")
                cur.execute("DROP TABLE IF EXISTS schema_version")
                cur.executescript(SCHEMA_SQL)
                cur.execute(
                    "INSERT INTO schema_version (version) VALUES (?)", (SCHEMA_VERSION,)
                )
                self._write_conn.commit()
            finally:
                self._schema_ok = True

    # ----- read connections ------------------------------------------

    def _get_read_conn(self) -> sqlite3.Connection:
        """Get the per-thread read connection, creating it on first call."""
        conn = getattr(self._read_local, "conn", None)
        if conn is None:
            conn = sqlite3.connect(
                str(self.path),
                check_same_thread=False,
                isolation_level=None,
            )
            self._read_local.conn = conn
        return conn

    # ----- readiness flags -------------------------------------------

    def is_ready(self) -> bool:
        """True when the index has been fully built at least once and the
        schema is intact. False during initial build or schema migration."""
        return self._is_ready and self._schema_ok

    def mark_ready(self) -> None:
        """Mark the index as queryable. Called by build_full_index after
        the first complete walk."""
        self._is_ready = True

    # ----- writers ---------------------------------------------------

    def upsert_conversation(
        self,
        conv: dict[str, Any],
        file_path: Path,
        mtime: float,
    ) -> int:
        """Insert all messages for one conversation; replace any existing rows.

        Wrapped in a single transaction so a crash mid-upsert leaves either
        the OLD state (rolled back) or the NEW state — never a half-deleted
        conversation. Returns the count of message rows written.
        """
        conv_uuid = conv.get("uuid", "")
        if not conv_uuid:
            return 0

        title = conv.get("name", "") or ""
        source = conv.get("source", "CLAUDE_AI") or "CLAUDE_AI"
        project_path = conv.get("project_path") or ""
        # 2026-05-14 (v5): workspace gate. Empty string ("") for legacy
        # untagged Desktop blobs and for all Claude Code conversations
        # (CC has no workspace concept). The query path treats empty as
        # "no workspace" — only an exact UUID match counts.
        organization_id = conv.get("organization_id") or ""

        rows: list[tuple[str, str, str, str, str, str, str, str, str]] = []
        for msg in conv.get("chat_messages", []) or []:
            body = _extract_searchable_text(msg)
            # We index even messages with empty body so the title-only
            # match still has a stable ``conv_uuid`` to anchor against.
            # Title-only matches are produced by the title column.
            rows.append(
                (
                    conv_uuid,
                    msg.get("uuid", "") or "",
                    msg.get("sender", "") or "",
                    msg.get("created_at", "") or "",
                    source,
                    project_path,
                    organization_id,
                    title,
                    body,
                )
            )

        # If a conversation has no messages we still want a row so a
        # title-only query hits something. Use a sentinel message_uuid.
        if not rows:
            rows.append(
                (
                    conv_uuid, "title", "title", "",
                    source, project_path, organization_id, title, "",
                )
            )

        with self._write_lock:
            with self._write_conn:  # explicit BEGIN; auto-COMMIT or ROLLBACK
                self._write_conn.execute(
                    "DELETE FROM messages WHERE conv_uuid = ?", (conv_uuid,)
                )
                self._write_conn.executemany(
                    "INSERT INTO messages "
                    "(conv_uuid, message_uuid, sender, created_at, source, project_path, organization_id, title, body) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    rows,
                )
                self._write_conn.execute(
                    "INSERT OR REPLACE INTO indexed_files (path, mtime, indexed_at) "
                    "VALUES (?, ?, ?)",
                    (str(file_path), float(mtime), int(time.time())),
                )

        return len(rows)

    def delete_conversation(self, conv_uuid: str, file_path: Path | None = None) -> None:
        """Remove a conversation's rows from the index."""
        with self._write_lock:
            with self._write_conn:
                self._write_conn.execute(
                    "DELETE FROM messages WHERE conv_uuid = ?", (conv_uuid,)
                )
                if file_path is not None:
                    self._write_conn.execute(
                        "DELETE FROM indexed_files WHERE path = ?", (str(file_path),)
                    )

    def delete_by_path(self, file_path: Path) -> None:
        """Remove all rows for a file that no longer exists on disk.

        Used by the drift-cleanup pass: if ``indexed_files`` mentions a
        path that ``os.path.exists`` says is gone, drop both the file
        record and any messages whose source file was that path.
        """
        # We don't have a reverse path→conv_uuid index, so look up the
        # path's conv_uuid via the messages table is not possible (we don't
        # store path on messages). Instead, the indexed_files table is the
        # source of truth for "which files contributed rows": when a file
        # disappears we look up its conv_uuid via the source layout
        # convention (file stem == conv uuid for both Desktop JSONs and CC
        # JSONLs).
        conv_uuid_from_stem = file_path.stem
        with self._write_lock:
            with self._write_conn:
                self._write_conn.execute(
                    "DELETE FROM messages WHERE conv_uuid = ?", (conv_uuid_from_stem,)
                )
                self._write_conn.execute(
                    "DELETE FROM indexed_files WHERE path = ?", (str(file_path),)
                )

    def needs_update(self, file_path: Path, current_mtime: float) -> bool:
        """True if the file isn't indexed or its mtime has changed since."""
        cur = self._write_conn.execute(
            "SELECT mtime FROM indexed_files WHERE path = ?", (str(file_path),)
        )
        row = cur.fetchone()
        if row is None:
            return True
        # mtime equality with float tolerance — if the file was rewritten
        # within the same nanosecond we'd theoretically miss it, but in
        # practice the watcher poll interval (5s) dwarfs any plausible
        # mtime collision.
        return float(row[0]) != float(current_mtime)

    def list_indexed_paths(self) -> list[Path]:
        """All paths currently recorded in ``indexed_files``."""
        cur = self._write_conn.execute("SELECT path FROM indexed_files")
        return [Path(row[0]) for row in cur.fetchall()]

    def clear_all(self) -> None:
        """Wipe all rows. Caller is responsible for a subsequent rebuild."""
        with self._write_lock:
            with self._write_conn:
                self._write_conn.execute("DELETE FROM messages")
                self._write_conn.execute("DELETE FROM indexed_files")

    # ----- query -----------------------------------------------------

    def query(
        self,
        user_query: str,
        *,
        source: Literal["all", "CLAUDE_AI", "CLAUDE_CODE"] = "all",
        conversation_uuid: str | None = None,
        project_path: str | None = None,
        bookmarks: set[str] | None = None,
        organization_id: str | None = None,
        conversation_uuids: set[str] | None = None,
        limit: int = 5000,
    ) -> list[dict[str, Any]]:
        """Run an FTS5 MATCH query and return matched message metadata.

        Returns a list of dicts with keys: ``conv_uuid``, ``message_uuid``,
        ``sender``, ``created_at``. Body text is NOT returned — the caller
        re-loads the conversation from FileCache and runs the existing
        Python snippet logic on it (Scatter-Gather: FTS5 is a pre-filter).

        Filters (all AND'd with the MATCH clause):
          * source: "all" | "CLAUDE_AI" | "CLAUDE_CODE"
          * conversation_uuid: most-specific scope; wins over
            project_path / bookmarks / conversation_uuids
          * project_path: exact match against the conv's project_path
          * bookmarks: restrict to UUIDs in this set
          * organization_id (2026-05-14): workspace gate; UNINDEXED
            equality. None means "no constraint".
          * conversation_uuids (2026-05-14): active-filter set gate.
            Pushed into SQL via a TEMP TABLE join — NOT a Python post-
            filter — to avoid the `top-N-bm25 + post-filter = silent
            drop` correctness bug Council flagged. Empty set returns
            [] immediately. SQLite's SQLITE_MAX_VARIABLE_NUMBER (often
            999) is dodged by the TEMP table approach; bm25 ranking is
            preserved within the allowed set.
        """
        match_expr = translate_query(user_query)
        if not match_expr:
            return []

        # Empty active-filter set → empty results. (Distinct from None
        # which means "no constraint".) This is also short-circuited at
        # the search.py entry point but we re-check here for direct
        # callers of SearchIndex.query.
        if conversation_uuids is not None and not conversation_uuids:
            return []

        clauses: list[str] = ["messages MATCH ?"]
        params: list[Any] = [match_expr]

        # Whether to populate + join allowed_conv. The TEMP table is
        # per-connection (threading.local); _populate_allowed_conv
        # DROPs and recreates it idempotently.
        use_allowed_join = False

        if conversation_uuid is not None:
            clauses.append("conv_uuid = ?")
            params.append(conversation_uuid)
        else:
            if project_path is not None:
                clauses.append("project_path = ?")
                params.append(project_path)
            if bookmarks is not None:
                if not bookmarks:
                    return []
                placeholders = ",".join("?" * len(bookmarks))
                clauses.append(f"conv_uuid IN ({placeholders})")
                params.extend(sorted(bookmarks))
            if conversation_uuids is not None:
                # NOT an IN(?, ?, ...) — that hits SQLITE_MAX_VARIABLE_NUMBER
                # (often 999) on large active-filter sets. Use a TEMP
                # TABLE join instead. bm25 ranking is preserved within
                # the allowed set, which fixes the LIMIT-5000-drift
                # correctness bug Council flagged.
                use_allowed_join = True
                clauses.append("conv_uuid IN (SELECT uuid FROM allowed_conv)")

        if source != "all":
            clauses.append("source = ?")
            params.append(source)
        if organization_id is not None:
            clauses.append("organization_id = ?")
            params.append(organization_id)

        sql = (
            "SELECT conv_uuid, message_uuid, sender, created_at "
            "FROM messages "
            f"WHERE {' AND '.join(clauses)} "
            # bm25() returns negative floats; lower (more negative) = more
            # relevant. ASC order yields top-relevance first.
            "ORDER BY bm25(messages) "
            "LIMIT ?"
        )
        params.append(int(limit))

        conn = self._get_read_conn()
        if use_allowed_join:
            # Populate the TEMP TABLE on this connection BEFORE the
            # query references it. The title-sweep in search._search_via_index
            # also calls _populate_allowed_conv on the same connection
            # (idempotent — reuses the same TEMP table).
            assert conversation_uuids is not None  # narrowed above
            self._populate_allowed_conv(conn, conversation_uuids)

        cur = conn.execute(sql, tuple(params))
        return [
            {
                "conv_uuid": row[0],
                "message_uuid": row[1],
                "sender": row[2],
                "created_at": row[3],
            }
            for row in cur.fetchall()
        ]

    def _populate_allowed_conv(
        self, conn: sqlite3.Connection, uuids: set[str]
    ) -> None:
        """Idempotent populate of the per-connection TEMP TABLE
        ``allowed_conv(uuid TEXT PRIMARY KEY)``.

        Drops + recreates + executemany-inserts. This is called per query
        when ``conversation_uuids`` is set; per-connection means safe
        across threads (each thread has its own threading.local read conn).
        SQLite TEMP tables have ~zero file overhead; the PRIMARY KEY gives
        O(log n) for the JOIN.

        Spec §2 (2026-05-14, Council convergence): we do NOT use
        ``IN (?, ?, ..., ?N)`` because SQLITE_MAX_VARIABLE_NUMBER is
        often 999 on Linux distro builds — 1500-conv corpora would
        error out. The TEMP table avoids that limit AND preserves bm25
        ranking within the allowed set, which fixes the
        ``LIMIT 5000 + post-filter = silent drop`` correctness bug.
        """
        # DROP IF EXISTS then CREATE — order matters. We can't use
        # CREATE TEMP TABLE IF NOT EXISTS + DELETE because if a prior
        # call left rows in place (e.g., the test reused the same
        # connection across cases), DELETE would still need to fire
        # before INSERT, and the round-trip cost is the same as
        # DROP+CREATE. Single-statement is clearer.
        conn.execute("DROP TABLE IF EXISTS allowed_conv")
        conn.execute(
            "CREATE TEMP TABLE allowed_conv (uuid TEXT PRIMARY KEY)"
        )
        conn.executemany(
            "INSERT OR IGNORE INTO allowed_conv (uuid) VALUES (?)",
            [(u,) for u in uuids],
        )

    def stats(self) -> dict[str, int]:
        """Return basic index size counters for diagnostics."""
        cur = self._write_conn.execute("SELECT COUNT(*) FROM messages")
        msg_count = cur.fetchone()[0]
        cur = self._write_conn.execute("SELECT COUNT(*) FROM indexed_files")
        file_count = cur.fetchone()[0]
        return {"messages": msg_count, "files": file_count}

    def close(self) -> None:
        """Close all connections. Idempotent."""
        try:
            self._write_conn.close()
        except sqlite3.Error:
            pass
        # threading.local cleanup happens when the thread dies; we can't
        # walk it from here. Per-thread connections are GC'd at thread end.


# ----- module-level singleton --------------------------------------

# Module-level singleton, mirrors the FileCache pattern in cache.py.
# Set to None when FTS5 isn't available so callers know to fall back.
_search_index: SearchIndex | None = None
_search_index_lock = threading.Lock()


def get_search_index() -> SearchIndex | None:
    """Return the process-wide SearchIndex, or None if FTS5 is unavailable.

    Lazy-initializes on first call. Returns the same instance on every
    subsequent call within this process. Test code may call
    :func:`reset_search_index_for_tests` to reset between tests.
    """
    global _search_index
    if _search_index is not None:
        return _search_index

    with _search_index_lock:
        if _search_index is not None:
            return _search_index
        if not fts5_available():
            logger.warning(
                "search_index: FTS5 not available in this sqlite3 build; "
                "search will use linear-scan fallback"
            )
            return None
        try:
            _search_index = SearchIndex(default_index_path())
        except sqlite3.Error as exc:
            logger.error("search_index: failed to open index: %s", exc, exc_info=True)
            return None
    return _search_index


def reset_search_index_for_tests() -> None:
    """Test-only: reset the module-level singleton.

    Production code MUST NOT call this. Used by pytest fixtures so each
    test starts with a fresh index pointed at its own tmp_path.

    Best-effort close: tests sometimes inject mock objects that don't
    implement ``close()``; we tolerate AttributeError so the fixture
    teardown doesn't crash.
    """
    global _search_index
    if _search_index is not None:
        try:
            _search_index.close()
        except (AttributeError, sqlite3.Error):
            pass
        _search_index = None


# ----- bulk indexing -----------------------------------------------


def _file_path_for_conv(conv: dict[str, Any], data_dir: Path, claude_dir: Path) -> Path | None:
    """Resolve the on-disk path for a conversation dict.

    For Desktop conversations: ``data_dir/by-org/<org>/<uuid>.json`` or
    legacy ``data_dir/<uuid>.json``. For CC sessions: walk
    ``claude_dir/projects/<encoded-cwd>/<uuid>.jsonl``.

    Returns None if no plausible path is found — the conversation will
    still be indexed (we use a synthetic path) but drift detection won't
    fire on it. This shouldn't happen for production data.
    """
    uuid = conv.get("uuid", "")
    if not uuid:
        return None

    source = conv.get("source", "CLAUDE_AI")
    if source == "CLAUDE_CODE":
        # CC files: claude_dir/projects/<encoded-cwd>/<uuid>.jsonl
        projects_dir = claude_dir / "projects"
        if projects_dir.exists():
            for project_dir in projects_dir.iterdir():
                candidate = project_dir / f"{uuid}.jsonl"
                if candidate.exists():
                    return candidate
        return None

    # Desktop: by-org first, legacy flat last.
    by_org = data_dir / "by-org"
    if by_org.exists():
        for org_dir in by_org.iterdir():
            candidate = org_dir / f"{uuid}.json"
            if candidate.exists():
                return candidate
    legacy = data_dir / f"{uuid}.json"
    if legacy.exists():
        return legacy
    return None


def build_full_index(
    store: Any,
    *,
    index: SearchIndex | None = None,
    on_progress: Callable[[int, int], None] | None = None,
) -> tuple[int, int]:
    """Walk every conversation and (re)populate the index.

    Idempotent — re-runs are no-ops for unchanged files because
    :meth:`SearchIndex.upsert_conversation` is a DELETE+INSERT scoped to
    the conversation's uuid.

    Returns ``(files_indexed, messages_indexed)``.

    Side effect: calls ``index.mark_ready()`` at the end so subsequent
    queries hit the index instead of falling back.
    """
    if index is None:
        index = get_search_index()
    if index is None:
        return (0, 0)

    data_dir = getattr(store, "data_dir", None) or get_settings().data_dir
    claude_dir = getattr(store, "claude_dir", None) or get_settings().claude_dir

    files_indexed = 0
    messages_indexed = 0

    convs = store.get_all_conversations_raw(source="all")
    total = len(convs)
    for i, conv in enumerate(convs):
        path = _file_path_for_conv(conv, data_dir, claude_dir)
        if path is None:
            # Synthetic path keyed by UUID so re-indexing replaces the
            # rows correctly. mtime=0 forces a re-index next time we have
            # a real path.
            path = data_dir / f"_synthetic_{conv.get('uuid', 'unknown')}.json"
            mtime = 0.0
        else:
            try:
                mtime = path.stat().st_mtime
            except OSError:
                mtime = 0.0
        # Skip the DELETE+INSERT when we already have this file at the
        # same mtime — saves the round-trip per-file on warm restarts.
        # The first build (empty index) always upserts because
        # needs_update returns True on the not-found path.
        if not index.needs_update(path, mtime):
            files_indexed += 1
            if on_progress is not None:
                on_progress(i + 1, total)
            continue
        try:
            messages_indexed += index.upsert_conversation(conv, path, mtime)
            files_indexed += 1
        except sqlite3.Error:
            logger.exception("search_index: upsert failed for %s", path)
            continue
        if on_progress is not None:
            on_progress(i + 1, total)

    index.mark_ready()
    logger.info(
        "search_index: build complete: %d files / %d messages",
        files_indexed, messages_indexed,
    )
    return files_indexed, messages_indexed


def update_drifted_files(
    store: Any,
    *,
    index: SearchIndex | None = None,
) -> int:
    """Re-index any file whose mtime no longer matches the indexed value.

    Also drops rows for files that have disappeared from disk (the
    cleanup pass). Returns the number of files re-indexed (does not
    count cleanup-only deletions).

    Cheap to call repeatedly — for unchanged files it does a single
    SELECT against ``indexed_files`` and bails. Designed to be invoked
    from the existing CC image watcher's ~5s polling pass.
    """
    if index is None:
        index = get_search_index()
    if index is None:
        return 0

    data_dir = getattr(store, "data_dir", None) or get_settings().data_dir
    claude_dir = getattr(store, "claude_dir", None) or get_settings().claude_dir

    # Cleanup pass: drop rows for files that no longer exist on disk.
    # Cheap: we expect <2k entries.
    for path in index.list_indexed_paths():
        if not path.exists():
            try:
                index.delete_by_path(path)
            except sqlite3.Error:
                logger.exception("search_index: cleanup-delete failed for %s", path)

    updated = 0
    convs = store.get_all_conversations_raw(source="all")
    for conv in convs:
        path = _file_path_for_conv(conv, data_dir, claude_dir)
        if path is None:
            continue
        try:
            mtime = path.stat().st_mtime
        except OSError:
            continue
        if not index.needs_update(path, mtime):
            continue
        try:
            index.upsert_conversation(conv, path, mtime)
            updated += 1
        except sqlite3.Error:
            logger.exception("search_index: drift-upsert failed for %s", path)
            continue

    return updated
