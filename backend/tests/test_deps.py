"""Tests for ``backend.deps`` — the FastAPI dependency factories.

Validates two contracts:

  1. ``get_store()`` returns a fresh ``ConversationStore`` per call,
     bound to the current settings — NOT a cached singleton. The
     rationale is in ``backend/deps.py``'s docstring: caching the store
     traps stale ``data_dir`` / ``claude_dir`` snapshots when test
     fixtures swap ``CLAUDE_EXPLORER_DATA_DIR``.
  2. FastAPI's ``app.dependency_overrides[get_store] = lambda: ...``
     hook actually swaps the store inside route handlers. This is the
     P0 test seam for router-level tests that want a fixture-driven
     store without monkeypatching module globals.
"""

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from backend.deps import get_store
from backend.store import ConversationStore


def test_get_store_returns_conversation_store_instance() -> None:
    """Smoke test: the factory hands back a real ConversationStore."""
    store = get_store()
    assert isinstance(store, ConversationStore)


def test_get_store_returns_fresh_instance_each_call() -> None:
    """Pinning the no-memoization decision.

    ``ConversationStore`` snapshots settings at construction, so caching
    would trap stale ``data_dir`` after a test fixture swaps env vars.
    If a future refactor reintroduces memoization, this test fails and
    forces the author to think through the test-isolation tradeoff
    again. The fix is NOT to update this assertion — it's to either
    auto-invalidate on settings change, or to keep the no-cache
    factory.
    """
    a = get_store()
    b = get_store()
    assert a is not b


def test_dependency_override_replaces_store_in_route() -> None:
    """The standard FastAPI override pattern reaches into the handler.

    This is the test seam routers will use. If this assertion ever
    fails, router-level tests lose the ability to inject a test store
    without resorting to monkeypatching backend.deps internals.
    """
    app = FastAPI()
    sentinel = ConversationStore()

    @app.get("/_test/store-id")
    def handler(store: ConversationStore = Depends(get_store)) -> dict:
        return {"id": id(store)}

    app.dependency_overrides[get_store] = lambda: sentinel
    client = TestClient(app)
    response = client.get("/_test/store-id")
    assert response.status_code == 200
    assert response.json() == {"id": id(sentinel)}
