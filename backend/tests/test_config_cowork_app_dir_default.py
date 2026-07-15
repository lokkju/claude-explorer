"""Default resolution of ``claude_desktop_app_dir`` (the Cowork app dir).

Bug (2026-07-15): on Linux the default was
``platformdirs.user_data_path("Claude")`` → ``~/.local/share/Claude``,
but Claude Desktop is an Electron app whose ``userData`` on Linux is
``$XDG_CONFIG_HOME`` → ``~/.config/Claude``. The two diverge on Linux
(and on Windows, where Electron uses Roaming ``%APPDATA%`` but
``user_data_path`` returns Local ``%LOCALAPPDATA%``), so ``cowork_root``
pointed at an empty directory and Cowork sessions were never enumerated
into the search index.

The fix makes the scalar ``claude_desktop_app_dir`` default to the
canonical Electron ``userData`` location
(``user_config_path("Claude", roaming=True)``), and unions discovery
across every candidate location (see
``test_cowork_multi_location_union.py``):

* Linux   → ``~/.config/Claude``                    (matches Electron)
* macOS   → ``~/Library/Application Support/Claude`` (config == data here)
* Windows → ``%APPDATA%\\Claude`` (Roaming)          (matches Electron)

This file pins the scalar-default contract. The autouse
``_isolate_cowork_app_dir``
fixture in conftest sets ``CLAUDE_DESKTOP_APP_DIR``; these tests delete
it so the *default* resolution path is exercised.
"""

from __future__ import annotations

from pathlib import Path

import platformdirs
import pytest

from backend import config


@pytest.fixture
def default_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Isolate HOME and strip every override so ``Settings.load`` falls
    through to the candidate-probing default for ``claude_desktop_app_dir``."""
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.delenv("CLAUDE_DESKTOP_APP_DIR", raising=False)
    monkeypatch.delenv("CLAUDE_EXPLORER_DATA_DIR", raising=False)
    monkeypatch.delenv("CLAUDE_EXPORTER_DATA_DIR", raising=False)
    monkeypatch.delenv("CLAUDE_DIR", raising=False)
    config.get_settings.cache_clear()
    yield tmp_path
    config.get_settings.cache_clear()


# -- Override precedence ------------------------------------------------


def test_env_override_is_sole_candidate() -> None:
    """An explicit env override wins outright — no probing."""
    cands = config._desktop_app_dir_candidates("/explicit/env/dir", None)
    assert cands == [Path("/explicit/env/dir")]


def test_config_override_is_sole_candidate() -> None:
    cands = config._desktop_app_dir_candidates(None, Path("/explicit/config/dir"))
    assert cands == [Path("/explicit/config/dir")]


# -- Default resolution -------------------------------------------------


def test_default_falls_back_to_electron_userdata_when_nothing_on_disk(
    default_env: Path,
) -> None:
    """With no sessions anywhere, the default is the canonical Electron
    ``userData`` location — ``user_config_path(roaming=True)``, NOT
    ``user_data_path``."""
    settings = config.Settings.load()
    assert settings.claude_desktop_app_dir == platformdirs.user_config_path(
        "Claude", roaming=True
    )


def test_default_is_not_user_data_path_when_they_differ(default_env: Path) -> None:
    """Regression guard for the original bug: where Electron's ``userData``
    differs from ``user_data_path`` (Linux, Windows), the default MUST NOT
    be the old ``user_data_path``. macOS coincides, so it's a no-op there."""
    data_path = platformdirs.user_data_path("Claude")
    config_path = platformdirs.user_config_path("Claude", roaming=True)
    settings = config.Settings.load()
    if data_path != config_path:
        assert settings.claude_desktop_app_dir != data_path
    assert settings.claude_desktop_app_dir == config_path


def test_scalar_default_is_first_candidate(default_env: Path) -> None:
    """The scalar is always the primary (candidates[0]); union discovery —
    not the scalar — is what finds sessions in secondary locations."""
    candidates = config._desktop_app_dir_candidates(None, None)
    settings = config.Settings.load()
    assert settings.claude_desktop_app_dir == candidates[0]
