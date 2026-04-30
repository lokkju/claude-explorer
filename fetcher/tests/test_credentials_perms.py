"""Credentials file must be written with 0o600 perms; parent dir 0o700.

Build-8 #2 (BLOCKER) — see PLANS/explorer-improvements-build.md.
"""

import os
import stat
from pathlib import Path

from fetcher.playwright_capture import save_credentials


def test_credentials_file_is_user_only_readable(tmp_path: Path) -> None:
    creds_path = tmp_path / "subdir" / "credentials.json"
    save_credentials({"session_key": "x", "org_id": "y"}, creds_path)

    assert creds_path.exists()
    mode = stat.S_IMODE(creds_path.stat().st_mode)
    assert mode == 0o600, f"expected 0o600, got {oct(mode)}"


def test_credentials_parent_dir_is_user_only(tmp_path: Path) -> None:
    creds_path = tmp_path / "subdir" / "credentials.json"
    save_credentials({"session_key": "x", "org_id": "y"}, creds_path)

    parent_mode = stat.S_IMODE(creds_path.parent.stat().st_mode)
    assert parent_mode == 0o700, f"expected 0o700, got {oct(parent_mode)}"


def test_credentials_overwrite_preserves_perms(tmp_path: Path) -> None:
    creds_path = tmp_path / "credentials.json"
    save_credentials({"session_key": "first"}, creds_path)
    save_credentials({"session_key": "second"}, creds_path)

    mode = stat.S_IMODE(creds_path.stat().st_mode)
    assert mode == 0o600, f"expected 0o600 after overwrite, got {oct(mode)}"
