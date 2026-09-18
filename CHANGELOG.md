# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

> Note: the entries under `[Unreleased]` below predate the 1.0.x line and
> were never folded into a release section upstream. They are left as-is
> rather than retroactively reassigned.

## [1.1.0] - 2026-09-17

First release of this fork. Upstream is unmaintained; this line continues
from 1.0.9.

### Security
- **SPA catch-all served arbitrary files.** The request path was joined
  onto the bundle root lexically, so `GET /../../../../etc/passwd`
  returned file contents over a raw socket (uvicorn percent-decodes
  without collapsing `..`). Everything readable by the serving user was
  exposed, including the session key in `credentials.json`.
- **PDF export read any file a conversation named.** The absolute path in
  an `[Image: source: ...]` marker comes out of message text, and the PDF
  exporter had no containment check, so the named file's bytes were
  embedded in the exported document. The browser route and the bundle
  exporter had always gated this.

### Fixed
- **The watcher's search-index drift pass had never run.** It was gated on
  a process-local `is_ready()` flag that the supervised watcher never
  sets, so nothing inotify missed was ever backfilled. Cowork sessions on
  Linux were the visible symptom.
- **`reindex-search` defaulted to a destructive wipe** while its docstring
  advertised idempotent re-runs. The default is now the drift pass;
  `--full` remains as an explicit, warned escape hatch.
- **One unreadable root wiped that surface's whole index.** Every
  enumeration failure degraded to "no files", which the missing-pass read
  as "the user deleted everything". Deletions are now scoped to roots
  that were actually read.
- **Summary-cache cleanup used only the primary Claude Code home** while
  the cache is populated from all of them, churning rows for a relocated
  `$CLAUDE_CONFIG_DIR` tree every backstop pass.
- **Continued sessions destroyed each other's index rows.** Two files
  sharing one internal `sessionId` indexed under one `conv_uuid` with
  uuid-scoped deletes; the second file's upsert wiped the first's, and
  deleting either took the survivor's rows too. Message rows are now
  scoped per file.
- **Drift compared mtime only**, so an append inside the same mtime tick
  on a coarse-granularity filesystem was never indexed. Size is now part
  of the comparison.
- **Unparseable session files were re-read on every pass forever.** They
  now get a ledger-only sentinel row.
- **A missing `messages` table read as "schema fine"**, leaving a
  populated ledger against an empty index so no drift pass could refill
  it.
- **`scheduled-fetch` could crash and could fail silently** — lock
  acquisition sat outside the `try`, and the catch-all never wrote a
  status, so a job failing for days still reported the last success.
- **macOS notifications never fired.** The AppleScript was built with
  Python `repr()`, which emits single quotes; AppleScript needs double.
- **Refresh could wedge at 409 until restart** when a client abandoned
  the SSE stream before its first frame.
- **Refresh streams died with no terminal error frame**, leaving the
  sidebar spinner running indefinitely.
- **The Playwright capture task leaked** when the stream was closed
  mid-capture, leaving a browser window open for the full timeout.

### Added
- `doctor` reports per-source search-index coverage, so a source that is
  entirely unindexed is visible instead of reading as healthy.
- `doctor` reports whether the web UI is bundled; `serve` warns before
  starting in API-only mode.

### Changed
- **Schema v15. The search index rebuilds once on first start** — required
  by the per-file message scoping and the size-aware ledger, since an FTS5
  virtual table cannot gain a column in place.
- `mcp_server/tests` runs in the default pytest suite. It was excluded, so
  the MCPB closure canary guarded nothing.


### Added
- **Dark mode support** with system theme detection
  - Automatically follows system preference by default
  - Manual toggle between Light/Dark/System modes
  - Theme toggle button in sidebar footer
- **Settings page** at `/settings`
  - Theme selection (Light/Dark/System)
  - Keyboard navigation mode (Emacs/Vim)
  - Data directory display
  - Conversation count
  - About section with GitHub link
- **Keyboard navigation** with two modes
  - Emacs mode (default): Ctrl+N/P to navigate, Ctrl+F to open, Ctrl+B to go back, Ctrl+S to search
  - Vim mode: j/k to navigate, l to open, h to go back, / to search, gg/G for top/bottom
  - Press `?` anywhere to see keyboard shortcuts help
- **Connection status dialog** with retry functionality
  - Shows when backend is unavailable
  - Automatic retry with exponential backoff
  - Manual retry and dismiss options
- **Jump-to-bottom button** in conversation detail view
- **Claude Code session support** with:
  - Project path and git branch display
  - Group by project view
  - Subagent expansion in conversation list
  - Phantom session filtering

### Fixed
- Circular reference detection in message tree building
- Iterative BFS for building message trees (prevents stack overflow on large conversations)
- Nested button HTML error in conversation list
- Connection dialog false positive on initial load

### Changed
- Conversation list items now use `role="button"` for proper accessibility

## [0.1.0] - 2024-03-01

### Added
- Initial release
- Browser-based credential capture with Playwright
- Proxy-based credential capture with mitmproxy
- Bulk conversation fetching from claude.ai API
- FastAPI backend with conversation browsing
- Full-text search across conversations
- Markdown and PDF export
- React frontend with Tailwind CSS
- Message tree visualization for branched conversations
- Command palette for quick search (Cmd+K)
