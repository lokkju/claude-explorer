# Verified defects, not yet fixed

Found 2026-09-16 in a review of `search_index` / `cc_watcher` /
`summary_cache` and the fetch pipeline. Everything below was reproduced
against real code — these are not review hunches. They are listed here
rather than fixed because each needs a decision I did not want to make
unilaterally (schema bump, UX change) or could not verify from this
machine.

Ordered by severity.

---

## 1. Two session files sharing one `sessionId` destroy each other's index rows

**Severity: high — silent, permanent search loss.**

Claude Code "continued session" files have a filename stem that differs
from the internal `sessionId` — `backend/store.py` has a whole second
lookup pass (Pass B) that exists because of this. `conv["uuid"]` comes
from the internal id, but enumeration dedups by stem, so two files can
be enumerated separately and index under the same `conv_uuid`.

`upsert_conversation` and `delete_by_path` both scope by `conv_uuid`:

```python
DELETE FROM messages WHERE conv_uuid = ?
DELETE FROM conversations WHERE conv_uuid = ?
DELETE FROM indexed_files WHERE path = ?
```

Reproduced with two files sharing one `sessionId`:

```
indexed files: 2
alpha hits: 0        <- file 1's body, wiped by file 2's upsert
beta  hits: 2
-- after deleting file 1 --
indexed files: 1
beta  hits: 0        <- file 2 still on disk, now unsearchable
```

Both halves are real:

* **Clobber.** The second file's upsert deletes the first's message rows,
  but the first file's `indexed_files` row keeps a current mtime, so no
  drift pass ever re-indexes it. Half the conversation is silently
  unsearchable forever.
* **Collateral delete.** Removing one file drops every message row for
  that `conv_uuid`, including the surviving file's. The survivor's mtime
  still matches, so it is never re-indexed — the conversation vanishes
  from search until a full rebuild.

**Why not fixed:** the clean fix scopes message rows by
`(conv_uuid, path)`, and `messages` has no path column — adding one is a
`SCHEMA_VERSION` bump, i.e. a forced full rebuild for every user, which
is exactly the wipe behaviour we just moved away from as a default. The
cheaper alternative is to dedup enumeration by `conv_uuid` instead of by
stem, accepting that a continued session indexes only one of its files.
That is a product decision.

A partial fix worth doing regardless, and cheap: make `delete_by_path`
drop the `conv_uuid`-scoped rows only when no other `indexed_files` row
references that uuid, and re-queue survivors. That kills the collateral
delete without touching the schema.

---

## 2. Drift compares mtime only, so a same-tick append is lost forever

**Severity: medium-high — silently missing content.**

`build_full_index` / `update_drifted_files` do check-read-check on
mtime alone. Equality before and after does not prove the file was
unchanged on a filesystem with coarse mtime granularity (HFS+/NFSv3 ≈ 1s,
FAT/exFAT 2s — relevant for `~/.claude` on a network share or external
drive).

Scenario: at t=10.2 the pass stats mtime 10.0 and reads N lines; at
t=10.6 Claude Code appends turn N+1, mtime still 10.0; the post-read stat
returns 10.0, so the pass stamps N-line content with mtime 10.0.
`_drift_first_scan` then compares 10.0 == 10.0 forever and turn N+1 is
never indexed, no matter how many passes run.

`SummaryCache` stamps mtime **and size** for exactly this reason
(`summary_cache.py`); the FTS5 `indexed_files` ledger has no `size`
column.

**Why not fixed:** adding `size` to `indexed_files` is another
`SCHEMA_VERSION` bump. Same forced-rebuild decision as #1 — and the two
should be bumped together if they are bumped at all.

---

## 3. A file that never parses is re-read on every pass, forever

**Severity: medium — unbounded wasted I/O, no correctness impact.**

`_load_conversation_at` returning `None` (0-byte file from an abandoned
session, unparseable lines, a `PermissionError`) means nothing is written
to `indexed_files`, and `_drift_first_scan` treats "no row" as drifted.

Reproduced with one empty `.jsonl`:

```
pass 0: drifted=['aaaa-empty.jsonl'] indexed_rows=0
pass 1: drifted=['aaaa-empty.jsonl'] indexed_rows=0
pass 2: drifted=['aaaa-empty.jsonl'] indexed_rows=0
```

It never settles. Newly relevant: the backstop now actually runs (every
600s), plus every debounced inotify batch, and a batch triggers a
whole-corpus drift pass. On a corpus with N such files this is permanent
repeated open-and-parse work.

**Fix shape:** write a sentinel ledger row (mtime stamped, zero messages)
so the file is considered current until it changes. Needs care so a file
that later becomes valid is still picked up — stamping the mtime does
that, since a real write bumps it.

---

## 4. A missing `messages` table reads as "schema fine"

**Severity: medium — recoverable only via manual reindex.**

`_init_schema` computes
`cols_ok = (not existing_cols) or existing_cols == _EXPECTED_MESSAGES_COLS`.
`PRAGMA table_info(messages)` returns nothing both when the DB is fresh
**and** when the table is gone, so a missing table takes the "columns
fine" branch, recreates `messages` empty, and early-returns.

Reachable because the rebuild path's `DROP TABLE`s each commit
separately (Python's sqlite3 opens no implicit transaction for DDL). A
SIGKILL between `DROP TABLE messages` and `DROP TABLE schema_version`,
on a run where the version already matched, leaves version=14 and no
messages table. `indexed_files` still holds every row with current
mtimes, so every drift pass reports zero drifted and the FTS5 table stays
empty — search returns nothing on the fast path until `reindex-search`.

**Fix shape:** require `existing_cols == _EXPECTED_MESSAGES_COLS`
whenever `indexed_files` is non-empty, rather than accepting "no
columns".

---

## 5. An exception mid-fetch ends the SSE stream with no `error` event

**Severity: medium — stuck spinner.**

`refresh_pipeline_stream` has `try/finally` but no `except`.
`_fetch_phase_stream` guards only `load_credentials`; everything after
(`DEFAULT_OUTPUT_DIR.mkdir`, `ClaudeFetcher(...)`, `fetcher.existing_pairs()`)
is unguarded. A read-only or full volume, or a stale network mount, makes
`mkdir` raise; it propagates out of both generators and Starlette aborts
an already-200 response mid-body. The client gets no `error` frame and no
`complete`, so the sidebar spinner spins indefinitely.

The older `fetch_conversations_stream` wraps its whole body in
`except Exception` and emits an error event. The refresh path does not —
the asymmetry looks unintentional.

**Fix shape:** mirror the older path's catch-all, emitting
`_build_error_event("TERMINAL", str(exc))` before returning.

---

## 6. Playwright capture task leaks when the consumer goes away

**Severity: low-medium — orphaned browser window.**

In `_run_capture_with_keepalive`, `capture_task.cancel()` runs only in an
`except Exception` handler. `GeneratorExit` and `CancelledError` are
`BaseException`, so closing the stream mid-capture bypasses it and there
is no `finally`.

Scenario: credentials are missing, capture opens a headful browser, the
user closes the tab at ~10s. The task is never cancelled and the browser
stays up for the remaining ~290s. Meanwhile the refresh flag is released
(correctly, as of the fix in `refresh-flag-wedge.md`), so the next click
launches a second browser and both may race to `save_credentials` on the
same path.

**Fix shape:** `finally: capture_task.cancel()`.

---

## 7. The Windows notifier shows nothing and reports success

Covered in [[notify-applescript-quoting]]. Left alone because a correct
replacement cannot be verified from this machine.

---

## Also worth a decision: `mcp_server/tests` never runs by default

`pyproject.toml` sets `testpaths = ["fetcher/tests", "backend/tests"]`,
so a bare `uv run pytest` skips all 18 `mcp_server` test files —
including `test_mcpb_closure.py`, which CLAUDE.md calls a hard
invariant. It passes when run explicitly (`uv run pytest mcp_server/tests`
→ 104 passed, 1 skipped), but it is not guarding anything in the default
suite.
