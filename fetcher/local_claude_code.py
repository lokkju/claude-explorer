"""
Import Claude Code conversations from local JSONL files.

Claude Code (CLI and Desktop Code tab) stores conversations locally at:
    ~/.claude/projects/{project-path-encoded}/{session-uuid}.jsonl

This module reads those JSONL files and converts them to the same JSON format
used by the Claude Desktop API fetcher.
"""

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

import click


# Default paths
DEFAULT_CLAUDE_DIR = Path.home() / ".claude"
DEFAULT_OUTPUT_DIR = Path.home() / ".claude-explorer" / "conversations"


def decode_project_path(encoded_name: str) -> str:
    """Decode the project directory name back to the original path.

    Claude Code encodes paths by replacing / with -
    e.g., -Users-rpeck-Source-myproject -> /Users/rpeck/Source/myproject
    """
    if encoded_name.startswith("-"):
        # Replace leading - and all - with /
        return encoded_name.replace("-", "/")
    return encoded_name


def parse_jsonl_file(path: Path) -> list[dict]:
    """Parse a JSONL file and return all entries."""
    entries = []
    with open(path, "r", encoding="utf-8") as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                entries.append(entry)
            except json.JSONDecodeError as e:
                click.echo(f"  Warning: Invalid JSON at line {line_num}: {e}", err=True)
    return entries


def extract_conversation_metadata(entries: list[dict], jsonl_path: Path) -> dict:
    """Extract metadata from JSONL entries."""
    # Find summary entry for name
    summary_entry = next((e for e in entries if e.get("type") == "summary"), None)
    name = summary_entry.get("summary") if summary_entry else None

    # Get first user message for fallback name and timestamps
    user_entries = [e for e in entries if e.get("type") == "user"]
    assistant_entries = [e for e in entries if e.get("type") == "assistant"]

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
        name = jsonl_path.stem  # Use filename as last resort

    # Get session ID and other metadata from first entry
    first_entry = entries[0] if entries else {}
    session_id = first_entry.get("sessionId", jsonl_path.stem)
    cwd = first_entry.get("cwd", "")
    git_branch = first_entry.get("gitBranch", "")
    version = first_entry.get("version", "")

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
        "created_at": created_at.isoformat(),
        "updated_at": updated_at.isoformat(),
        "cwd": cwd,
        "git_branch": git_branch,
        "version": version,
        "source": "CLAUDE_CODE",
    }


def convert_entry_to_message(entry: dict) -> dict | None:
    """Convert a JSONL entry to a chat message format."""
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
        # Content is already structured blocks
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


def convert_jsonl_to_conversation(entries: list[dict], jsonl_path: Path) -> dict:
    """Convert JSONL entries to a conversation JSON format."""
    metadata = extract_conversation_metadata(entries, jsonl_path)

    # Convert messages
    messages = []
    for entry in entries:
        msg = convert_entry_to_message(entry)
        if msg:
            messages.append(msg)

    # Build conversation object
    conversation = {
        "uuid": metadata["uuid"],
        "name": metadata["name"],
        "summary": metadata["summary"],
        "model": metadata["model"],
        "created_at": metadata["created_at"],
        "updated_at": metadata["updated_at"],
        "settings": {},
        "is_starred": False,
        "is_temporary": False,
        "project_path": metadata["cwd"],
        "git_branch": metadata["git_branch"],
        "claude_code_version": metadata["version"],
        "source": "CLAUDE_CODE",
        "chat_messages": messages,
        "current_leaf_message_uuid": messages[-1]["uuid"] if messages else "",
    }

    return conversation


def discover_jsonl_files(claude_dir: Path) -> Iterator[Path]:
    """Find all JSONL session files in the Claude directory."""
    projects_dir = claude_dir / "projects"

    if not projects_dir.exists():
        return

    for project_dir in projects_dir.iterdir():
        if not project_dir.is_dir():
            continue

        for jsonl_file in project_dir.glob("*.jsonl"):
            # Skip agent sub-conversations for now (can be included later)
            if jsonl_file.name.startswith("agent-"):
                continue
            yield jsonl_file


def import_claude_code_sessions(
    claude_dir: Path = DEFAULT_CLAUDE_DIR,
    output_dir: Path = DEFAULT_OUTPUT_DIR,
    incremental: bool = True,
    verbose: bool = False,
) -> int:
    """Import all Claude Code sessions from local JSONL files.

    Returns the number of sessions imported.
    """
    # cowork-multi-org C3: Claude Code sessions land under a synthetic
    # _claude_code "org" so the loader treats them uniformly with Claude.ai
    # tenants. Source vs tenant remain orthogonal — the source field on each
    # JSON drives the icon picker; the parent dir drives the workspace label.
    cc_dir = output_dir / "by-org" / "_claude_code"
    cc_dir.mkdir(parents=True, exist_ok=True)

    # Get existing UUIDs if incremental — check both the new layout and the
    # legacy flat layout (in case the user has imported sessions from before
    # the layout switch and migration hasn't run yet).
    existing_uuids = set()
    if incremental:
        for p in list(cc_dir.glob("*.json")) + list(output_dir.glob("*.json")):
            if p.stem == "_index":
                continue
            try:
                with open(p) as f:
                    data = json.load(f)
                if data.get("source") == "CLAUDE_CODE":
                    existing_uuids.add(data.get("uuid"))
            except (json.JSONDecodeError, IOError):
                pass

    imported = 0
    skipped = 0

    jsonl_files = list(discover_jsonl_files(claude_dir))
    click.echo(f"Found {len(jsonl_files)} Claude Code session files")

    for jsonl_path in jsonl_files:
        if verbose:
            click.echo(f"Processing: {jsonl_path}")

        try:
            entries = parse_jsonl_file(jsonl_path)
            if not entries:
                if verbose:
                    click.echo("  Skipping empty file")
                continue

            # Get session ID early to check for duplicates
            first_entry = entries[0]
            session_id = first_entry.get("sessionId", jsonl_path.stem)

            if incremental and session_id in existing_uuids:
                skipped += 1
                if verbose:
                    click.echo(f"  Skipping existing: {session_id}")
                continue

            conversation = convert_jsonl_to_conversation(entries, jsonl_path)

            # Save to output directory under the synthetic _claude_code org.
            output_path = cc_dir / f"{conversation['uuid']}.json"
            with open(output_path, "w", encoding="utf-8") as f:
                json.dump(conversation, f, indent=2)

            # P4a: copy any [Image: source: <abs-path>] referenced files
            # from ~/.claude/image-cache/ into the permanent
            # ~/.claude-explorer/cc-images/<conv-uuid>/ cache so the
            # viewer keeps working after Claude Code rotates the
            # originals. Best-effort — failures are logged, never raised.
            try:
                from backend.cc_image_cache import cache_all_markers

                cache_all_markers(conversation)
            except Exception as e:
                click.echo(
                    f"  Warning: could not cache CC images for "
                    f"{conversation.get('uuid')}: {e}",
                    err=True,
                )

            imported += 1
            name = conversation.get("name", "Untitled")[:50]
            click.echo(f"[{imported}] Imported: {name}")

        except Exception as e:
            click.echo(f"  Error processing {jsonl_path}: {e}", err=True)

    click.echo(f"\nDone! Imported {imported} sessions, skipped {skipped} existing.")
    return imported


@click.command()
@click.option(
    "--claude-dir",
    type=click.Path(path_type=Path),
    default=DEFAULT_CLAUDE_DIR,
    help="Path to Claude config directory (default: ~/.claude)",
)
@click.option(
    "--output-dir",
    type=click.Path(path_type=Path),
    default=DEFAULT_OUTPUT_DIR,
    help="Where to save JSON files",
)
@click.option(
    "--incremental/--full-refresh",
    default=True,
    help="Skip already-imported sessions (default: incremental)",
)
@click.option("--verbose", is_flag=True, help="Show detailed output")
def main(
    claude_dir: Path,
    output_dir: Path,
    incremental: bool,
    verbose: bool,
) -> None:
    """Import Claude Code sessions from local JSONL files."""
    import_claude_code_sessions(
        claude_dir=claude_dir,
        output_dir=output_dir,
        incremental=incremental,
        verbose=verbose,
    )


if __name__ == "__main__":
    main()
