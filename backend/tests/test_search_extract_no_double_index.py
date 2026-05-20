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


# ---------------------------------------------------------------------------
# Tool-arg dedupe (SCHEMA_VERSION v8 → v9, 2026-05-19)
#
# `_stringify_tool_input` originally appended BOTH ``json.dumps(tool_input)``
# (the whole dict, keys and values) AND each top-level string value
# verbatim — so for `{"command": "echo hello"}` the FTS5 body carried
# ``"echo hello"`` twice and ``snippet()`` echoed the duplication on every
# tool-call search hit.
#
# Option-C fix: emit a keys-only projection (so JSON keys remain searchable
# as tokens) + emit each unique string value exactly once (recursing into
# nested dicts/lists). Two search axes preserved, no overlap.
# ---------------------------------------------------------------------------


def test_tool_input_value_appears_once_in_body():
    """Bug case: `{"command": "echo hello world"}` must NOT double the
    value-text. Pre-v9 indexer appended both json.dumps AND the per-value
    string, so "echo hello world" appeared twice in the body — visible
    in the UI as doubled snippet rows on every tool-call hit.
    """
    msg = {
        "uuid": "m-tool-1",
        "sender": "assistant",
        "text": "",
        "content": [
            {
                "type": "tool_use",
                "name": "Bash",
                "input": {"command": "echo hello world"},
            },
        ],
    }
    body = _extract_searchable_text(msg, include_tool_calls=True)
    occurrences = body.count("echo hello world")
    assert occurrences == 1, (
        f"tool-input value was indexed {occurrences}x — pre-v9 doubling "
        f"regression. Body: {body!r}"
    )


def test_tool_input_key_remains_searchable():
    """Sibling positive: dropping the raw json.dumps projection must NOT
    break the JSON-key search axis. A user searching for ``command`` must
    still match a message whose only searchable surface is a tool_use
    block with a ``command`` key.
    """
    msg = {
        "uuid": "m-tool-2",
        "sender": "assistant",
        "text": "",
        "content": [
            {
                "type": "tool_use",
                "name": "Bash",
                "input": {"command": "deploy"},
            },
        ],
    }
    body = _extract_searchable_text(msg, include_tool_calls=True)
    assert "command" in body, (
        f"key projection lost — `command` key must remain searchable. "
        f"Body: {body!r}"
    )


def test_tool_input_value_remains_searchable():
    """Sibling positive: the per-value string projection must still
    surface value-text to the FTS5 index. A user searching for ``hello``
    must match `{"command": "echo hello world"}`.
    """
    msg = {
        "uuid": "m-tool-3",
        "sender": "assistant",
        "text": "",
        "content": [
            {
                "type": "tool_use",
                "name": "Bash",
                "input": {"command": "echo hello world"},
            },
        ],
    }
    body = _extract_searchable_text(msg, include_tool_calls=True)
    assert "hello" in body, (
        f"value projection lost — `hello` must remain searchable. "
        f"Body: {body!r}"
    )


def test_tool_input_key_appears_once_per_unique_key():
    """Bug case sibling: a tool_use key like ``command`` must NOT be
    repeated in the body. Pre-v9, json.dumps produced ``"command":`` AND
    nothing else repeated the key — so this passed by accident. Post-v9,
    we project keys explicitly; the regression to catch is "key emitted
    once per occurrence in the dict" (e.g. a nested dict re-using the same
    key would double-count). Lock that down here.
    """
    msg = {
        "uuid": "m-tool-4",
        "sender": "assistant",
        "text": "",
        "content": [
            {
                "type": "tool_use",
                "name": "Bash",
                "input": {"command": "ls -la"},
            },
        ],
    }
    body = _extract_searchable_text(msg, include_tool_calls=True)
    occurrences = body.count("command")
    assert occurrences == 1, (
        f"key `command` appeared {occurrences}x — Option-C projection "
        f"must emit each key once. Body: {body!r}"
    )


def test_tool_input_nested_values_indexed_once():
    """Nested-dict / list values must be reachable for value-text search
    AND must NOT double. `{"args": ["hello", "world"], "cwd": "/tmp"}`:
    every leaf string appears exactly once.
    """
    msg = {
        "uuid": "m-tool-5",
        "sender": "assistant",
        "text": "",
        "content": [
            {
                "type": "tool_use",
                "name": "Shell",
                "input": {
                    "args": ["hello", "world"],
                    "cwd": "/tmp/workspace",
                },
            },
        ],
    }
    body = _extract_searchable_text(msg, include_tool_calls=True)
    # All values reachable.
    assert "hello" in body
    assert "world" in body
    assert "/tmp/workspace" in body
    # Each value appears exactly once.
    assert body.count("hello") == 1, f"`hello` doubled: {body!r}"
    assert body.count("world") == 1, f"`world` doubled: {body!r}"
    assert body.count("/tmp/workspace") == 1, f"`/tmp/workspace` doubled: {body!r}"
    # Nested keys still searchable.
    assert "args" in body
    assert "cwd" in body


def test_tool_input_duplicate_string_value_appears_once():
    """Bidirectional dedupe: if the SAME string appears as two distinct
    values in the input (e.g. `{"old_string": "x", "new_string": "x"}` —
    rare but valid), the body should still carry it only once. This is
    the strict-dedupe contract — Option C synthesizes a set-deduped value
    projection.
    """
    msg = {
        "uuid": "m-tool-6",
        "sender": "assistant",
        "text": "",
        "content": [
            {
                "type": "tool_use",
                "name": "Edit",
                "input": {
                    "old_string": "needle-X",
                    "new_string": "needle-X",
                },
            },
        ],
    }
    body = _extract_searchable_text(msg, include_tool_calls=True)
    assert body.count("needle-X") == 1, (
        f"duplicate value was indexed {body.count('needle-X')}x — "
        f"Option-C must dedupe value-strings. Body: {body!r}"
    )
