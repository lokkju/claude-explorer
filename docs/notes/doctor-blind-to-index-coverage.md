# doctor cannot see an under-populated search index

**Priority:** Medium — the check that should have caught
[[watcher-search-drift-never-runs]] two months earlier.
**Discovery date:** 2026-09-16

## Context

`claude-explorer doctor` reported the search index healthy the whole time
Cowork sessions were missing from it.

## Problem

`backend/doctor.py:check_search` reports
`index present (N file(s) indexed)` and nothing more. It never compares
N against what is actually on disk, and never breaks the count out by
source. An index holding 28 Desktop conversations and zero Cowork
sessions is reported identically to a complete one. `grep -i cowork
backend/doctor.py` returns no hits at all.

There is also no check that the watcher's search-index drift pass is
firing, which is the specific mechanism that failed.

## Proposed solution

Have `check_search` enumerate on-disk conversation paths via the existing
`_enumerate_conversation_paths` (stat-only, no content reads) and compare
per source against `indexed_files`. Report OK only when coverage is
complete; WARN naming the shortfall by source with `reindex-search
--drift` as the fix command.

Keep it cheap — the enumeration is stat-only and already the single
source of truth for "what counts as a conversation file on disk", so
doctor and the indexer cannot drift apart on the definition.

## Affected files

- `backend/doctor.py` (`check_search`)
- `backend/tests/test_doctor_watcher_search.py`
