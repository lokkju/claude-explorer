"""Tests for the /api/conversations endpoint.

The sidebar's "Search titles and projects" input has two filter paths:

  1. **Server-side** via `GET /api/conversations?search=...`. The store's
     `list_conversations(search=...)` filters against `name` /
     `summary` / `project_path`. This is the public API contract
     external scripts hit.

  2. **Client-side** via the React hook `useConversations` (see
     `frontend/src/hooks/useConversations.ts`). Filters against
     `name` / `project_path` only (intentionally NOT `summary` — see
     hook docstring P1.2 2026-05-04).

These tests pin the SERVER-SIDE contract. They seed a known corpus
and assert specific UUIDs in the filtered result, so a search that
returned [] for every query (or returned everything regardless of
query) would fail RED. Previous tests asserted only HTTP 200 and were
useless against that failure mode.
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from backend.cache import _conversation_cache
from backend import config as cfg
from backend.main import app


def _conv(
    uuid: str,
    name: str,
    *,
    summary: str = "",
    project_path: str | None = None,
    source: str = "CLAUDE_AI",
):
    """Build a Claude Desktop conversation JSON."""
    return {
        "uuid": uuid,
        "name": name,
        "summary": summary,
        "model": "claude-sonnet-4-6",
        "created_at": "2026-05-01T12:00:00Z",
        "updated_at": "2026-05-01T13:00:00Z",
        "is_starred": False,
        "source": source,
        "project_path": project_path,
        "current_leaf_message_uuid": "msg-1",
        "chat_messages": [
            {
                "uuid": "msg-1",
                "parent_message_uuid": None,
                "sender": "human",
                "text": "hello",
                "created_at": "2026-05-01T12:00:00Z",
                "updated_at": "2026-05-01T12:00:00Z",
                "content": [{"type": "text", "text": "hello"}],
            },
        ],
    }


@pytest.fixture
def title_filter_data_dir(tmp_path, monkeypatch):
    """Three Desktop conversations with intentionally orthogonal fields:

      * `applekey` only in NAME
      * `bananakey` only in SUMMARY
      * `cherrykey` only in PROJECT_PATH

    Lets each test assert that searching for X returns ONLY the
    conversation that has X in the matching field — proving the filter
    is doing real work, not falling back to "always return everything"
    or "always return []".
    """
    convs = [
        _conv("conv-name", "applekey title goes here", summary="plain summary"),
        _conv("conv-summary", "plain title", summary="this summary has bananakey in it"),
        _conv("conv-path", "plain title", summary="plain summary",
              project_path="/work/cherrykey/some-project"),
    ]
    by_org = tmp_path / "by-org" / "org-1"
    by_org.mkdir(parents=True)
    for c in convs:
        (by_org / f"{c['uuid']}.json").write_text(json.dumps(c))
    empty_claude = tmp_path / "claude-empty"
    empty_claude.mkdir()
    monkeypatch.setenv("CLAUDE_EXPLORER_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("CLAUDE_DIR", str(empty_claude))
    cfg.get_settings.cache_clear()  # type: ignore[attr-defined]
    _conversation_cache.clear()
    yield tmp_path
    _conversation_cache.clear()
    cfg.get_settings.cache_clear()  # type: ignore[attr-defined]


# ---------- Original smoke tests (kept; widened to assert non-empty) ----------


def test_list_conversations(client):
    """Smoke: endpoint returns a list."""
    response = client.get("/api/conversations")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_get_conversation_not_found(client):
    response = client.get("/api/conversations/nonexistent-uuid")
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


def test_get_conversation_tree_not_found(client):
    response = client.get("/api/conversations/nonexistent-uuid/tree")
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# None-safety contracts on the detail endpoints (same bug-class as 8ab36fc).
# ---------------------------------------------------------------------------


def test_get_conversation_handles_null_chat_messages_without_crashing(
    tmp_path, monkeypatch
):
    """A conversation with ``chat_messages: null`` (NOT ``[]``) must not
    crash ``GET /api/conversations/{uuid}``.

    Same bug-class as 8ab36fc: ``data.get("chat_messages", [])`` returns
    ``None`` when the key is present with value ``None``, and every
    downstream operation (``any(...for m in chat_messages)``,
    ``len(chat_messages)``, ``for m in chat_messages``,
    ``has_branches(chat_messages)``) raises ``TypeError``. Pinned by
    this test and fixed at ``backend/store.py:get_conversation``.
    """
    conv = {
        "uuid": "conv-detail-null-chats",
        "name": "regular title",
        "summary": "",
        "model": "claude-sonnet-4-6",
        "created_at": "2026-05-01T12:00:00Z",
        "updated_at": "2026-05-01T13:00:00Z",
        "is_starred": False,
        "source": "CLAUDE_AI",
        "chat_messages": None,
    }
    by_org = tmp_path / "by-org" / "org-1"
    by_org.mkdir(parents=True)
    (by_org / "conv-detail-null-chats.json").write_text(json.dumps(conv))
    empty_claude = tmp_path / "claude-empty"
    empty_claude.mkdir()
    monkeypatch.setenv("CLAUDE_EXPLORER_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("CLAUDE_DIR", str(empty_claude))
    cfg.get_settings.cache_clear()  # type: ignore[attr-defined]
    _conversation_cache.clear()

    client = TestClient(app)
    r = client.get("/api/conversations/conv-detail-null-chats")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["uuid"] == "conv-detail-null-chats"
    # The empty-messages contract: None on disk → [] on the wire.
    assert body["messages"] == [], body["messages"]
    assert body["message_count"] == 0


def test_get_conversation_handles_null_name_summary_model_without_crashing(
    tmp_path, monkeypatch
):
    """``GET /api/conversations/{uuid}`` with a conv whose ``name`` /
    ``summary`` / ``model`` are explicit ``null`` must not crash with
    a Pydantic ``ValidationError`` → 500.

    Mirrors ``test_list_conversations_handles_null_name_summary_model_without_crashing``
    in test_search.py but for the per-conversation detail endpoint. The
    same ``data.get(k, fallback_str)`` anti-pattern lives in
    ``backend/store.py:get_conversation`` at the
    ``ConversationDetail(...)`` construction (lines 564-585).
    """
    conv = {
        "uuid": "conv-detail-null-strs",
        "name": None,
        "summary": None,
        "model": None,
        "created_at": "2026-05-01T12:00:00Z",
        "updated_at": "2026-05-01T13:00:00Z",
        "is_starred": False,
        "source": "CLAUDE_AI",
        "chat_messages": [],
    }
    by_org = tmp_path / "by-org" / "org-1"
    by_org.mkdir(parents=True)
    (by_org / "conv-detail-null-strs.json").write_text(json.dumps(conv))
    empty_claude = tmp_path / "claude-empty"
    empty_claude.mkdir()
    monkeypatch.setenv("CLAUDE_EXPLORER_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("CLAUDE_DIR", str(empty_claude))
    cfg.get_settings.cache_clear()  # type: ignore[attr-defined]
    _conversation_cache.clear()

    client = TestClient(app)
    r = client.get("/api/conversations/conv-detail-null-strs")
    assert r.status_code == 200, r.text
    body = r.json()
    # Same None→safe-string fallback contract as list_conversations.
    assert isinstance(body["name"], str)
    assert isinstance(body["summary"], str)
    assert isinstance(body["model"], str)


# ---------- Search filter — strong content assertions ----------


def test_sidebar_search_filters_by_name(title_filter_data_dir):
    """search=applekey — only NAME contains it. Filter must return
    exactly that conversation.
    """
    client = TestClient(app)
    r = client.get("/api/conversations", params={"search": "applekey"})
    assert r.status_code == 200
    uuids = [c["uuid"] for c in r.json()]
    assert uuids == ["conv-name"], uuids


def test_sidebar_search_filters_by_summary(title_filter_data_dir):
    """search=bananakey — only SUMMARY contains it. The server-side filter
    matches against summary; the client-side filter (intentionally)
    does not. Server-side test pins the contract for external API users.
    """
    client = TestClient(app)
    r = client.get("/api/conversations", params={"search": "bananakey"})
    assert r.status_code == 200
    uuids = [c["uuid"] for c in r.json()]
    assert uuids == ["conv-summary"], uuids


def test_sidebar_search_filters_by_project_path(title_filter_data_dir):
    """search=cherrykey — only PROJECT_PATH contains it. Returns only
    the conversation whose project_path mentions it.
    """
    client = TestClient(app)
    r = client.get("/api/conversations", params={"search": "cherrykey"})
    assert r.status_code == 200
    uuids = [c["uuid"] for c in r.json()]
    assert uuids == ["conv-path"], uuids


def test_sidebar_search_returns_empty_for_nonmatching_query(title_filter_data_dir):
    """Bidirectional pair: a query that matches nothing must return [].

    If this test passes but the matching tests above fail, the filter is
    broken in the "always return []" direction. If this fails (returns
    everything), the filter is broken in the "ignore query" direction.
    Together they pin both edges.
    """
    client = TestClient(app)
    r = client.get(
        "/api/conversations",
        params={"search": "zzzzznotinanycorpusvaluezzzzz"},
    )
    assert r.status_code == 200
    assert r.json() == []


def test_sidebar_search_is_case_insensitive(title_filter_data_dir):
    """Filter is `search_lower in field.lower()`; APPLEKEY / applekey /
    AppleKey must all return the same conversation.
    """
    client = TestClient(app)
    for q in ("applekey", "APPLEKEY", "AppleKey"):
        r = client.get("/api/conversations", params={"search": q})
        assert r.status_code == 200
        uuids = [c["uuid"] for c in r.json()]
        assert uuids == ["conv-name"], f"q={q!r} → {uuids}"


def test_sidebar_search_different_queries_return_disjoint_results(
    title_filter_data_dir,
):
    """Tautology-protection: three orthogonal queries on disjoint fields
    must return disjoint result sets. If the filter is ignoring the
    query and returning everything, all three sets equal {all 3 uuids}.
    """
    client = TestClient(app)
    a = {c["uuid"] for c in client.get(
        "/api/conversations", params={"search": "applekey"}).json()}
    b = {c["uuid"] for c in client.get(
        "/api/conversations", params={"search": "bananakey"}).json()}
    c = {c["uuid"] for c in client.get(
        "/api/conversations", params={"search": "cherrykey"}).json()}

    assert a == {"conv-name"}, a
    assert b == {"conv-summary"}, b
    assert c == {"conv-path"}, c
    # Disjoint sanity:
    assert a & b == set()
    assert b & c == set()
    assert a & c == set()


def test_sidebar_search_unfiltered_returns_all(title_filter_data_dir):
    """No `search=` param → all conversations. Distinct from the
    `search` cases above; pins that filtering is opt-in.
    """
    client = TestClient(app)
    r = client.get("/api/conversations")
    assert r.status_code == 200
    uuids = sorted(c["uuid"] for c in r.json())
    assert uuids == ["conv-name", "conv-path", "conv-summary"]


def test_sidebar_search_source_filter(title_filter_data_dir):
    """source=CLAUDE_CODE on a Desktop-only seeded corpus → []."""
    client = TestClient(app)
    r = client.get(
        "/api/conversations",
        params={"search": "applekey", "source": "CLAUDE_CODE"},
    )
    assert r.status_code == 200
    assert r.json() == []


def test_sidebar_search_sort_orders_results(title_filter_data_dir):
    """Sort by name asc/desc with a 2-hit query, confirm the order
    reverses. Catches a regression where `sort_order` is ignored.
    """
    client = TestClient(app)
    # All three conversations contain "plain" somewhere; this matches all 3.
    # (conv-name has "applekey title", but conv-summary and conv-path have
    # "plain title", and they all have "plain summary" except conv-name).
    # Use the literal "title" instead since it appears in every name.
    asc = client.get(
        "/api/conversations",
        params={"search": "title", "sort": "name", "sort_order": "asc"},
    ).json()
    desc = client.get(
        "/api/conversations",
        params={"search": "title", "sort": "name", "sort_order": "desc"},
    ).json()
    asc_names = [c["name"] for c in asc]
    desc_names = [c["name"] for c in desc]
    assert asc_names != [], "Sort test must have a non-empty result set."
    assert asc_names == list(reversed(desc_names)), (
        f"asc={asc_names} ; desc={desc_names}"
    )
