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


# Placeholder pattern used by Claude Desktop when a content block (tool call,
# canvas widget, etc.) can't be rendered in the current client. Mirrors the
# frontend's filter in frontend/src/lib/utils.ts (filterToolPlaceholders): when
# we render a message with showToolCalls=false, this exact pattern is stripped
# from the displayed text. We strip the same pattern from the searchable text
# projection when include_tool_calls=False so that a message whose `text`
# field consists ONLY of this placeholder is treated as "no visible text"
# (mirrors messageHasVisibleContent semantics).
_TOOL_PLACEHOLDER_RE = re.compile(
    r"```\s*\n?\s*(?:"
    r"This block is not supported on your current device yet\."
    r"|"
    r"Viewing artifacts created via the Analysis Tool web feature preview "
    r"isn't yet supported on mobile\."
    r")\s*\n?\s*```"
)


def _extract_searchable_text(
    message: dict[str, Any],
    *,
    include_tool_calls: bool = True,
) -> str:
    """Flatten every searchable surface of a message into one string.

    Covers: message['text'] (Desktop API plain text), and all content blocks —
    text, tool_use input dicts (Bash command, file paths, prompt args), and
    tool_result content (which can be a string OR a list of text blocks).

    When ``include_tool_calls=False``:
      * Skips ``tool_use`` and ``tool_result`` content blocks.
      * Strips the Desktop "This block is not supported…" placeholder from
        ``message['text']`` (mirrors frontend ``messageHasVisibleContent``
        and ``filterToolPlaceholders``). A message whose ``text`` field is
        only that placeholder yields the empty string here.
      * ``text``-type blocks are unchanged — they ARE the user-visible body.

    ``thinking`` blocks are NEVER indexed regardless of the toggle
    (V1 polish 2026-05-13): the frontend has no `case 'thinking':`
    renderer in V1, so indexing thinking content produces search
    "ghosts" — a query that hits inside a thinking block returns a
    result whose bubble shows nothing matching. Until a `Show thinking`
    UI affordance ships, hide it from search too. Spec invariant: search
    only returns hits the user can navigate to. The accompanying
    `backend/search_index.SCHEMA_VERSION` bump (2 → 3) forces a one-time
    rebuild so stale thinking-only matches don't pollute the FTS5
    top-N ranking.

    Default ``include_tool_calls=True`` preserves prior indexing behavior
    for tool blocks; the FTS5 index ALWAYS uses the full projection so
    the index stays correct regardless of the per-query filter (the
    filter is applied at snippet/scatter time, not at index time — see
    search.py module docstring on the "include_tool_calls" architecture).

    Argless command-marker exclusion (V1 polish 2026-05-13):
    Argless slash markers (``is_command_marker=True``: ``/exit``, ``/clear``,
    ``/compact`` and the leading-prelude rows that ``_flag_leading_prelude_markers``
    flags on top of them) are CHROME, not user content. The viewer hides them
    behind ``SessionPreludeAffordance`` / ``SlashCommandBadge`` and the export
    surfaces drop them via ``export._is_excludable_marker``. The search
    projection mirrors that exclusion here — typing ``exit`` in the search
    box should NOT produce hits on ``Session: /exit`` chrome rows.

    Predicate equivalence with ``export._is_excludable_marker`` (export.py:159)
    is INTENTIONAL: both surfaces apply the same definition of "chrome" so the
    spec invariant "one truth, three surfaces" (viewer + search + export) holds.
    Argful markers (``/coding <prose>``, ``/plan <prose>``) carry
    ``is_command_marker=False`` post-Fix-2 (claude_code_reader 2026-05-13), so
    they pass through this guard and remain searchable on the user's real
    prose body AND on the ``slash_command`` token.

    Strict ``is True`` check (not truthy): defends against non-bool injections
    (e.g. ``"false"`` string, ``1`` int) from fixtures or future code paths that
    might silently exclude legitimate messages. Production data is always bool
    per the Pydantic ``Message`` model (models.py) and the CC ingester
    (claude_code_reader.py:342 sets it as a real boolean), but the function
    signature is ``dict[str, Any]`` so we don't trust truthiness.

    Index-time side effect (paired with SCHEMA_VERSION bump 3 → 4 in
    search_index.py): ``upsert_conversation`` writes ``body=""`` for these
    rows, so they contribute no tokens to the FTS5 inverted index. Title is
    still populated, so unqualified MATCH on a conversation title is still
    correct — the title pseudo-message comes from the `_search_via_index`
    title-sweep, not from marker-row body matches.
    """
    if message.get("is_command_marker") is True:
        return ""

    parts: list[str] = []

    text = message.get("text") or ""
    if text:
        if not include_tool_calls:
            # Mirror frontend filterToolPlaceholders so a message whose
            # `text` is ONLY a tool placeholder is correctly treated as
            # empty when the user has hidden tool calls.
            text = _TOOL_PLACEHOLDER_RE.sub("", text).strip()
        if text:
            parts.append(text)

    # CC slash-command name (V1 polish round 3, 2026-05-12). Set by the
    # triplet collapser on synthetic "Session: /foo" markers AND on
    # argful markers where `message["text"]` is the user's prompt body.
    # We append the "/foo" string so both surface forms are searchable:
    #   * Literal substring `/coding` hits via linear-scan regex.
    #   * FTS5's `unicode61` tokenizer splits on `/` so the token
    #     `coding` ALSO appears in the indexed projection — a user
    #     searching for either form gets the marker.
    # MUST guard against None: an unguarded `parts.append(None)` would
    # raise TypeError in the trailing `"\n".join(parts)`. The truthy
    # guard also drops empty-string values without poisoning the index
    # with a stray "None" literal.
    slash_command = message.get("slash_command")
    if slash_command:
        parts.append(slash_command)

    for block in message.get("content") or []:
        if not isinstance(block, dict):
            continue
        btype = block.get("type")

        if btype == "text":
            t = block.get("text") or ""
            if t:
                parts.append(t)

        elif btype == "tool_use":
            if not include_tool_calls:
                continue
            name = block.get("name") or ""
            if name:
                parts.append(name)
            tool_input = block.get("input")
            if isinstance(tool_input, dict):
                parts.append(_stringify_tool_input(tool_input))
            elif isinstance(tool_input, str):
                parts.append(tool_input)

        elif btype == "tool_result":
            if not include_tool_calls:
                continue
            tr_content = block.get("content")
            if isinstance(tr_content, str):
                parts.append(tr_content)
            elif isinstance(tr_content, list):
                for sub in tr_content:
                    if isinstance(sub, dict) and sub.get("type") == "text":
                        t = sub.get("text") or ""
                        if t:
                            parts.append(t)

        # `thinking` blocks: deliberately NOT indexed (V1 polish 2026-05-13).
        # The frontend has no renderer for `thinking` content blocks
        # (see frontend/src/components/message/MessageBubble.tsx
        # ContentBlockRenderer — only 'text', 'tool_use', 'tool_result',
        # 'image' branches). Indexing thinking would produce search hits
        # that map to bubbles where the matching text is invisible —
        # a confusing UX failure mode. Re-add this branch (gated by a
        # new `include_thinking` setting wired through SettingsContext +
        # preferences + a header toggle + the search query) when a
        # "Show thinking" affordance ships.

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


def parse_user_query(query: str) -> tuple[str | None, list[str]]:
    """Split a free-form user query into (phrase, tokens).

    Returns:
      * Phrase mode: ``("foo bar", ["foo bar"])`` when the user's entire query
        is wrapped in matching double quotes — exact-phrase semantics.
      * Token mode: ``(None, ["foo", "bar", "baz"])`` when the query is
        unquoted whitespace-separated — AND-of-tokens semantics.
      * Single token: ``(None, ["foo"])`` — same as token mode with one term.
      * Empty: ``(None, [])`` — caller skips search.

    The phrase detection is intentionally narrow (entire query quoted, no
    mixed `foo "bar baz"` syntax). That keeps the predicate stable and
    matches user expectations: quotes mean "the whole thing is literal".

    Why no boundary characters in the returned tokens: the snippet regex
    built downstream (see ``_make_snippet_regex``) deliberately avoids
    ``\\b`` boundaries because the FTS5 index uses the ``porter`` stemmer +
    ``unicode61 remove_diacritics 1`` tokenizer (search_index.py:121).
    FTS5 matches ``running`` for query ``run`` and ``café`` for ``cafe``;
    a Python regex with ``\\b`` would fail to find those tokens in the
    raw message text and silently drop FTS5 hits. The fallback path in
    the callers handles that drift by emitting a 0-length highlight when
    no Python match is found.
    """
    stripped = query.strip()
    if not stripped:
        return None, []
    # Phrase mode: starts and ends with " (and has at least 3 chars so we
    # don't treat a single empty-string "" as a phrase).
    if len(stripped) >= 3 and stripped[0] == '"' and stripped[-1] == '"':
        inner = stripped[1:-1].strip()
        if inner:
            return inner, [inner]
    return None, stripped.split()


def _make_snippet_regex(phrase: str | None, tokens: list[str]) -> "re.Pattern[str] | None":
    """Build the regex used to locate a highlight position in a message.

    Phrase mode → literal escaped phrase. Token mode (>=1 token) → an
    alternation ``(t1|t2|...)`` matching ANY token. No word boundaries —
    see ``parse_user_query`` for the stemmer-drift rationale.

    Returns ``None`` when there are no tokens (caller short-circuits).
    """
    if phrase is not None:
        return re.compile(re.escape(phrase), re.IGNORECASE)
    if not tokens:
        return None
    return re.compile(
        "|".join(re.escape(t) for t in tokens),
        re.IGNORECASE,
    )


# Default length of the leading-text fallback snippet emitted when the
# Python regex can't find a query token in an FTS5-matched message body
# (stemmer/diacritic drift). 300 chars ≈ 6 lines of prose — enough for
# the user to recognize what they matched even without a yellow <mark>.
_FALLBACK_SNIPPET_LEN = 300


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
    include_tool_calls: bool = True,
    organization_id: str | None = None,
    conversation_uuids: set[str] | None = None,
) -> list[SearchResult]:
    """Search across all conversations for matching messages.

    Dispatches to the FTS5 fast path when the index is ready (see module
    docstring); falls back to the linear-scan path on any failure mode
    (index not ready, FTS5 unavailable, sqlite3 error). Both paths produce
    byte-for-byte identical ``SearchResult`` objects for whole-word
    queries.

    Scope filters (manual finding 2026-05-04 + sidebar-scope propagation
    2026-05-14):
      - ``conversation_uuid``: restrict to a single conversation. Most
        specific filter; wins over ``project_path`` / ``bookmarks`` /
        ``conversation_uuids`` when more than one is passed.
      - ``project_path``: restrict to conversations whose project_path
        matches exactly (CC sessions grouped by their cwd).
      - ``bookmarks``: restrict to a set of conversation UUIDs (the
        client passes the bookmark set when the sidebar's Starred filter
        is active).
      - ``organization_id`` (sidebar Workspace dropdown, 2026-05-14):
        restrict to conversations whose organization_id matches exactly.
        ``None`` matches only None on the conv side — a UUID filter never
        incidentally surfaces untagged data (mirrors
        ``ConversationStore.list_conversations``).
      - ``conversation_uuids`` (active-filter set, 2026-05-14): restrict
        to a set of UUIDs. The frontend computes this from the active
        filter graph (atoms/groups under
        ``frontend/src/lib/filterEngine.ts``); MCP does not use this.
        ``None`` means "no constraint"; the empty set means "filter
        excludes everything" — caller short-circuits to ``[]``.

    All filters AND-compose with each other and with the existing
    ``source`` filter. Backend-side because tool_use / tool_result
    payloads are large; client-side post-filtering would waste bandwidth
    and break ranking.

    ``include_tool_calls`` (2026-05-11): when False, search ignores
    tool_use / tool_result / thinking content. Hit messages whose only
    matching text lives in those blocks are silently dropped — the
    sidebar should only show results the user can navigate to. The FTS5
    index itself is still built over the full text; the filter is applied
    at scatter/snippet time so toggling the setting doesn't require a
    rebuild.

    Note on FTS5 ``LIMIT 5000`` and ``include_tool_calls=False``: if a
    user's corpus has more than 5000 messages whose only token-match is
    in tool content, FTS5 may return them as the top 5000 ranked hits
    (we then drop all of them) while a plain-text match further down the
    ranking gets missed. The linear-scan fallback would still find it.
    This is an accepted theoretical drift; on Ray's 1,222-file corpus
    it's unrealizable. If a bug report ever shows count mismatch on a
    real query, pagination is the fix.
    """
    if not query or len(query.strip()) < 1:
        return []

    # Empty-set short-circuit: an active filter that excludes everything
    # passes ``conversation_uuids=set()``. Same semantic as ``bookmarks``
    # — distinct from ``None`` (no constraint). Spec §2 (2026-05-14).
    # We DON'T short-circuit on empty bookmarks here for backward compat
    # with the existing router contract; that path's empty handling lives
    # in ``_search_via_linear_scan`` and ``SearchIndex.query``. The
    # conversation_uuids check is hoisted up so we don't waste a query on
    # the FTS5 index either.
    if conversation_uuids is not None and not conversation_uuids:
        return []

    # ``conversation_uuid`` (singular pin scope) is most-specific; when
    # set, it overrides ``project_path``, ``bookmarks``, AND
    # ``conversation_uuids``. We strip the latter three here so the
    # downstream paths only ever see the pin gate.
    if conversation_uuid is not None:
        conversation_uuids = None
        bookmarks = None
        project_path = None

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
                    include_tool_calls=include_tool_calls,
                    organization_id=organization_id,
                    conversation_uuids=conversation_uuids,
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
        include_tool_calls=include_tool_calls,
        organization_id=organization_id,
        conversation_uuids=conversation_uuids,
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
    include_tool_calls: bool = True,
    organization_id: str | None = None,
    conversation_uuids: set[str] | None = None,
) -> list[SearchResult]:
    """Original linear-scan implementation; now the fallback path.

    Walks every conversation, runs a Python regex against each message's
    flattened searchable text. Slow on large corpora (~0.8-2.3s on Ray's
    1.5GB corpus) but always correct and never depends on an index file
    being present.

    Sidebar-scope params (2026-05-14):
      * ``organization_id`` — workspace gate; mirrors
        ConversationStore.list_conversations behavior. None on the conv
        side does NOT match a UUID filter (and vice versa).
      * ``conversation_uuids`` — active-filter set gate; ANDs with the
        other scope filters. None means "no constraint".
    """
    phrase, tokens = parse_user_query(query)
    if not tokens:
        return []
    pattern = _make_snippet_regex(phrase, tokens)
    if pattern is None:
        return []
    # Lowercased token list used to AND-filter messages on the linear path
    # (phrase mode is a single literal "token"). The FTS5 path filters
    # AND-semantics in SQL; the linear path is the fallback and must
    # enforce the same contract here.
    tokens_lower = [t.lower() for t in tokens]
    results = []

    for conv in store.get_all_conversations_raw(source=source):
        if conversation_uuid:
            # Most specific filter; wins over project_path / bookmarks /
            # conversation_uuids. (We also strip those three at the
            # search_conversations entry point — this is defense in depth.)
            if conv.get("uuid") != conversation_uuid:
                continue
        else:
            if project_path and conv.get("project_path") != project_path:
                continue
            if bookmarks is not None and conv.get("uuid") not in bookmarks:
                continue
            if (
                conversation_uuids is not None
                and conv.get("uuid") not in conversation_uuids
            ):
                continue
        # Workspace filter ANDs always (not part of the most-specific
        # override). None on the filter side means "no constraint";
        # otherwise an exact-equality gate matches conv organization_id
        # (None on the conv side is NOT a wildcard match).
        if organization_id is not None and conv.get("organization_id") != organization_id:
            continue
        matching_messages: list[MessageSnippet] = []

        # Search in conversation name. Title-match policy:
        #   * Phrase mode → literal substring (the whole phrase appears).
        #   * Token mode  → CURRENT behavior preserved: substring match on
        #     the FULL query string (so a typed 3-word query that wasn't
        #     intended as a title hunt doesn't unexpectedly match more
        #     titles). This is intentionally conservative; revisit if a
        #     user reports title hits being too narrow.
        name = conv.get("name", "")
        name_lower = name.lower()
        title_needle = (phrase if phrase is not None else query).lower()
        if title_needle and title_needle in name_lower:
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
            #
            # 2026-05-11: dynamic cache key so the include_tool_calls=True
            # and False projections coexist without poisoning each other.
            # A query that toggles the setting between calls re-uses the
            # other projection on the cached dict.
            cache_key = (
                "__search_text_full__" if include_tool_calls
                else "__search_text_textonly__"
            )
            text = msg.get(cache_key)
            if text is None:
                text = _extract_searchable_text(
                    msg, include_tool_calls=include_tool_calls,
                )
                msg[cache_key] = text

            if not text:
                continue

            # AND-of-tokens gate (linear path): every required token must
            # appear (case-insensitive substring) in the message text.
            # Phrase mode reduces to "the phrase must appear" because
            # tokens_lower has a single element equal to the phrase. This
            # matches the FTS5 path's MATCH semantics. Without this gate,
            # the snippet regex's alternation (foo|bar) would happily
            # surface a message containing only "foo" — silent OR drift.
            text_lower = text.lower()
            if not all(t in text_lower for t in tokens_lower):
                continue

            msg_created_at = _parse_datetime(msg.get("created_at"))

            # Snippet placement: find the FIRST token occurrence (any
            # token; first-match wins). The frontend's HighlightedSnippet
            # only supports a single contiguous <mark>, so highlighting
            # multiple tokens isn't worth the complexity — the user sees
            # WHY they landed, and the ±150 char window typically shows
            # the other tokens around it.
            match = pattern.search(text)
            if match is not None:
                if context_size == "full":
                    snippet = text
                    start = match.start()
                    end = match.end()
                else:
                    snippet, start, end = create_snippet(
                        text, match.start(), match.end()
                    )
            else:
                # Fallback: tokens AND-pass but regex didn't find them
                # literally (stemmer-drift on the FTS5 side OR a unicode
                # normalization quirk). Emit a leading-text snippet with
                # a 0-length highlight rather than dropping the FTS5 hit.
                if context_size == "full":
                    snippet = text
                else:
                    snippet = text[:_FALLBACK_SNIPPET_LEN] + (
                        "..." if len(text) > _FALLBACK_SNIPPET_LEN else ""
                    )
                start = 0
                end = 0
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
    include_tool_calls: bool = True,
    organization_id: str | None = None,
    conversation_uuids: set[str] | None = None,
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
        organization_id=organization_id,
        conversation_uuids=conversation_uuids,
    )
    body_matched_uuids: set[str] = {m["conv_uuid"] for m in matches}

    # Parse user query once — drives both title sweep and snippet regex.
    phrase, tokens = parse_user_query(query)
    if not tokens:
        return []
    title_needle = phrase if phrase is not None else query
    # Step 2: title-substring sweep. The linear scan emits a title pseudo-
    # message when the conversation NAME contains the query (case-
    # insensitive substring). FTS5 catches token-aligned title matches,
    # but a substring that crosses token boundaries (e.g. "ned" inside
    # "scheduled") would NOT hit FTS5 yet WOULD hit the linear scan.
    # We use the FTS5 index's own ``title`` column as the source of
    # truth — it's stored UNINDEXED so a SELECT DISTINCT is cheap and
    # avoids the multi-second cost of ``store.list_conversations()``
    # (which rebuilds the agent index on every call).
    #
    # Multi-word note: we sweep on the FULL query string (or stripped
    # phrase) — conservative substring semantics, mirroring the linear
    # path. Token-level AND on titles is a future enhancement (see
    # `_search_via_linear_scan` for the matching policy).
    query_lower = title_needle.lower()
    title_matched_uuids: set[str] = set()
    title_sql_clauses = ["title LIKE ?"]
    title_sql_params: list[Any] = [f"%{title_needle}%"]
    # Sidebar-scope (2026-05-14): the title sweep needs the conversation_uuids
    # gate too, so a title-only hit on an excluded conversation doesn't bleed
    # in via this code path. We use the same TEMP TABLE that SearchIndex.query
    # populates (under the per-thread read connection); see
    # SearchIndex._populate_allowed_conv. If conversation_uuids is None we
    # don't emit the JOIN at all.
    use_allowed_join = conversation_uuids is not None
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
        if use_allowed_join:
            title_sql_clauses.append(
                "conv_uuid IN (SELECT uuid FROM allowed_conv)"
            )
    if source != "all":
        title_sql_clauses.append("source = ?")
        title_sql_params.append(source)
    if organization_id is not None:
        title_sql_clauses.append("organization_id = ?")
        title_sql_params.append(organization_id)
    if title_sql_clauses:
        try:
            conn = idx._get_read_conn()
            # If we're using the allowed_conv TEMP table here, populate it
            # on this same read connection. SearchIndex.query already did
            # this for the main MATCH query, but the TEMP table is per-
            # connection — we're guaranteed the same conn since both
            # threading.local lookups happen inside one request thread.
            if use_allowed_join:
                idx._populate_allowed_conv(conn, conversation_uuids)
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
    if conversation_uuids is not None:
        candidate_uuids &= conversation_uuids

    if not candidate_uuids:
        return []

    # Step 3: walk ONLY the matched conversations. For each matched
    # conv, find which of its messages were FTS5-hit, then run the
    # snippet regex on those messages to produce snippets byte-for-byte
    # identical to the linear path.
    pattern = _make_snippet_regex(phrase, tokens)
    if pattern is None:
        return []
    tokens_lower = [t.lower() for t in tokens]
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
        # 2026-05-11: dynamic cache key keyed to include_tool_calls so the
        # two projections coexist on the same cached message dict (FTS5
        # index always stores the FULL text; the filter is applied at
        # snippet-build time here). A query that toggles the setting
        # between calls re-uses the other projection without thrashing.
        cache_key = (
            "__search_text_full__" if include_tool_calls
            else "__search_text_textonly__"
        )
        for msg in conv.get("chat_messages", []):
            if msg.get("uuid") not in wanted_msg_uuids:
                continue
            text = msg.get(cache_key)
            if text is None:
                text = _extract_searchable_text(
                    msg, include_tool_calls=include_tool_calls,
                )
                msg[cache_key] = text
            if not text:
                continue
            # FTS5 returns a row for every message in a conversation
            # whose TITLE column matches (title is indexed too); a
            # title-only hit will surface every message row for that
            # conv. To match the linear path's body-only emission, we
            # require the body to contain every token (case-insensitive
            # substring) before emitting a body snippet. This is also
            # the gate that lets us emit a fallback snippet for stemmer
            # drift (e.g. query `run` finds `running` in body — the
            # substring check passes, the regex fails, fallback fires).
            text_lower = text.lower()
            if not all(t in text_lower for t in tokens_lower):
                continue
            msg_created_at = _parse_datetime(msg.get("created_at"))
            # FTS5 already filtered by MATCH (AND-of-tokens). The regex
            # below is for PLACING the highlight, not gating inclusion.
            # If the regex finds nothing, that's stemmer/diacritic drift
            # (porter+unicode61 on FTS5 side vs literal regex on Python
            # side) — we still emit a leading-text fallback snippet so
            # the user sees the FTS5 hit instead of an invisible drop.
            match = pattern.search(text)
            if match is not None:
                if context_size == "full":
                    snippet = text
                    start = match.start()
                    end = match.end()
                else:
                    snippet, start, end = create_snippet(
                        text, match.start(), match.end()
                    )
            else:
                if context_size == "full":
                    snippet = text
                else:
                    snippet = text[:_FALLBACK_SNIPPET_LEN] + (
                        "..." if len(text) > _FALLBACK_SNIPPET_LEN else ""
                    )
                start = 0
                end = 0
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
    so both paths share the implementation byte-for-byte.

    Bug B fix (V1 polish 2026-05-14, second attempt): for sort fields
    ``updated_at`` and ``created_at``, the conversation-level sort key
    is ``r.conversation_updated_at`` / ``r.conversation_created_at``
    EXACTLY — no max/min over matched-message timestamps.

    Why we removed the prior message-aware sort:

      * The UI displays the conversation's own ``updated_at`` in the
        date column of each result card (frontend SearchPanel.tsx
        renders ``match.createdAt`` first, then falls back to the
        conversation timestamp). The sort label in the same panel is
        "Last Activity" — users reasonably read that as conversation
        activity, not "newest matched message time".
      * The prior key ``max([m.created_at for m in matching_messages])``
        produced a user-visible inversion: a conversation updated
        yesterday whose matched message body is a month old would sort
        BELOW a conversation updated last week with a recent matched
        message. The user sees "yesterday" labeled card BELOW "last
        week" labeled card. Live reproduced 2026-05-14:
          curl /api/search?q=comprehensive+medium&sort=updated_at&sort_order=desc
        showed position 4 with conv_updated_at=2026-05-14 BELOW position 3
        with conv_updated_at=2026-05-01.

    Within-conversation message ordering is unchanged: messages inside
    a single result card group are still sorted by their per-message
    ``created_at`` (with fallback to conversation_updated_at for nulls),
    so multiple matches inside the same conversation show in time order.
    """
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