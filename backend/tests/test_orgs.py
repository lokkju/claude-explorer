"""Tests for the /api/orgs endpoint and conversation/search org filtering.

C6 of cowork-multi-org. The endpoint returns a discriminated three-state
response (NEW-P0-C):

  * (a) creds present + parseable -> 200 {authenticated: true, orgs: [...]}
  * (b) creds file absent         -> 200 {authenticated: false, orgs: []}
  * (c) creds file corrupt        -> 500 {error: "credentials_corrupt", ...}

The synthetic "_claude_code" org must never appear in the response (it's a
source, not a tenant).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from fetcher.credentials import save_credentials


PERSONAL = "ae24ae66-4622-48e7-b4b3-1ab2c49f933d"
COWORK = "0c0c170b-1234-5678-90ab-cdef00000000"


def _v2_creds(orgs_count: int = 2):
    orgs = [{"uuid": PERSONAL, "name": "Personal", "capabilities": ["chat"], "seen_in_response": True}]
    if orgs_count >= 2:
        orgs.append({"uuid": COWORK, "name": "Cowork", "capabilities": ["chat"], "seen_in_response": True})
    return {
        "schema_version": 2,
        "session_key": "sk-test",
        "cf_bm": None,
        "cf_clearance": None,
        "captured_at": "2026-05-01T00:00:00+00:00",
        "orgs": orgs,
        "primary_org_id": PERSONAL,
        "legacy_migration_target": PERSONAL,
        "org_id": PERSONAL,
    }


@pytest.fixture
def isolated_creds(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    creds = tmp_path / "credentials.json"
    monkeypatch.setattr(
        "backend.routers.orgs.DEFAULT_CREDENTIALS_PATH", creds, raising=False
    )
    return creds


def test_endpoint_three_state_authenticated_true(
    client: TestClient, isolated_creds: Path
) -> None:
    """NEW-P0-C. Valid creds with two orgs → 200 {authenticated: true, orgs: [...]}."""
    save_credentials(_v2_creds(orgs_count=2), isolated_creds)
    r = client.get("/api/orgs")
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["authenticated"] is True
    assert len(data["orgs"]) == 2
    by_id = {o["org_id"]: o for o in data["orgs"]}
    assert PERSONAL in by_id
    assert COWORK in by_id
    assert by_id[PERSONAL]["is_primary"] is True
    assert by_id[COWORK]["is_primary"] is False
    assert by_id[PERSONAL]["name"] == "Personal"


def test_endpoint_three_state_authenticated_false(
    client: TestClient, isolated_creds: Path
) -> None:
    """NEW-P0-C. No creds file → 200 {authenticated: false, orgs: []}."""
    # Don't write the creds file.
    r = client.get("/api/orgs")
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["authenticated"] is False
    assert data["orgs"] == []


def test_endpoint_three_state_corrupt(
    client: TestClient, isolated_creds: Path
) -> None:
    """NEW-P0-C. Creds file exists but is invalid JSON → 500."""
    isolated_creds.parent.mkdir(parents=True, exist_ok=True)
    isolated_creds.write_text("{not valid json")
    r = client.get("/api/orgs")
    assert r.status_code == 500
    data = r.json()
    assert data.get("detail", {}).get("error") == "credentials_corrupt" or "credentials_corrupt" in str(data)


def test__get_orgs__credentials_v2_invalid__returns_500_corrupt(
    client: TestClient, isolated_creds: Path
) -> None:
    """ORG-CORRUPT-SCHEMA (P4.2). schema_version=2 but invalid → 500 credentials_corrupt.

    Frontend distinguishes ``authenticated: false`` (clean re-capture) from a
    500 (user must wipe + recapture). A creds file that claims v2 but fails
    field validation is a distinct UI state — must surface as 500, not 200/false.
    Exercises ``_validate`` at fetcher/credentials.py:138-191 via the v2 path
    at credentials.py:240-244.
    """
    isolated_creds.parent.mkdir(parents=True, exist_ok=True)
    isolated_creds.write_text(json.dumps({
        "schema_version": 2,
        "orgs": [{"uuid": PERSONAL, "name": "X", "capabilities": ["chat"], "seen_in_response": True}],
        "primary_org_id": PERSONAL,
        "captured_at": "2026-05-01T00:00:00+00:00",
    }))
    r = client.get("/api/orgs")
    assert r.status_code == 500, r.text
    detail = r.json().get("detail", {})
    assert detail.get("error") == "credentials_corrupt", (
        f"expected error=credentials_corrupt, got {detail!r}"
    )
    assert "session_key" in detail.get("message", ""), (
        f"detail.message should reference the missing field; got {detail!r}"
    )


def test__get_orgs__credentials_truncated_json__returns_500_corrupt(
    client: TestClient, isolated_creds: Path
) -> None:
    """ORG-CORRUPT-PARSE (P4.2). Truncated JSON → 500 credentials_corrupt with detail.

    Stronger assertion than the existing three-state test: pin the exact
    detail.error code that the frontend dispatches on.
    """
    isolated_creds.parent.mkdir(parents=True, exist_ok=True)
    isolated_creds.write_text('{"schema_version": 2, "session_key"')  # truncated
    r = client.get("/api/orgs")
    assert r.status_code == 500
    detail = r.json().get("detail", {})
    assert detail.get("error") == "credentials_corrupt"
    assert "message" in detail and detail["message"], (
        f"detail.message must be non-empty; got {detail!r}"
    )


def test__orgs_response_schema__pydantic_response_model_in_openapi(
    client: TestClient,
) -> None:
    """Hunt Pydantic↔TS drift (Task B): `/api/orgs` must have a
    Pydantic response_model so OpenAPI documents the shape and future
    drift surfaces in the schema diff. The router previously returned
    a raw `dict` with no response_model — frontend `OrgsResponse` /
    `Org` interfaces were the only contract spec.

    RED test for the tightening: if `response_model` is not set OR
    the response schema does not declare both `authenticated` and
    `orgs[].org_id` keys, this fails.

    Bidirectional: see
    `test__orgs_response_schema__authenticated_true_payload_matches_pydantic_shape`
    below for the GREEN-direction "real shape still works" check.
    """
    openapi = client.get("/openapi.json").json()
    paths = openapi["paths"]
    assert "/api/orgs" in paths, "GET /api/orgs missing from OpenAPI"
    get_op = paths["/api/orgs"]["get"]
    schemas = openapi["components"]["schemas"]
    resp_200 = get_op["responses"]["200"]["content"]["application/json"]["schema"]
    # Either a direct $ref or an inline schema.
    if "$ref" in resp_200:
        ref_name = resp_200["$ref"].split("/")[-1]
        resp_schema = schemas[ref_name]
    else:
        resp_schema = resp_200
    props = resp_schema.get("properties", {})
    assert "authenticated" in props, (
        f"OrgsResponse schema must declare 'authenticated'; got props={list(props)}"
    )
    assert "orgs" in props, (
        f"OrgsResponse schema must declare 'orgs'; got props={list(props)}"
    )
    # Drill into the orgs item schema to confirm `org_id` is documented.
    orgs_items = props["orgs"].get("items", {})
    if "$ref" in orgs_items:
        org_schema = schemas[orgs_items["$ref"].split("/")[-1]]
    else:
        org_schema = orgs_items
    org_props = org_schema.get("properties", {})
    assert "org_id" in org_props, (
        f"Org schema must declare 'org_id'; got props={list(org_props)}"
    )
    assert "is_primary" in org_props, (
        f"Org schema must declare 'is_primary'; got props={list(org_props)}"
    )


def test__orgs_response_schema__authenticated_true_payload_matches_pydantic_shape(
    client: TestClient, isolated_creds: Path
) -> None:
    """Bidirectional GREEN for the tightening: with valid creds, the
    actual response payload still matches the existing wire format
    that the frontend `OrgsResponse` interface encodes. If the
    Pydantic tightening accidentally changes a field name or drops a
    field, this fails."""
    save_credentials(_v2_creds(orgs_count=2), isolated_creds)
    r = client.get("/api/orgs")
    assert r.status_code == 200, r.text
    data = r.json()
    assert set(data.keys()) == {"authenticated", "orgs"}, (
        f"top-level keys drifted; got {set(data)}"
    )
    assert isinstance(data["orgs"], list) and data["orgs"], "orgs must be non-empty"
    for org in data["orgs"]:
        assert set(org.keys()) == {"org_id", "name", "is_primary"}, (
            f"Org keys drifted; got {set(org)}"
        )
        assert isinstance(org["org_id"], str)
        assert org["name"] is None or isinstance(org["name"], str)
        assert isinstance(org["is_primary"], bool)


def test_synthetic_claude_code_org_filtered(
    client: TestClient, isolated_creds: Path
) -> None:
    """The synthetic _claude_code 'org' must never appear in the response."""
    creds = _v2_creds(orgs_count=2)
    creds["orgs"].append({
        "uuid": "_claude_code", "name": "Claude Code", "capabilities": [], "seen_in_response": False
    })
    # _claude_code isn't a valid uuid for primary_org_id but the validator
    # accepts any non-empty str. Skip validation by writing directly.
    isolated_creds.parent.mkdir(parents=True, exist_ok=True)
    isolated_creds.write_text(json.dumps(creds))
    r = client.get("/api/orgs")
    assert r.status_code == 200
    data = r.json()
    org_ids = {o["org_id"] for o in data["orgs"]}
    assert "_claude_code" not in org_ids


# ---------------------------------------------------------------------------
# Conversation list filter by organization_id
# ---------------------------------------------------------------------------


def test_conversation_list_filter_by_organization_id(
    client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """?organization_id=<uuid> returns only that org's conversations."""
    data_dir = tmp_path / "conversations"
    data_dir.mkdir()
    monkeypatch.setenv("CLAUDE_EXPLORER_DATA_DIR", str(data_dir))
    # Bust the lru_cache.
    from backend.config import get_settings
    get_settings.cache_clear()

    def _write(org_uuid: str, conv_uuid: str, name: str) -> None:
        org_dir = data_dir / "by-org" / org_uuid
        org_dir.mkdir(parents=True, exist_ok=True)
        (org_dir / f"{conv_uuid}.json").write_text(json.dumps({
            "uuid": conv_uuid,
            "name": name,
            "summary": "",
            "model": "claude-sonnet-4-6",
            "created_at": "2024-03-01T12:00:00Z",
            "updated_at": "2024-03-01T13:00:00Z",
            "organization_id": org_uuid,
            "organization_name": "X",
            "chat_messages": [],
        }))

    _write(PERSONAL, "11111111-2222-3333-4444-555555555555", "PersonalConv")
    _write(COWORK, "22222222-2222-3333-4444-555555555555", "CoworkConv")

    r1 = client.get(f"/api/conversations?organization_id={PERSONAL}")
    assert r1.status_code == 200
    convs1 = r1.json()
    uuids1 = {c["uuid"] for c in convs1}
    assert "11111111-2222-3333-4444-555555555555" in uuids1
    assert "22222222-2222-3333-4444-555555555555" not in uuids1

    r2 = client.get(f"/api/conversations?organization_id={COWORK}")
    assert r2.status_code == 200
    uuids2 = {c["uuid"] for c in r2.json()}
    assert "22222222-2222-3333-4444-555555555555" in uuids2
    assert "11111111-2222-3333-4444-555555555555" not in uuids2
