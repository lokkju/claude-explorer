"""Tests for compact-marker extraction.

Build-7 — see PLANS/explorer-improvements-build.md.

A compact marker is a synthetic user message with `isCompactSummary: true` (CC only).
Each marker is classified `auto` or `manual` based on the presence of a
`<command-name>/compact</command-name>` user message in the small lookahead
window AFTER the compact-summary entry. Manual markers also extract the
user-typed `<command-args>` payload.
"""

from __future__ import annotations

from pathlib import Path

from backend.claude_code_reader import (
    extract_compact_markers,
    read_claude_code_conversation,
)

FIXTURES = Path(__file__).parent / "fixtures" / "jsonl"


def test_extract_compact_markers_auto_only() -> None:
    conv = read_claude_code_conversation(FIXTURES / "compact_auto_only.jsonl")
    assert conv is not None
    markers = conv.get("compact_markers", [])
    assert len(markers) == 1
    m = markers[0]
    assert m["kind"] == "auto"
    assert m["user_prompt"] is None
    assert m["message_uuid"] == "u2"
    assert "Auto-compact summary" in m["summary_text"]
    assert m["timestamp"] == "2026-04-01T11:00:00Z"


def test_extract_compact_markers_manual_only() -> None:
    conv = read_claude_code_conversation(FIXTURES / "compact_manual_only.jsonl")
    assert conv is not None
    markers = conv.get("compact_markers", [])
    assert len(markers) == 1
    m = markers[0]
    assert m["kind"] == "manual"
    assert m["user_prompt"] == "focus on tests and refactor the auth module"
    assert "Manual compact summary" in m["summary_text"]


def test_extract_compact_markers_mixed() -> None:
    conv = read_claude_code_conversation(FIXTURES / "compact_mixed.jsonl")
    assert conv is not None
    markers = conv.get("compact_markers", [])
    assert len(markers) == 2

    auto_marker = markers[0]
    assert auto_marker["kind"] == "auto"
    assert auto_marker["user_prompt"] is None
    assert auto_marker["message_uuid"] == "u2"

    manual_marker = markers[1]
    assert manual_marker["kind"] == "manual"
    assert manual_marker["user_prompt"] == "preserve context for the build phase"
    assert manual_marker["message_uuid"] == "u4"


def test_extract_compact_markers_no_compacts() -> None:
    conv = read_claude_code_conversation(FIXTURES / "no_summary.jsonl")
    assert conv is not None
    assert conv.get("compact_markers", []) == []


def test_extract_compact_markers_helper_directly() -> None:
    """The pure-function entry point should accept raw entries."""
    entries = [
        {"type": "user", "uuid": "u1", "isCompactSummary": True, "timestamp": "2026-01-01T00:00:00Z",
         "message": {"role": "user", "content": "Auto summary."}},
        {"type": "user", "uuid": "u2", "timestamp": "2026-01-01T00:00:01Z",
         "message": {"role": "user", "content": "next prompt"}},
    ]
    markers = extract_compact_markers(entries)
    assert len(markers) == 1
    assert markers[0]["kind"] == "auto"
    assert markers[0]["user_prompt"] is None


def test_extract_compact_markers_manual_via_lookahead() -> None:
    entries = [
        {"type": "user", "uuid": "u1", "isCompactSummary": True, "timestamp": "2026-01-01T00:00:00Z",
         "message": {"role": "user", "content": "Manual summary"}},
        {"type": "user", "uuid": "u2", "timestamp": "2026-01-01T00:00:01Z",
         "message": {"role": "user", "content": "<command-name>/compact</command-name>\n<command-args>refocus on auth</command-args>"}},
    ]
    markers = extract_compact_markers(entries)
    assert len(markers) == 1
    assert markers[0]["kind"] == "manual"
    assert markers[0]["user_prompt"] == "refocus on auth"


def test_extract_compact_markers_list_content_blocks() -> None:
    """Manual-classification scan must handle list-shaped message content."""
    entries = [
        {"type": "user", "uuid": "u1", "isCompactSummary": True, "timestamp": "2026-01-01T00:00:00Z",
         "message": {"role": "user", "content": [{"type": "text", "text": "Manual summary in blocks"}]}},
        {"type": "user", "uuid": "u2", "timestamp": "2026-01-01T00:00:01Z",
         "message": {"role": "user", "content": [
             {"type": "text", "text": "<command-name>/compact</command-name>\n<command-args>handle blocks</command-args>"}
         ]}},
    ]
    markers = extract_compact_markers(entries)
    assert len(markers) == 1
    assert markers[0]["kind"] == "manual"
    assert markers[0]["user_prompt"] == "handle blocks"
    assert "Manual summary in blocks" in markers[0]["summary_text"]


def test_compact_markers_in_conversation_summary_lookup() -> None:
    """When the API returns a CC conversation, compact_markers field must be present."""
    conv = read_claude_code_conversation(FIXTURES / "compact_mixed.jsonl")
    assert conv is not None
    assert "compact_markers" in conv
