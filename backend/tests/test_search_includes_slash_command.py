"""V1 polish round 3 (2026-05-12): search-projection regression for the
`slash_command` field on CC command markers.

Context: `backend/claude_code_reader.py::_collapse_local_command_triplets`
sets `message["slash_command"]` (e.g. "/coding") on synthetic command
markers. For ARGFUL markers (where the user typed real prose after the
slash command — `is_command_marker=False` post-Fix-2), the search
projection in `backend/search.py::_extract_searchable_text` must include
the slash_command field — otherwise a user searching for "/coding" to
find every invocation gets zero hits even though every invocation has
the field set.

Bidirectional contract:
  * POSITIVE (this file): a message with `is_command_marker=False` AND
    `slash_command="/coding"` has both the command name AND the literal
    "/coding" substring in its projection.
  * NEGATIVE: a message with `slash_command=None` (or absent) has NO
    stray "None" literal in its projection. If the implementation ever
    regresses to `parts.append(message.get("slash_command"))` (no
    truthy guard), this test catches the bug.
  * NEGATIVE: an empty-string slash_command (defensive — shouldn't
    happen, but pinning the guard) does not appear in the projection.

Cross-reference: ARGLESS markers (`is_command_marker=True`) are
NOT searchable — that contract is pinned in
`test_search_excludes_argless_markers.py` (V1 polish cleanup
2026-05-13). The two test files together pin the complete spec:
argful searchable, argless excluded.
"""

from __future__ import annotations

from backend.search import _extract_searchable_text


def test_marker_with_slash_command_includes_command_in_projection() -> None:
    """The POSITIVE case: an argful /coding marker.

    Argful markers have ``is_command_marker=False`` post-Fix-2 (see
    claude_code_reader.py:454 — argful triplets get the False branch
    via ``cur.get('is_command_marker') is not True``). This is the
    fixture shape we expect from real ingestion."""
    marker = {
        "uuid": "u1",
        "sender": "human",
        "text": "Double-check your plan with the LLM council.",
        "content": [
            {"type": "text", "text": "Double-check your plan with the LLM council."}
        ],
        "is_command_marker": False,  # argful → False per Fix-2
        "slash_command": "/coding",
    }
    projection = _extract_searchable_text(marker)

    # Args body is searchable.
    assert "Double-check your plan with the LLM council." in projection
    # The slash-prefixed command name is in the projection so a literal
    # substring search for "/coding" hits via the linear-scan fallback
    # path, AND so FTS5 tokenizes `coding` as a queryable token.
    assert "/coding" in projection


def test_argless_marker_is_excluded_from_projection() -> None:
    """The argless case: /exit marker is NOT searchable (V1 polish
    cleanup 2026-05-13).

    This used to assert the opposite — that argless markers were
    searchable on both the legacy "Session: /foo" label AND the
    slash_command token. That contract was reversed because argless
    markers are CHROME, not user content: the viewer hides them
    behind SessionPreludeAffordance / SlashCommandBadge and the
    export drops them via export._is_excludable_marker. Search
    now mirrors that exclusion for the "one truth, three surfaces"
    spec invariant.

    See test_search_excludes_argless_markers.py for the full
    bidirectional contract; this test pins the specific shape
    (argless with slash_command set) so a refactor that walks back
    the early-return in _extract_searchable_text breaks here too.
    """
    marker = {
        "uuid": "u1",
        "sender": "human",
        "text": "Session: /exit",
        "content": [{"type": "text", "text": "Session: /exit"}],
        "is_command_marker": True,
        "slash_command": "/exit",
    }
    projection = _extract_searchable_text(marker)
    assert projection == "", (
        f"argless marker must produce empty projection; got: {projection!r}"
    )


def test_message_with_none_slash_command_has_no_none_literal() -> None:
    """The NEGATIVE case: when `slash_command` is None, the projection
    MUST NOT contain the literal string `"None"`.

    If `_extract_searchable_text` ever regresses to
    `parts.append(message.get("slash_command"))` (no truthy guard) it
    would either crash (TypeError on `"\\n".join`) or — worse — pass
    through `str(None)` poisoning the FTS5 index with garbage tokens.
    This test pins the guard.
    """
    msg = {
        "uuid": "u1",
        "sender": "assistant",
        "text": "Just a normal assistant reply.",
        "content": [{"type": "text", "text": "Just a normal assistant reply."}],
        "slash_command": None,
    }
    projection = _extract_searchable_text(msg)
    assert "Just a normal assistant reply." in projection
    assert "None" not in projection, (
        f"projection must NOT contain the literal 'None'; got: {projection!r}"
    )


def test_message_with_absent_slash_command_field_works() -> None:
    """Defensive: a message dict with NO `slash_command` key at all
    (every claude.ai message — the field is CC-only) must produce a
    valid projection without raising. Trivial but pins the .get() guard.
    """
    msg = {
        "uuid": "u1",
        "sender": "human",
        "text": "Hello from Desktop.",
        "content": [{"type": "text", "text": "Hello from Desktop."}],
        # No `slash_command` key.
    }
    projection = _extract_searchable_text(msg)
    assert "Hello from Desktop." in projection
    assert "None" not in projection


def test_message_with_empty_string_slash_command_is_skipped() -> None:
    """Defensive: if some upstream path emits `slash_command=""`
    (shouldn't happen but the type is `str | None`), the truthy guard
    skips it cleanly — neither the empty string nor a stray separator
    pollutes the projection.

    Note on duplication: `_extract_searchable_text` deliberately appends
    BOTH `message["text"]` AND each `content[]` text block's text. For
    most CC and Desktop messages these mirror each other, so the body
    appears twice in the projection — this is pre-existing behavior and
    not what this test is checking. What we're pinning here is that an
    empty slash_command adds NO additional content (no stray "None",
    no spurious empty separator, no projection growth).
    """
    msg = {
        "uuid": "u1",
        "sender": "human",
        "text": "Body text.",
        "content": [{"type": "text", "text": "Body text."}],
        "slash_command": "",
    }
    projection = _extract_searchable_text(msg)
    # The body appears twice (text mirror + content block). The empty
    # slash_command must NOT add a third copy or a stray sep.
    assert projection.count("Body text.") == 2, (
        f"empty slash_command should add nothing; got: {projection!r}"
    )
    # And absolutely no "None" leak.
    assert "None" not in projection


def test_slash_command_projection_works_with_tool_calls_disabled() -> None:
    """The `include_tool_calls=False` projection path must ALSO include
    `slash_command` for ARGFUL markers (is_command_marker=False).
    Slash commands are user-visible content, not tool chatter — toggling
    "hide tool calls" must not silently hide them from search.

    Argless markers (is_command_marker=True) are excluded from search
    in BOTH projection variants — that contract is pinned in
    test_search_excludes_argless_markers.py. This test pins the
    complementary argful case across both variants.
    """
    marker = {
        "uuid": "u1",
        "sender": "human",
        "text": "Real /coding prompt.",
        "content": [{"type": "text", "text": "Real /coding prompt."}],
        "is_command_marker": False,  # argful → False per Fix-2
        "slash_command": "/coding",
    }
    proj_full = _extract_searchable_text(marker, include_tool_calls=True)
    proj_textonly = _extract_searchable_text(marker, include_tool_calls=False)
    assert "/coding" in proj_full
    assert "/coding" in proj_textonly, (
        "slash_command must appear in BOTH projection variants — "
        "toggling tool-call visibility must not hide slash commands"
    )
