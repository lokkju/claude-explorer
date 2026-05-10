"""Full-text search implementation.

Two paths:
  * **FTS5 fast path** (preferred). When :mod:`backend.search_index` reports
    the index is ready and FTS5 is available, queries hit the SQLite FTS5
    inverted index. The index returns ``(conv_uuid, message_uuid)`` pairs;
    we then walk only those conversations from the cache and run the same
    snippet/sort code as the linear path. Latency target: <50 ms per query.
  * **Linear-scan fallback**. When the index isn't ready (initial build
    still in progress), FTS5 isn't compiled into the local sqlite3 build,
    or any sqlite3 error fires, we fall back to the original full-walk
    code path. Search never goes "down".

The two paths produce byte-for-byte identical ``SearchResult`` objects for
whole-word queries (the common case). Sub-string queries that don't align
with token boundaries (e.g., ``"py"`` matching the substring inside
``"happy"``) are a documented behavior change: the FTS5 path returns
prefix-matches only.
"""

import json
import logging
import re
import sqlite3
from typing import Any, Literal

from .models import SearchResult, MessageSnippet
from .store import ConversationStore, _parse_datetime


logger = logging.getLogger(__name__)


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

    Dispatches to the FTS5 fast path when the index is ready (see module
    docstring); falls back to the linear-scan path on any failure mode
    (index not ready, FTS5 unavailable, sqlite3 error). Both paths produce
    byte-for-byte identical ``SearchResult`` objects for whole-word
    queries.

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

    # Fast path: FTS5 inverted index when ready. Imported lazily so the
    # test suite can patch get_search_index() without import cycles.
    try:
        from .search_index import get_search_index

        idx = get_search_index()
        if idx is not None and idx.is_ready():
            try:
                return _search_via_index(
                    store, idx, query,
                    source=source, context_size=context_size,
                    sort=sort, sort_order=sort_order,
                    conversation_uuid=conversation_uuid,
                    project_path=project_path,
                    bookmarks=bookmarks,
                )
            except sqlite3.Error:
                logger.exception(
                    "search_index: query failed; falling back to linear scan"
                )
                # fall through to linear scan
    except ImportError:
        # search_index module isn't importable — definitely use linear scan.
        pass

    return _search_via_linear_scan(
        store, query,
        source=source, context_size=context_size,
        sort=sort, sort_order=sort_order,
        conversation_uuid=conversation_uuid,
        project_path=project_path,
        bookmarks=bookmarks,
    )


def _search_via_linear_scan(
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
    """Original linear-scan implementation; now the fallback path.

    Walks every conversation, runs a Python regex against each message's
    flattened searchable text. Slow on large corpora (~0.8-2.3s on Ray's
    1.5GB corpus) but always correct and never depends on an index file
    being present.
    """
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

    return _sort_results(results, sort=sort, sort_order=sort_order)


def _search_via_index(
    store: ConversationStore,
    idx: Any,
    query: str,
    *,
    source: Literal["all", "CLAUDE_AI", "CLAUDE_CODE"],
    context_size: Literal["snippet", "full"],
    sort: SortField,
    sort_order: SortOrder,
    conversation_uuid: str | None,
    project_path: str | None,
    bookmarks: set[str] | None,
) -> list[SearchResult]:
    """FTS5 fast path: scatter-gather over the inverted index.

    1. Ask the FTS5 index for the set of matched ``(conv_uuid,
       message_uuid)`` pairs (subject to source/scope filters at the SQL
       layer too — they're cheap UNINDEXED-column filters).
    2. Title-substring sweep over conversation summaries (lightweight)
       to catch sub-token substrings the FTS5 prefix-tokenizer can't
       see (e.g., "edul" inside "scheduled").
    3. Walk ONLY the matched conversations via
       :meth:`ConversationStore.get_conversation` (warm via FileCache)
       and run the existing :func:`create_snippet` / regex finditer
       loop on each. This avoids loading the entire conversation
       corpus on every query.

    Why we don't call back into ``_search_via_linear_scan``: that function
    re-walks ``store.get_all_conversations_raw()`` which loads every
    JSON/JSONL file. Even with FileCache hot, that's ~1 s for a 1.5 GB
    corpus. Walking only the matched conversations is the entire point
    of the index.
    """
    # Step 1: ask FTS5 for body+title MATCH hits (subject to scope at
    # the SQL layer).
    matches = idx.query(
        query,
        source=source,
        conversation_uuid=conversation_uuid,
        project_path=project_path,
        bookmarks=bookmarks,
    )
    body_matched_uuids: set[str] = {m["conv_uuid"] for m in matches}

    # Step 2: title-substring sweep. The linear scan emits a title pseudo-
    # message when the conversation NAME contains the query (case-
    # insensitive substring). FTS5 catches token-aligned title matches,
    # but a substring that crosses token boundaries (e.g. "ned" inside
    # "scheduled") would NOT hit FTS5 yet WOULD hit the linear scan.
    # We use the FTS5 index's own ``title`` column as the source of
    # truth — it's stored UNINDEXED so a SELECT DISTINCT is cheap and
    # avoids the multi-second cost of ``store.list_conversations()``
    # (which rebuilds the agent index on every call).
    query_lower = query.lower()
    title_matched_uuids: set[str] = set()
    title_sql_clauses = ["title LIKE ?"]
    title_sql_params: list[Any] = [f"%{query}%"]
    if conversation_uuid is not None:
        title_sql_clauses.append("conv_uuid = ?")
        title_sql_params.append(conversation_uuid)
    else:
        if project_path is not None:
            title_sql_clauses.append("project_path = ?")
            title_sql_params.append(project_path)
        if bookmarks is not None:
            if not bookmarks:
                title_matched_uuids = set()
                title_sql_clauses = []
            else:
                placeholders = ",".join("?" * len(bookmarks))
                title_sql_clauses.append(f"conv_uuid IN ({placeholders})")
                title_sql_params.extend(sorted(bookmarks))
    if source != "all":
        title_sql_clauses.append("source = ?")
        title_sql_params.append(source)
    if title_sql_clauses:
        try:
            conn = idx._get_read_conn()
            sql = (
                "SELECT DISTINCT conv_uuid FROM messages "
                f"WHERE {' AND '.join(title_sql_clauses)} "
                # COLLATE NOCASE on title would be ideal but the column is
                # UNINDEXED; we use case-insensitive LIKE via lower() in
                # Python after fetch.
            )
            cur = conn.execute(sql, tuple(title_sql_params))
            title_matched_uuids = {row[0] for row in cur.fetchall()}
        except sqlite3.Error:
            # Fall back to no title sweep — body matches still win.
            title_matched_uuids = set()

    candidate_uuids = body_matched_uuids | title_matched_uuids

    # AND with any user scope (extra defense — the SQL WHERE clauses
    # already enforce these).
    if bookmarks is not None:
        candidate_uuids &= bookmarks
    if conversation_uuid is not None:
        candidate_uuids &= {conversation_uuid}

    if not candidate_uuids:
        return []

    # Step 3: walk ONLY the matched conversations. For each matched
    # conv, find which of its messages were FTS5-hit, then run the
    # existing per-message regex on those messages to produce snippets
    # byte-for-byte identical to the linear path.
    pattern = re.compile(re.escape(query), re.IGNORECASE)
    msgs_per_conv: dict[str, set[str]] = {}
    for m in matches:
        cu = m["conv_uuid"]
        if cu in candidate_uuids:
            msgs_per_conv.setdefault(cu, set()).add(m["message_uuid"])

    # Walk the conversation corpus ONCE, skipping convs not in the
    # candidate set. This is the only place we touch
    # ``get_all_conversations_raw()`` — the warm FileCache makes it
    # cheap (~10-100 ms for a 1.5 GB corpus on warm disk + cache).
    # On cold cache it's a one-time cost shared with the CC warm pass.
    results: list[SearchResult] = []
    for conv in store.get_all_conversations_raw(source=source):
        cu = conv.get("uuid", "")
        if cu not in candidate_uuids:
            continue

        matching_messages: list[MessageSnippet] = []
        name = conv.get("name", "") or ""

        # Title pseudo-message — emitted only when the conv NAME contains
        # the query (mirrors the linear-scan emit at search.py:264).
        if query_lower in name.lower():
            tmatch = pattern.search(name)
            if tmatch:
                snippet, start, end = create_snippet(name, tmatch.start(), tmatch.end())
                matching_messages.append(
                    MessageSnippet(
                        message_uuid="title",
                        sender="title",
                        snippet=snippet,
                        match_start=start,
                        match_end=end,
                    )
                )

        # Body matches: walk only the FTS5-matched messages (the rest
        # are guaranteed not to match the query).
        wanted_msg_uuids = msgs_per_conv.get(cu, set())
        for msg in conv.get("chat_messages", []):
            if msg.get("uuid") not in wanted_msg_uuids:
                continue
            text = msg.get("__search_text__")
            if text is None:
                text = _extract_searchable_text(msg)
                msg["__search_text__"] = text
            if not text:
                continue
            msg_created_at = _parse_datetime(msg.get("created_at"))
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
                # Only first match per message — same as linear path.
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

    # Apply the same sort logic as the linear path (extracted into
    # _sort_results below so both code paths stay byte-identical).
    return _sort_results(results, sort=sort, sort_order=sort_order)


def _sort_results(
    results: list[SearchResult],
    *,
    sort: SortField,
    sort_order: SortOrder,
) -> list[SearchResult]:
    """Same sort logic as _search_via_linear_scan's tail block. Extracted
    so both paths share the implementation byte-for-byte."""
    reverse = sort_order == "desc"

    def _match_time(m: MessageSnippet, fallback):
        return m.created_at if m.created_at is not None else fallback

    for r in results:
        fallback = r.conversation_updated_at
        r.matching_messages.sort(
            key=lambda m, fb=fallback: _match_time(m, fb),
            reverse=reverse,
        )

    if sort in ("updated_at", "created_at"):
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
        results.sort(
            key=lambda r: (r.project_name is None, (r.project_name or "").lower()),
            reverse=reverse,
        )

    return results