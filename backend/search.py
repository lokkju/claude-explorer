"""Full-text search implementation."""

import re

from .models import SearchResult, MessageSnippet
from .store import ConversationStore, _parse_datetime


SNIPPET_CONTEXT = 50  # Characters of context around match


def create_snippet(text: str, match_start: int, match_end: int) -> tuple[str, int, int]:
    """Create a snippet with context around the match."""
    # Calculate snippet boundaries
    snippet_start = max(0, match_start - SNIPPET_CONTEXT)
    snippet_end = min(len(text), match_end + SNIPPET_CONTEXT)

    # Adjust to word boundaries if possible
    if snippet_start > 0:
        space_pos = text.rfind(" ", snippet_start, match_start)
        if space_pos > 0:
            snippet_start = space_pos + 1

    if snippet_end < len(text):
        space_pos = text.find(" ", match_end, snippet_end)
        if space_pos > 0:
            snippet_end = space_pos

    snippet = text[snippet_start:snippet_end]

    # Add ellipsis if truncated
    prefix = "..." if snippet_start > 0 else ""
    suffix = "..." if snippet_end < len(text) else ""

    # Adjust match positions for the snippet
    new_match_start = len(prefix) + (match_start - snippet_start)
    new_match_end = new_match_start + (match_end - match_start)

    return prefix + snippet + suffix, new_match_start, new_match_end


def search_conversations(
    store: ConversationStore, query: str
) -> list[SearchResult]:
    """Search across all conversations for matching messages."""
    if not query or len(query.strip()) < 1:
        return []

    query_lower = query.lower()
    pattern = re.compile(re.escape(query), re.IGNORECASE)
    results = []

    for conv in store.get_all_conversations_raw():
        matching_messages: list[MessageSnippet] = []

        # Search in conversation name
        name = conv.get("name", "")
        if query_lower in name.lower():
            # Add a pseudo-message for title match
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
            # Get message text
            text = msg.get("text", "")
            if not text:
                # Extract from content blocks
                for block in msg.get("content", []):
                    if block.get("type") == "text" and block.get("text"):
                        text = block["text"]
                        break

            if not text:
                continue

            # Search for matches
            for match in pattern.finditer(text):
                snippet, start, end = create_snippet(text, match.start(), match.end())
                matching_messages.append(
                    MessageSnippet(
                        message_uuid=msg.get("uuid", ""),
                        sender=msg.get("sender", ""),
                        snippet=snippet,
                        match_start=start,
                        match_end=end,
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
                    matching_messages=matching_messages,
                )
            )

    # Sort by most recently updated
    results.sort(key=lambda r: r.conversation_updated_at, reverse=True)

    return results