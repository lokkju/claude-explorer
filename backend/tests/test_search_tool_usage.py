"""Search must hit text inside tool_use input and tool_result content blocks.

Build-8 #1 (BLOCKER) — see PLANS/explorer-improvements-build.md.
"""

from __future__ import annotations

from typing import Any

from backend.search import search_conversations


class FakeStore:
    """Minimal stand-in for ConversationStore.get_all_conversations_raw()."""

    def __init__(self, conversations: list[dict[str, Any]]):
        self._conversations = conversations

    def get_all_conversations_raw(self, source: str = "all") -> list[dict[str, Any]]:
        return self._conversations


def _conv_with_tool_use_input(query_token: str) -> dict[str, Any]:
    return {
        "uuid": "conv-tu",
        "name": "Conversation with tool_use",
        "summary": "",
        "created_at": "2024-03-01T12:00:00Z",
        "updated_at": "2024-03-01T13:00:00Z",
        "chat_messages": [
            {
                "uuid": "msg-tu-1",
                "sender": "assistant",
                "text": "",
                "content": [
                    {
                        "type": "tool_use",
                        "id": "tu-1",
                        "name": "Bash",
                        "input": {
                            "command": f"echo {query_token}",
                            "description": "demo",
                        },
                    }
                ],
                "created_at": "2024-03-01T12:00:00Z",
                "updated_at": "2024-03-01T12:00:00Z",
            }
        ],
    }


def _conv_with_tool_result_text(query_token: str) -> dict[str, Any]:
    return {
        "uuid": "conv-tr",
        "name": "Conversation with tool_result",
        "summary": "",
        "created_at": "2024-03-01T12:00:00Z",
        "updated_at": "2024-03-01T13:00:00Z",
        "chat_messages": [
            {
                "uuid": "msg-tr-1",
                "sender": "user",
                "text": "",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": "tu-1",
                        "content": [
                            {"type": "text", "text": f"Output line: {query_token}"}
                        ],
                    }
                ],
                "created_at": "2024-03-01T12:00:00Z",
                "updated_at": "2024-03-01T12:00:00Z",
            }
        ],
    }


def _conv_with_tool_result_string(query_token: str) -> dict[str, Any]:
    return {
        "uuid": "conv-tr-str",
        "name": "Conversation with tool_result (string content)",
        "summary": "",
        "created_at": "2024-03-01T12:00:00Z",
        "updated_at": "2024-03-01T13:00:00Z",
        "chat_messages": [
            {
                "uuid": "msg-tr-str-1",
                "sender": "user",
                "text": "",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": "tu-2",
                        "content": f"plain string output: {query_token}",
                    }
                ],
                "created_at": "2024-03-01T12:00:00Z",
                "updated_at": "2024-03-01T12:00:00Z",
            }
        ],
    }


def test_search_finds_text_in_tool_use_input() -> None:
    token = "search-target-token-A"
    store = FakeStore([_conv_with_tool_use_input(token)])

    results = search_conversations(store, token).results

    assert len(results) == 1, f"expected 1 hit on tool_use input, got {len(results)}"
    assert results[0].conversation_uuid == "conv-tu"
    assert any(m.message_uuid == "msg-tu-1" for m in results[0].matching_messages)


def test_search_finds_text_in_tool_result_blocks() -> None:
    token = "search-target-token-B"
    store = FakeStore([_conv_with_tool_result_text(token)])

    results = search_conversations(store, token).results

    assert len(results) == 1, f"expected 1 hit on tool_result text, got {len(results)}"
    assert results[0].conversation_uuid == "conv-tr"
    assert any(m.message_uuid == "msg-tr-1" for m in results[0].matching_messages)


def test_search_finds_text_in_tool_result_string_content() -> None:
    token = "search-target-token-C"
    store = FakeStore([_conv_with_tool_result_string(token)])

    results = search_conversations(store, token).results

    assert len(results) == 1, f"expected 1 hit on tool_result string content, got {len(results)}"
    assert results[0].conversation_uuid == "conv-tr-str"
    assert any(m.message_uuid == "msg-tr-str-1" for m in results[0].matching_messages)


def test_search_still_finds_plain_text_blocks() -> None:
    """Regression guard: the existing text-block search path must keep working."""
    token = "regression-guard-token"
    store = FakeStore(
        [
            {
                "uuid": "conv-text",
                "name": "Plain text",
                "summary": "",
                "created_at": "2024-03-01T12:00:00Z",
                "updated_at": "2024-03-01T13:00:00Z",
                "chat_messages": [
                    {
                        "uuid": "msg-text-1",
                        "sender": "human",
                        "text": f"Here is {token} in a normal text message.",
                        "content": [
                            {
                                "type": "text",
                                "text": f"Here is {token} in a normal text message.",
                            }
                        ],
                        "created_at": "2024-03-01T12:00:00Z",
                        "updated_at": "2024-03-01T12:00:00Z",
                    }
                ],
            }
        ]
    )

    results = search_conversations(store, token).results
    assert len(results) == 1
    assert results[0].matching_messages[0].message_uuid == "msg-text-1"
