"""Store module for reading conversation JSON files from disk."""

import json
from pathlib import Path
from datetime import datetime, timezone
from typing import Any

from .config import get_settings
from .models import (
    ConversationSummary,
    ConversationDetail,
    ConversationTree,
    Message,
    MessageNode,
    ContentBlock,
)


def _parse_datetime(dt_str: str | None) -> datetime:
    """Parse datetime string from Claude's JSON format."""
    if not dt_str:
        return datetime.now(timezone.utc)
    try:
        # Handle ISO format with optional timezone
        if dt_str.endswith("Z"):
            dt_str = dt_str[:-1] + "+00:00"
        dt = datetime.fromisoformat(dt_str)
        # Ensure timezone-aware
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        return datetime.now(timezone.utc)


def _extract_text(content: list[dict[str, Any]]) -> str:
    """Extract plain text from content blocks."""
    texts = []
    for block in content:
        if block.get("type") == "text" and block.get("text"):
            texts.append(block["text"])
    return "\n".join(texts)


def _parse_content_blocks(content: list[dict[str, Any]]) -> list[ContentBlock]:
    """Parse raw content blocks into ContentBlock models."""
    blocks = []
    for block in content:
        block_type = block.get("type", "text")
        parsed = ContentBlock(
            type=block_type,
            text=block.get("text"),
            name=block.get("name"),
            input=block.get("input"),
            content=_parse_content_blocks(block.get("content", []))
            if block.get("content")
            else None,
        )
        blocks.append(parsed)
    return blocks


def _parse_message(raw: dict[str, Any]) -> Message:
    """Parse a raw message dict into a Message model."""
    content = raw.get("content", [])
    return Message(
        uuid=raw.get("uuid", ""),
        sender=raw.get("sender", "human"),
        text=raw.get("text", "") or _extract_text(content),
        content=_parse_content_blocks(content),
        created_at=_parse_datetime(raw.get("created_at")),
        updated_at=_parse_datetime(raw.get("updated_at")),
        truncated=raw.get("truncated", False),
        parent_message_uuid=raw.get("parent_message_uuid"),
        attachments=raw.get("attachments", []),
        files=raw.get("files", []),
    )


def resolve_active_branch(
    messages: list[dict[str, Any]], leaf_uuid: str
) -> list[dict[str, Any]]:
    """Resolve the active branch by walking from leaf to root."""
    by_uuid = {m["uuid"]: m for m in messages}
    branch = []
    current = by_uuid.get(leaf_uuid)
    while current:
        branch.append(current)
        parent_uuid = current.get("parent_message_uuid")
        current = by_uuid.get(parent_uuid) if parent_uuid else None
    return list(reversed(branch))


def has_branches(messages: list[dict[str, Any]]) -> bool:
    """Check if the conversation has any branches (message with >1 child)."""
    child_count: dict[str | None, int] = {}
    for msg in messages:
        parent = msg.get("parent_message_uuid")
        child_count[parent] = child_count.get(parent, 0) + 1
    return any(count > 1 for count in child_count.values())


def build_message_tree(messages: list[dict[str, Any]]) -> list[MessageNode]:
    """Build the full message tree from flat message list."""
    children_map: dict[str | None, list[dict[str, Any]]] = {}

    for msg in messages:
        parent = msg.get("parent_message_uuid")
        if parent not in children_map:
            children_map[parent] = []
        children_map[parent].append(msg)

    def build_node(msg: dict[str, Any]) -> MessageNode:
        child_msgs = children_map.get(msg["uuid"], [])
        return MessageNode(
            message=_parse_message(msg),
            children=[build_node(c) for c in child_msgs],
        )

    # Root messages are those with no parent
    root_msgs = children_map.get(None, [])
    return [build_node(m) for m in root_msgs]


class ConversationStore:
    """Store for reading conversation data from disk."""

    def __init__(self, data_dir: Path | None = None):
        self.data_dir = data_dir or get_settings().data_dir

    def _get_conversation_files(self) -> list[Path]:
        """Get all conversation JSON files."""
        if not self.data_dir.exists():
            return []
        return sorted(self.data_dir.glob("*.json"))

    def _load_conversation(self, path: Path) -> dict[str, Any] | None:
        """Load a conversation from a JSON file."""
        try:
            with open(path) as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            return None

    def _make_summary(self, data: dict[str, Any]) -> ConversationSummary:
        """Create a ConversationSummary from raw conversation data."""
        chat_messages = data.get("chat_messages", [])
        human_count = sum(1 for m in chat_messages if m.get("sender") == "human")

        return ConversationSummary(
            uuid=data.get("uuid", ""),
            name=data.get("name", "Untitled"),
            summary=data.get("summary", ""),
            model=data.get("model", ""),
            created_at=_parse_datetime(data.get("created_at")),
            updated_at=_parse_datetime(data.get("updated_at")),
            is_starred=data.get("is_starred", False),
            is_temporary=data.get("is_temporary", False),
            message_count=len(chat_messages),
            human_message_count=human_count,
            has_branches=has_branches(chat_messages),
        )

    def list_conversations(
        self,
        search: str | None = None,
        starred: bool | None = None,
        model: str | None = None,
        sort: str = "updated_at",
    ) -> list[ConversationSummary]:
        """List all conversations with optional filtering."""
        conversations = []

        for path in self._get_conversation_files():
            data = self._load_conversation(path)
            if not data:
                continue

            # Apply filters
            if starred is not None and data.get("is_starred") != starred:
                continue
            if model and data.get("model") != model:
                continue
            if search:
                search_lower = search.lower()
                name_match = search_lower in data.get("name", "").lower()
                summary_match = search_lower in data.get("summary", "").lower()
                if not (name_match or summary_match):
                    continue

            conversations.append(self._make_summary(data))

        # Sort
        if sort == "name":
            conversations.sort(key=lambda c: c.name.lower())
        elif sort == "created_at":
            conversations.sort(key=lambda c: c.created_at, reverse=True)
        else:  # updated_at (default)
            conversations.sort(key=lambda c: c.updated_at, reverse=True)

        return conversations

    def get_conversation(self, uuid: str) -> ConversationDetail | None:
        """Get a single conversation by UUID with resolved active branch."""
        for path in self._get_conversation_files():
            data = self._load_conversation(path)
            if not data or data.get("uuid") != uuid:
                continue

            chat_messages = data.get("chat_messages", [])
            leaf_uuid = data.get("current_leaf_message_uuid", "")

            # Resolve active branch
            if leaf_uuid and chat_messages:
                branch = resolve_active_branch(chat_messages, leaf_uuid)
            else:
                branch = chat_messages

            messages = [_parse_message(m) for m in branch]
            human_count = sum(1 for m in chat_messages if m.get("sender") == "human")

            return ConversationDetail(
                uuid=data.get("uuid", ""),
                name=data.get("name", "Untitled"),
                summary=data.get("summary", ""),
                model=data.get("model", ""),
                created_at=_parse_datetime(data.get("created_at")),
                updated_at=_parse_datetime(data.get("updated_at")),
                is_starred=data.get("is_starred", False),
                is_temporary=data.get("is_temporary", False),
                message_count=len(chat_messages),
                human_message_count=human_count,
                has_branches=has_branches(chat_messages),
                messages=messages,
                current_leaf_message_uuid=leaf_uuid,
            )

        return None

    def get_conversation_tree(self, uuid: str) -> ConversationTree | None:
        """Get the full message tree for a conversation."""
        for path in self._get_conversation_files():
            data = self._load_conversation(path)
            if not data or data.get("uuid") != uuid:
                continue

            chat_messages = data.get("chat_messages", [])
            leaf_uuid = data.get("current_leaf_message_uuid", "")

            # Build full tree
            root_messages = build_message_tree(chat_messages)

            # Get active path
            if leaf_uuid:
                branch = resolve_active_branch(chat_messages, leaf_uuid)
                active_path = [m["uuid"] for m in branch]
            else:
                active_path = []

            return ConversationTree(
                uuid=uuid,
                root_messages=root_messages,
                active_path=active_path,
            )

        return None

    def get_all_conversations_raw(self) -> list[dict[str, Any]]:
        """Get all raw conversation data for search/export."""
        conversations = []
        for path in self._get_conversation_files():
            data = self._load_conversation(path)
            if data:
                conversations.append(data)
        return conversations

    def count_conversations(self) -> int:
        """Count total number of conversations."""
        return len(self._get_conversation_files())