"""Build-9 Bug 3: Per-conversation force-refetch should return USER-FRIENDLY
messages, not raw JSON detail strings or generic 5xx text.

Three scenarios:

1. Upstream 404 (the conversation isn't visible to the current credentials' org).
   Old: 404 with detail "Conversation X not found upstream".
   New: 404 with a friendly explanation that the conversation may have been
        deleted, archived, or moved to a different workspace.

2. Cross-org disambiguation: when the requested UUID is also missing from the
   cached `_index.json` (we just listed conversations and it isn't in the list),
   the friendlier message should explicitly mention the multi-workspace cause.

3. Upstream 401/403/cf-mitigated: same AUTH classification path as the main
   pipeline (uses SESSION_EXPIRED_MESSAGE).

These tests pin the contract that the route returns. The frontend will read
`detail` and surface it verbatim, so the message IS the user copy.
"""

import json

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _stub_creds(monkeypatch):
    from backend.routers import fetch as fetch_router

    def fake_load_credentials(_path):
        return {
            "session_key": "sk_test",
            "org_id": "org_test",
            "cf_bm": None,
            "cf_clearance": None,
        }

    monkeypatch.setattr(fetch_router, "load_credentials", fake_load_credentials)


# ---------------------------------------------------------------------------
# 1. Upstream 404 -> friendly message (no JSON / no "upstream" jargon)
# ---------------------------------------------------------------------------


def test_force_refetch_404_returns_friendly_message(client, monkeypatch):
    from backend.routers import fetch as fetch_router

    _stub_creds(monkeypatch)

    class FakeFetcher:
        def __init__(self, **_kwargs):
            pass

        def fetch_conversation(self, _uuid):
            # The fetcher returns None on a clean 404 from Anthropic.
            return None

        def fetch_conversation_list(self):
            # Index is unavailable; the route should still produce a friendly
            # 404 even if it can't compare against the org's conversation list.
            return []

        def save_conversation(self, _conv):
            pass

    monkeypatch.setattr(fetch_router, "ClaudeFetcher", FakeFetcher)

    r = client.post("/api/fetch/conversation/missing-uuid")
    assert r.status_code == 404, r.text

    detail = r.json().get("detail", "")
    lowered = detail.lower()

    # No raw fallback like "Conversation X not found upstream".
    assert "upstream" not in lowered, f"Raw 'upstream' jargon leaked to user: {detail!r}"
    # Must explain the situation in human terms.
    assert (
        "deleted" in lowered
        or "archived" in lowered
        or "no longer" in lowered
        or "not available" in lowered
        or "isn't available" in lowered
    ), f"Friendly explanation missing: {detail!r}"


# ---------------------------------------------------------------------------
# 2. Cross-org disambiguation: UUID also missing from the org's list -> mention
#    workspace
# ---------------------------------------------------------------------------


def test_force_refetch_cross_org_message_when_uuid_not_in_org_list(client, monkeypatch):
    """If the upstream returns 404 AND the UUID is not present in the org's
    own conversation list (compared against `_index.json` or a fresh
    `fetch_conversation_list()` call), the message should call out the
    multi-workspace possibility explicitly.
    """
    from backend.routers import fetch as fetch_router

    _stub_creds(monkeypatch)

    class FakeFetcher:
        def __init__(self, **_kwargs):
            pass

        def fetch_conversation(self, _uuid):
            return None

        def fetch_conversation_list(self):
            # The current org has SOME conversations, but not our missing one.
            return [
                {"uuid": "aaa-bbb", "name": "Other"},
                {"uuid": "ccc-ddd", "name": "Other 2"},
            ]

        def save_conversation(self, _conv):
            pass

    monkeypatch.setattr(fetch_router, "ClaudeFetcher", FakeFetcher)

    r = client.post("/api/fetch/conversation/c8f7917d-not-in-this-org")
    assert r.status_code == 404, r.text

    detail = r.json().get("detail", "")
    lowered = detail.lower()
    assert (
        "workspace" in lowered or "different" in lowered
    ), f"Cross-org explanation missing: {detail!r}"


def test_force_refetch_404_when_uuid_present_in_org_list_no_workspace_mention(
    client, monkeypatch
):
    """If the UUID IS in the org list but Anthropic still returns 404 for the
    detail call, this is most likely 'recently deleted', not a workspace
    mismatch. Avoid the workspace copy in that case to reduce confusion.
    """
    from backend.routers import fetch as fetch_router

    _stub_creds(monkeypatch)
    target_uuid = "aaa-bbb-here"

    class FakeFetcher:
        def __init__(self, **_kwargs):
            pass

        def fetch_conversation(self, _uuid):
            return None

        def fetch_conversation_list(self):
            return [{"uuid": target_uuid, "name": "I'm in the list"}]

        def save_conversation(self, _conv):
            pass

    monkeypatch.setattr(fetch_router, "ClaudeFetcher", FakeFetcher)

    r = client.post(f"/api/fetch/conversation/{target_uuid}")
    assert r.status_code == 404, r.text

    detail = r.json().get("detail", "")
    lowered = detail.lower()
    # Should NOT mention workspace because the UUID was in the org's list.
    assert "workspace" not in lowered, (
        f"Workspace copy should be reserved for cross-org case; got: {detail!r}"
    )


# ---------------------------------------------------------------------------
# 3. Upstream 401/403/cf-mitigated -> AUTH path with SESSION_EXPIRED_MESSAGE
# ---------------------------------------------------------------------------


def test_force_refetch_403_uses_session_expired_message(client, monkeypatch):
    from backend.routers import fetch as fetch_router

    _stub_creds(monkeypatch)

    class FakeFetcher:
        def __init__(self, **_kwargs):
            pass

        def fetch_conversation(self, _uuid):
            raise RuntimeError("403 Forbidden cf-mitigated: challenge")

        def save_conversation(self, _conv):
            pass

    monkeypatch.setattr(fetch_router, "ClaudeFetcher", FakeFetcher)

    r = client.post("/api/fetch/conversation/blocked-uuid")
    assert r.status_code == 401
    detail = r.json().get("detail", "").lower()
    # The canonical session-expired message lives in the router as a constant.
    assert "session" in detail or "re-run" in detail or "re-capture" in detail, detail


def test_force_refetch_401_uses_session_expired_message(client, monkeypatch):
    from backend.routers import fetch as fetch_router

    _stub_creds(monkeypatch)

    class FakeFetcher:
        def __init__(self, **_kwargs):
            pass

        def fetch_conversation(self, _uuid):
            raise RuntimeError("401 Unauthorized")

        def save_conversation(self, _conv):
            pass

    monkeypatch.setattr(fetch_router, "ClaudeFetcher", FakeFetcher)

    r = client.post("/api/fetch/conversation/auth-uuid")
    assert r.status_code == 401
    detail = r.json().get("detail", "").lower()
    assert "session" in detail or "re-run" in detail or "re-capture" in detail, detail
