"""`claude-explorer serve` must say so when it starts without a UI.

Reported 2026-09-16 as "a git based install doesn't include the ui". The
only signal today is a ``log.warning`` emitted at import time inside
``backend.main``, which lands in the structured log rather than in front
of the human who just typed the command; the CLI then prints
"Starting server on http://..." as though everything is fine, and the
browser gets JSON. ``serve`` already warns this way about a missing CC
watcher — same treatment here.
"""
from __future__ import annotations

from pathlib import Path

import pytest
from click.testing import CliRunner

import cli.main as cm
from cli.main import main


@pytest.fixture
def stub_serve(monkeypatch):
    """Stop `serve` from actually binding a port.

    The conftest's autouse fixture already pins the watcher as
    uninstalled, so that hint prints too — harmless here, since every
    assertion below is about the UI notice specifically.
    """
    import uvicorn

    monkeypatch.setattr(uvicorn, "run", lambda *a, **k: None)


def test_warns_when_ui_is_not_bundled(stub_serve, monkeypatch) -> None:
    monkeypatch.setattr(cm, "_serve_static_dir", lambda: None, raising=False)

    res = CliRunner().invoke(main, ["serve", "--port", "8799"])

    assert res.exit_code == 0, res.output
    out = res.output.lower()
    assert "api-only" in out, f"serve must announce API-only mode; got {res.output!r}"
    assert "doctor" in out or "npm run build" in out, (
        "the warning must point somewhere actionable"
    )


def test_silent_when_ui_is_bundled(stub_serve, monkeypatch, tmp_path: Path) -> None:
    """No noise on a healthy install."""
    static = tmp_path / "_static"
    (static / "assets").mkdir(parents=True)
    (static / "index.html").write_text("<html></html>")
    monkeypatch.setattr(cm, "_serve_static_dir", lambda: static, raising=False)

    res = CliRunner().invoke(main, ["serve", "--port", "8799"])

    assert res.exit_code == 0, res.output
    assert "api-only" not in res.output.lower()


def test_detection_failure_does_not_break_serve(stub_serve, monkeypatch) -> None:
    """A hint is never worth failing the command over."""
    def _boom():
        raise OSError("nope")

    monkeypatch.setattr(cm, "_serve_static_dir", _boom, raising=False)

    res = CliRunner().invoke(main, ["serve", "--port", "8799"])

    assert res.exit_code == 0, res.output
    assert "Starting server" in res.output
