# One unreadable root wiped that surface's whole index

**Priority:** High — silent bulk data loss, newly reachable.
**Discovery date:** 2026-09-16

## Context

Found in a review immediately after
[[watcher-search-drift-never-runs]] was fixed. That fix turned the
supervised watcher's backstop drift pass back on, so this now executes
every 600s in a long-lived process where it had never run at all.

## Problem

`_drift_first_scan`'s missing-pass was:

```python
for indexed_path_str in indexed_mtimes.keys():
    if Path(indexed_path_str) not in live_set:
        missing.append(indexed_path)
```

and every enumeration failure upstream degrades to "no files":

- `_enumerate_conversation_paths` skips a Cowork root when
  `cowork_root.exists()` is False, and turns an `iterdir()` `OSError`
  into an empty list;
- `discover_jsonl_files` yields nothing when the projects dir is absent;
- `_get_conversation_files` returns `[]` when `data_dir` is absent.

So a root that is momentarily unavailable — an ejected external volume,
an autofs/NFS mount that has not come back, a Cowork directory moved by
an app update — reads as "every file on that surface was deleted", and a
single pass drops its `messages`, `conversations` and `indexed_files`
rows. Search then returns nothing for that surface until someone runs a
full rebuild.

Verified before fixing: with a Cowork session indexed, removing the
Cowork root and running one `update_drifted_files` deleted the row and
made the session unsearchable. Same for the CC projects root.

## Fix

`_enumerate_conversation_paths_with_roots` now also returns the roots it
actually walked — a Cowork root whose `iterdir()` raised is deliberately
not recorded. The missing-pass deletes only indexed paths that lie under
a root read successfully this pass, and logs a warning naming how many
rows it left alone. `_enumerate_conversation_paths` stays as a wrapper
for `doctor`'s coverage check.

**Trade-off:** a root the user genuinely deleted keeps its stale rows
until `reindex-search --full`. Stale rows beat silent bulk deletion, and
the full rebuild is the documented way to clear them.

## Affected files

- `backend/search_index.py`
- `backend/tests/test_drift_missing_pass_floor.py`
