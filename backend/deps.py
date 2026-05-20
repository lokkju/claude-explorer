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
