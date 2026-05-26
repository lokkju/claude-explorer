"""FastAPI dependency factories.

Centralizes the construction of shared backend objects so router code
uses ``store: ConversationStore = Depends(get_store)`` instead of
ad-hoc ``ConversationStore()`` calls in every route handler. The win is
**test isolation**: tests swap the store with a fixture-driven instance
via ``app.dependency_overrides[get_store] = lambda: my_store``, no
monkeypatching of module globals required.

Why no memoization on ``get_store``: ``ConversationStore.__init__``
snapshots ``settings.data_dir`` and ``settings.claude_dir`` at
construction time. A singleton built before a test fixture swaps
``CLAUDE_EXPLORER_DATA_DIR`` would hold stale path state, silently
fighting the fixture. The real backend caches (``FileCache``,
``SummaryCache``, ``SearchIndex``) ARE singletons one level down —
allocating a fresh ``ConversationStore`` per request is just a couple
of attribute writes, not a meaningful cost.

This module is intentionally tiny — it's a seam, not an abstraction.
Future shared dependencies (e.g. a ``get_search_index()`` dependency
that returns the FTS5 index handle) can land here next to ``get_store``
under the same pattern.
"""

from fastapi import Depends, HTTPException

from .config import Settings, get_settings
from .store import ConversationStore


def get_store() -> ConversationStore:
    """Return a fresh ``ConversationStore`` bound to current settings.

    Routers use this via ``store: ConversationStore = Depends(get_store)``.
    Tests inject a different store via FastAPI's standard
    ``app.dependency_overrides[get_store] = lambda: my_store`` hook,
    which short-circuits this factory for the duration of the request.

    Not memoized — see module docstring for rationale.
    """
    return ConversationStore()


#: Shared message text for the corrupt-config refusal. Surfaced by the
#: HTTP gate (this module) AND by the CLI gate (``cli.main.fetch``)
#: so users see the same actionable hint regardless of where the
#: failure surfaces. External script callers parse this for
#: error-handling; keep the "Fix or remove" verb stable.
CONFIG_CORRUPT_REFUSAL_TEMPLATE = (
    "Config file is corrupt; refusing to write to avoid orphaning your "
    "archive. Reason: {reason}. "
    "Fix or remove ~/.claude-explorer/config.json and restart."
)


def refuse_if_config_corrupt(
    settings: Settings = Depends(get_settings),
) -> Settings:
    """Layer 2 of PLANS/2026.05.18-config-corruption-safe-mode.md.

    Refuse to handle a writer request when ``Settings`` carries a
    populated ``config_corrupt_reason`` — the parse-loop's signal that
    the user's ``config.json`` didn't load cleanly and that proceeding
    would risk silently writing to the wrong ``data_dir`` (orphaning
    their archive).

    Usage on writer routes::

        @router.post("", dependencies=[Depends(refuse_if_config_corrupt)])
        async def create_bookmark(...): ...

    READS are intentionally NOT gated: the user must be able to look
    at their existing archive while they fix the corrupt config. The
    ``/api/config`` endpoint specifically must remain available so the
    UI banner that tells the user about the problem can render.

    Returns the ``Settings`` instance on success so the dependency
    composes cleanly with downstream consumers that also need it (the
    return value is otherwise harmless to ignore).

    The 503 status is intentional: it preserves "service degraded"
    retry semantics, distinct from 500 (server bug) and 4xx (client
    fixable by changing the request).
    """
    if settings.config_corrupt_reason:
        raise HTTPException(
            status_code=503,
            detail=CONFIG_CORRUPT_REFUSAL_TEMPLATE.format(
                reason=settings.config_corrupt_reason
            ),
        )
    return settings
