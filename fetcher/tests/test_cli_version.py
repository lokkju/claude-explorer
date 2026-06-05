"""Regression test: ``claude-explorer --version`` must report the real
installed package version, not a frozen literal.

Pre-fix shipping bug (found 2026-06-04 while smoke-testing the published
1.0.4 wheel from PyPI): ``cli/main.py`` hardcoded
``@click.version_option(version="0.1.0")``, so ``claude-explorer
--version`` printed ``0.1.0`` on *every* release. The fix lets Click read
the version from installed package metadata (``package_name=``), which
can never drift from ``pyproject.toml``.
"""

from __future__ import annotations

from importlib.metadata import version

from click.testing import CliRunner

from cli.main import main


def test_version_flag_reports_installed_package_version() -> None:
    expected = version("claude-explorer")
    result = CliRunner().invoke(main, ["--version"])
    assert result.exit_code == 0
    assert expected in result.output


def test_version_flag_is_not_the_frozen_literal() -> None:
    # The shipping bug was a hardcoded "0.1.0" that never tracked the
    # package. Guard against that literal returning while the real version
    # differs.
    pkg = version("claude-explorer")
    result = CliRunner().invoke(main, ["--version"])
    assert result.exit_code == 0
    if pkg != "0.1.0":
        assert "0.1.0" not in result.output
