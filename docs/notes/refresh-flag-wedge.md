# Refresh could wedge at 409 until the worker restarted

**Priority:** Medium-high — user-visible, unrecoverable without a
restart.
**Discovery date:** 2026-09-16

## Problem

`refresh_pipeline` claims the concurrency flag in the HANDLER:

```python
_refresh_in_progress = True
return StreamingResponse(
    refresh_pipeline_stream(incremental=incremental, limit=limit), ...)
```

and the only reset is the `finally` inside `refresh_pipeline_stream`.

An async generator's `finally` runs only if its body was ever entered.
At the point above the generator has merely been constructed, and
Starlette never calls `aclose()` on a body iterator (no `aclose` appears
anywhere in `starlette/responses.py`). So a generator dropped before its
first `__anext__` is finalised without executing its body.

Failure scenario: the user clicks Refresh and immediately navigates away
or hits Esc, tearing down the connection before `stream_response`
reaches the first `__anext__`. anyio cancels the task group, the
generator is collected un-started, and every subsequent
`GET /api/fetch/refresh` returns `409 Refresh already in progress` — with
no work running anywhere — until the worker restarts.

## Fix

Keep claiming the flag synchronously (that is what makes the 409 check
race-free — there is no `await` between test and set), but pull the
first frame in the handler before handing the iterator to Starlette. A
started generator that is later abandoned gets `aclose()`d by asyncio's
async-generator finaliser, which runs the `finally`.

`_PrimedStream` replays the pulled frame and then delegates; its
`aclose` forwards, so an explicit close also runs the `finally`.

Priming is cheap on both branches: the capture path yields
`capture_start` before doing any work, and the fetch path only reads the
credentials file. If priming itself raises, the handler releases the
flag before re-raising.

## Affected files

- `backend/routers/fetch.py`
- `backend/tests/test_refresh_flag_release.py`
