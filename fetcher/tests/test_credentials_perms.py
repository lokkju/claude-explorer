"""Credentials file must be written with 0o600 perms; parent dir 0o700.

After C2 of cowork-multi-org, the canonical perms tests live in
test_credentials.py (test_perms_0600, test_parent_dir_0700). This file is
retained as a thin facade so existing CI references still resolve, but
delegates to the new module to avoid duplication.
"""

import stat
import sys
from pathlib import Path

import pytest

from fetcher.credentials import save_credentials


def _v2_creds(primary: str = "org-uuid") -> dict:
    return {
        "schema_version": 2,
        "session_key": "sk-ant-test",
        "cf_bm": None,
        "cf_clearance": None,
        "captured_at": "2026-05-01T00:00:00+00:00",
        "orgs": [{"uuid": primary, "name": None, "capabilities": [], "seen_in_response": False}],
        "primary_org_id": primary,
        "legacy_migration_target": primary,
        "org_id": primary,
    }


def test_credentials_file_is_user_only_readable(tmp_path: Path) -> None:
    if sys.platform.startswith("win"):
        pytest.skip("Windows skipped")
    creds_path = tmp_path / "subdir" / "credentials.json"
    save_credentials(_v2_creds(), creds_path)

    assert creds_path.exists()
    mode = stat.S_IMODE(creds_path.stat().st_mode)
    assert mode == 0o600, f"expected 0o600, got {oct(mode)}"


def test_credentials_parent_dir_is_user_only(tmp_path: Path) -> None:
    if sys.platform.startswith("win"):
        pytest.skip("Windows skipped")
    creds_path = tmp_path / "subdir" / "credentials.json"
    save_credentials(_v2_creds(), creds_path)

    parent_mode = stat.S_IMODE(creds_path.parent.stat().st_mode)
    assert parent_mode == 0o700, f"expected 0o700, got {oct(parent_mode)}"


def test_credentials_overwrite_preserves_perms(tmp_path: Path) -> None:
    if sys.platform.startswith("win"):
        pytest.skip("Windows skipped")
    creds_path = tmp_path / "credentials.json"
    save_credentials(_v2_creds("first-uuid"), creds_path)
    save_credentials(_v2_creds("second-uuid"), creds_path)

    mode = stat.S_IMODE(creds_path.stat().st_mode)
    assert mode == 0o600, f"expected 0o600 after overwrite, got {oct(mode)}"
