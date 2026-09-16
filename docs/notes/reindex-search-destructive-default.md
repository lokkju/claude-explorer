# `reindex-search` defaults to a destructive wipe

**Priority:** Medium — data-destructive default, contradicted by its own
docstring.
**Discovery date:** 2026-09-16

## Context

Ran `claude-explorer reindex-search` expecting it to ensure everything
on disk was indexed. It wiped the index and rebuilt from scratch.

## Problem

`cli/main.py:403`:

```python
@click.option("--full/--drift", default=True, ...)
```

The default path calls `idx.clear_all()` (DELETE from `messages`,
`indexed_files`, `conversations`) and then rebuilds. Meanwhile the
command's own docstring says:

> Idempotent: re-runs are cheap because the upsert is a no-op for
> unchanged files (mtime check).

That is false for the default path. `clear_all()` truncates
`indexed_files`, so `_drift_first_scan` sees 100% of the corpus as
drifted and re-reads every file. On a real corpus that is a multi-minute
rebuild during which search is degraded.

Worse in combination with
[[watcher-search-drift-never-runs]]: when enumeration is under-covering
for any reason, a full rebuild *deletes* rows it cannot re-discover, so
the command that users reach for to fix a stale index can make it worse.

`--drift` already does the safe thing — `update_drifted_files` adds files
absent from `indexed_files` and cleans up rows for files that vanished —
which is what "reindex" reads as.

## Proposed solution

Flip the default to `--drift`. Keep `--full` as an explicit destructive
escape hatch, and have it print a warning naming the wipe before it runs.
Fix the docstring so the idempotence claim is attached to the path that
actually has it.

## Affected files

- `cli/main.py` (`reindex_search`)
- `CLAUDE.md` (the `reindex-search` section documents `--drift` as the
  non-default)
- `backend/tests/` (new CLI test pinning the default)
