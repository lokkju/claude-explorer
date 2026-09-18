"""Schema v15: per-file message scoping and size-aware drift.

Two defects from docs/notes/BACKLOG-verified-unfixed.md, both fixed by
one SCHEMA_VERSION bump because both change the on-disk ledger.

**1. Two files, one sessionId.** Claude Code "continued session" files
have a filename stem that differs from the internal ``sessionId`` --
``backend/store.py`` carries a whole second lookup pass because of it.
Enumeration dedups by stem, so both files are enumerated, and both index
under the same ``conv_uuid``. ``upsert_conversation`` and
``delete_by_path`` scoped their DELETEs by ``conv_uuid`` alone, so:

  * the second file's upsert wiped the first file's message rows while
    the first file's ledger mtime stayed current, meaning no drift pass
    ever re-indexed it -- half the conversation silently unsearchable;
  * deleting either file dropped every message row for that uuid,
    including the survivor's, whose mtime also stayed current -- the
    whole conversation gone from search until a full rebuild.

The two files are two PARTS of one logical conversation, so the fix is
to scope message rows by ``(conv_uuid, path)`` and let both contribute,
not to pick a winner.

**2. mtime-only drift.** Equality of mtime before and after a read does
not prove the file was unchanged on a filesystem with coarse mtime
granularity (HFS+/NFSv3 ~1s, FAT/exFAT 2s -- relevant for ``~/.claude``
on a network share or external drive). A same-tick append gets stamped
with the mtime of the content we read WITHOUT it, and the drift scan
then compares equal forever. ``SummaryCache`` stamps mtime AND size for
exactly this reason; ``indexed_files`` had no size column.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from backend import search_index as si
from backend.store import ConversationStore


SID = "99999999-9999-9999-9999-999999999999"


def _write_cc(claude_dir: Path, stem: str, body: str, session_id: str = SID) -> Path:
    proj = claude_dir / "projects" / "p"
    proj.mkdir(parents=True, exist_ok=True)
    path = proj / f"{stem}.jsonl"
    path.write_text(
        "\n".join(
            json.dumps(e)
            for e in (
                {
                    "type": "user",
                    "uuid": f"{stem}-u1",
                    "sessionId": session_id,
                    "timestamp": "2026-01-01T00:00:00Z",
                    "cwd": "/t",
                    "message": {"role": "user", "content": body},
                },
                {
                    "type": "assistant",
                    "uuid": f"{stem}-a1",
                    "sessionId": session_id,
                    "timestamp": "2026-01-01T00:00:01Z",
                    "message": {
                        "role": "assistant",
                        "model": "claude-sonnet-5",
                        "id": f"msg_{stem}",
                        "content": [{"type": "text", "text": "ok"}],
                    },
                },
            )
        )
        + "\n"
    )
    return path


@pytest.fixture
def env(tmp_path: Path):
    claude_dir = tmp_path / "claude"
    (claude_dir / "projects" / "p").mkdir(parents=True)
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    cowork = tmp_path / "app" / "lam"
    cowork.mkdir(parents=True)
    idx = si.SearchIndex(tmp_path / "index.sqlite")
    store = ConversationStore(
        data_dir=data_dir, claude_dir=claude_dir, cowork_root=cowork
    )
    try:
        yield {"idx": idx, "store": store, "claude_dir": claude_dir, "tmp": tmp_path}
    finally:
        idx.close()


# --- 1. continued sessions -------------------------------------------


def test_both_parts_of_a_continued_session_are_searchable(env) -> None:
    """Bug it would surface: the second file's upsert deleting the
    first's message rows."""
    _write_cc(env["claude_dir"], "11111111-1111-1111-1111-111111111111", "part_one_kangaroo")
    _write_cc(env["claude_dir"], "22222222-2222-2222-2222-222222222222", "part_two_platypus")

    si.update_drifted_files(env["store"], index=env["idx"])

    assert env["idx"].query("part_one_kangaroo"), (
        "the first file's messages must survive the second file's upsert"
    )
    assert env["idx"].query("part_two_platypus")


def test_deleting_one_part_keeps_the_other_searchable(env) -> None:
    """Bug it would surface: delete_by_path dropping every row for the
    conv_uuid, including the surviving file's, whose ledger mtime still
    matches so it is never re-indexed."""
    f1 = _write_cc(env["claude_dir"], "11111111-1111-1111-1111-111111111111", "part_one_kangaroo")
    _write_cc(env["claude_dir"], "22222222-2222-2222-2222-222222222222", "part_two_platypus")
    si.update_drifted_files(env["store"], index=env["idx"])

    f1.unlink()
    si.update_drifted_files(env["store"], index=env["idx"])

    assert not env["idx"].query("part_one_kangaroo"), "deleted file's rows must go"
    assert env["idx"].query("part_two_platypus"), (
        "the surviving file of a continued session must stay searchable"
    )


def test_deleting_the_last_part_clears_the_projection_row(env) -> None:
    """The conversations projection row must not outlive every file that
    fed it -- that would leave a phantom in the title sweep."""
    f1 = _write_cc(env["claude_dir"], "11111111-1111-1111-1111-111111111111", "part_one_kangaroo")
    f2 = _write_cc(env["claude_dir"], "22222222-2222-2222-2222-222222222222", "part_two_platypus")
    si.update_drifted_files(env["store"], index=env["idx"])

    f1.unlink()
    f2.unlink()
    si.update_drifted_files(env["store"], index=env["idx"])

    assert env["idx"].title_match_uuids("%") == [] or SID not in env["idx"].title_match_uuids("%")


def test_reindexing_one_part_does_not_disturb_the_other(env) -> None:
    """Re-upserting file 2 must replace only file 2's rows."""
    _write_cc(env["claude_dir"], "11111111-1111-1111-1111-111111111111", "part_one_kangaroo")
    f2 = _write_cc(env["claude_dir"], "22222222-2222-2222-2222-222222222222", "part_two_platypus")
    si.update_drifted_files(env["store"], index=env["idx"])

    # Rewrite file 2 with different content and re-index.
    _write_cc(env["claude_dir"], "22222222-2222-2222-2222-222222222222", "part_two_rewritten_gibbon")
    os.utime(f2, (0, 0))
    si.update_drifted_files(env["store"], index=env["idx"])

    assert env["idx"].query("part_one_kangaroo"), "file 1 untouched"
    assert env["idx"].query("part_two_rewritten_gibbon")
    assert not env["idx"].query("part_two_platypus"), "file 2's old rows replaced"


# --- 2. size-aware drift ---------------------------------------------


def test_same_mtime_different_size_is_drifted(env) -> None:
    """The coarse-granularity case: content changes, mtime does not.

    Bug it would surface: mtime-only comparison declaring the file
    current forever, so the appended turn is never indexed.
    """
    path = _write_cc(env["claude_dir"], "33333333-3333-3333-3333-333333333333", "before_append_ibex")
    si.update_drifted_files(env["store"], index=env["idx"])
    assert env["idx"].query("before_append_ibex")

    stamped = path.stat().st_mtime
    # Append a turn, then force the mtime back to what we indexed --
    # exactly what a 1s/2s-granularity filesystem does on its own.
    with path.open("a") as fh:
        fh.write(
            json.dumps(
                {
                    "type": "user",
                    "uuid": "extra-u",
                    "sessionId": "33333333-3333-3333-3333-333333333333",
                    "timestamp": "2026-01-01T00:00:02Z",
                    "cwd": "/t",
                    "message": {"role": "user", "content": "appended_turn_lemur"},
                }
            )
            + "\n"
        )
    os.utime(path, (stamped, stamped))

    drifted, _ = si._drift_first_scan(env["store"], env["idx"])

    assert path in [p for p, _ in drifted], (
        "a file whose size changed must be re-indexed even when its mtime "
        "is unchanged"
    )

    si.update_drifted_files(env["store"], index=env["idx"])
    assert env["idx"].query("appended_turn_lemur")


def test_unchanged_file_is_not_drifted(env) -> None:
    """No churn: size-awareness must not make every pass re-index."""
    _write_cc(env["claude_dir"], "44444444-4444-4444-4444-444444444444", "steady_state_okapi")
    si.update_drifted_files(env["store"], index=env["idx"])

    drifted, missing = si._drift_first_scan(env["store"], env["idx"])

    assert drifted == [] and missing == []


# --- schema column-order guard ----------------------------------------


def test_messages_column_order_matches_the_declared_tuple(env) -> None:
    """``snippet()`` addresses FTS5 columns by ORDINAL.

    The snippet indices were literal ints through v14 and shifted
    silently twice: v13 inserted ``is_compaction_summary`` before
    ``title``, v15 inserted ``path`` after ``conv_uuid``. Both times the
    only symptom was empty highlight slices. They are now derived from
    ``MESSAGES_COLUMNS``; this pins that tuple against what SQLite
    actually created, so the DDL and the tuple cannot drift apart.
    """
    conn = env["idx"]._get_read_conn()
    actual = tuple(
        r[1] for r in conn.execute("PRAGMA table_info(messages)").fetchall()
    )
    assert actual == si.MESSAGES_COLUMNS, (
        "messages DDL and MESSAGES_COLUMNS disagree; snippet() ordinals "
        f"are derived from the tuple.\n  DDL:   {actual}\n  tuple: "
        f"{si.MESSAGES_COLUMNS}"
    )
    assert si.MESSAGES_COLUMNS.index("body") == si.SearchIndex._SNIPPET_BODY_COL_IDX


def test_unparseable_file_reaches_a_steady_state(env) -> None:
    """A file that yields no conversation must stop being re-read.

    Verified before the fix: three consecutive passes each reported the
    same empty .jsonl as drifted, indefinitely. The backstop runs every
    600s and every debounced inotify batch triggers a whole-corpus pass,
    so this was permanent repeated open-and-parse work.
    """
    empty = env["claude_dir"] / "projects" / "p" / "dead-session.jsonl"
    empty.write_text("")

    si.update_drifted_files(env["store"], index=env["idx"])
    drifted, _ = si._drift_first_scan(env["store"], env["idx"])

    assert empty not in [p for p, _ in drifted], (
        "an unparseable file must be stamped so it stops churning"
    )


def test_unparseable_file_is_picked_up_once_it_becomes_valid(env) -> None:
    """The sentinel must not be a tombstone."""
    path = env["claude_dir"] / "projects" / "p" / "later-valid.jsonl"
    path.write_text("")
    si.update_drifted_files(env["store"], index=env["idx"])

    _write_cc(
        env["claude_dir"],
        "later-valid",
        "now_it_parses_dormouse",
        session_id="55555555-5555-5555-5555-555555555555",
    )
    si.update_drifted_files(env["store"], index=env["idx"])

    assert env["idx"].query("now_it_parses_dormouse")
