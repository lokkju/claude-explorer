"""Port-conflict surfaces an actionable error.

Build-8 #3 (BLOCKER) — see PLANS/explorer-improvements-build.md.
"""

import pytest
from click.testing import CliRunner

from fetcher.cli import main


def test_address_in_use_oserror_is_actionable(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(*args, **kwargs):
        raise OSError(48, "Address already in use")

    import uvicorn

    monkeypatch.setattr(uvicorn, "run", boom)

    runner = CliRunner()
    result = runner.invoke(main, ["serve", "--port", "9123"])

    assert result.exit_code != 0
    combined = (result.output or "") + (str(result.exception) if result.exception else "")
    assert "9123" in combined
    assert "port" in combined.lower()
    assert "--port" in combined


def test_other_oserror_propagates(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(*args, **kwargs):
        raise OSError(13, "Permission denied")

    import uvicorn

    monkeypatch.setattr(uvicorn, "run", boom)

    runner = CliRunner()
    result = runner.invoke(main, ["serve", "--port", "9123"])

    assert result.exit_code != 0
    assert isinstance(result.exception, OSError)
    assert result.exception.errno == 13
