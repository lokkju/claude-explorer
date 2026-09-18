# Verified defects — status

Found 2026-09-16 in a review of `search_index` / `cc_watcher` /
`summary_cache` and the fetch pipeline. Each was reproduced against real
code before being filed.

**All but one are now fixed** (2026-09-17, shipped in 1.1.0). Kept as a
record of what was wrong and why, since several of the fixes carry
trade-offs worth remembering.

## Fixed

1. **Continued sessions destroyed each other's index rows.** Two files
   sharing one internal `sessionId` indexed under one `conv_uuid`; the
   uuid-scoped DELETE in `upsert_conversation` meant the second file's
   upsert wiped the first's rows while the first's ledger mtime stayed
   current, and `delete_by_path` took the survivor's rows with it.
   Fixed by schema v15: message rows are scoped by `(conv_uuid, path)`,
   both files contribute, and the projection row drops only when no
   indexed file feeds that uuid.

2. **Drift compared mtime only.** An append inside the same mtime tick
   on a coarse-granularity filesystem was stamped as current and never
   re-read. Fixed by schema v15: `indexed_files.size` joins the
   comparison, matching what `SummaryCache` has always done.

3. **Unparseable files were re-read forever.** A file yielding no
   conversation wrote no ledger row, and "no row" means drifted, so
   every backstop pass and every debounced inotify batch re-opened it.
   Fixed with a ledger-only sentinel row; a later write that makes the
   file valid moves mtime or size and it is picked up normally.

4. **A missing `messages` table read as "schema fine."**
   `PRAGMA table_info` returns nothing for a fresh database and for a
   dropped table alike. Fixed by using a populated ledger to
   distinguish them.

5. **Refresh streams died with no terminal error frame.** Fixed with a
   catch-all that emits one, matching `fetch_conversations_stream`.

6. **The Playwright capture task leaked** on `GeneratorExit`. Fixed by
   moving the cancel into a `finally`.

Also fixed: `mcp_server/tests` now runs in the default suite, so the
MCPB closure canary actually guards something.

### Trade-offs taken

* v15 forces a one-time index rebuild. An FTS5 virtual table cannot gain
  a column in place, so there is no fast-migration path; the v9→v10,
  v11→v12 and v13→v14 shims all self-disabled via their
  `SCHEMA_VERSION == N+1` gates, as designed.
* The missing-pass floor (shipped 2026-09-16) means a root the user
  genuinely deleted keeps stale rows until `reindex-search --full`.
  Stale rows beat silent bulk deletion.
* `snippet()` column ordinals are now derived from `MESSAGES_COLUMNS`
  rather than hard-coded. They had shifted silently twice, with empty
  highlight slices as the only symptom.

## Still open

**The Windows notifier shows nothing and reports success.** It loads a
WinRT type and then writes to discarded stdout; no `ToastNotification` is
ever constructed. PowerShell exits 0, so `notify()` reports success.

Not fixed because a correct replacement
(`System.Windows.Forms.NotifyIcon.ShowBalloonTip`, which also needs the
process to stay alive while the balloon renders) cannot be verified from
a Linux machine, and shipping unverified Windows GUI code is worse than a
documented no-op. `test_windows_uses_powershell` pins the current
behavior. See [[notify-applescript-quoting]].
