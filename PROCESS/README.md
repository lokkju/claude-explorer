/model# PROCESS/ — Medium Series Extraction Artifacts

Intermediate artifacts for the Medium series **"Unlocking Your Claude History: A UI and MCP Server for Your Conversations"** (see `PLANS/medium-articles.md` for the plan + progress tracker).

Everything in this directory is generated from the project's own build-session transcripts via the `claude-sessions` MCP server. The articles' factual claims cite back to these files; each fact cites back to a specific message in a specific session.

## Citation format

Every bullet, fact, or quote ends with one of:

- `[session_id#pos=N]` — the Nth message (0-indexed) in the session's active branch
- `[session_id#msg=UUID]` — a specific message UUID (preferred for direct quotes)

Session ids are the full UUID (e.g. `a70251a5-b932-4b61-aba1-16a70410b98e`). Shorten to the first 8 chars when space is tight, but only where unambiguous within this repo.

## Directory map

```
PROCESS/
├── README.md                      # this file
├── 00_session_inventory.md        # full session table + skipped-session note
├── 99_styleguide.md         # prompt-include for every drafting subagent
├── a70251a5/                      # main build session (5,207 messages)
│   ├── outline.jsonl              # every message: uuid, position, sender, summary
│   ├── outline_digest.md          # every 100th human message, for scanning
│   ├── phases.md                  # 20–40 phase boundaries with theme + position range
│   └── phase_NN_<slug>.md         # one per phase: goal, prompt, decisions, misc
├── 76fe578b/                      # current planning session (this one)
│   └── summary.md
├── skipped/
│   └── gmail_sessions.md          # why the 7 Gmail-agent sessions were excluded
├── 90_themes.md                   # cross-cut by theme (reverse-eng, backend, etc)
├── 91_memorable_quotes.md         # 20–40 direct quotes worth using in the articles
├── 92_timeline.md                 # date-ordered milestones
└── 93_use_cases.md                # concrete use cases for Part 1
```

## Reproducibility

Any extraction in this directory can be re-derived from the `claude-sessions` MCP server as long as the user still has the underlying JSON files under `~/.claude-exporter/conversations/`. The MCP server's SQLite cache (`~/.claude-exporter/cache.db`) is throwaway.
