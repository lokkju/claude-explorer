# scheduled-fetch could crash and could fail silently

**Priority:** Medium.
**Discovery date:** 2026-09-16

`backend/scheduled_fetch.py`'s module docstring promises "Never raises:
every failure becomes a status + exit code." Two holes:

1. `_acquire_lock()` was called OUTSIDE the `try`. It only catches
   `FileExistsError`, but its `p.parent.mkdir()` and `os.open()` raise
   `PermissionError` (root-owned or read-only `~/.claude-explorer`) and
   `OSError(ENOSPC)` too. Those escaped the catch-all entirely, so the
   supervised job died with a traceback.
2. The catch-all itself only logged and returned 1 — no status write. A
   job that had been failing for days still reported the last success as
   current in `doctor` and the UI, because nothing ever overwrote the
   status file.

## Fix

Lock acquisition moved inside the `try` (with `handle = None` first so
the `finally` still releases correctly). The catch-all now writes an
`error` status — best-effort, wrapped, since the failure could be the
status write itself. `last_success_at` is preserved by `_write`, so a
failed run never claims a fresh success, and lock contention stays a
quiet exit 0 that does not touch the status.

## Affected files

- `backend/scheduled_fetch.py`
- `backend/tests/test_scheduled_fetch_routine.py`
