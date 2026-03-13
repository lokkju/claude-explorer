"""
Read Claude Code conversations directly from local JSONL files.

Claude Code (CLI and Desktop Code tab) stores conversations locally at:
    ~/.claude/projects/{project-path-encoded}/{session-uuid}.jsonl

This module reads those JSONL files on-the-fly without copying them.
Features:
- orjson for fast JSON parsing (3-10x faster than stdlib)
- Memory cache with mtime-based invalidation
- Parallel file reading with ThreadPoolExecutor
"""

import orjson
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from .cache import (
    get_conversation_cache,
    parse_jsonl_fast,
    parse_jsonl_fast_limited,
)

# Default Claude directory
DEFAULT_CLAUDE_DIR = Path.home() / ".claude"


def parse_jsonl_file(path: Path) -> list[dict]:
    """Parse a JSONL file and return all entries.

    Uses orjson for ~5x faster parsing than stdlib json.
    """
    return parse_jsonl_fast(path)


def _parse_datetime(dt_str: str | None) -> datetime:
    """Parse datetime string from Claude's format."""
    if not dt_str:
        return datetime.now(timezone.utc)
    try:
        if dt_str.endswith("Z"):
            dt_str = dt_str[:-1] + "+00:00"
        dt = datetime.fromisoformat(dt_str)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        return datetime.now(timezone.utc)


def read_conversation_summary_fast(jsonl_path: Path) -> dict[str, Any] | None:
    """Read metadata from a JSONL file for fast listing.

    Scans the entire file to:
    - Find first user/assistant entries for metadata
    - Count all user entries and unique assistant message IDs
    """
    summary_entry = None
    first_user = None
    first_real_user = None  # First user message that's not a system "Caveat" message
    first_assistant = None
    first_timestamp = None

    # Message counting
    user_count = 0
    assistant_message_ids: set[str] = set()

    def _get_message_text(entry: dict) -> str:
        """Extract text content from a message entry."""
        msg = entry.get("message", {})
        content = msg.get("content", "")
        if isinstance(content, str):
            return content
        elif isinstance(content, list):
            text_parts = [b.get("text", "") for b in content if b.get("type") == "text"]
            return " ".join(text_parts)
        return ""

    def _is_system_message(entry: dict) -> bool:
        """Check if a user entry is a system message (Caveat, bash I/O, tool results, commands)."""
        msg = entry.get("message", {})
        content = msg.get("content", "")

        if isinstance(content, list):
            # Check for tool_result blocks (these are not real user messages)
            if any(b.get("type") == "tool_result" for b in content):
                return True

        text = _get_message_text(entry)

        # Skip system-generated messages and command infrastructure
        return (
            text.startswith("Caveat: The messages below were generated")
            or text.startswith("<local-command-caveat>")
            or text.startswith("<bash-input>")
            or text.startswith("<bash-stdout>")
            or text.startswith("<bash-stderr>")
            or text.startswith("<command-message>")
            or text.startswith("<command-name>")
            or text.startswith("Unknown skill:")
            or text.startswith("Unknown command:")
        )

    def _extract_title_from_message(entry: dict) -> str | None:
        """Extract a clean title from a message, handling XML tags and special formats."""
        import re

        text = _get_message_text(entry)
        if not text:
            return None

        # Try to extract command name from <command-name>/foo</command-name>
        cmd_match = re.search(r"<command-name>(/[^<]+)</command-name>", text)
        if cmd_match:
            return cmd_match.group(1)

        # Skip messages that are just XML infrastructure
        if text.startswith("<") and ">" in text:
            # Check if there's useful content after the XML tags
            # Remove all XML tags and see what's left
            clean = re.sub(r"<[^>]+>", "", text).strip()
            if clean and len(clean) > 10:
                text = clean
            else:
                return None

        # Clean up markdown and get first meaningful line
        lines = text.strip().split("\n")
        for line in lines:
            # Strip markdown headers and whitespace
            clean_line = re.sub(r"^#+\s*", "", line).strip()
            # Skip empty lines and short fragments
            if clean_line and len(clean_line) > 5:
                return clean_line[:100]

        return text[:100].strip() if text.strip() else None

    try:
        with open(jsonl_path, "rb") as f:  # Binary mode for orjson
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = orjson.loads(line)
                    entry_type = entry.get("type")

                    # Extract metadata from first occurrences
                    ts = entry.get("timestamp")
                    if ts and first_timestamp is None:
                        first_timestamp = ts

                    if entry_type == "summary" and not summary_entry:
                        summary_entry = entry
                    elif entry_type == "user":
                        user_count += 1
                        if not first_user:
                            first_user = entry
                        # Track first real user message for title extraction
                        if not first_real_user and not _is_system_message(entry):
                            first_real_user = entry
                    elif entry_type == "assistant":
                        # Dedupe by message.id to handle streaming chunks
                        msg = entry.get("message", {})
                        msg_id = msg.get("id")
                        if msg_id:
                            assistant_message_ids.add(msg_id)
                        if not first_assistant:
                            first_assistant = entry

                except orjson.JSONDecodeError:
                    pass
    except (OSError, IOError):
        return None

    if not first_user:
        return None

    # Build metadata - use first_real_user (non-system) for title if available
    name = summary_entry.get("summary") if summary_entry else None
    if not name and first_real_user:
        name = _extract_title_from_message(first_real_user)

    if not name:
        name = jsonl_path.stem

    # Detect phantom sessions (local command artifacts with no real conversation)
    # A phantom session starts with "Caveat:" AND has no assistant responses
    is_phantom = (
        name.startswith("Caveat: The messages below were generated")
        and len(assistant_message_ids) == 0
    )

    session_id = first_user.get("sessionId", jsonl_path.stem)
    cwd = first_user.get("cwd", "")
    git_branch = first_user.get("gitBranch", "")

    # Get model
    model = ""
    if first_assistant:
        msg = first_assistant.get("message", {})
        model = msg.get("model", "")

    # Use file mtime for updated_at (fast)
    created_at = _parse_datetime(first_timestamp)
    try:
        mtime = jsonl_path.stat().st_mtime
        updated_at = datetime.fromtimestamp(mtime, tz=timezone.utc)
    except OSError:
        updated_at = created_at

    # Total messages = user messages + unique assistant responses
    message_count = user_count + len(assistant_message_ids)

    return {
        "uuid": session_id,
        "name": name,
        "summary": "",
        "model": model,
        "created_at": created_at.isoformat(),
        "updated_at": updated_at.isoformat(),
        "is_starred": False,
        "is_temporary": False,
        "project_path": cwd,
        "git_branch": git_branch,
        "source": "CLAUDE_CODE",
        "message_count": message_count,
        "human_message_count": user_count,
        "has_branches": False,
        "is_phantom": is_phantom,
    }


def _extract_conversation_metadata(entries: list[dict], jsonl_path: Path) -> dict:
    """Extract metadata from JSONL entries."""
    # Find summary entry for name
    summary_entry = next((e for e in entries if e.get("type") == "summary"), None)
    name = summary_entry.get("summary") if summary_entry else None

    # Get user and assistant messages
    user_entries = [e for e in entries if e.get("type") == "user"]
    assistant_entries = [e for e in entries if e.get("type") == "assistant"]

    # Timestamps from all entries
    all_timestamps = []
    for e in entries:
        ts = e.get("timestamp")
        if ts:
            try:
                all_timestamps.append(datetime.fromisoformat(ts.replace("Z", "+00:00")))
            except (ValueError, TypeError):
                pass

    created_at = min(all_timestamps) if all_timestamps else datetime.now(timezone.utc)
    updated_at = max(all_timestamps) if all_timestamps else datetime.now(timezone.utc)

    # Fallback name from first user message
    if not name and user_entries:
        first_msg = user_entries[0].get("message", {})
        content = first_msg.get("content", "")
        if isinstance(content, str):
            name = content[:100].strip()
        elif isinstance(content, list):
            text_parts = [b.get("text", "") for b in content if b.get("type") == "text"]
            name = " ".join(text_parts)[:100].strip()

    if not name:
        name = jsonl_path.stem

    # Get metadata from first user entry (has cwd, version, etc.)
    first_user_entry = user_entries[0] if user_entries else {}
    first_entry = entries[0] if entries else {}
    session_id = first_user_entry.get("sessionId") or first_entry.get("sessionId") or jsonl_path.stem
    cwd = first_user_entry.get("cwd", "")
    git_branch = first_user_entry.get("gitBranch", "")
    version = first_user_entry.get("version", "")

    # Get model from first assistant message
    model = ""
    if assistant_entries:
        msg = assistant_entries[0].get("message", {})
        model = msg.get("model", "")

    return {
        "uuid": session_id,
        "name": name,
        "summary": "",
        "model": model,
        "created_at": created_at,
        "updated_at": updated_at,
        "cwd": cwd,
        "git_branch": git_branch,
        "version": version,
    }


def _get_message_key(entry: dict) -> str | None:
    """Get a unique key for grouping streaming chunks of the same message.

    Assistant messages have message.id, user messages use entry uuid.
    """
    entry_type = entry.get("type")
    if entry_type not in ("user", "assistant"):
        return None

    msg = entry.get("message", {})
    # Assistant messages have message.id for grouping streaming chunks
    if entry_type == "assistant" and msg.get("id"):
        return f"assistant:{msg['id']}"
    # User messages use entry uuid
    return f"user:{entry.get('uuid', '')}"


def _merge_entries_to_message(entries: list[dict]) -> dict | None:
    """Merge multiple streaming entries into a single message.

    Claude Code streams messages as multiple entries, each with different
    content blocks (thinking, text, tool_use, etc.). This merges them all.
    """
    if not entries:
        return None

    first_entry = entries[0]
    last_entry = entries[-1]
    entry_type = first_entry.get("type")

    if entry_type not in ("user", "assistant"):
        return None

    # Collect ALL content blocks from ALL entries
    all_content_blocks = []
    text_parts = []

    for entry in entries:
        message_data = entry.get("message", {})
        content = message_data.get("content", "")

        if isinstance(content, str):
            if content:
                all_content_blocks.append({"type": "text", "text": content})
                text_parts.append(content)
        elif isinstance(content, list):
            for block in content:
                all_content_blocks.append(block)
                if block.get("type") == "text":
                    text_parts.append(block.get("text", ""))

    text = "\n".join(text_parts)

    timestamp = first_entry.get("timestamp", datetime.now(timezone.utc).isoformat())

    # Use first entry's uuid as the message uuid (for parent chain)
    # Use first entry's parentUuid to link to previous message
    return {
        "uuid": first_entry.get("uuid", ""),
        "sender": "human" if entry_type == "user" else "assistant",
        "text": text,
        "content": all_content_blocks,
        "created_at": timestamp,
        "updated_at": last_entry.get("timestamp", timestamp),
        "truncated": False,
        "parent_message_uuid": first_entry.get("parentUuid"),
        "attachments": [],
        "files": [],
    }


def _convert_entry_to_message(entry: dict) -> dict | None:
    """Convert a JSONL entry to a chat message format.

    Note: For streaming conversations, use _merge_entries_to_message instead.
    """
    entry_type = entry.get("type")

    if entry_type not in ("user", "assistant"):
        return None

    message_data = entry.get("message", {})

    # Extract text content
    content = message_data.get("content", "")
    if isinstance(content, str):
        text = content
        content_blocks = [{"type": "text", "text": content}] if content else []
    elif isinstance(content, list):
        content_blocks = content
        text_parts = []
        for block in content:
            if block.get("type") == "text":
                text_parts.append(block.get("text", ""))
        text = "\n".join(text_parts)
    else:
        text = ""
        content_blocks = []

    timestamp = entry.get("timestamp", datetime.now(timezone.utc).isoformat())

    return {
        "uuid": entry.get("uuid", ""),
        "sender": "human" if entry_type == "user" else "assistant",
        "text": text,
        "content": content_blocks,
        "created_at": timestamp,
        "updated_at": timestamp,
        "truncated": False,
        "parent_message_uuid": entry.get("parentUuid"),
        "attachments": [],
        "files": [],
    }


def read_claude_code_conversation(jsonl_path: Path) -> dict[str, Any] | None:
    """Read a single Claude Code conversation from a JSONL file.

    Handles Claude Code's streaming format where multiple entries represent
    chunks of the same message. Groups entries by message ID and merges them.
    """
    entries = parse_jsonl_file(jsonl_path)
    if not entries:
        return None

    metadata = _extract_conversation_metadata(entries, jsonl_path)

    # Group entries by message key (handles streaming chunks)
    from collections import OrderedDict
    message_groups: OrderedDict[str, list[dict]] = OrderedDict()

    for entry in entries:
        key = _get_message_key(entry)
        if key:
            if key not in message_groups:
                message_groups[key] = []
            message_groups[key].append(entry)

    # Build mapping from any entry UUID to the merged message's UUID
    # Include ALL entries (user, assistant, system, progress, etc.)
    # Non-message entries map to the most recent message's UUID
    uuid_remap: dict[str, str] = {}
    last_message_uuid: str | None = None

    for entry in entries:
        entry_uuid = entry.get("uuid", "")
        if not entry_uuid:
            continue

        key = _get_message_key(entry)
        if key:
            # This is a user/assistant entry - find its merged UUID
            group = message_groups.get(key, [])
            if group:
                merged_uuid = group[0].get("uuid", "")
                uuid_remap[entry_uuid] = merged_uuid
                last_message_uuid = merged_uuid
        else:
            # Non-message entry (system, progress, etc.) - map to last message
            if last_message_uuid:
                uuid_remap[entry_uuid] = last_message_uuid

    # Merge each group into a single message
    messages = []
    for group_entries in message_groups.values():
        msg = _merge_entries_to_message(group_entries)
        if msg:
            # Remap parent_message_uuid to point to merged message UUID
            parent = msg.get("parent_message_uuid")
            if parent and parent in uuid_remap:
                msg["parent_message_uuid"] = uuid_remap[parent]
            messages.append(msg)

    return {
        "uuid": metadata["uuid"],
        "name": metadata["name"],
        "summary": metadata["summary"],
        "model": metadata["model"],
        "created_at": metadata["created_at"].isoformat(),
        "updated_at": metadata["updated_at"].isoformat(),
        "is_starred": False,
        "is_temporary": False,
        "project_path": metadata["cwd"],
        "git_branch": metadata["git_branch"],
        "claude_code_version": metadata["version"],
        "source": "CLAUDE_CODE",
        "chat_messages": messages,
        "current_leaf_message_uuid": messages[-1]["uuid"] if messages else "",
    }


def discover_jsonl_files(claude_dir: Path = DEFAULT_CLAUDE_DIR) -> Iterator[Path]:
    """Find all JSONL session files in the Claude directory."""
    projects_dir = claude_dir / "projects"

    if not projects_dir.exists():
        return

    for project_dir in projects_dir.iterdir():
        if not project_dir.is_dir():
            continue

        for jsonl_file in project_dir.glob("*.jsonl"):
            # Skip agent sub-conversations
            if jsonl_file.name.startswith("agent-"):
                continue
            yield jsonl_file


def read_agent_summary_fast(agent_path: Path) -> tuple[str | None, dict | None]:
    """Read agent metadata quickly without full parsing.

    Returns (session_id, summary_dict) or (None, None) if invalid.
    Only reads first ~20 lines for speed.
    """
    first_user = None
    first_assistant = None
    first_timestamp = None
    agent_id = None
    lines_read = 0
    max_lines = 20

    try:
        with open(agent_path, "rb") as f:  # Binary mode for orjson
            for line in f:
                lines_read += 1
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = orjson.loads(line)
                    entry_type = entry.get("type")

                    if agent_id is None:
                        agent_id = entry.get("agentId")

                    ts = entry.get("timestamp")
                    if ts and first_timestamp is None:
                        first_timestamp = ts

                    if entry_type == "user" and not first_user:
                        first_user = entry
                    elif entry_type == "assistant" and not first_assistant:
                        first_assistant = entry

                    # Stop once we have what we need
                    if first_user and first_assistant:
                        break

                except orjson.JSONDecodeError:
                    pass

                if lines_read >= max_lines:
                    break
    except (OSError, IOError):
        return None, None

    if not first_user:
        return None, None

    session_id = first_user.get("sessionId")
    if not session_id:
        return None, None

    if not agent_id:
        agent_id = agent_path.stem.replace("agent-", "")

    # Get name from first user message
    name = f"Agent {agent_id}"
    first_msg = first_user.get("message", {})
    content = first_msg.get("content", "")
    if isinstance(content, str) and content.strip():
        name = content[:80].strip()
    elif isinstance(content, list):
        text_parts = [b.get("text", "") for b in content if b.get("type") == "text"]
        text = " ".join(text_parts)[:80].strip()
        if text:
            name = text

    model = ""
    if first_assistant:
        msg = first_assistant.get("message", {})
        model = msg.get("model", "")

    # Use file mtime for updated_at
    created_at = _parse_datetime(first_timestamp)
    try:
        mtime = agent_path.stat().st_mtime
        updated_at = datetime.fromtimestamp(mtime, tz=timezone.utc)
    except OSError:
        updated_at = created_at

    summary = {
        "uuid": agent_id,
        "agent_id": agent_id,
        "name": name,
        "model": model,
        "created_at": created_at,
        "updated_at": updated_at,
        "message_count": 0,  # Not counted for speed
    }

    return session_id, summary


def build_agent_index_with_summaries(claude_dir: Path = DEFAULT_CLAUDE_DIR) -> dict[str, list[dict]]:
    """Build a mapping of sessionId -> list of agent summaries.

    This scans all agent files once and extracts both sessionId and summary data,
    avoiding repeated file reads when listing conversations.
    """
    index: dict[str, list[dict]] = {}
    projects_dir = claude_dir / "projects"

    if not projects_dir.exists():
        return index

    for project_dir in projects_dir.iterdir():
        if not project_dir.is_dir():
            continue

        # Find all agent files in this project directory
        for agent_file in project_dir.glob("agent-*.jsonl"):
            session_id, summary = read_agent_summary_fast(agent_file)
            if session_id and summary:
                if session_id not in index:
                    index[session_id] = []
                index[session_id].append(summary)

    return index


def discover_agent_files(project_dir: Path, session_id: str) -> list[Path]:
    """Find all agent JSONL files belonging to a session.

    Note: This function reads each agent file to verify ownership.
    For batch operations, use build_agent_index() instead.
    """
    agent_files = []

    # Agent files can be directly in project dir or in session subdirectory
    for pattern in [
        project_dir / f"agent-*.jsonl",
        project_dir / session_id / "**" / "agent-*.jsonl",
    ]:
        for agent_file in project_dir.glob(pattern.name if pattern.parent == project_dir else str(pattern.relative_to(project_dir))):
            # Verify this agent belongs to the session by checking sessionId in file
            entries = parse_jsonl_file(agent_file)
            if entries:
                first_user = next((e for e in entries if e.get("type") == "user"), None)
                if first_user and first_user.get("sessionId") == session_id:
                    agent_files.append(agent_file)

    return agent_files


def _extract_agent_metadata(entries: list[dict], agent_path: Path) -> dict:
    """Extract metadata from agent JSONL entries."""
    user_entries = [e for e in entries if e.get("type") == "user"]
    assistant_entries = [e for e in entries if e.get("type") == "assistant"]

    # Get agent ID from first entry
    first_entry = entries[0] if entries else {}
    agent_id = first_entry.get("agentId", agent_path.stem.replace("agent-", ""))

    # Timestamps
    all_timestamps = []
    for e in entries:
        ts = e.get("timestamp")
        if ts:
            try:
                all_timestamps.append(datetime.fromisoformat(ts.replace("Z", "+00:00")))
            except (ValueError, TypeError):
                pass

    created_at = min(all_timestamps) if all_timestamps else datetime.now(timezone.utc)
    updated_at = max(all_timestamps) if all_timestamps else datetime.now(timezone.utc)

    # Get name from first user message
    name = f"Agent {agent_id}"
    if user_entries:
        first_msg = user_entries[0].get("message", {})
        content = first_msg.get("content", "")
        if isinstance(content, str):
            name = content[:80].strip() or name
        elif isinstance(content, list):
            text_parts = [b.get("text", "") for b in content if b.get("type") == "text"]
            name = " ".join(text_parts)[:80].strip() or name

    # Get model
    model = ""
    if assistant_entries:
        msg = assistant_entries[0].get("message", {})
        model = msg.get("model", "")

    # Count messages
    message_count = len(user_entries) + len(assistant_entries)

    return {
        "uuid": agent_id,
        "agent_id": agent_id,
        "name": name,
        "model": model,
        "created_at": created_at,
        "updated_at": updated_at,
        "message_count": message_count,
    }


def read_agent_summary(agent_path: Path) -> dict[str, Any] | None:
    """Read summary metadata for an agent conversation."""
    entries = parse_jsonl_file(agent_path)
    if not entries:
        return None

    return _extract_agent_metadata(entries, agent_path)


def _load_conversation_cached(jsonl_path: Path) -> dict[str, Any] | None:
    """Load a full conversation with caching."""
    cache = get_conversation_cache()
    return cache.get_or_load(jsonl_path, read_claude_code_conversation)


def list_claude_code_conversations(
    claude_dir: Path = DEFAULT_CLAUDE_DIR,
    full_content: bool = False,
    include_phantom: bool = False,
) -> list[dict[str, Any]]:
    """List all Claude Code conversations from local JSONL files, including subagents.

    Args:
        claude_dir: Path to Claude config directory
        full_content: If True, read full conversation content (for search).
                     If False, only read metadata (fast, for listing).
        include_phantom: If True, include phantom sessions (local command artifacts).
                        Default False to hide these empty sessions.

    Features:
    - Uses orjson for ~5x faster JSON parsing
    - Caches parsed conversations with mtime-based invalidation
    - Parallel file reading when loading full content
    """
    # Build agent index once upfront - reads each agent file once and extracts summaries
    agent_index = build_agent_index_with_summaries(claude_dir)

    # Collect all file paths
    jsonl_paths = list(discover_jsonl_files(claude_dir))

    if full_content:
        # Use cache + parallel loading for full content
        cache = get_conversation_cache()
        conversations_raw = cache.load_many_parallel(
            jsonl_paths,
            read_claude_code_conversation,
        )
    else:
        # Fast sequential reading for metadata-only (already very fast)
        conversations_raw = [read_conversation_summary_fast(p) for p in jsonl_paths]

    # Attach subagents to each conversation
    conversations = []
    for conv in conversations_raw:
        if conv:
            # Filter out phantom sessions unless explicitly requested
            if not include_phantom and conv.get("is_phantom", False):
                continue

            session_id = conv["uuid"]

            # Look up agent summaries from pre-built index (no additional file I/O)
            subagents = agent_index.get(session_id, [])

            # Sort subagents by created_at
            subagents = sorted(subagents, key=lambda a: a["created_at"])

            # Convert datetimes to ISO strings for JSON serialization
            for agent in subagents:
                if isinstance(agent["created_at"], datetime):
                    agent["created_at"] = agent["created_at"].isoformat()
                if isinstance(agent["updated_at"], datetime):
                    agent["updated_at"] = agent["updated_at"].isoformat()

            conv["subagents"] = subagents
            conversations.append(conv)

    return conversations