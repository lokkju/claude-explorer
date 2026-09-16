# macOS re-auth notifications have never fired

**Priority:** Medium — the only proactive signal that a session expired.
**Discovery date:** 2026-09-16

## Problem

`backend/notify.py` built its AppleScript with Python `repr()`:

```python
script = f'display notification {message!r} with title {title!r}'
```

AppleScript string literals require DOUBLE quotes; `'foo'` is a syntax
error. `repr()` emits single quotes unless the value contains an
apostrophe — so whether the notification worked depended on the text.

The one message this module actually sends,
`scheduled_fetch._REAUTH_MSG`, contains no apostrophe:

> Your Claude session expired. Re-authenticate: run `claude-explorer
> capture` (or click Refresh in the web UI).

so the generated script was single-quoted, `osascript` exited non-zero,
and `_run` returned False. macOS users never saw the notice. The return
value is discarded by the caller, and the notification is edge-triggered
on `if not prior.auth_expired` — so the edge was consumed on the first
failure and no later tick retried.

`repr()` is also not an escaping function: a message containing a quote
would have been injected into the `-e` script.

## Fix

`_applescript_str()` renders a proper double-quoted literal, escaping
backslash then quote. Also gave `_run` a 5s timeout — `run_scheduled_fetch`
calls `notify()` while holding `scheduled-fetch.lock`, and a `notify-send`
that never returns (headless box, no notification daemon) would wedge the
lock and make every later tick skip as "previous run still in progress".

## Deliberately NOT fixed: the Windows branch is a no-op

```python
ps = ("[Windows.UI.Notifications.ToastNotificationManager, ...] > $null; "
      f"Write-Output {message!r}")
return _run(["powershell", "-NoProfile", "-Command", ps])
```

It loads a WinRT type and then writes to a captured (discarded) stdout.
No `ToastNotification` is ever constructed or shown, PowerShell exits 0,
and `notify()` reports success. Left alone because a correct replacement
(`System.Windows.Forms.NotifyIcon.ShowBalloonTip`, which also needs the
process to stay alive while the balloon renders) cannot be verified from
this machine, and shipping unverified Windows GUI code is worse than a
documented no-op. `test_windows_uses_powershell` currently pins the
existing behavior.

## Affected files

- `backend/notify.py`
- `backend/tests/test_notify.py`
