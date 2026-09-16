"""The watcher's summary-cache cleanup must use every Claude Code home.

Found 2026-09-16, in the same review that produced
[[drift-missing-pass-floor]] — and, like that one, made reachable by
re-enabling the watcher's backstop pass.

The cache is POPULATED from the union of CC homes:

    for cdir in self.claude_dirs:            # backend/store.py
        ... list_claude_code_conversations(cdir) ...   # upserts
    cc_files = [f for cdir in self.claude_dirs
                  for f in discover_jsonl_files(cdir)]

but the watcher's cleanup computed "live" from the SCALAR primary only:

    claude_dir = get_settings().claude_dir
    live_paths = list(discover_jsonl_files(claude_dir))
    cleaned = cache.delete_missing({str(p) for p in stat_index.keys()})

so every row for a relocated ($CLAUDE_CONFIG_DIR) tree was deleted on
each backstop pass and repopulated by the next sidebar request — a
permanent churn cycle in which those sessions are re-parsed from scratch
every 600s and the cache never converges. The FTS5 pass in the same
function goes through ConversationStore precisely to avoid this; the two
passes disagreed about what "live" means.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest


def _write_cc_session(claude_dir: Path, project: str, uuid: str, body: str) -> Path:
    proj = claude_dir / "projects" / project
    proj.mkdir(parents=True, exist_ok=True)
    path = proj / f"{uuid}.jsonl"
    path.write_text(
        "\n".join(
            json.dumps(e)
            for e in (
                {
                    "type": "user",
                    "uuid": f"{uuid}-u1",
                    "sessionId": uuid,
                    "timestamp": "2026-01-01T00:00:00Z",
                    "cwd": "/tmp/p",
                    "message": {"role": "user", "content": body},
                },
                {
                    "type": "assistant",
                    "uuid": f"{uuid}-a1",
                    "sessionId": uuid,
                    "timestamp": "2026-01-01T00:00:01Z",
                    "message": {
                        "role": "assistant",
                        "model": "claude-sonnet-5",
                        "id": f"msg_{uuid}",
                        "content": [{"type": "text", "text": "ok"}],
                    },
                },
            )
        )
        + "\n"
    )
    return path


@pytest.fixture
def two_homes(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """A primary ~/.claude plus a relocated $CLAUDE_CONFIG_DIR tree."""
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.delenv("CLAUDE_DIR", raising=False)
    monkeypatch.delenv("CLAUDE_DESKTOP_APP_DIR", raising=False)
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    monkeypatch.setenv("CLAUDE_EXPLORER_DATA_DIR", str(data_dir))

    primary = tmp_path / ".claude"
    secondary = tmp_path / "relocated"
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(secondary))

    from backend import config

    config.get_settings.cache_clear()
    settings = config.get_settings()
    if len(settings.claude_dirs) < 2:
        pytest.skip("platform collapses CC home candidates")

    p1 = _write_cc_session(primary, "proj-a", "aaaaaaaa-0000-0000-0000-000000000001", "primary_body")
    p2 = _write_cc_session(secondary, "proj-b", "bbbbbbbb-0000-0000-0000-000000000002", "secondary_body")
    (primary / "image-cache").mkdir(parents=True, exist_ok=True)

    yield {"primary": p1, "secondary": p2}
    config.get_settings.cache_clear()


def _cached_paths(paths: list[Path]) -> set[Path]:
    from backend.summary_cache import get_summary_cache

    cache = get_summary_cache()
    assert cache is not None
    stat_index = {p: p.stat() for p in paths if p.exists()}
    return set(cache.get_many(list(stat_index.keys()), stat_index).keys())


def test_backstop_keeps_rows_for_a_relocated_cc_home(two_homes) -> None:
    """Bug it would surface: cleanup scoped to the primary home deleting
    every cached row that came from the relocated tree."""
    from backend import cc_watcher
    from backend.store import ConversationStore

    both = [two_homes["primary"], two_homes["secondary"]]

    # Populate the cache the way a sidebar request does.
    ConversationStore().list_conversations()
    assert _cached_paths(both) == set(both), "precondition: both rows cached"

    cc_watcher.scan_once()

    assert _cached_paths(both) == set(both), (
        "the backstop cleanup must treat every Claude Code home as live, "
        "not just the primary"
    )


def test_backstop_still_drops_a_genuinely_deleted_session(two_homes) -> None:
    """The union fix must not disable the cleanup it is part of."""
    from backend import cc_watcher
    from backend.store import ConversationStore

    both = [two_homes["primary"], two_homes["secondary"]]
    ConversationStore().list_conversations()
    assert _cached_paths(both) == set(both)

    two_homes["secondary"].unlink()

    cc_watcher.scan_once()

    assert _cached_paths(both) == {two_homes["primary"]}
