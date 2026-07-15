"""Multi-location (union) discovery for externally-read session types.

Design (2026-07-15, chosen over a single "best root" resolver): sessions
can be SPLIT across locations — an app update or a repackaged Flatpak/Snap
install moves the dir, leaving sessions in the old one AND the new one.
Discovery must UNION across every candidate root, not pick one, or the
un-picked location's sessions silently never index.

These tests pin the union + dedup at the enumeration layer (the actual
"gets indexed" path) and on the store's ``cowork_roots`` / ``claude_dirs``
properties. Parsing/rendering of Cowork sessions is already covered by
``test_cowork_reader.py`` / ``test_store_cowork_integration.py``; here we
only need the directory shape, so enumeration (which stats, never parses)
is the tightest place to assert.

The autouse ``_isolate_cowork_app_dir`` conftest fixture sets
``CLAUDE_DESKTOP_APP_DIR`` (→ a single override candidate); ``union_env``
deletes it and points HOME at a tmp dir so the multi-candidate default
path is exercised.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from backend import config, search_index
from backend.store import ConversationStore


@pytest.fixture
def union_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.delenv("CLAUDE_DESKTOP_APP_DIR", raising=False)
    monkeypatch.delenv("CLAUDE_DIR", raising=False)
    monkeypatch.delenv("CLAUDE_CONFIG_DIR", raising=False)
    monkeypatch.delenv("CLAUDE_EXPLORER_DATA_DIR", raising=False)
    monkeypatch.delenv("CLAUDE_EXPORTER_DATA_DIR", raising=False)
    config.get_settings.cache_clear()
    yield tmp_path
    config.get_settings.cache_clear()


def _make_cowork_session(app_dir: Path, uuid: str) -> Path:
    """Create ``app_dir/local-agent-mode-sessions/dep/org/local_<uuid>/audit.jsonl``."""
    sess = (
        app_dir
        / config.COWORK_SESSIONS_DIRNAME
        / "deployment-uuid"
        / "org-uuid"
        / f"local_{uuid}"
    )
    sess.mkdir(parents=True, exist_ok=True)
    (sess / "audit.jsonl").write_text("{}\n")
    return sess / "audit.jsonl"


# -- cowork_roots property ---------------------------------------------


def test_cowork_roots_unions_existing_candidate_dirs(union_env: Path) -> None:
    candidates = config._desktop_app_dir_candidates(None, None)
    if len(candidates) < 2:
        pytest.skip("platform collapses candidates; nothing to union")

    _make_cowork_session(candidates[0], "aaaaaaaa")
    _make_cowork_session(candidates[1], "bbbbbbbb")

    store = ConversationStore()
    roots = store.cowork_roots
    assert candidates[0] / config.COWORK_SESSIONS_DIRNAME in roots
    assert candidates[1] / config.COWORK_SESSIONS_DIRNAME in roots


def test_cowork_root_injected_is_sole_location(tmp_path: Path) -> None:
    """A test/explicit injected root must NOT union in the developer's real
    trees — isolation is load-bearing for the whole fixture suite."""
    injected = tmp_path / "isolated"
    store = ConversationStore(cowork_root=injected)
    assert store.cowork_roots == [injected]


# -- enumeration union + dedup (the indexing path) ---------------------


def test_enumerate_unions_cowork_across_roots(union_env: Path) -> None:
    candidates = config._desktop_app_dir_candidates(None, None)
    if len(candidates) < 2:
        pytest.skip("platform collapses candidates; nothing to union")

    _make_cowork_session(candidates[0], "aaaaaaaa")
    _make_cowork_session(candidates[1], "bbbbbbbb")

    store = ConversationStore()
    paths = search_index._enumerate_conversation_paths(store)
    cowork = [p for p, src in paths if src == "CLAUDE_COWORK"]

    names = {p.parent.name for p in cowork}
    assert names == {"local_aaaaaaaa", "local_bbbbbbbb"}


def test_enumerate_dedups_same_session_in_two_roots(union_env: Path) -> None:
    """A session copied into both roots (same ``local_<uuid>``) is indexed
    once; the primary (first candidate) wins."""
    candidates = config._desktop_app_dir_candidates(None, None)
    if len(candidates) < 2:
        pytest.skip("platform collapses candidates; nothing to union")

    _make_cowork_session(candidates[0], "dupdupup")
    _make_cowork_session(candidates[1], "dupdupup")

    store = ConversationStore()
    paths = search_index._enumerate_conversation_paths(store)
    dup = [p for p, src in paths if src == "CLAUDE_COWORK" and p.parent.name == "local_dupdupup"]

    assert len(dup) == 1
    # Primary candidate wins.
    assert str(candidates[0]) in str(dup[0])


# -- claude_dirs union (CLAUDE_CONFIG_DIR relocation) ------------------


def test_claude_dirs_unions_relocated_cc_home(
    union_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    relocated = union_env / "relocated-cc"
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(relocated))
    config.get_settings.cache_clear()

    store = ConversationStore()
    assert Path.home() / ".claude" in store.claude_dirs
    assert relocated in store.claude_dirs


def test_claude_dir_injected_is_sole_location(tmp_path: Path) -> None:
    injected = tmp_path / "cc-isolated"
    store = ConversationStore(claude_dir=injected)
    assert store.claude_dirs == [injected]
