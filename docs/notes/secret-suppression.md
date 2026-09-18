# Secret suppression across derived stores and egress

**Priority:** High — the archive durably stores, indexes and re-emits
transcript content that routinely contains live credentials.
**Discovery date:** 2026-09-16
**Status:** idea, not scoped

## Context

Raised after the two file-read defects
([[spa-catchall-path-traversal]], [[pdf-export-reads-any-file]]), both
of which ended with `~/.claude-explorer/credentials.json` in an
attacker's or a recipient's hands. Fixing those closed the paths that
read files *outside* the corpus. They say nothing about secrets that are
already *inside* it.

## Problem

Claude Code sessions capture tool output verbatim. `cat .env`, `env`,
`kubectl get secret -o yaml`, `terraform show`, `gh auth token`, a pasted
`~/.aws/credentials`, a private key echoed into a heredoc: all of it
lands in `~/.claude/projects/*.jsonl` and, from there, into everything
this project builds on top.

Storage fan-out today, per conversation:

- the fetched Desktop JSON under `~/.claude-explorer/conversations/`
  (the only on-disk copy this project actually owns and writes);
- the FTS5 `messages` table, which holds message bodies in full so
  `snippet()` can work;
- the summary cache blob;
- the cc-images permanent cache.

Egress fan-out:

- `/api/search` snippets and `/api/conversations/{uuid}` payloads;
- Markdown, PDF and zip-bundle exports — artifacts produced
  specifically in order to send them to other people;
- **the MCP server**, which hands conversation content back to a model.
  That is the sharpest surface: content returned there can be re-emitted
  into any later context, including a different vendor's.

Net effect: a session where the user ran `cat .env` once is a session
whose secrets are now in a SQLite index, a summary cache, and any PDF
they ever export from it.

## Shape of the fix

One detector, two enforcement points. Framing it as "ingestion" plus
"querying" invites two implementations that drift, which is the same
failure that produced [[summary-cache-cleanup-union]].

**Ingestion — everything we write.** Redact before
`upsert_conversation`, before the summary-cache write, and before the
fetched Desktop JSON hits `~/.claude-explorer/conversations/`. Index the
redacted form. Two consequences worth deciding on deliberately: the
secret becomes unsearchable (the point), and the index no longer matches
the JSONL byte-for-byte, so the redaction has to be *deterministic* or a
re-index stops being reproducible and we grow another reconciliation
class.

**Querying — everything we hand back.** Redact in the search snippet
builder, the detail payload, every exporter, and the MCP tool responses.
Still needed with ingestion covered, because the detail and export paths
read the CC/Cowork JSONL directly rather than going through the index.

**Detection.** Seed from the patterns this repo already maintains in the
CLAUDE.md pre-push checklist (`sk-ant-`, `Bearer`, `"password":`,
session-key shapes) and extend: AWS `AKIA`/`ASIA`, GitHub `ghp_`/`gho_`/
`ghu_`/`ghs_`/`ghr_`, Slack `xox[abprs]-`, PEM `-----BEGIN * PRIVATE
KEY-----` blocks, JWTs, `postgres://user:pass@`-style connection
strings, and `KEY=`/`TOKEN=`/`SECRET=` assignments with high-entropy
values. Consider `detect-secrets` or `gitleaks`' rule set rather than
hand-rolling; both ship maintained pattern catalogues.

## The part that needs a decision before any of it is built

False positives are the whole ballgame. A conversation *about* secret
scanning contains example keys. A conversation debugging an auth bug
contains the token you actually want to find later. Redacting the index
silently breaks legitimate search, and the user has no way to tell the
difference between "no results" and "results suppressed".

Minimum viable answer: detect and **tag** at ingest, suppress at render,
never destroy, and surface it. A message with suppressed spans should
say so in the UI with a per-conversation reveal, and search should
report "N matches in suppressed content" rather than silently returning
nothing. That keeps the archive lossless and puts the decision in front
of the person who knows whether the string is real.

## Suggested order, if it gets built

1. MCP responses. Highest blast radius, smallest surface (5 tools), and
   the one place content leaves for a model rather than for the user who
   already has it.
2. Exports. Second-highest, and the artifact is designed to be shared.
3. Search snippets and detail payloads.
4. Ingestion (index, summary cache, fetched Desktop JSON). Last, because
   it is the only step whose output has to stay reproducible across a
   re-index.

## Adjacent, cheaper, worth doing regardless

Log and diagnostic redaction. `doctor --json`, the SSE `error` frames,
and `logger.exception` calls can all carry transcript fragments or
paths. The repo already has CWE-200 comments about not echoing resolved
paths to clients; the same discipline is not applied to log sinks, which
land in journald and launchd logs.

## Affected files (sketch)

- new: a leaf `backend/secrets.py` (detector + deterministic redactor),
  importable from the MCP closure without pulling anything heavy — see
  the closure-canary invariant in CLAUDE.md
- `mcp_server/server.py`, `backend/exporters/*`, `backend/routers/search.py`,
  `backend/routers/conversations.py`
- `backend/search_index.py` (`upsert_conversation`), `backend/summary_cache.py`
- `frontend/src/` for the suppressed-span affordance
