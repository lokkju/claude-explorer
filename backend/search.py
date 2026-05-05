"""Full-text search implementation."""

import json
import re
from typing import Any, Literal

from .models import SearchResult, MessageSnippet
from .store import ConversationStore, _parse_datetime


def _extract_searchable_text(message: dict[str, Any]) -> str:
    """Flatten every searchable surface of a message into one string.

    Covers: message['text'] (Desktop API plain text), and all content blocks —
    text, tool_use input dicts (Bash command, file paths, prompt args), and
    tool_result content (which can be a string OR a list of text blocks).
    """
    parts: list[str] = []

    text = message.get("text") or ""
    if text:
        parts.append(text)

    for block in message.get("content") or []:
        if not isinstance(block, dict):
            continue
        btype = block.get("type")

        if btype == "text":
            t = block.get("text") or ""
            if t:
                parts.append(t)

        elif btype == "tool_use":
            name = block.get("name") or ""
            if name:
                parts.append(name)
            tool_input = block.get("input")
            if isinstance(tool_input, dict):
                parts.append(_stringify_tool_input(tool_input))
            elif isinstance(tool_input, str):
                parts.append(tool_input)

        elif btype == "tool_result":
            tr_content = block.get("content")
            if isinstance(tr_content, str):
                parts.append(tr_content)
            elif isinstance(tr_content, list):
                for sub in tr_content:
                    if isinstance(sub, dict) and sub.get("type") == "text":
                        t = sub.get("text") or ""
                        if t:
                            parts.append(t)

        elif btype == "thinking":
            t = block.get("thinking") or block.get("text") or ""
            if t:
                parts.append(t)

    return "\n".join(parts)


def _stringify_tool_input(tool_input: dict[str, Any]) -> str:
    """Render a tool_use input dict so its string-valued fields are searchable.

    JSON-dumps the whole dict (so nested values are reachable) and also
    appends each top-level string value verbatim so a user search like
    "echo foo" matches without quoting concerns.
    """
    parts: list[str] = []
    try:
        parts.append(json.dumps(tool_input, ensure_ascii=False))
    except (TypeError, ValueError):
        pass
    for v in tool_input.values():
        if isinstance(v, str):
            parts.append(v)
    return "\n".join(parts)


SNIPPET_CONTEXT = 150  # Characters of context on each side of the match (~3 lines total)
WORD_BOUNDARY_SEARCH = 25  # Max chars to extend outward to avoid cutting mid-word


def create_snippet(text: str, match_start: int, match_end: int) -> tuple[str, int, int]:
    """Create a snippet with context around the match.

    Extends outward to word boundaries (up to WORD_BOUNDARY_SEARCH chars)
    so we don't cut mid-word. Falls back to the raw char boundary if no
    whitespace is nearby — the ellipsis prefix/suffix signals the cut.
    """
    snippet_start = max(0, match_start - SNIPPET_CONTEXT)
    snippet_end = min(len(text), match_end + SNIPPET_CONTEXT)

    # Extend snippet_start LEFTWARD to a word boundary (keeps the preceding word intact)
    if snippet_start > 0:
        extended = max(0, snippet_start - WORD_BOUNDARY_SEARCH)
        space_pos = text.rfind(" ", extended, snippet_start + 1)
        if space_pos >= 0:
            snippet_start = space_pos + 1

    # Extend snippet_end RIGHTWARD to a word boundary (keeps the following word intact)
    if snippet_end < len(text):
        extended = min(len(text), snippet_end + WORD_BOUNDARY_SEARCH)
        space_pos = text.find(" ", snippet_end - 1, extended)
        if space_pos >= 0:
            snippet_end = space_pos

    snippet = text[snippet_start:snippet_end]

    # Add ellipsis if truncated
    prefix = "..." if snippet_start > 0 else ""
    suffix = "..." if snippet_end < len(text) else ""

    # Adjust match positions for the snippet
    new_match_start = len(prefix) + (match_start - snippet_start)
    new_match_end = new_match_start + (match_end - match_start)

    return prefix + snippet + suffix, new_match_start, new_match_end


def _derive_project_name(project_path: str | None) -> str | None:
    """Mirror ConversationSummary.model_post_init project_name derivation."""
    if not project_path:
        return None
    stripped = project_path.rstrip("/")
    return stripped.split("/")[-1] if "/" in stripped else stripped


SortField = Literal["updated_at", "created_at", "name", "project"]
SortOrder = Literal["asc", "desc"]


def search_conversations(
    store: ConversationStore,
    query: str,
    source: Literal["all", "CLAUDE_AI", "CLAUDE_CODE"] = "all",
    context_size: Literal["snippet", "full"] = "snippet",
    sort: SortField = "updated_at",
    sort_order: SortOrder = "desc",
    conversation_uuid: str | None = None,
    project_path: str | None = None,
    bookmarks: set[str] | None = None,
) -> list[SearchResult]:
    """Search across all conversations for matching messages.

    Scope filters (manual finding 2026-05-04):
      - ``conversation_uuid``: restrict to a single conversation. Most
        specific filter; wins over ``project_path`` / ``bookmarks`` when
        all three are passed.
      - ``project_path``: restrict to conversations whose project_path
        matches exactly (CC sessions grouped by their cwd).
      - ``bookmarks``: restrict to a set of conversation UUIDs (the
        client passes the bookmark set when the sidebar's Starred filter
        is active).

    All three are AND'd with the existing ``source`` filter and with each
    other (when more than one is set). Backend-side because tool_use /
    tool_result payloads are large; client-side post-filtering would
    waste bandwidth and break ranking.
    """
    if not query or len(query.strip()) < 1:
        return []

    query_lower = query.lower()
    pattern = re.compile(re.escape(query), re.IGNORECASE)
    results = []

    for conv in store.get_all_conversations_raw(source=source):
        if conversation_uuid:
            # Most specific filter; wins over project_path / bookmarks.
            if conv.get("uuid") != conversation_uuid:
                continue
        else:
            if project_path and conv.get("project_path") != project_path:
                continue
            if bookmarks is not None and conv.get("uuid") not in bookmarks:
                continue
        matching_messages: list[MessageSnippet] = []

        # Search in conversation name
        name = conv.get("name", "")
        if query_lower in name.lower():
            # Add a pseudo-message for title match. Titles are short, so we
            # always use the snippet helper here regardless of context_size.
            match = pattern.search(name)
            if match:
                snippet, start, end = create_snippet(name, match.start(), match.end())
                matching_messages.append(
                    MessageSnippet(
                        message_uuid="title",
                        sender="title",
                        snippet=snippet,
                        match_start=start,
                        match_end=end,
                    )
                )

        # Search in messages
        for msg in conv.get("chat_messages", []):
            # Issue #0 — cache the searchable-text projection on the
            # message dict itself. The cached conversation dict is the
            # same instance on every call (via backend.cache.FileCache),
            # so this memo survives across search requests until the
            # source file's mtime changes (which invalidates the cache
            # entry and rebuilds the dict). Profile showed
            # _stringify_tool_input -> json.dumps was the dominant warm
            # cost (~0.3s of the ~0.9s search loop).
            text = msg.get("__search_text__")
            if text is None:
                text = _extract_searchable_text(msg)
                msg["__search_text__"] = text

            if not text:
                continue

            msg_created_at = _parse_datetime(msg.get("created_at"))

            # Search for matches
            for match in pattern.finditer(text):
                if context_size == "full":
                    snippet = text
                    start = match.start()
                    end = match.end()
                else:
                    snippet, start, end = create_snippet(
                        text, match.start(), match.end()
                    )
                matching_messages.append(
                    MessageSnippet(
                        message_uuid=msg.get("uuid", ""),
                        sender=msg.get("sender", ""),
                        snippet=snippet,
                        match_start=start,
                        match_end=end,
                        created_at=msg_created_at,
                    )
                )
                # Only include first match per message to avoid duplicates
                break

        if matching_messages:
            results.append(
                SearchResult(
                    conversation_uuid=conv.get("uuid", ""),
                    conversation_name=conv.get("name", "Untitled"),
                    conversation_updated_at=_parse_datetime(conv.get("updated_at")),
                    conversation_created_at=_parse_datetime(conv.get("created_at")),
                    project_name=_derive_project_name(conv.get("project_path")),
                    matching_messages=matching_messages,
                )
            )

    reverse = sort_order == "desc"

    # Match-level time key, with a conversation-level fallback for title-only
    # matches (no per-message timestamp).
    def _match_time(m: MessageSnippet, fallback):
        return m.created_at if m.created_at is not None else fallback

    # Sort matches within each conversation by message timestamp so the
    # newest/oldest match (per order) is always on top of its group.
    for r in results:
        fallback = r.conversation_updated_at
        r.matching_messages.sort(
            key=lambda m, fb=fallback: _match_time(m, fb),
            reverse=reverse,
        )

    if sort in ("updated_at", "created_at"):
        # Rank each conversation by the most-recent (updated_at) or earliest
        # (created_at) matching message inside it. For updated_at+desc this
        # means the globally-latest matching message lands at the top.
        def _conv_time_key(r: SearchResult):
            times = [m.created_at for m in r.matching_messages if m.created_at]
            if times:
                return max(times) if sort == "updated_at" else min(times)
            return (
                r.conversation_updated_at
                if sort == "updated_at"
                else r.conversation_created_at
            )

        results.sort(key=_conv_time_key, reverse=reverse)
    elif sort == "name":
        results.sort(key=lambda r: (r.conversation_name or "").lower(), reverse=reverse)
    elif sort == "project":
        # None project_names last when ascending, first when descending — same
        # behavior as store.py's list sort.
        results.sort(
            key=lambda r: (r.project_name is None, (r.project_name or "").lower()),
            reverse=reverse,
        )

    return results