"""Tests for the per-org subdirectory layout introduced in C3.

C3 changes:
  * ClaudeFetcher.__init__ accepts orgs + primary_org_id (drops scalar org_id).
  * save_conversation writes to output_dir/by-org/<org_uuid>/<uuid>.json.
  * organization_id / organization_name are injected into the on-disk JSON.
  * _index.json is written in v2 schema (single-element orgs array in C3).
  * Legacy save_index() preserves backward-compat for now (UUID-only dedup;
    pair dedup ships in C5).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from fetcher.bulk_fetch import ClaudeFetcher


def _make_fetcher(tmp_path: Path, org_uuid: str = "ae24ae66-4622-48e7-b4b3-1ab2c49f933d") -> ClaudeFetcher:
    return ClaudeFetcher(
        session_key="sk-test",
        orgs=[{"uuid": org_uuid, "name": "Personal", "capabilities": ["chat"], "seen_in_response": True}],
        primary_org_id=org_uuid,
        output_dir=tmp_path / "conversations",
        files_dir=tmp_path / "files",
        download_files=False,
        delay=0.0,
    )


def test_save_conversation_writes_to_by_org_subdir(tmp_path: Path) -> None:
    """C3 storage layout: <output_dir>/by-org/<org_uuid>/<uuid>.json"""
    fetcher = _make_fetcher(tmp_path)
    conv = {"uuid": "11111111-2222-3333-4444-555555555555", "name": "Test"}
    fetcher.save_conversation(conv)

    expected = (
        tmp_path
        / "conversations"
        / "by-org"
        / "ae24ae66-4622-48e7-b4b3-1ab2c49f933d"
        / "11111111-2222-3333-4444-555555555555.json"
    )
    assert expected.exists(), f"expected {expected} to exist; tree:\n" + "\n".join(
        str(p) for p in (tmp_path / "conversations").rglob("*")
    )


def test_save_conversation_injects_organization_fields(tmp_path: Path) -> None:
    """The on-disk JSON must carry organization_id and organization_name."""
    fetcher = _make_fetcher(tmp_path)
    conv = {"uuid": "11111111-2222-3333-4444-555555555555", "name": "Test"}
    fetcher.save_conversation(conv)

    saved_path = (
        tmp_path / "conversations" / "by-org" / "ae24ae66-4622-48e7-b4b3-1ab2c49f933d" / "11111111-2222-3333-4444-555555555555.json"
    )
    saved = json.loads(saved_path.read_text())
    assert saved["organization_id"] == "ae24ae66-4622-48e7-b4b3-1ab2c49f933d"
    assert saved["organization_name"] == "Personal"


def test_save_conversation_does_not_overwrite_existing_organization_id(tmp_path: Path) -> None:
    """If the conversation already has organization_id (e.g. from a re-fetch
    of a tagged file), do NOT overwrite — but the file goes under whichever
    org the fetcher is currently scoped to.
    """
    fetcher = _make_fetcher(tmp_path)
    conv = {
        "uuid": "11111111-2222-3333-4444-555555555555",
        "name": "Test",
        "organization_id": "some-other-org-from-elsewhere",
        "organization_name": "Some Other Org",
    }
    fetcher.save_conversation(conv)

    # File path is still by current scope (we're fetching as "Personal"):
    saved_path = (
        tmp_path / "conversations" / "by-org" / "ae24ae66-4622-48e7-b4b3-1ab2c49f933d" / "11111111-2222-3333-4444-555555555555.json"
    )
    assert saved_path.exists()
    saved = json.loads(saved_path.read_text())
    # Pre-existing organization_id is honored over the synthesized one.
    assert saved["organization_id"] == "some-other-org-from-elsewhere"


def test_save_index_writes_v2_schema(tmp_path: Path) -> None:
    """C3: _index.json is v2 with a single-element orgs array (single-org fetch)."""
    fetcher = _make_fetcher(tmp_path)
    convs = [
        {"uuid": "aaaaaaaa-1111-2222-3333-444444444444", "name": "A", "model": "claude-sonnet-4"},
        {"uuid": "bbbbbbbb-1111-2222-3333-444444444444", "name": "B", "model": "claude-opus-4"},
    ]
    fetcher.save_index(convs)

    index_path = tmp_path / "conversations" / "_index.json"
    assert index_path.exists()

    idx = json.loads(index_path.read_text())
    assert idx["schema_version"] == 2
    assert "fetched_at" in idx
    assert "orgs" in idx
    assert len(idx["orgs"]) == 1

    org_entry = idx["orgs"][0]
    assert org_entry["org_id"] == "ae24ae66-4622-48e7-b4b3-1ab2c49f933d"
    assert org_entry["name"] == "Personal"
    assert org_entry["status"] == "ok"
    assert org_entry["fetched_count"] == 2
    assert org_entry["last_successful_fetched_count"] == 2
    assert org_entry["last_successful_fetched_at"] is not None
    assert org_entry["error_code"] is None
    assert len(org_entry["conversations"]) == 2


def test_init_rejects_legacy_org_id_kwarg(tmp_path: Path) -> None:
    """Per NEW4-P0-D, C3 drops scalar org_id from __init__."""
    with pytest.raises(TypeError):
        ClaudeFetcher(
            session_key="sk",
            org_id="abc",  # type: ignore[call-arg]
            output_dir=tmp_path,
        )


def test_init_requires_orgs_and_primary(tmp_path: Path) -> None:
    """Both orgs and primary_org_id are required."""
    with pytest.raises(TypeError):
        ClaudeFetcher(session_key="sk", output_dir=tmp_path)  # type: ignore[call-arg]


def test_primary_must_appear_in_orgs(tmp_path: Path) -> None:
    """primary_org_id must reference an org in the orgs list."""
    with pytest.raises(ValueError):
        ClaudeFetcher(
            session_key="sk",
            orgs=[{"uuid": "ae24ae66-4622-48e7-b4b3-1ab2c49f933d", "name": "Personal", "capabilities": [], "seen_in_response": False}],
            primary_org_id="0c0c170b-1234-5678-90ab-cdef00000000",
            output_dir=tmp_path,
        )


def test_existing_pairs_includes_by_org_files(tmp_path: Path) -> None:
    """Incremental dedup must read from by-org/<org>/*.json (the new layout)."""
    fetcher = _make_fetcher(tmp_path)
    org_uuid = "ae24ae66-4622-48e7-b4b3-1ab2c49f933d"
    by_org = tmp_path / "conversations" / "by-org" / org_uuid
    by_org.mkdir(parents=True)
    (by_org / "11111111-2222-3333-4444-555555555555.json").write_text(
        json.dumps({"uuid": "11111111-2222-3333-4444-555555555555"})
    )

    existing = fetcher.existing_uuids_for_current_org()
    assert "11111111-2222-3333-4444-555555555555" in existing


def test_existing_pairs_ignores_other_orgs(tmp_path: Path) -> None:
    """Incremental dedup is per-org in C3 (UUID-only set; spec says pair-set
    dedup waits for C5)."""
    fetcher = _make_fetcher(tmp_path)
    other_org = tmp_path / "conversations" / "by-org" / "0c0c170b-1234-5678-90ab-cdef00000000"
    other_org.mkdir(parents=True)
    (other_org / "11111111-2222-3333-4444-555555555555.json").write_text(
        json.dumps({"uuid": "11111111-2222-3333-4444-555555555555"})
    )

    existing = fetcher.existing_uuids_for_current_org()
    assert "11111111-2222-3333-4444-555555555555" not in existing
