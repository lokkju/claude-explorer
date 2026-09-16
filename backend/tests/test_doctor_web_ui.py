"""doctor must report whether the web UI is actually bundled.

Reported 2026-09-16 as "a git based install doesn't include the ui".
The bundle itself turned out to be fine, but nothing in the product says
so: `_resolve_static_dir` returning None drops the server into API-only
mode with a single `log.warning` that scrolls past on startup, `/` then
answers JSON instead of the app, and `doctor` reports "All checks
passed" the whole time. Same blindness as the search-index coverage gap
— a missing capability that no check looks at.
"""
from __future__ import annotations

from pathlib import Path

import backend.doctor as doctor
from backend.doctor import Status


def test_web_ui_ok_when_bundle_present(monkeypatch, tmp_path: Path) -> None:
    static = tmp_path / "_static"
    (static / "assets").mkdir(parents=True)
    (static / "index.html").write_text("<html></html>")
    (static / "assets" / "index-abc.js").write_text("x")
    monkeypatch.setattr(doctor, "_resolve_static_dir", lambda: static)

    r = doctor.check_web_ui()

    assert r.status is Status.OK
    assert str(static) in r.detail


def test_web_ui_warns_when_absent(monkeypatch) -> None:
    """API-only mode must be visible in doctor, with an actionable fix.

    Bug it would surface: doctor reporting all-clear on an install whose
    UI never shipped, which is exactly what the reporter saw.
    """
    monkeypatch.setattr(doctor, "_resolve_static_dir", lambda: None)

    r = doctor.check_web_ui()

    assert r.status is Status.WARN
    assert "api-only" in r.detail.lower()
    assert r.fix_command


def test_web_ui_warns_when_bundle_has_no_assets(monkeypatch, tmp_path: Path) -> None:
    """index.html alone is a broken bundle: the shell loads and every
    script 404s, which looks like "the UI doesn't work" rather than "the
    UI is missing". Catch it as its own case."""
    static = tmp_path / "_static"
    static.mkdir()
    (static / "index.html").write_text("<html></html>")
    monkeypatch.setattr(doctor, "_resolve_static_dir", lambda: static)

    r = doctor.check_web_ui()

    assert r.status is Status.WARN
    assert "asset" in r.detail.lower()


def test_web_ui_is_registered(monkeypatch) -> None:
    """The check has to be in ALL_CHECKS or it never runs."""
    names = [name for name, _ in doctor.ALL_CHECKS]
    assert "Web UI" in names


def test_web_ui_survives_a_raising_resolver(monkeypatch) -> None:
    """doctor must never crash on a check."""
    def _boom():
        raise OSError("nope")

    monkeypatch.setattr(doctor, "_resolve_static_dir", _boom)

    results = doctor.run_checks([("Web UI", doctor.check_web_ui)])

    assert results[0].status is Status.FAIL
    assert "OSError" in results[0].detail
