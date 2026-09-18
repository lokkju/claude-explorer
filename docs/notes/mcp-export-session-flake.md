# `test_mcp_export_session_preserves_summary_on_sliced_copy` — RESOLVED

**Priority:** was High (failed CI on every PR).
**Discovery date:** 2026-09-18, surfaced when Actions were first enabled
on this fork. The defect itself predates the 1.1.0 work.
**Status:** root-caused and fixed. Kept because the investigation cost
several wrong turns that are worth not repeating.

## Root cause

`test_server_version_does_not_require_installed_package_metadata`
simulates the MCPB bundle environment by reloading the server module:

```python
sys.modules.pop("mcp_server.server", None)
reloaded = importlib.import_module("mcp_server.server")
finally:
    sys.modules.pop("mcp_server.server", None)   # "restore"
```

Popping is not restoring, and there are **two** bindings, not one:

* `sys.modules["mcp_server.server"]`
* the attribute `server` on the parent package `mcp_server`

`importlib.import_module` sets both to the newly created module.
`sys.modules.pop` clears only the first. And `from mcp_server import
server` — which is what the conftest's `reset_mcp_singletons` uses —
resolves through the **package attribute**, not `sys.modules`.

So after that test:

* conftest nulled `_store` / `_settings` on the RELOADED module;
* every test that did `from mcp_server.server import <tool>` at
  collection time still called into the ORIGINAL module, whose `_store`
  held a `ConversationStore` bound to an earlier test's tmp `data_dir`.

`export_session` then looked for the session in a directory belonging to
the previous test and raised `Session '<uuid>' not found` for a file
sitting on disk in the correct directory.

**This was never a store bug.** `ConversationStore.get_conversation` was
behaving correctly; it was handed a store pointed at a dead directory.

## Fix

Restore both bindings in the reloading test's `finally`:

```python
sys.modules["mcp_server.server"] = original
_pkg.server = original
```

Measured after the fix: **0/12 serial, 0/25 at `-n 4`**. Before:
**10/12 serial, ~1 in 4 at `-n 4`**.

The CI deselect is removed and the full MCP suite gates PRs again.

## Wrong turns worth not repeating

Every hypothesis below was *measured*, which is the only reason the
wrong ones got discarded instead of shipped.

| Hypothesis | Result |
|---|---|
| FileCache / `_DETAIL_DICT_CACHE` leaking across tests | cleared both → 5/20, unchanged |
| `summary_cache` singleton not reset in the MCP conftest | added it → 6/25, unchanged |
| Caused by the 1.1.0 work | base commit `2f5336f` → 5/20, pre-existing |
| Caused by adding `mcp_server/tests` to `testpaths` | CI passes an explicit path, which ignores `testpaths` |
| Migration sentinel hiding the flat file | instrumentation showed the file listed and visible |
| Module reload, fixed by restoring `sys.modules` only | → 10/10, unchanged — the package attribute was the missing half |

Three measurement errors cost the most time:

1. **Too few runs.** An initial 6-run check of the base commit came back
   clean and nearly proved "I broke it". At a 25% rate, 6 runs miss it
   about half the time. Anything checking this needs 20+ runs.
2. **Assuming the parallel path was the problem.** `-n auto` on a
   many-core box passed, so it looked like an xdist artifact. It is
   deterministic serially; pinning CI to `-n0` would have made it red
   every run. Caught by measuring before committing to it.
3. **Instrumenting the wrong object.** Early diagnostics did
   `from mcp_server import server` and printed `data_dir`, which showed
   everything correct — because that import returned the *reloaded*
   module while the failing call used the original. Same for an identity
   check run at teardown, after the conftest had re-imported. The
   decisive diagnostic compared `fn.__globals__` (what the call actually
   uses) against a fresh import, in the failing test body:

   ```
   DIAG4 same dict?   : False
   DIAG4 bound _store : /tmp/.../test_mcp_list_sessions_still_i0/data   <- previous test
   DIAG4 fresh _store : None
   ```

   Instrument the object the failing code path holds, not a
   freshly-resolved one, and do it at the moment of failure.

## Also changed alongside

`mcp_server/tests/conftest.py` now resets the `summary_cache` singleton
as well as the search-index one. It resolves the same SQLite file via the
same `default_index_path`, so repointing the path without resetting the
singleton can leave it attached to the developer's real
`~/.claude-explorer/search-index.sqlite`. `backend/tests/conftest.py`
resets both; this mirror had only half. Unrelated to the bug above — it
was measured and does not affect it.

## Affected files

- `mcp_server/tests/test_server_version.py` (the fix)
- `mcp_server/tests/conftest.py` (summary-cache reset)
- `.github/workflows/test.yml` (deselect removed)
