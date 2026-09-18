# Summary-cache cleanup churned rows for a relocated CC home

**Priority:** Medium — permanent 600s churn cycle, no data loss (the
summary cache is derived and rebuilds from disk).
**Discovery date:** 2026-09-16

## Problem

The summary cache is POPULATED from the union of Claude Code homes —
`ConversationStore._get_claude_code_conversations` loops
`self.claude_dirs`, and `store.py`'s detail path builds
`cc_files = [f for cdir in self.claude_dirs for f in discover_jsonl_files(cdir)]`.

The watcher's cleanup computed "live" from the SCALAR primary:

```python
claude_dir = get_settings().claude_dir
live_paths = list(discover_jsonl_files(claude_dir))
cleaned = cache.delete_missing({str(p) for p in stat_index.keys()})
```

So every cached row sourced from a relocated `$CLAUDE_CONFIG_DIR` tree
was deleted on each backstop pass and repopulated by the next sidebar
request — those sessions re-parsed from scratch every 600s, cache never
converging. The FTS5 pass in the same function goes through
`ConversationStore` for exactly this reason; the two passes disagreed
about what "live" means.

Verified before fixing: with a primary `~/.claude` and a relocated tree,
one `scan_once()` dropped the relocated session's cache row.

This is the same omission class as [[drift-missing-pass-floor]] and a
gap left by the 2026-07-15 multi-location union commit, which updated
discovery and the FTS5 enumerator but not this cleanup.

## Fix

Union the live set across `settings.claude_dirs`, deduped by path (not
by session stem — the cache is keyed by path and the population path
doesn't dedup either), plus a floor: skip the cleanup entirely when no
CC home is present, rather than treating an unmounted home as "every
cached session was deleted".

The floor gates on the HOME existing, not `home/projects`. A home
without a `projects/` dir is a real empty state (never ran Claude Code)
where cleanup is correct; an absent home is "couldn't look".

## Known residual

A relocated tree on an ejected volume, while the primary home is fine,
still has its rows deleted and re-cached later. That is cache churn, not
loss — the summary cache is derived state that rebuilds from disk. The
durable artifact is the FTS5 index, and that one got proper per-root
scoping in [[drift-missing-pass-floor]]. Scoping `delete_missing` by
root here would also change the contract pinned by
`test_scan_once_drops_summary_cache_rows_for_missing_files`, which
expects an orphaned row under no known home to be cleaned.

## Affected files

- `backend/cc_watcher.py` (`scan_once`)
- `backend/tests/test_watcher_summary_cleanup_union.py`
