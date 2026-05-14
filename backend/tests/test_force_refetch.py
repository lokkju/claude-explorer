"""Tests for the per-conversation force-refetch route (Build-1 follow-up)."""



def test_force_refetch_route_invokes_fetcher(client, monkeypatch):
    """A POST to /api/fetch/conversation/<uuid> should call ClaudeFetcher even
    if the conversation already exists on disk (no incremental skip)."""
    from backend.routers import fetch as fetch_router

    fetched: list[str] = []
    saved: list[dict] = []

    def fake_load_credentials(_path):
        return {
            "session_key": "sk_test",
            "org_id": "org_test",
            "cf_bm": None,
            "cf_clearance": None,
        }

    class FakeFetcher:
        def __init__(self, **_kwargs):
            pass

        def fetch_conversation(self, uuid):
            fetched.append(uuid)
            return {"uuid": uuid, "name": f"Refetched {uuid}", "chat_messages": []}

        def save_conversation(self, conv):
            saved.append(conv)

    monkeypatch.setattr(fetch_router, "load_credentials", fake_load_credentials)
    monkeypatch.setattr(fetch_router, "ClaudeFetcher", FakeFetcher)

    r = client.post("/api/fetch/conversation/test-uuid-xyz")
    assert r.status_code == 200, r.text
    assert fetched == ["test-uuid-xyz"]
    assert len(saved) == 1
    assert saved[0]["uuid"] == "test-uuid-xyz"


def test_force_refetch_returns_404_when_fetcher_returns_none(client, monkeypatch):
    from backend.routers import fetch as fetch_router

    def fake_load_credentials(_path):
        return {"session_key": "x", "org_id": "y", "cf_bm": None, "cf_clearance": None}

    class FakeFetcher:
        def __init__(self, **_kwargs):
            pass

        def fetch_conversation(self, _uuid):
            return None

        def save_conversation(self, _conv):
            pass

    monkeypatch.setattr(fetch_router, "load_credentials", fake_load_credentials)
    monkeypatch.setattr(fetch_router, "ClaudeFetcher", FakeFetcher)

    r = client.post("/api/fetch/conversation/missing-uuid")
    assert r.status_code == 404


def test_force_refetch_returns_401_on_auth_error(client, monkeypatch):
    from backend.routers import fetch as fetch_router

    def fake_load_credentials(_path):
        return {"session_key": "x", "org_id": "y", "cf_bm": None, "cf_clearance": None}

    class FakeFetcher:
        def __init__(self, **_kwargs):
            pass

        def fetch_conversation(self, _uuid):
            raise RuntimeError("403 Forbidden cf-mitigated: challenge")

        def save_conversation(self, _conv):
            pass

    monkeypatch.setattr(fetch_router, "load_credentials", fake_load_credentials)
    monkeypatch.setattr(fetch_router, "ClaudeFetcher", FakeFetcher)

    r = client.post("/api/fetch/conversation/blocked-uuid")
    assert r.status_code == 401
    assert "re-run" in r.json().get("detail", "").lower() or "re-capture" in r.json().get("detail", "").lower()
