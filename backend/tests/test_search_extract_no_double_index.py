"""Regression: ``_extract_searchable_text`` must not double-index text
that appears in BOTH ``message['text']`` and a ``content[i].text`` block.

The bug surfaced as doubled snippets in the search panel — e.g. a
single assistant message rendered as

    Good! Now let me deploy this image:
    Good! Now let me deploy this image:

…in the right-hand search result, while the conversation pane on
the left showed the line exactly ONCE.

Root cause: `backend.store._parse_message` populates
``Message.text`` from ``raw.get("text", "") or _extract_text(content)``,
so for both Desktop and Claude Code messages the ``text`` field ends
up holding the same string the ``content`` text-blocks already carry.
``_extract_searchable_text`` then appends BOTH (lines 132 + 158),
producing a `"X\nX"` indexed body. FTS5's ``snippet()`` faithfully
echoes the double in its output, and the frontend renders it.

The fix: skip ``message['text']`` when ``content`` already contains
text blocks. Treat the content blocks as the canonical source —
matching the frontend ``MessageBubble`` renderer, which also prefers
blocks.

Bidirectional pair:

  * `test_no_double_index_when_text_and_content_both_present` — the
    bug case. Must yield the substring exactly once.
  * `test_uses_text_when_content_has_no_text_blocks` — the fallback
    case. A message with only a ``tool_use`` block (no text blocks)
    must still expose its ``message['text']`` for indexing, otherwise
    the bare-text legacy path silently loses content.
  * `test_uses_text_when_content_missing_entirely` — Desktop-API
    legacy shape where ``content`` may be absent. Still index from
    ``message['text']``.
"""

from __future__ import annotations

from backend.search import _extract_searchable_text


def test_no_double_index_when_text_and_content_both_present():
    """The bug case: ``text`` and a ``text`` content block carry the
    same string. Indexed body MUST contain "deploy this image" once,
    not twice.
    """
    msg = {
        "uuid": "m-1",
        "sender": "assistant",
        "text": "Good! Now let me deploy this image:",
        "content": [
            {"type": "text", "text": "Good! Now let me deploy this image:"},
            {"type": "tool_use", "name": "Bash",
             "input": {"command": "echo hi"}},
        ],
    }
    body = _extract_searchable_text(msg, include_tool_calls=True)
    # The substring must appear exactly once for the visible text.
    occurrences = body.count("Good! Now let me deploy this image:")
    assert occurrences == 1, (
        f"text was indexed {occurrences}x — duplication regression. "
        f"Body head: {body[:200]!r}"
    )


def test_uses_text_when_content_has_no_text_blocks():
    """Fallback contract: when ``content`` has blocks but none are
    ``type=='text'`` (e.g. only ``tool_use``), the indexer must still
    fall back to ``message['text']`` so the message's visible prose
    isn't silently dropped from the index.
    """
    msg = {
        "uuid": "m-2",
        "sender": "assistant",
        "text": "I will now run this command for you.",
        "content": [
            {"type": "tool_use", "name": "Bash",
             "input": {"command": "ls -la"}},
        ],
    }
    body = _extract_searchable_text(msg, include_tool_calls=True)
    assert "I will now run this command for you." in body, (
        f"fallback to message['text'] dropped — bare-text msg path broken. "
        f"Body: {body!r}"
    )


def test_uses_text_when_content_missing_entirely():
    """Fallback contract: legacy Desktop shape with no ``content`` key
    at all must still index from ``message['text']``.
    """
    msg = {
        "uuid": "m-3",
        "sender": "human",
        "text": "Just a plain text message.",
    }
    body = _extract_searchable_text(msg, include_tool_calls=True)
    assert "Just a plain text message." in body


def test_no_double_index_with_tools_off():
    """Same as the primary bug case but with ``include_tool_calls=False``
    (the projection used by ``body_text``). Must also dedupe.
    """
    msg = {
        "uuid": "m-4",
        "sender": "assistant",
        "text": "Good! Now let me deploy this image:",
        "content": [
            {"type": "text", "text": "Good! Now let me deploy this image:"},
            {"type": "tool_use", "name": "Bash",
             "input": {"command": "deploy"}},
        ],
    }
    body = _extract_searchable_text(msg, include_tool_calls=False)
    occurrences = body.count("Good! Now let me deploy this image:")
    assert occurrences == 1, (
        f"text was indexed {occurrences}x in body_text projection — "
        f"duplication regression. Body: {body!r}"
    )


def test_multiple_text_blocks_all_indexed():
    """Bidirectional pair: when ``content`` has MULTIPLE distinct
    text blocks, all of them must be indexed. Test that the dedupe
    fix doesn't accidentally drop legitimate per-block text.

    The frontend renders blocks in order, so each block's text is
    user-visible and must be searchable.
    """
    msg = {
        "uuid": "m-5",
        "sender": "assistant",
        # text field carries the joined projection (typical _extract_text
        # output: "\n".join(block.text for text blocks)).
        "text": "Part one of the answer.\nPart two of the answer.",
        "content": [
            {"type": "text", "text": "Part one of the answer."},
            {"type": "text", "text": "Part two of the answer."},
        ],
    }
    body = _extract_searchable_text(msg, include_tool_calls=True)
    assert "Part one of the answer." in body
    assert "Part two of the answer." in body
    # Neither must appear twice (the join must use blocks, not text+blocks).
    assert body.count("Part one of the answer.") == 1
    assert body.count("Part two of the answer.") == 1
