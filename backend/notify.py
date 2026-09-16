"""Best-effort cross-platform desktop notification. CLI-only; never
raises. Returns False when no notifier is available (caller falls back
to the status file + doctor). Must stay OUT of the MCPB closure."""

from __future__ import annotations

import shutil
import subprocess
import sys


# Notifiers are fire-and-forget UI calls, but run_scheduled_fetch invokes
# notify() while holding scheduled-fetch.lock. A notifier that never
# returns -- notify-send on a headless box with no notification daemon --
# would wedge the lock and make every later tick skip as "previous run
# still in progress". Bound it. TimeoutExpired is a SubprocessError, so
# the existing handler already turns it into False.
_NOTIFY_TIMEOUT_SEC = 5


def _run(cmd: list[str]) -> bool:
    try:
        return subprocess.run(
            cmd, capture_output=True, text=True, timeout=_NOTIFY_TIMEOUT_SEC
        ).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def _applescript_str(value: str) -> str:
    """Render ``value`` as an AppleScript string literal.

    AppleScript literals are DOUBLE-quoted; `'foo'` is a syntax error.
    This used to be Python's ``repr()``, which emits single quotes unless
    the value happens to contain an apostrophe -- so whether the
    notification worked depended on the text, and the one message this
    module actually sends (scheduled_fetch._REAUTH_MSG) has no
    apostrophe, so osascript always failed and macOS users never saw the
    re-auth notice. Backslash first, then quote, or the escapes we add
    get re-escaped.
    """
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def notify(title: str, message: str) -> bool:
    if sys.platform == "darwin":
        script = (
            f"display notification {_applescript_str(message)} "
            f"with title {_applescript_str(title)}"
        )
        return _run(["osascript", "-e", script])
    if sys.platform.startswith("linux"):
        if shutil.which("notify-send") is None:
            return False
        return _run(["notify-send", title, message])
    if sys.platform == "win32":
        ps = (
            "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications,"
            " ContentType = WindowsRuntime] > $null; "
            f"Write-Output {message!r}"
        )
        # Minimal balloon via powershell; best-effort only.
        return _run(["powershell", "-NoProfile", "-Command", ps])
    return False
