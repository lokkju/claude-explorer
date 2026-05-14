"""MCP `list_sessions` must mirror the UI's search query semantics.

Locked contract (2026-05-14):

* Multi-word unquoted query (`"foo bar"`) → AND-of-terms. A
  conversation matches only if EVERY token appears somewhere in the
  same matched message (any order, not necessarily adjacent).
* Quoted query (``'"foo bar"'`` — i.e. the user-typed string contains
  the literal double quotes) → phrase. The tokens must appear in
  that exact sequence in a single message.

The UI's `/api/search` endpoint and the MCP `list_sessions` tool both
delegate to `backend.search.search_conversations(store, query, ...)`
with the raw user-typed query string. Any preprocessing on the MCP
side would silently diverge from the UI behavior; these tests pin
the contract so a future refactor can't introduce that divergence
without failing CI.
"""

from __future__ import annotations

from typing import Any

from mcp_server.server import list_sessions


def _call(**kwargs: Any) -> dict[str, Any]:
    """Invoke `list_sessions` even after FastMCP has wrapped it."""
    fn = getattr(list_sessions, "fn", list_sessions)
    return fn(**kwargs)


def _msg(uuid: str, sender: str, text: str) -> dict[str, Any]:
    return {
        "uuid": uuid,
        "sender": sender,
        "text": text,
        "content": [{"type": "text", "text": text}],
        "created_at": "2026-04-01T10:00:00Z",
        "updated_at": "2026-04-01T10:00:00Z",
        "parent_message_uuid": None,
    }


# ---------------------------------------------------------------------------
# Multi-word unquoted: AND-of-terms
# ---------------------------------------------------------------------------


def test_multi_word_query_is_and_of_terms_not_or(mcp_data):
    """`comprehensive medium` (unquoted) must return ONLY conversations
    whose message contains BOTH tokens. Returning B (comprehensive
    only) or C (medium only) would mean OR semantics, which is wrong.
    """
    conv_a = mcp_data.add_desktop_session(
        "u-a",
        name="A: both tokens",
        messages=[
            _msg(
                "msg-a-1",
                "human",
                "Need a comprehensive medium-form write-up of this design.",
            )
        ],
    )
    mcp_data.add_desktop_session(
        "u-b",
        name="B: comprehensive only",
        messages=[_msg("msg-b-1", "human", "Need a comprehensive write-up.")],
    )
    mcp_data.add_desktop_session(
        "u-c",
        name="C: medium only",
        messages=[_msg("msg-c-1", "human", "Need a medium-form write-up.")],
    )

    result = _call(query="comprehensive medium")

    uuids = {s["uuid"] for s in result["sessions"]}
    assert uuids == {conv_a}, (
        f"Expected only conv A (contains both 'comprehensive' AND 'medium'), "
        f"got {uuids}. If B or C is in here, AND-of-terms semantics broke."
    )


def test_multi_word_query_tokens_need_not_be_adjacent(mcp_data):
    """AND-of-terms means co-occurrence, NOT adjacency. Tokens
    separated by other words in the same message must still match.
    """
    conv = mcp_data.add_desktop_session(
        "u-scattered",
        name="Scattered tokens",
        messages=[
            _msg(
                "msg-1",
                "human",
                "I need a comprehensive plan for the new medium-form article.",
            )
        ],
    )

    result = _call(query="comprehensive medium")
    uuids = {s["uuid"] for s in result["sessions"]}
    assert conv in uuids


# ---------------------------------------------------------------------------
# Quoted phrase: exact-sequence-only
# ---------------------------------------------------------------------------


def test_quoted_query_requires_exact_phrase(mcp_data):
    """Wrapping the query in double quotes flips to phrase mode:
    tokens must appear in that exact sequence in a single message.

    The MCP tool receives the query string verbatim (FastMCP doesn't
    strip the user-typed quotes), so the inner `"comprehensive medium"`
    quote characters survive into `search_conversations`.
    """
    conv_phrase = mcp_data.add_desktop_session(
        "u-phrase",
        name="Phrase present",
        messages=[
            _msg(
                "msg-phrase",
                "human",
                "Write a comprehensive medium-form article.",
            )
        ],
    )
    mcp_data.add_desktop_session(
        "u-scattered",
        name="Scattered (no phrase)",
        messages=[
            _msg(
                "msg-scattered",
                "human",
                "I need a comprehensive plan for the new medium-form article.",
            )
        ],
    )

    # Note the literal double quotes inside the Python string.
    result = _call(query='"comprehensive medium"')
    uuids = {s["uuid"] for s in result["sessions"]}
    assert uuids == {conv_phrase}, (
        f"Expected only the phrase-bearing conv, got {uuids}. Quoted "
        "query semantics must require exact sequence, not just AND."
    )


# ---------------------------------------------------------------------------
# Single-word and zero-hit regression guards
# ---------------------------------------------------------------------------


def test_single_word_query_unchanged(mcp_data):
    """Single-token queries must still work as token search — the
    multi-word AND fix mustn't have broken the trivial case.
    """
    conv_a = mcp_data.add_desktop_session(
        "u-a",
        name="Has comprehensive",
        messages=[_msg("msg-a", "human", "A comprehensive overview.")],
    )
    conv_b = mcp_data.add_desktop_session(
        "u-b",
        name="Has medium",
        messages=[_msg("msg-b", "human", "A medium-form article.")],
    )

    result = _call(query="comprehensive")
    uuids = {s["uuid"] for s in result["sessions"]}
    assert uuids == {conv_a}
    assert conv_b not in uuids


def test_no_match_returns_empty(mcp_data):
    """A query whose tokens don't co-occur anywhere returns zero
    sessions (proves AND really is AND, not OR-with-empty-set).
    """
    mcp_data.add_desktop_session(
        "u-1",
        name="Only word A",
        messages=[_msg("msg-1", "human", "tensorflow only here")],
    )
    mcp_data.add_desktop_session(
        "u-2",
        name="Only word B",
        messages=[_msg("msg-2", "human", "kubernetes only here")],
    )

    # No message contains both tokens → empty result.
    result = _call(query="tensorflow kubernetes")
    assert result["sessions"] == []
    assert result["total"] == 0
