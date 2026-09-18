"""A missing ``messages`` table must not read as "schema fine".

From docs/notes/BACKLOG-verified-unfixed.md. ``_init_schema`` computed

    cols_ok = (not existing_cols) or existing_cols == _EXPECTED_MESSAGES_COLS

and ``PRAGMA table_info(messages)`` returns nothing in two very
different situations: the database is brand new, and the table is gone.
A missing table therefore took the "columns fine" branch, got recreated
EMPTY by ``executescript(SCHEMA_SQL)``, and the function early-returned
without touching ``indexed_files``.

Reachable because the rebuild path's ``DROP TABLE``s each commit
separately (Python's sqlite3 opens no implicit transaction for DDL). A
SIGKILL or power loss between ``DROP TABLE messages`` and
``DROP TABLE schema_version``, on a run where the version already
matched, leaves exactly this state. The v14 self-repair comment in
``search_index.py`` documents that half-applied states like this have
been observed live.

Consequence: the ledger still holds every row with current mtimes, so
every drift pass reports zero drifted files and the FTS5 table stays
empty forever. Search returns nothing on the fast path until someone
runs ``reindex-search``.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

from backend import search_index as si


def _make_db_without_messages(path: Path) -> None:
    """Current-version database whose ``messages`` table is gone but
    whose ledger is fully populated."""
    msg_cols = ", ".join(
        c if c in ("title", "body", "body_text") else f"{c} UNINDEXED"
        for c in si.MESSAGES_COLUMNS
    )
    conn = sqlite3.connect(str(path))
    conn.executescript(f"""
        CREATE TABLE schema_version (version INTEGER NOT NULL);
        INSERT INTO schema_version (version) VALUES ({si.SCHEMA_VERSION});

        CREATE VIRTUAL TABLE messages USING fts5(
            {msg_cols},
            tokenize = "porter unicode61 remove_diacritics 1"
        );

        CREATE TABLE indexed_files (
            path TEXT PRIMARY KEY, mtime REAL NOT NULL,
            size INTEGER NOT NULL DEFAULT -1,
            indexed_at INTEGER NOT NULL, conv_uuid TEXT
        );

        CREATE TABLE conversations (
            conv_uuid TEXT PRIMARY KEY,
            title TEXT,
            conv_created_at TEXT,
            conv_updated_at TEXT,
            project_path TEXT,
            source TEXT,
            organization_id TEXT,
            is_compaction_titled INTEGER NOT NULL DEFAULT 0
        );
    """)
    conn.executemany(
        "INSERT INTO indexed_files (path, mtime, size, indexed_at, conv_uuid) "
        "VALUES (?, ?, ?, ?, ?)",
        [
            (f"/tmp/session-{i}.jsonl", 1000.0 + i, 500 + i, 1, f"conv-{i}")
            for i in range(5)
        ],
    )
    conn.execute(
        "INSERT INTO conversations (conv_uuid, title) VALUES ('conv-0', 'T')"
    )
    conn.commit()
    # The interrupted-rebuild state: messages dropped, everything else
    # left behind, version row still current.
    conn.execute("DROP TABLE messages")
    conn.commit()
    conn.close()


def test_missing_messages_table_forces_a_rebuild(tmp_path: Path) -> None:
    """Bug it would surface: the ledger surviving an empty messages
    table, so every drift pass sees zero drift and search stays dead.
    """
    db = tmp_path / "half-dropped.sqlite"
    _make_db_without_messages(db)

    with sqlite3.connect(str(db)) as pre:
        names = {
            r[0] for r in pre.execute(
                "SELECT name FROM sqlite_master WHERE type IN ('table','view')"
            ).fetchall()
        }
        assert "messages" not in names, "fixture precondition"
        assert pre.execute("SELECT COUNT(*) FROM indexed_files").fetchone()[0] == 5

    idx = si.SearchIndex(db)
    try:
        assert idx.indexed_file_count() == 0, (
            "a missing messages table must invalidate the ledger too; "
            "leaving ledger rows behind means every drift pass reports "
            "zero drifted files and the index never refills"
        )
        # And the index is usable again: the schema is intact, so a
        # rebuild can repopulate it.
        assert idx._schema_ok is True
    finally:
        idx.close()


def test_intact_database_is_left_alone(tmp_path: Path) -> None:
    """No regression: a healthy database must not be wiped on open."""
    db = tmp_path / "healthy.sqlite"
    idx = si.SearchIndex(db)
    try:
        conv = {
            "uuid": "conv-healthy",
            "name": "Healthy",
            "source": "CLAUDE_CODE",
            "chat_messages": [
                {
                    "uuid": "m1",
                    "sender": "human",
                    "created_at": "2026-01-01T00:00:00Z",
                    "text": "steady_marker_wombat",
                }
            ],
        }
        idx.upsert_conversation(conv, Path("/tmp/healthy.jsonl"), 123.0, 45)
        assert idx.indexed_file_count() == 1
    finally:
        idx.close()

    reopened = si.SearchIndex(db)
    try:
        assert reopened.indexed_file_count() == 1, (
            "reopening an intact index must not drop the ledger"
        )
    finally:
        reopened.close()
