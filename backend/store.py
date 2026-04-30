"""Store module for reading conversation JSON files from disk."""

import json
from pathlib import Path
from datetime import datetime, timezone
from typing import Any, Literal

from .config import get_settings
from .claude_code_reader import (
    list_claude_code_conversations,
    read_claude_code_conversation,
    discover_jsonl_files,
    DEFAULT_CLAUDE_DIR,
)
from .models import (
    ConversationSummary,
    ConversationDetail,
    ConversationTree,
    Message,
    MessageNode,
    ContentBlock,
    SubagentSummary,
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
        if isinstance(block, str):
            # Sometimes content is a plain string (e.g., tool_result)
            blocks.append(ContentBlock(type="text", text=block))
            continue

        block_type = block.get("type", "text")
        # Handle nested content - can be string or list
        nested_content = block.get("content")
        if nested_content and isinstance(nested_content, list):
            parsed_nested = _parse_content_blocks(nested_content)
        elif nested_content and isinstance(nested_content, str):
            parsed_nested = [ContentBlock(type="text", text=nested_content)]
        else:
            parsed_nested = None

        parsed = ContentBlock(
            type=block_type,
            text=block.get("text"),
            name=block.get("name"),
            input=block.get("input"),
            content=parsed_nested,
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
    """Resolve the active branch by walking from leaf to root.

    Handles circular references in parent chain by tracking visited nodes.
    """
    by_uuid = {m["uuid"]: m for m in messages}
    branch = []
    visited: set[str] = set()
    current = by_uuid.get(leaf_uuid)
    while current:
        uuid = current["uuid"]
        if uuid in visited:
            # Circular reference detected - stop here
            break
        visited.add(uuid)
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
    """Build the full message tree from flat message list.

    Uses iterative BFS approach to handle conversations with thousands of messages
    without hitting Python's recursion limit. Handles circular references safely.
    """
    if not messages:
        return []

    # Build parent->children map
    children_map: dict[str | None, list[str]] = {}
    msg_by_uuid: dict[str, dict[str, Any]] = {}

    for msg in messages:
        uuid = msg["uuid"]
        parent = msg.get("parent_message_uuid")
        # Detect and break self-referential parent links. A message that claims
        # its own UUID as its parent would produce a MessageNode that contains
        # itself in its children list, causing a Pydantic serialization cycle
        # (PydanticSerializationError: Circular reference detected). Treat the
        # node as a root instead.
        if parent == uuid:
            parent = None
        msg_by_uuid[uuid] = msg
        if parent not in children_map:
            children_map[parent] = []
        children_map[parent].append(uuid)

    # Track which nodes have been added to the tree to prevent cycles
    in_tree: set[str] = set()
    nodes: dict[str, MessageNode] = {}

    # BFS from root nodes
    root_uuids = children_map.get(None, [])
    queue: list[str] = list(root_uuids)
    root_nodes: list[MessageNode] = []

    while queue:
        uuid = queue.pop(0)
        if uuid in in_tree:
            # Skip - already processed (prevents cycles)
            continue
        if uuid not in msg_by_uuid:
            continue

        in_tree.add(uuid)

        # Create node
        node = MessageNode(
            message=_parse_message(msg_by_uuid[uuid]),
            children=[],
        )
        nodes[uuid] = node

        # If this is a root node, add to root list
        parent_uuid = msg_by_uuid[uuid].get("parent_message_uuid")
        if parent_uuid is None or parent_uuid == uuid:
            # parent_uuid == uuid: self-loop guard. This can occur when a later
            # raw record for the same UUID overwrites msg_by_uuid after
            # children_map was already built, restoring a self-referential
            # parent link that the children_map construction pass already
            # cleared. Treat as a root to avoid appending this node as its own
            # child, which would create a Python object cycle.
            root_nodes.append(node)
        elif parent_uuid in nodes:
            # Add as child of parent
            nodes[parent_uuid].children.append(node)

        # Queue children for processing
        for child_uuid in children_map.get(uuid, []):
            if child_uuid not in in_tree:
                queue.append(child_uuid)

    return root_nodes


class ConversationStore:
    """Store for reading conversation data from disk and Claude Code JSONL files."""

    def __init__(self, data_dir: Path | None = None, claude_dir: Path | None = None):
        self.data_dir = data_dir or get_settings().data_dir
        self.claude_dir = claude_dir or DEFAULT_CLAUDE_DIR

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

    def _make_summary(self, data: dict[str, Any], include_subagents: bool = False) -> ConversationSummary:
        """Create a ConversationSummary from raw conversation data."""
        chat_messages = data.get("chat_messages", [])
        # Use pre-computed counts if available (from fast reader), else calculate
        if chat_messages:
            message_count = len(chat_messages)
            human_count = sum(1 for m in chat_messages if m.get("sender") == "human")
        else:
            message_count = data.get("message_count", 0)
            human_count = data.get("human_message_count", 0)

        # Parse subagents if requested
        subagents = []
        if include_subagents:
            for agent_data in data.get("subagents", []):
                subagents.append(SubagentSummary(
                    uuid=agent_data.get("uuid", ""),
                    agent_id=agent_data.get("agent_id", ""),
                    name=agent_data.get("name", ""),
                    model=agent_data.get("model", ""),
                    created_at=_parse_datetime(agent_data.get("created_at")),
                    updated_at=_parse_datetime(agent_data.get("updated_at")),
                    message_count=agent_data.get("message_count", 0),
                ))

        return ConversationSummary(
            uuid=data.get("uuid", ""),
            name=data.get("name", "Untitled"),
            summary=data.get("summary", ""),
            model=data.get("model", ""),
            created_at=_parse_datetime(data.get("created_at")),
            updated_at=_parse_datetime(data.get("updated_at")),
            is_starred=data.get("is_starred", False),
            is_temporary=data.get("is_temporary", False),
            message_count=message_count,
            human_message_count=human_count,
            has_branches=data.get("has_branches", False) if not chat_messages else has_branches(chat_messages),
            source=data.get("source", "CLAUDE_AI"),
            project_path=data.get("project_path"),
            git_branch=data.get("git_branch"),
            subagents=subagents,
        )

    def _get_claude_code_conversations(
        self, full_content: bool = False, include_phantom: bool = False
    ) -> list[dict[str, Any]]:
        """Get all Claude Code conversations from JSONL files.

        Args:
            full_content: If True, read full message content (slower, for search).
                         If False, only read metadata (fast, for listing).
            include_phantom: If True, include phantom sessions (local command artifacts).
        """
        return list_claude_code_conversations(
            self.claude_dir, full_content=full_content, include_phantom=include_phantom
        )

    def _get_all_conversations_data(
        self,
        source: Literal["all", "CLAUDE_AI", "CLAUDE_CODE"] = "all",
        full_content: bool = False,
        include_phantom: bool = False,
    ) -> list[dict[str, Any]]:
        """Get raw conversation data from all sources.

        Args:
            source: Filter by conversation source
            full_content: If True, read full message content (for search).
                         If False, only read metadata (fast, for listing).
            include_phantom: If True, include phantom sessions (local command artifacts).
        """
        conversations = []

        # Load Claude Desktop conversations (from JSON files)
        if source in ("all", "CLAUDE_AI"):
            for path in self._get_conversation_files():
                data = self._load_conversation(path)
                if data:
                    # Skip Claude Code conversations that might have been imported
                    if data.get("source") == "CLAUDE_CODE":
                        continue
                    conversations.append(data)

        # Load Claude Code conversations (from JSONL files)
        if source in ("all", "CLAUDE_CODE"):
            conversations.extend(self._get_claude_code_conversations(
                full_content=full_content, include_phantom=include_phantom
            ))

        return conversations

    def list_conversations(
        self,
        search: str | None = None,
        starred: bool | None = None,
        model: str | None = None,
        source: Literal["all", "CLAUDE_AI", "CLAUDE_CODE"] = "all",
        sort: str = "updated_at",
        sort_order: Literal["asc", "desc"] = "desc",
        include_phantom: bool = False,
        include_subagents: bool = False,
    ) -> list[ConversationSummary]:
        """List all conversations with optional filtering."""
        conversations = []

        for data in self._get_all_conversations_data(source, include_phantom=include_phantom):
            # Apply filters
            if starred is not None and data.get("is_starred") != starred:
                continue
            if model and data.get("model") != model:
                continue
            if search:
                search_lower = search.lower()
                name_match = search_lower in data.get("name", "").lower()
                summary_match = search_lower in data.get("summary", "").lower()
                project_match = search_lower in data.get("project_path", "").lower()
                if not (name_match or summary_match or project_match):
                    continue

            conversations.append(self._make_summary(data, include_subagents=include_subagents))

        # Sort
        reverse = sort_order == "desc"
        if sort == "name":
            conversations.sort(key=lambda c: c.name.lower(), reverse=reverse)
        elif sort == "created_at":
            conversations.sort(key=lambda c: c.created_at, reverse=reverse)
        elif sort == "project":
            # Sort by project_name (None values go last)
            conversations.sort(
                key=lambda c: (c.project_name is None, (c.project_name or "").lower()),
                reverse=reverse,
            )
        else:  # updated_at (default)
            conversations.sort(key=lambda c: c.updated_at, reverse=reverse)

        return conversations

    def _find_conversation_data(self, uuid: str) -> tuple[dict[str, Any] | None, Path | None]:
        """Find conversation data by UUID from any source.

        Returns (data, file_path) tuple.
        """
        # First check Claude Desktop JSON files
        for path in self._get_conversation_files():
            data = self._load_conversation(path)
            if data and data.get("uuid") == uuid:
                return data, path

        # Then check Claude Code JSONL files
        for jsonl_path in discover_jsonl_files(self.claude_dir):
            if jsonl_path.stem == uuid:
                data = read_claude_code_conversation(jsonl_path)
                if data and data.get("uuid") == uuid:
                    return data, jsonl_path

        return None, None

    def get_conversation(self, uuid: str, leaf_override: str | None = None) -> ConversationDetail | None:
        """Get a single conversation by UUID with resolved active branch.

        Args:
            uuid: Conversation UUID.
            leaf_override: If provided, render the branch ending at this message
                UUID instead of the conversation's stored current leaf.
        """
        data, file_path = self._find_conversation_data(uuid)
        if not data:
            return None

        chat_messages = data.get("chat_messages", [])
        stored_leaf = data.get("current_leaf_message_uuid", "")
        leaf_uuid = leaf_override or stored_leaf
        # Validate leaf_override actually exists in this conversation; fall back
        # to the stored leaf if the caller passed something stale.
        if leaf_override and not any(m.get("uuid") == leaf_override for m in chat_messages):
            leaf_uuid = stored_leaf

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
            source=data.get("source", "CLAUDE_AI"),
            project_path=data.get("project_path"),
            git_branch=data.get("git_branch"),
            messages=messages,
            current_leaf_message_uuid=leaf_uuid,
            file_path=str(file_path) if file_path else None,
            compact_markers=data.get("compact_markers", []),
        )

    def get_conversation_tree(self, uuid: str) -> ConversationTree | None:
        """Get the full message tree for a conversation."""
        data, _ = self._find_conversation_data(uuid)
        if not data:
            return None

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

    def get_all_conversations_raw(
        self,
        source: Literal["all", "CLAUDE_AI", "CLAUDE_CODE"] = "all",
    ) -> list[dict[str, Any]]:
        """Get all raw conversation data for search/export (includes full message content)."""
        return self._get_all_conversations_data(source, full_content=True)

    def count_conversations(
        self,
        source: Literal["all", "CLAUDE_AI", "CLAUDE_CODE"] = "all",
    ) -> int:
        """Count total number of conversations."""
        return len(self._get_all_conversations_data(source))