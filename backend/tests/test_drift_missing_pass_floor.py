"""The drift pass must not delete rows for a surface it could not read.

Found 2026-09-16, immediately after the watcher's backstop drift pass was
re-enabled (it had been dead behind an `is_ready()` gate, see
docs/notes/watcher-search-drift-never-runs.md). That pass now runs every
600s in the supervised watcher, which makes this reachable where it
previously was not.

`_drift_first_scan`'s missing-pass is:

    for indexed_path_str in indexed_mtimes.keys():
        if Path(indexed_path_str) not in live_set:
            missing.append(indexed_path)

and every enumeration failure upstream is swallowed into "no files":
`_enumerate_conversation_paths` skips a Cowork root when
`cowork_root.exists()` is False and turns `iterdir()` OSError into an
empty list; `discover_jsonl_files` yields nothing when the projects dir
is absent; `_get_conversation_files` returns [] when data_dir is absent.

So a root that is momentarily unavailable -- an ejected external volume,
an autofs/NFS mount that has not come back, a Cowork dir that moved --
reads as "every file on that surface was deleted", and one pass wipes
every message, conversation-projection and ledger row for it. Search
then returns nothing for that surface until a full re-walk.
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from backend import config, search_index
from backend.store import ConversationStore


@pytest.fixture
def corpus(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """A store with one CC session and one Cowork session, each in its own
    injected root, plus a real SearchIndex on tmp."""
    claude_dir = tmp_path / "claude"
    (claude_dir / "projects" / "proj").mkdir(parents=True)
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    cowork_root = tmp_path / "app" / config.COWORK_SESSIONS_DIRNAME

    cc_uuid = "11111111-1111-1111-1111-111111111111"
    cc_path = claude_dir / "projects" / "proj" / f"{cc_uuid}.jsonl"
    cc_path.write_text(
        "\n".join(
            json.dumps(e)
            for e in (
                {
                    "type": "user",
                    "uuid": f"{cc_uuid}-u1",
                    "sessionId": cc_uuid,
                    "timestamp": "2026-01-01T00:00:00Z",
                    "cwd": "/tmp/proj",
                    "message": {"role": "user", "content": "cc_needle_ocelot"},
                },
                {
                    "type": "assistant",
                    "uuid": f"{cc_uuid}-a1",
                    "sessionId": cc_uuid,
                    "timestamp": "2026-01-01T00:00:01Z",
                    "message": {
                        "role": "assistant",
                        "model": "claude-sonnet-5",
                        "id": f"msg_{cc_uuid}",
                        "content": [{"type": "text", "text": "ok"}],
                    },
                },
            )
        )
        + "\n"
    )

    cw_uuid = "22222222-2222-2222-2222-222222222222"
    sess_dir = cowork_root / "dep" / "org" / f"local_{cw_uuid}"
    sess_dir.mkdir(parents=True)
    (sess_dir / "audit.jsonl").write_text(
        "\n".join(
            json.dumps(e)
            for e in (
                {
                    "type": "user",
                    "uuid": f"{cw_uuid}-u1",
                    "session_id": f"local_{cw_uuid}",
                    "_audit_timestamp": "2026-01-01T00:00:00Z",
                    "message": {"role": "user", "content": "cowork_needle_narwhal"},
                },
                {
                    "type": "assistant",
                    "uuid": f"{cw_uuid}-a1",
                    "session_id": f"local_{cw_uuid}",
                    "_audit_timestamp": "2026-01-01T00:00:01Z",
                    "message": {
                        "role": "assistant",
                        "model": "claude-sonnet-5",
                        "id": f"msg_{cw_uuid}",
                        "content": [{"type": "text", "text": "ok"}],
                    },
                },
            )
        )
        + "\n"
    )
    (cowork_root / "dep" / "org" / f"local_{cw_uuid}.json").write_text(
        json.dumps({"sessionId": f"local_{cw_uuid}", "title": "cowork one"})
    )

    idx = search_index.SearchIndex(tmp_path / "index.sqlite")
    store = ConversationStore(
        data_dir=data_dir, claude_dir=claude_dir, cowork_root=cowork_root
    )
    try:
        yield {
            "store": store,
            "index": idx,
            "cowork_root": cowork_root,
            "claude_dir": claude_dir,
            "cc_path": cc_path,
            "cowork_path": sess_dir / "audit.jsonl",
        }
    finally:
        idx.close()


def _indexed(idx) -> set[Path]:
    return set(idx.list_indexed_paths())


def test_unreadable_cowork_root_does_not_delete_its_rows(corpus) -> None:
    """The headline case: Cowork's root disappears (ejected volume, moved
    dir). Its indexed rows must survive.

    Bug it would surface: the missing-pass treating an unenumerable
    surface as "everything on it was deleted".
    """
    idx, store = corpus["index"], corpus["store"]
    search_index.update_drifted_files(store, index=idx)
    before = _indexed(idx)
    assert corpus["cowork_path"] in before, f"precondition failed: {before}"

    # The whole Cowork root goes away -- not the individual session.
    shutil.rmtree(corpus["cowork_root"].parent)

    search_index.update_drifted_files(store, index=idx)

    after = _indexed(idx)
    assert corpus["cowork_path"] in after, (
        "an unreadable Cowork root must not delete its indexed rows; "
        f"indexed paths went {before} -> {after}"
    )
    assert idx.query("cowork_needle_narwhal"), (
        "the Cowork session must still be searchable after its root went "
        "temporarily unreadable"
    )
    # The healthy CC surface is untouched either way.
    assert corpus["cc_path"] in after


def test_missing_projects_root_does_not_delete_cc_rows(corpus) -> None:
    """Same guarantee for the Claude Code surface."""
    idx, store = corpus["index"], corpus["store"]
    search_index.update_drifted_files(store, index=idx)
    assert corpus["cc_path"] in _indexed(idx)

    shutil.rmtree(corpus["claude_dir"] / "projects")

    search_index.update_drifted_files(store, index=idx)

    assert corpus["cc_path"] in _indexed(idx)
    assert idx.query("cc_needle_ocelot")


def test_genuinely_deleted_file_in_a_healthy_root_is_still_cleaned(corpus) -> None:
    """The floor must not turn the cleanup pass off.

    A single file deleted while its root is perfectly readable is a real
    deletion and its rows must go.
    """
    idx, store = corpus["index"], corpus["store"]
    search_index.update_drifted_files(store, index=idx)
    assert corpus["cowork_path"] in _indexed(idx)

    # Remove just the session dir; the root itself stays readable.
    shutil.rmtree(corpus["cowork_path"].parent)

    search_index.update_drifted_files(store, index=idx)

    assert corpus["cowork_path"] not in _indexed(idx), (
        "a file deleted from a readable root must still be cleaned up"
    )
    assert not idx.query("cowork_needle_narwhal")
    assert corpus["cc_path"] in _indexed(idx)


def test_total_enumeration_outage_deletes_nothing(corpus) -> None:
    """Every root unreadable at once -- e.g. HOME not yet mounted. The
    pass must be a no-op, not a wipe."""
    idx, store = corpus["index"], corpus["store"]
    search_index.update_drifted_files(store, index=idx)
    before = _indexed(idx)
    assert len(before) == 2

    shutil.rmtree(corpus["cowork_root"].parent)
    shutil.rmtree(corpus["claude_dir"] / "projects")

    search_index.update_drifted_files(store, index=idx)

    assert _indexed(idx) == before
