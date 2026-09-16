# Supervised watcher never runs the search-index drift pass

**Priority:** High — silent, unbounded index staleness.
**Discovery date:** 2026-09-16

## Context

Cowork sessions appeared to be missing from the FTS5 index on Linux even
though `claude-explorer doctor` reported the index healthy and the
Cowork multi-location union fix (2f5336f, 2026-07-15) had been installed
for two months. The installed `uv tool` venv was byte-identical to repo
HEAD, and `_enumerate_conversation_paths` found all 16 on-disk Cowork
sessions when run directly. Only a manual `reindex-search` ever made
them searchable.

## Problem

`backend/cc_watcher.py:219` gates the backstop drift pass on
`idx.is_ready()`:

```python
idx = get_search_index()
if idx is not None and idx.is_ready():
    updated = update_drifted_files(ConversationStore(), index=idx)
```

`is_ready()` is a **process-local** flag. It is only set by
`mark_ready()`, which is only called at the end of `build_full_index()`,
which is only reachable from `backend/main.py` (the `serve` lifespan) and
`cli/main.py` (`reindex-search --full`). The supervised watcher launcher
(`~/.claude-explorer/cc-watcher.py`) calls neither, so `is_ready()` is
**permanently False in that process** and the pass at line 219 has never
executed there.

Confirmed against two months of retained journal for
`claude-explorer-cc-watcher.service`:

```
grep -c 'summary cache drift pass'  -> 2996
grep -c 'search index drift pass'   -> 0
```

The summary-cache pass immediately below it is ungated, which is why it
logs every backstop interval while the FTS5 pass logs nothing.

`_fire_drift_pass` (the inotify path, `cc_watcher.py:500`) explicitly
comments "Run even when not ready" and does not gate — so the two drift
paths disagree, and the one whose entire job is catching what inotify
missed is the disabled one. Anything not modified while the watcher was
alive, under a root that already existed at observer-start time, is
never backfilled. Cowork-on-Linux was exactly that population.

`backend/doctor.py:137` documents this same trap and works around it
with `is_built_on_disk()`; `scan_once` never got the same treatment.

## Proposed solution

The gate is not wrong to exist — `test_scan_once_skips_drift_when_index_
not_ready` pins it, and its rationale (do not drift-scan against a
half-built index, racing the initial build's writes) is sound for the
`serve` process. The predicate is what is wrong: it asks "did THIS
process ever complete a build?" when it means "is a build running right
now?".

Add an explicit in-flight flag to `SearchIndex` (`_build_in_progress`,
set at the top of `build_full_index` and cleared in a `finally`), expose
it as `is_building()`, and gate on `not idx.is_building()`. In the
`serve` process the behavior is unchanged; in the watcher process, where
no build ever runs, the flag is always False and the backstop works.

## Affected files

- `backend/cc_watcher.py` (`scan_once`)
- `backend/search_index.py` (`SearchIndex.is_building`, `build_full_index`)
- `backend/tests/test_cc_watcher.py` (rewrite the not-ready test, add a
  regression test for a process that never built)
