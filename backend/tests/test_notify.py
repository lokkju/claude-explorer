from __future__ import annotations

import backend.notify as notify


def test_macos_uses_osascript(monkeypatch) -> None:
    calls = []
    monkeypatch.setattr(notify.sys, "platform", "darwin")
    monkeypatch.setattr(notify, "_run", lambda cmd: calls.append(cmd) or True)
    assert notify.notify("T", "M") is True
    assert calls[0][0] == "osascript"


def test_linux_uses_notify_send_when_present(monkeypatch) -> None:
    calls = []
    monkeypatch.setattr(notify.sys, "platform", "linux")
    monkeypatch.setattr(notify.shutil, "which", lambda name: "/usr/bin/notify-send")
    monkeypatch.setattr(notify, "_run", lambda cmd: calls.append(cmd) or True)
    assert notify.notify("T", "M") is True
    assert calls[0][0] == "notify-send"


def test_linux_no_notify_send_returns_false(monkeypatch) -> None:
    monkeypatch.setattr(notify.sys, "platform", "linux")
    monkeypatch.setattr(notify.shutil, "which", lambda name: None)
    assert notify.notify("T", "M") is False


def test_windows_uses_powershell(monkeypatch) -> None:
    calls = []
    monkeypatch.setattr(notify.sys, "platform", "win32")
    monkeypatch.setattr(notify, "_run", lambda cmd: calls.append(cmd) or True)
    assert notify.notify("T", "M") is True
    assert "powershell" in calls[0][0].lower()


def test_unknown_platform_returns_false(monkeypatch) -> None:
    monkeypatch.setattr(notify.sys, "platform", "sunos5")
    assert notify.notify("T", "M") is False


# ---------------------------------------------------------------------------
# AppleScript quoting (docs/notes/notify-applescript-quoting.md)
#
# The script was built with Python `repr()`:
#
#     f'display notification {message!r} with title {title!r}'
#
# AppleScript string literals require DOUBLE quotes; `'foo'` is a syntax
# error. repr() emits single quotes unless the value contains an
# apostrophe, so whether the notification worked depended on the text.
# The one message this module actually sends -- scheduled_fetch's
# _REAUTH_MSG -- has no apostrophe, so it always produced invalid
# AppleScript and osascript always exited non-zero. macOS users never got
# the re-auth notice.
# ---------------------------------------------------------------------------


def _macos_script(monkeypatch, title: str, message: str) -> str:
    calls: list[list[str]] = []
    monkeypatch.setattr(notify.sys, "platform", "darwin")
    monkeypatch.setattr(notify, "_run", lambda cmd, **kw: calls.append(cmd) or True)
    notify.notify(title, message)
    assert calls, "notify() must invoke osascript on darwin"
    return calls[0][-1]


def test_macos_script_uses_applescript_double_quotes(monkeypatch) -> None:
    script = _macos_script(monkeypatch, "Claude Explorer", "Session expired.")
    assert script == (
        'display notification "Session expired." with title "Claude Explorer"'
    ), f"AppleScript needs double-quoted literals; got: {script!r}"


def test_macos_script_is_valid_for_the_real_reauth_message(monkeypatch) -> None:
    """Regression guard on the exact production payload."""
    from backend.scheduled_fetch import _REAUTH_MSG, _REAUTH_TITLE

    script = _macos_script(monkeypatch, _REAUTH_TITLE, _REAUTH_MSG)
    assert "'" not in script.split("display notification ")[1][:1]
    assert script.startswith('display notification "')
    assert ' with title "Claude Explorer"' in script


def test_macos_script_escapes_embedded_quotes(monkeypatch) -> None:
    """A quote in the message must be escaped, not close the literal --
    otherwise the rest of the text is parsed as AppleScript."""
    script = _macos_script(monkeypatch, "T", 'say "hi" then beep')
    assert script == 'display notification "say \\"hi\\" then beep" with title "T"'


def test_macos_script_escapes_backslashes(monkeypatch) -> None:
    script = _macos_script(monkeypatch, "T", r"C:\path\to")
    assert script == 'display notification "C:\\\\path\\\\to" with title "T"'


def test_run_uses_a_timeout(monkeypatch) -> None:
    """A hung notifier must not block the caller.

    run_scheduled_fetch calls notify() while holding scheduled-fetch.lock;
    a notify-send that never returns (no notification daemon on a
    headless box) would wedge every later tick at the lock check.
    """
    seen: dict = {}

    def _fake_run(cmd, **kwargs):
        seen.update(kwargs)

        class _R:
            returncode = 0

        return _R()

    monkeypatch.setattr(notify.subprocess, "run", _fake_run)
    notify._run(["true"])
    assert seen.get("timeout"), f"expected a timeout kwarg, got {seen!r}"


def test_run_returns_false_on_timeout(monkeypatch) -> None:
    import subprocess as sp

    def _fake_run(cmd, **kwargs):
        raise sp.TimeoutExpired(cmd, 5)

    monkeypatch.setattr(notify.subprocess, "run", _fake_run)
    assert notify._run(["true"]) is False
