# Benchmarks

Developer-loop perf measurements. **NOT a CI gate.** Per
`PLANS/PERFORMANCE_PHASE_2.md` §Workstream D, this is a one-command
convenience for "did I regress anything" diffs and PR-body numbers.

## Quick start

```bash
# 1. Start the backend on :8765 (in a separate terminal):
DYLD_LIBRARY_PATH=/opt/homebrew/lib uv run uvicorn backend.main:app --port 8765

# 2. Wait for "search index build complete" on stdout (warm restart: <1s).

# 3. Run the suite:
make bench
```

You'll see a table like:

```
== Claude Explorer benchmark (http://localhost:8765) ==

Fixtures (auto-picked from live corpus):
  small:  abc12345-…  (         485 bytes)
  medium: def67890-…  (  41,000,000 bytes)
  large:  fedcba98-…  ( 288,000,000 bytes)

label                                                    n     mean      p50      p95      max       bytes
--------------------------------------------------------------------------------
list /api/conversations                                 10     87.1     86.0     91.0     93.0    245,673
search /api/search?q=python                              5    195.4    192.0    220.0    230.0     12,345
search /api/search?q=foobar                              5     45.2     44.0     48.0     50.0      1,000
detail-small /api/conversations/abc12345…                5     15.0     15.0     17.0     17.0      8,200
detail-medium /api/conversations/def67890…               5     45.3     44.0     50.0     52.0  3,400,000
detail-large /api/conversations/fedcba98…                5     78.4     76.0     85.0     90.0 22,000,000
export-md /api/conversations/def67890…/export/markdown   5     65.0     63.0     70.0     73.0  3,500,000
```

## Output modes

| Mode | Command | Use case |
|------|---------|----------|
| Human | `make bench` | Eyeballing locally |
| JSON  | `make bench-json` | Paste into PR body or pipe to diff tool |
| Quick | `make bench-quick` | Fewer runs per measurement; iterate fast |

## Cold-cache measurements

Warm benchmarks above. For cold-restart numbers (server restart between
runs, the path that hits the FTS5 build on startup):

```bash
make cold-search-instructions
```

Prints the manual steps. We deliberately do NOT automate the restart
(or the OS-level `sudo purge` / `drop_caches`) — those need privileges
and the user should know they're running them.

## Fixture selection

The harness auto-picks SMALL / MEDIUM / LARGE conversation fixtures
at the 5th, 50th, and 95th percentile of file size by walking:

* `~/.claude/projects/` (Claude Code JSONL sessions)
* `~/.claude-explorer/conversations/` (Claude Desktop JSONs)

The chosen UUIDs are printed at the top of every output so runs are
reproducible across the same corpus. To pin specific UUIDs across
multiple runs (e.g. so before/after measurements use the same files
even if the corpus grew between runs):

```bash
uv run python benchmarks/run_all.py \
  --small abc12345-6789-… \
  --medium def67890-abcd-… \
  --large fedcba98-7654-…
```

If your machine has no Claude Code sessions or no Claude Desktop
conversations, the harness degrades gracefully and skips the
corresponding rows. A new install with zero corpus will see
list + search rows only.

## Use in PRs

`make bench-json | tee bench-results.json` to capture a structured
snapshot. Paste before/after in the PR body for any perf-touching
change. Example:

```markdown
### Bench numbers

Before (main):

| Endpoint | mean (ms) |
|----------|-----------|
| /api/conversations | 87 |
| /api/search?q=python | 2,300 |
| /api/conversations/{large} | 1,474 |

After (this PR):

| Endpoint | mean (ms) | delta |
|----------|-----------|-------|
| /api/conversations | 85 | -2% |
| /api/search?q=python | 180 | **-92%** |
| /api/conversations/{large} | 45 | **-97%** |
```

## Existing focused benchmarks

Two pre-existing scripts complement this one. They're focused tools,
kept as-is:

* `benchmarks/bench_perf.py` — basic two-endpoint runner with hand-
  rolled stats. Older but stable; use when you want a single-purpose
  number without the suite overhead.
* `benchmarks/bench_search_paths.py` — in-process comparison of
  `_search_via_linear_scan` vs `_search_via_index`. Use when
  investigating FTS5-vs-fallback drift; doesn't need a running server.
