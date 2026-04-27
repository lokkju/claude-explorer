# Multi-Org Fetching (Cowork Support)

## Context

Claude.ai accounts with a personal org plus a "Cowork" workspace have more than one organization. The fetcher currently captures only the *first* org it sees and never queries the others, so Cowork conversations silently never reach the exporter.

Evidence:
- `fetcher/playwright_capture.py:91-92` takes `data[0].uuid` from `/api/organizations` and discards the rest.
- `fetcher/mitmproxy_addon.py:32,73` latches onto the first `org_id` matching a regex and stops.
- `fetcher/bulk_fetch.py:84` scopes every call to that single org_id.

Stored conversations carry no organization metadata, so even after a re-fetch there's no way to distinguish Personal vs Cowork at display time.

This document was reviewed by an adversarial LLM Council (Gemini-3-Pro + GPT-5.2). Council findings (P0-1 through P1-7) are folded into the relevant sections below; a summary mapping appears at the end.

## High-Level Shape

```mermaid
flowchart LR
    subgraph capture
      A1[playwright_capture] -->|all orgs| C[credentials.json<br/>schema_version=2<br/>orgs: array]
      A2[mitmproxy_addon] -->|accumulate orgs| C
    end
    subgraph fetch
      C --> F1[bulk_fetch.run_all_orgs<br/>CLI]
      C --> F2[routers/fetch.py SSE<br/>UI button]
      F1 -->|tag JSON,<br/>per-org filename| D[conversations/by-org/&lt;org_id&gt;/&lt;uuid&gt;.json]
      F2 -->|tag JSON,<br/>per-org filename| D
    end
    D --> S[store._make_summary]
    S --> M[ConversationSummary<br/>+organization_id/name]
    M --> R0[/orgs - Sidebar selector source/]
    M --> R1[/conversations?organization_id=.../]
    M --> R2[/search?organization_id=.../]
    R0 --> U[Sidebar workspace Select +<br/>ConversationList group label]
    R1 --> U
    R2 --> U
```

Both fetch paths must learn multi-org. The CLI (`bulk_fetch.py`) and the UI's "Fetch" button (`backend/routers/fetch.py` SSE endpoint) construct `ClaudeFetcher` independently — fixing only the CLI leaves the in-app fetch on the single-org bug.

## Phase 0 — Verify org topology + chat-visibility scoping (read-only probe)

Council P0-6: a "≥2 orgs vs =1 org" gate is too coarse. We must confirm what *actually scopes chat visibility*. An org may be listed but `/chat_conversations` denied, or Cowork may be partitioned by some header/cookie/account-context that the URL path doesn't capture.

Required artifacts before any code is written:

1. **Full `/api/organizations` response** — `uuid`, `name`, `capabilities` for every org.
2. **One `/chat_conversations` request per org context** — confirm the org `uuid` is the actual scoping dimension, with full URL + every request header + cookies recorded. Diff the two requests; the *only* differences should be the path-segment `org_id` and possibly per-org cookies.
3. **An empirical answer to: "When the user clicks the Cowork tab in Claude Desktop, what changes in outbound requests?"** Capture this via mitmproxy. If anything beyond the path segment changes (a workspace header, a context cookie, a different host), the multi-org loop must replicate that switch — not just the path.

```bash
SESSION=$(jq -r .session_key ~/.claude-exporter/credentials.json)
CF_BM=$(jq -r .cf_bm ~/.claude-exporter/credentials.json)
CF_CLEARANCE=$(jq -r .cf_clearance ~/.claude-exporter/credentials.json)

# Step 1: list orgs
curl -s -H "Cookie: sessionKey=${SESSION}; __cf_bm=${CF_BM}; cf_clearance=${CF_CLEARANCE}" \
  -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" \
  https://claude.ai/api/organizations \
  | jq '[.[] | {uuid, name, capabilities}]'

# Step 2: probe each org's chat list (replace ORG_UUID per org). Record status code.
for ORG in $(curl -s ... /api/organizations | jq -r '.[].uuid'); do
  echo "=== $ORG ==="
  curl -i -s -H "Cookie: sessionKey=${SESSION}" \
    "https://claude.ai/api/organizations/${ORG}/chat_conversations?limit=1" | head -20
done
```

Decision gate:

| Probe outcome | Action |
|---|---|
| ≥ 2 orgs, all return 200 on `/chat_conversations` | Proceed with the plan as written. |
| ≥ 2 orgs, secondary returns 403/404 | Cowork uses some other scoping dimension. Capture Claude Desktop's actual Cowork-tab requests via mitmproxy and amend before coding. |
| Any org responds with a header/cookie change beyond `org_id` | Plan Phase 2 must include header/cookie passthrough; do not proceed without that captured. |
| = 1 org | Cowork is a project inside the personal org. Stop and re-plan around `project_uuid`. |

Fallback if Cloudflare blocks the curl probe (401/403): add `print(json.dumps(data, indent=2))` after `data = await response.json()` at `fetcher/playwright_capture.py:90`, re-run `uv run claude-explorer capture`, read the printed list, then revert.

## Design decisions

### Storage layout: per-org subdirectory

**Council P0-2 / P1-5.** Today both fetch paths write `<output_dir>/<uuid>.json` and dedup by filename stem. Two orgs returning the same conversation UUID (which happens when conversations are shared between orgs, and is statistically possible regardless) cause **silent data loss**: incremental mode skips the second org's copy, full-refresh mode silently overwrites the first. Confirmed by reading `fetcher/bulk_fetch.py:330-341`, `backend/routers/fetch.py:109-136`, and `backend/store.py:214-218,372-375`.

Fix: write per org. New layout:

```
~/.claude-explorer/conversations/
├── _index.json                  # global index (schema_version=2)
└── by-org/
    ├── <org_id_personal>/
    │   ├── <uuid_a>.json
    │   └── <uuid_b>.json
    └── <org_id_cowork>/
        └── <uuid_c>.json
```

This requires changes in three places:

1. `fetcher/bulk_fetch.py:save_conversation`: build `path = self.output_dir / "by-org" / self.current_org["uuid"] / f"{uuid}.json"` and `mkdir(parents=True, exist_ok=True)`.
2. `fetcher/local_claude_code.py:264-267`: parallel save path; same change. (Claude Code locally-imported sessions go under a synthetic `local` org id, e.g. `by-org/_claude_code/<uuid>.json`, so the loader treats them uniformly.)
3. `backend/store.py:_get_conversation_files` (line 214) + `routers/fetch.py:109-114`: glob becomes `data_dir.rglob("*.json")` (or explicitly `data_dir.glob("by-org/*/*.json")` to keep `_index.json` and any future top-level files out of the load set). The dedup set in `routers/fetch.py:113` becomes `set[tuple[str, str]]` keyed by `(org_id, uuid)`, populated by walking `by-org/<org_id>/`. Read `org_id` from the parent directory name.

**Migration of existing single-org data.** On the first multi-org run: walk `data_dir/*.json` (top-level), read each JSON's `organization_id` (None for legacy), and `os.rename` into `by-org/<org_id_or_PRIMARY>/`. `PRIMARY` resolves to the legacy `creds["org_id"]` (the only org we knew about pre-migration). Migration is one-shot and idempotent — guarded by a sentinel file `by-org/.migrated_v2`. **Migration is read-only of file contents** (only filesystem moves), so a partial failure leaves data recoverable: a separate `by-org/.migration_log.json` records every move.

### Credentials schema and the *real* "single normalization point"

**Council P0-1.** The original plan claimed `bulk_fetch.load_credentials()` was the single normalization point. It isn't — `backend/routers/fetch.py` reads `credentials.json` independently. Hand-wave fix.

Real fix: extract a shared module.

- New module: **`fetcher/credentials.py`** containing `load_credentials(path) -> CredentialsV2` and `save_credentials(creds, path)`. Imported by `bulk_fetch.py`, `routers/fetch.py`, `playwright_capture.py`, `mitmproxy_addon.py`, and tests. *No other module reads or writes `credentials.json` directly.* The plan must include a final-step grep audit to enforce this.
- New typed model `CredentialsV2`:

  ```python
  class CredentialsV2(TypedDict):
      schema_version: Literal[2]
      session_key: str
      cf_bm: str | None
      cf_clearance: str | None
      captured_at: str          # ISO8601
      orgs: list[OrgRef]        # always non-empty
      primary_org_id: str       # see P1-4 below
      org_id: str               # legacy mirror = primary_org_id, kept for one minor version
  ```

- `load_credentials()` accepts both schemas. If `schema_version` is missing (or 1), it synthesizes:
  ```python
  creds["schema_version"] = 2
  creds["orgs"] = [{"uuid": creds["org_id"], "name": None, "capabilities": []}]
  creds["primary_org_id"] = creds["org_id"]
  ```
  and **returns the upgraded dict in memory only** — no automatic disk rewrite. The next legitimate write (next capture, next save_credentials call) persists the v2 shape.
- `save_credentials()` writes atomically (see Atomic writes below) and always emits `schema_version: 2`.

### Primary org selection (P1-4, NEW-P0-B)

`/api/organizations` doesn't document a stable order. Picking `orgs[0]` makes `primary_org_id` random across captures.

Resolution order:
1. If `creds["primary_org_id"]` already exists **and the referenced org is still in `creds["orgs"]`**, keep it (sticky once chosen).
2. Else, prefer the org whose `capabilities` includes `"chat"` (or whatever flag the Phase 0 probe reveals; record the actual flag name in this section before coding).
3. Else, prefer the org with the **most conversations on disk** (a tiebreaker that survives mitm captures with no `/api/organizations` response).
4. Else, the first by UUID lexicographic order (deterministic fallback, never index-based).

**Auto-demote on access loss (NEW-P0-B).** The original "primary 403/404 → hard abort" rule, combined with the sticky primary, creates a permanent brick if the user loses access to their primary org (left a Cowork tenant, capability revoked, etc.). Replacement rule: on the **primary** org, only `401 Unauthorized` is a hard abort (genuine session expiration). `403` and `404` instead trigger an auto-demote: clear `primary_org_id`, run resolution steps 2-4 against the remaining orgs, persist via `save_credentials`, log a strong warning to `_index.json` (`primary_demoted_from: <uuid>, reason: HTTP_403`), and continue with the new primary. The user sees this in the FetchDialog summary as a banner.

The user can override at any time via `claude-explorer set-primary-org <uuid>` (new CLI subcommand) or discover the available list via `claude-explorer list-orgs` (NEW-P1-F).

### Atomic credentials writes (P0-5)

All `credentials.json` writes go through `fetcher/credentials.py::save_credentials()`:

```python
def save_credentials(creds: CredentialsV2, path: Path) -> None:
    _validate(creds)                       # raise if shape is wrong
    tmp = path.with_suffix(".json.tmp")
    bak = path.with_suffix(".json.bak")
    with open(tmp, "w") as f:
        json.dump(creds, f, indent=2)
        f.flush()
        os.fsync(f.fileno())
    if path.exists():
        os.replace(path, bak)              # last-known-good
    os.replace(tmp, path)                  # atomic on POSIX
```

`os.replace` guarantees *file-level* atomicity on both POSIX and Windows, but **not state-level atomicity** under read-modify-write. Pass-2 dropped `fcntl.flock` for Windows compat; Pass-3 must address the lost-update race that re-emerged (NEW-P0-A): if `playwright_capture` (terminal A) and `mitmproxy_addon` (terminal B) both load creds, each merges a different subset of orgs, last writer wins and the org list is silently truncated. Mitm's "save on every new org" pattern (line 172) makes this more frequent.

Two-part fix:

1. **Cross-platform advisory lock.** Use `portalocker` (works on POSIX *and* Windows, unlike `fcntl`). Add to `pyproject.toml`. The lock wraps the whole read-modify-write block in `save_credentials` AND the merge-aware variant used by mitm.
2. **Merge-on-write semantics for org accumulation.** Mitm's `save_credentials` path becomes `merge_orgs_and_save(new_orgs, path)`: acquire lock, re-read current creds inside the locked block, union `creds["orgs"]` with `new_orgs` keyed by UUID (preferring entries with `seen_in_response: true` so URL-only fallbacks don't overwrite real names), write atomically, release lock. This eliminates lost updates even if the lock acquisition somehow fails (defense in depth).

```python
def save_credentials(creds: CredentialsV2, path: Path) -> None:
    _validate(creds)
    lock_path = path.with_suffix(".json.lock")
    with portalocker.Lock(lock_path, timeout=10):
        tmp = path.with_suffix(".json.tmp")
        bak = path.with_suffix(".json.bak")
        with open(tmp, "w") as f:
            json.dump(creds, f, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, 0o600)                    # NEW-P1-H: restrict perms
        if path.exists():
            os.replace(path, bak)               # last-known-good
        os.replace(tmp, path)                   # atomic on POSIX + Windows
        # NEW-P1-H: delete prior .bak after this successful write — atomicity is
        # already guaranteed; .bak only needs to live during the brief write window.
        prev_bak = bak.with_suffix(".json.bak.prev")
        if prev_bak.exists():
            prev_bak.unlink()
```

`.bak` retention (NEW-P1-H): the prior implementation kept `.bak` indefinitely, leaking stale session keys after re-capture. New rule: at the start of each save, rename any existing `.bak` to `.bak.prev`; at the end, delete `.bak.prev`. This guarantees `.bak` exists only during the write window. Add a `claude-explorer wipe-creds` subcommand for explicit teardown that removes `credentials.json`, `.bak`, `.bak.prev`, `.lock`, and any tmp residue.

`_validate` rejects partial/malformed inputs before the tmp file is opened.

### Per-org error handling (P0-3, P0-7, NEW-P0-B, NEW-P0-J, NEW-P1-K)

Replace blanket `try/except: log + continue` with explicit per-org status:

| HTTP code on `/chat_conversations` | Behavior |
|---|---|
| 200 | `status: ok`, write conversations. |
| 401 (any org) | **Hard abort.** Surface "session expired — re-run `claude-explorer capture`" to the UI/CLI. Do not write a partial `_index.json`. |
| 403 / 404 (**primary** org) | **Auto-demote** (NEW-P0-B): clear `primary_org_id`, re-resolve via the deterministic algorithm, persist creds, log `primary_demoted_from` to `_index.json`. Continue with new primary. **Do not hard-abort** — that would brick the user permanently. |
| 403 / 404 (**secondary** org) | Skip that org, mark `status: skipped`, persist `error_code` and `error_message` to `_index.json`. UI surfaces "Cowork: skipped (403)". |
| 429 | See "Rate-limit handling" below. |
| Other 5xx | Same retry policy as 429. After exhaustion: `status: failed`, persist error. |
| Network/timeout | Same retry policy. After exhaustion: `status: failed`. |

**Rate-limit handling (NEW-P0-J, NEW-P1-K).** Anthropic 429s scope by **session-key/IP**, not by org — exhausting Cowork's "budget" then immediately fetching Personal would instant-429 there too and risk a session ban. Therefore:

- Backoff state is **global to the `ClaudeFetcher` instance**, not per-org. A 429 sets `self._cooldown_until = now + retry_after`; *every* subsequent request across all orgs honors that timestamp before issuing.
- Honor `Retry-After` header literally. If absent, use exponential backoff (3 attempts, base 30s, capped 5min).
- **Sleep policy (precise to make tests deterministic):** retry sleep = backoff value only (or `Retry-After`); the per-conversation `--delay` applies only between *successful* requests, never inside the retry chain. Inter-org `--delay` is a separate sleep applied between two successful org transitions.
- Inject a `sleep_fn: Callable[[float], None] = time.sleep` parameter on the retry helper so tests can replace it with a recorder for timing assertions.

**Crucially, a `failed` status does not overwrite previously-successful org data on disk.** Per-org subdirectories make this trivial: a failed Cowork run never touches `by-org/<personal_id>/`.

**`_index.json` write-atomicity (NEW-P1-L).** The global `_index.json` is also written via tmp+`os.replace`. An org is recorded with `status: ok` **only after every conversation in that org has been persisted** — never speculatively. If a crash occurs mid-org, the index either reflects the last fully-completed org or, if no orgs completed, isn't written at all (the prior `_index.json` survives untouched). Partial state never makes it to disk.

**Concurrent fetch lock (NEW-P2-N).** A `data_dir/.fetch.lock` file (created via `portalocker`) prevents simultaneous CLI + UI fetches from racing on `_index.json`. Second attempt fails with `FetchInProgress` ("Another fetch is running. Wait or check `data_dir/.fetch.lock` if you believe this is stale.").

### `_index.json` schema (P1-3)

```json
{
  "schema_version": 2,
  "fetched_at": "2026-04-26T...Z",
  "orgs": [
    {
      "org_id": "...",
      "name": "Personal",
      "status": "ok",
      "fetched_count": 87,
      "skipped_count": 0,
      "error_code": null,
      "error_message": null,
      "conversations": [{"uuid": "...", ...}]
    },
    {
      "org_id": "...",
      "name": "Cowork",
      "status": "skipped",
      "fetched_count": 0,
      "skipped_count": 0,
      "error_code": "HTTP_403",
      "error_message": "Forbidden"
    }
  ]
}
```

`schema_version` lets external scripts and future commits detect the shape. We retain a top-level `org_id` mirror for one minor version (= primary org) for any external readers; remove in the version after.

### `'Claude Desktop'` legacy fallback (P1-1)

Council: bucketing untagged exports under `'Claude Desktop'` conflates **source** ("captured from the desktop app / web export") with **tenant** (Personal vs Cowork). After Phase 5's re-fetch, conversations migrate visibly between groups, breaking user trust.

Resolution:

- Storage: `organization_id` and `organization_name` stay `null` for un-retagged JSONs (do not synthesize `'Claude Desktop'` as a fake organization).
- UI: untagged Claude.ai conversations group under a distinct label `"Untagged (re-fetch to assign workspace)"`. Both source-icon and copy clearly tell the user a re-fetch is needed. The literal `'Claude Desktop'` string disappears from the group-key code path entirely.
- Source vs tenant remain orthogonal: `source` continues to drive the icon picker (P1-1 fallout into ConversationList.tsx — see Edits table).

### Sidebar workspace selector source (P1-2)

Council: deriving the selector's option list from `useConversations({}).data` is wrong on three axes — perf (5–10k row reduction every render), layout shift (set membership flips during a streaming SSE fetch), and missing-name false negatives.

Fix: new endpoint `GET /api/orgs` reads from `credentials.json` (always known *before* any conversation is fetched). Returns:

```json
[
  {"org_id": "...", "name": "Personal", "is_primary": true},
  {"org_id": "...", "name": "Cowork", "is_primary": false}
]
```

Sidebar consumes this. Selector visibility is gated on `length >= 2` of distinct `org_id`s (UUIDs, not names — so two orgs with identical names still show separately as `Cowork (uuid prefix)`). Layout reserves the slot to avoid shift; renders a placeholder when only one org exists.

### Capabilities field (P1-7)

We capture `capabilities` on the org. We will *use* it: if `capabilities` does not include the chat-list permission flag (exact name TBD by Phase 0 probe), skip that org's `/chat_conversations` request entirely instead of relying on a 403 → P0-3 path. Reduces noise in `_index.json` and avoids wasting one round-trip per non-chat org. If Phase 0 reveals capabilities are too vague to use this way, **drop the field** rather than store dead data.

### Cowork question (kept from prior plan)

Phase 0 + the chat-list probe collectively answer the personal-vs-project-vs-org question empirically. If the probe shows Cowork is a project inside the personal org, the entire plan reduces to project labeling and the multi-org loop is shelved.

## Edits

| File | Change |
|---|---|
| `fetcher/credentials.py` | **NEW.** Sole reader/writer of `credentials.json`. Exports `load_credentials() -> CredentialsV2`, `save_credentials(creds, path)`, `merge_orgs_and_save(new_orgs, path)`, `wipe_credentials(path)`, `CredentialsV2` typed dict, and `OrgRef`. Handles v1→v2 in-memory upgrade. Does atomic write (tmp + `os.replace`) + portalocker file lock + `.bak`-only-during-write retention + `0o600` perms. Validates schema before persisting. Uses `portalocker` (cross-platform) instead of `fcntl` (POSIX-only). |
| `pyproject.toml` | Add `portalocker>=2.8` to dependencies. |
| `fetcher/playwright_capture.py` | In `get_org_id()` (line 83): return full list `[{uuid, name, capabilities}]` instead of `data[0].uuid`. Rename to `get_orgs()`. In `capture_credentials()` (line 174): build `creds = CredentialsV2(...)` with `orgs`, derive `primary_org_id` (see Primary org selection). **Delete the local `save_credentials` (line 197-204)** and update its call site in `main()` (line 237) to `from fetcher.credentials import save_credentials`. Update success printout to list all orgs *with redacted names by default* (P2-1; show full names under `--verbose`). |
| `fetcher/mitmproxy_addon.py` | Replace scalar `self.org_id` with `self.orgs: dict[str, dict]` keyed by UUID; accumulate all org UUIDs seen in `request()` (line 68). Remove the `self.captured` early-exit at line 73–76. Add a `response()` hook: when the request URL matches `/api/(v\d+/)?organizations(?:\?|$)` (regex on `flow.request.pretty_url`), and the response is JSON, decode using `flow.response.get_text()` (handles gzip/brotli automatically) inside a `try/except` that logs raw `Content-Length` + `Content-Encoding` + `Content-Type` on failure, then call `merge_orgs_and_save(new_orgs, self.credentials_path)` from `fetcher.credentials`. Per-org provenance: store `seen_in_response: bool` so URL-only orgs are flagged "name unknown". **Delete `_save_credentials` (line 96-111).** All persistence goes through the merge-aware helper to prevent lost-update races (NEW-P0-A). |
| `fetcher/bulk_fetch.py` | `ClaudeFetcher.__init__` accepts `orgs: list[dict]`, `primary_org_id: str`, and `sleep_fn: Callable[[float], None] = time.sleep` (drop the scalar `org_id` param — `_api_url` now reads `self.current_org["uuid"]`). Instance state for rate-limit tracking: `self._cooldown_until: float = 0.0` — **global, not per-org** (NEW-P0-J: Anthropic 429s scope by session/IP, not org). Every request consults this; backoff updates honor `Retry-After` header literally, else exponential 3×30s base/5min cap. Replace the existing 60s-sleep-and-recurse 429 handling at `fetch_conversation` (line 322-325) with this helper (NEW-P0-J + NEW-P1-K: precise sleep policy = backoff/`Retry-After` only inside retry; per-conversation `--delay` only between *successful* requests). New method `run_all_orgs()` iterates `self.orgs`, sets `self.current_org`, applies the per-org error policy. **On primary 403/404, calls a new `_demote_primary()` helper** that clears `creds["primary_org_id"]`, re-resolves, persists via `save_credentials`, and continues with the new primary (NEW-P0-B). `save_conversation()` (line 330): write to `self.output_dir / "by-org" / self.current_org["uuid"] / f"{uuid}.json"` (mkdir parents); inject `organization_id`/`organization_name`. `save_index()` (line 343): atomic tmp+`os.replace` write of the new schema; per-org `status: ok` is written **only after every conversation in that org has been persisted** (NEW-P1-L). Build `existing_pairs: set[tuple[str, str]]` from `by-org/*/*.json` for incremental dedup. **`run()` (line 368)**: thin shim → `run_all_orgs()` over `[{"uuid": self.primary_org_id, "name": None}]`. **Refresh org names on success (NEW-P2-M):** when `/api/organizations` returns 200 during a run, call `merge_orgs_and_save` so renamed/relabeled orgs propagate without a re-capture. **Acquire `data_dir/.fetch.lock` via portalocker at run start** (NEW-P2-N): exit with `FetchInProgress` if held. |
| `fetcher/local_claude_code.py` | At line 264-267, write to `output_dir / "by-org" / "_claude_code" / f"{uuid}.json"`. The synthetic `_claude_code` "org" is filtered out of the `/api/orgs` selector (it's a source, not a tenant — P1-1 orthogonality). These JSONs are *not* loaded by `backend/store.py`'s desktop path (filtered at line 307 by `source == CLAUDE_CODE`); the directory exists only to keep imports from polluting tenant subdirs. |
| `fetcher/migrate_to_v2.py` | **NEW.** One-shot, idempotent. **Glob filter** (NEW-P0-I): only files matching `re.fullmatch(r'[0-9a-f-]{36}\.json', name)` — explicitly excludes `_index.json`, `.migration_log.json`, and any other non-UUID file at the top level. **Per-file content-mutation guard** (NEW-P0-D): if the on-disk JSON already has a non-null `organization_id`, **only relocate** (no content rewrite); never overwrite a real `organization_name` with null. Files already inside `by-org/**` are skipped entirely. **Multi-signal source classifier** (NEW-P1-E): `data.get("source")` first, then structural detection (mirror `backend/store.py` line 307 logic) for pre-`source`-field exports. Branches: explicit `CLAUDE_CODE` *or* structural-CLAUDE_CODE → `by-org/_claude_code/<uuid>.json` (no content mutation). Explicit `CLAUDE_AI` → `by-org/<organization_id_or_primary>/<uuid>.json` *and* inject `organization_id`/`organization_name` from `creds.orgs` (only when source is unambiguous). **Unknown source** → `by-org/_unknown_source/<uuid>.json`, no content mutation, surface in migration log so the user can decide. Uses the same atomic tmp-rename pattern as `save_credentials`. Logs every move + tag to `by-org/.migration_log.json`. Touches `by-org/.migrated_v2` sentinel only after every file has succeeded. Re-runnable safely. |
| `backend/routers/fetch.py` | `fetch_conversations_stream()` (line 62): import `load_credentials` from `fetcher.credentials` (no direct file read). **Migration with progress (NEW-P1-G):** if sentinel absent, run `migrate_to_v2()` and emit `{type: "migration_start", total_files}`, `{type: "migration_progress", moved, total}` (every 50 files), `{type: "migration_done", moved, by_bucket}` SSE events so FetchDialog can show a separate progress phase instead of stalling silently for minutes on 10k+ legacy files. Build `ClaudeFetcher(orgs=creds.orgs, primary_org_id=creds.primary_org_id, ...)`, call `run_all_orgs` adapted to streaming. Emit `progress` events `{type: "org_start", org_id, name}` and `{type: "org_done", org_id, status, fetched_count, error_code}` around each org. If a primary auto-demotion fired, also emit `{type: "primary_demoted", from_org_id, to_org_id, reason}`. Cumulative `current`/`total` counters span all orgs so the existing FetchDialog progress bar still reads right. Replace `existing_uuids = set()` (line 113) with `existing_pairs: set[tuple[str, str]]` keyed on `(org_id, uuid)`, populated from `by-org/<org_id>/*.json`. |
| `backend/routers/orgs.py` | **NEW.** `GET /api/orgs` returns a discriminated three-state response (NEW-P0-C — must distinguish "no creds file" from "creds unreadable" from "1 org"): (a) creds present + parseable → `200 {authenticated: true, orgs: [{org_id, name, is_primary}, ...]}`. Hides the `_claude_code` synthetic org. (b) creds file absent → `200 {authenticated: false, orgs: []}` (not 404 — that fires a global ApiError toast via `frontend/src/lib/api.ts:21-26`). (c) creds file exists but unreadable/malformed → `500 {error: "credentials_corrupt", detail: ...}`. Frontend `useOrgs` maps `(a)`→ workspace selector active, `(b)`→ "Run `claude-explorer capture` first" empty state in FetchDialog, `(c)`→ explicit error banner. |
| `backend/main.py` | Register the new `orgs` router under `/api`. |
| `fetcher/cli.py` | Register three new Click subcommands (NEW-P1-F + NEW-P1-H): (1) `claude-explorer list-orgs` — prints a table of `<uuid>  <name or "(name unknown)">  [primary]` rows from `creds["orgs"]`. Required companion to `set-primary-org` so users can discover what to pass. (2) `claude-explorer set-primary-org <uuid_or_prefix>` — accepts an unambiguous prefix (≥ 8 chars). Validates uniquely matches one org in `creds["orgs"]` (else: print "Ambiguous prefix" or "Unknown org. Available:" with the `list-orgs` output and exit 1), sets `creds["primary_org_id"]`, persists via `save_credentials`. Echo the resolved org name. (3) `claude-explorer wipe-creds` — confirms with the user, then removes `credentials.json`, `.bak`, `.bak.prev`, `.lock`, and `.tmp` residue. Also `claude-explorer migrate` — runs `migrate_to_v2()` explicitly so users on large data dirs can run it offline rather than blocking the SSE fetch. |
| `backend/search.py` + `backend/routers/search.py` | Add `organization_id: str \| None` arg to `search_conversations()` (line 63) and the route. Filter inside the loop at line 79 with `if organization_id and conv.get("organization_id") != organization_id: continue`. Thread through `frontend/src/lib/api.ts:search` and `useSearch`. Without this, global Cmd+K search still mixes Personal + Cowork results regardless of the sidebar workspace filter. |
| `backend/models.py` | Add to `ConversationSummary` (line 46): `organization_id: str \| None = None`, `organization_name: str \| None = None`. |
| `backend/store.py` | Two changes: (a) in `_make_summary()` (line 228), read `organization_id`/`organization_name` from raw data and pass to `ConversationSummary`. (b) `_get_conversation_files()` (line 214) globs `by-org/*/*.json` (excludes top-level so `_index.json` doesn't leak in). |
| `backend/routers/conversations.py` | Add `organization_id: str \| None = Query(None)` to `list_conversations()` (line 19). Pass through to `store.list_conversations()`. In `store.list_conversations()` (line 319), add matching filter alongside `model` / `starred`. |
| `frontend/src/lib/types.ts` | Add `organization_id?: string \| null; organization_name?: string \| null` to `ConversationSummary` (line 15); add `organization_id?: string` to `ConversationFilters` (line 99). New `Org` type: `{ org_id: string; name: string \| null; is_primary: boolean }`. |
| `frontend/src/hooks/useOrgs.ts` | **NEW.** `useQuery(['orgs'], () => api.getOrgs())`. 5-min staleTime; revalidate after a successful fetch (NEW-P2-M). Maps the three-state `/api/orgs` response (NEW-P0-C) to `{ isAuthenticated, orgs, error }`: `(authenticated: true, orgs: [...])` → selector active, `(authenticated: false)` → "run capture" empty state, `500` → explicit error banner. Selector visibility = `isAuthenticated && orgs.length >= 2`. |
| `frontend/src/contexts/SourceFilterContext.tsx` | Add `organizationId: string \| null` state + setter alongside the existing `sourceFilter`. Persist in localStorage. They compose. |
| `frontend/src/hooks/useConversations.ts` | Thread `organization_id` through the query key and request. Also extend `useSearch` (line 49) to accept and forward `organizationId`. |
| `frontend/src/contexts/SearchPanelContext.tsx` | Read `organizationId` from `SourceFilterContext` and pass to `useSearch` at line 90. Without this row, Cmd-K still mixes Personal + Cowork results regardless of the sidebar workspace selection — the backend filter and the `useSearch` arg both exist but nothing supplies the value at the call site. |
| `frontend/src/lib/api.ts` | In `getConversations` (line 29), add `if (filters?.organization_id) params.set('organization_id', filters.organization_id)` next to the other params at line 39. New `api.getOrgs()` calls `/api/orgs`. |
| `frontend/src/components/layout/Sidebar.tsx` | Add a second `<Select>` below the source filter (line 109 area). Source: `useOrgs().data` (NOT the conversation list). Render whenever there are ≥ 2 distinct `org_id`s; reserve the slot otherwise (placeholder div with same height) to prevent layout shift mid-stream. Display name = `org.name ?? \`Workspace (\${org.org_id.slice(0,8)})\``. On change, push `organization_id` into `SourceFilterContext`. |
| `frontend/src/components/conversation/ConversationList.tsx` | Two changes: (a) group key is `conv.organization_name ?? "Untagged (re-fetch to assign workspace)"`. The string `'Claude Desktop'` is removed from this code path. (b) Icon picker: switch to `const isClaudeAi = groupConvs.every(c => c.source === 'CLAUDE_AI')`, then `{isClaudeAi ? <MessageSquare /> : <FolderCode />}`. Source drives icon; tenant drives label. |
| `frontend/src/components/fetch/FetchDialog.tsx` | (a) Handle the `migration_*` SSE events (NEW-P1-G) with a separate progress bar phase that completes before the per-org bar starts. (b) Handle `primary_demoted` SSE event (NEW-P0-B): show a banner "Primary workspace changed from X to Y because X returned HTTP 403." (c) When `useOrgs` returns `authenticated: false` (NEW-P0-C), show a "Run `claude-explorer capture` first" empty state instead of the normal Fetch button. (d) On `FetchInProgress` error (NEW-P2-N), show "Another fetch is running" message instead of starting a duplicate. |
| `backend/tests/conftest.py` + `backend/tests/test_conversations.py` + `backend/tests/test_fetch.py` + `backend/tests/test_orgs.py` + `backend/tests/test_search.py` + `fetcher/tests/test_mitmproxy_addon.py` + `fetcher/tests/test_credentials.py` + `fetcher/tests/test_bulk_fetch_multi_org.py` + `fetcher/tests/test_migrate.py` | See Test plan. |

## Test plan (P1-6)

Tests are explicit, not implicit. Each Council finding gets a concrete test.

| Test | What it asserts |
|---|---|
| `test_credentials::test_v1_loads_as_v2_in_memory` | Loading a v1 file yields a `CredentialsV2` with synthesized `orgs` and `primary_org_id`; the on-disk file is not modified. |
| `test_credentials::test_atomic_write_survives_kill` | Simulate SIGKILL between `tmp` write and `os.replace`; assert original `credentials.json` and `.bak` survive intact. |
| `test_credentials::test_concurrent_writes_no_corruption` | Two writers race on `save_credentials`; final file is always valid JSON matching exactly one writer's intent (no half-merged blob). Atomicity is guaranteed by `os.replace`, not by an inter-process lock — the test should not assume serialization order. |
| `test_credentials::test_invalid_schema_rejected` | `save_credentials({})` raises before touching disk. |
| `test_mitmproxy_addon::test_response_hook_decodes_gzip` | `flow.response.get_text()` path with a gzip-encoded `/api/organizations` body. |
| `test_mitmproxy_addon::test_response_hook_handles_brotli` | Same with brotli. |
| `test_mitmproxy_addon::test_response_hook_matches_versioned_path` | `/api/v1/organizations` matches; `/api/organizations/abc` does not. |
| `test_mitmproxy_addon::test_response_hook_decode_failure_logs_and_continues` | A truncated body doesn't crash the addon. |
| `test_bulk_fetch_multi_org::test_filename_collision_isolated` | Two orgs both report UUID `X`; both files exist on disk under their own `by-org/<org_id>/` and contain their respective content. |
| `test_bulk_fetch_multi_org::test_dedup_pairs_not_uuids` | With `incremental=True` and Org A's `X.json` already on disk under `by-org/A/`, fetching Org B still pulls and saves `X.json` under `by-org/B/`. |
| `test_bulk_fetch_multi_org::test_secondary_403_records_status` | Mock secondary org returning 403; `_index.json` shows `status: "skipped"`, `error_code: "HTTP_403"`. Primary org's data unchanged. |
| `test_bulk_fetch_multi_org::test_primary_403_aborts` | Mock primary org returning 403; run aborts, no `_index.json` written, no partial state. |
| `test_bulk_fetch_multi_org::test_429_retries_then_fails` | Mock 3× 429 responses then 200; assert eventual success and proper backoff timing. After 3 failures, status is `"failed"`, prior org data untouched. |
| `test_bulk_fetch_multi_org::test_two_orgs_same_name_distinguished_by_id` | Both orgs named "Workspace"; sidebar selector still treats them as distinct (UUID-keyed). |
| `test_orgs::test_endpoint_returns_credentials_orgs` | `GET /api/orgs` reads from credentials, not conversations. |
| `test_orgs::test_endpoint_empty_when_no_credentials` | Fresh install (no `credentials.json`) yields `200 []` — *not* 404. Frontend selector remains hidden via the `length >= 2` gate without any error toast. |
| `test_orgs::test_synthetic_claude_code_org_filtered` | `_claude_code` does not appear in the response. |
| `test_conversations::test_organization_id_filter` | `?organization_id=<uuid>` returns only that org's rows. |
| `test_conversations::test_untagged_loads_with_null_org` | A pre-migration JSON without `organization_id` loads with `organization_id=None` — does not error. |
| `test_conversations::test_mixed_legacy_and_tagged_grouping` | A list containing both tagged and null-org rows groups them correctly: tagged under their workspace name, null under "Untagged". |
| `test_search::test_organization_id_filter` | Same as above for full-text search. |
| `test_migrate::test_idempotent` | Run migration twice; second run is a no-op (sentinel respected). |
| `test_migrate::test_partial_failure_logged` | Simulate a permission error mid-migration; assert `migration_log.json` records the partial state and sentinel is *not* touched. |
| `test_migrate::test_claude_code_routes_to_synthetic_org` | A top-level legacy JSON with `source: "CLAUDE_CODE"` migrates into `by-org/_claude_code/`, *not* into `by-org/<primary_org>/`. Source/tenant orthogonality (P1-1) is preserved across migration. |
| `test_migrate::test_legacy_files_get_org_id_injected` | A top-level legacy Claude.ai JSON without `organization_id` migrates into `by-org/<primary>/<uuid>.json` *and* the on-disk JSON now contains `organization_id` and `organization_name`. After migration, `_make_summary` returns the primary org's name, not "Untagged". |
| `test_migrate::test_skips_already_tagged_files` | NEW-P0-D. A JSON that already has `organization_id: <uuid>` is *only relocated* (or skipped if already in `by-org/<uuid>/`); content is not re-mutated. A subsequent run with creds whose org_name differs from the file's stored name does not overwrite the file's name. |
| `test_migrate::test_excludes_non_uuid_files` | NEW-P0-I. A top-level `_index.json`, `.migration_log.json`, and a stray `notes.json` are all left in place; only files matching the UUID regex are processed. |
| `test_migrate::test_unknown_source_routed_to_quarantine` | NEW-P1-E. A pre-`source`-field JSON whose structural detection is inconclusive lands in `by-org/_unknown_source/`, content unmutated, with an entry in `migration_log.json`. |
| `test_credentials::test_lost_update_race_prevented` | NEW-P0-A. Spawn two threads/processes both calling `merge_orgs_and_save` with disjoint org sets; final on-disk creds contain the union. Without portalocker, this test fails. |
| `test_credentials::test_bak_deleted_on_next_save` | NEW-P1-H. Save creds twice; assert that after the second save, only `credentials.json` exists (no `.bak.prev`, no leaking session keys from the prior version). |
| `test_credentials::test_wipe_creds_removes_all_artifacts` | NEW-P1-H. After a save, create `.bak.prev` + `.lock` + `.tmp` residue manually; `wipe_credentials` removes all of them. |
| `test_credentials::test_perms_0600` | NEW-P1-H. After save, assert file mode is `0o600` (Unix only; Windows skipped). |
| `test_orgs::test_endpoint_three_state_authenticated_false` | NEW-P0-C. No creds file → `200 {authenticated: false, orgs: []}`. |
| `test_orgs::test_endpoint_three_state_corrupt` | NEW-P0-C. Creds file exists but is invalid JSON → `500 {error: "credentials_corrupt"}`. |
| `test_orgs::test_endpoint_three_state_authenticated_true` | NEW-P0-C. Valid creds with two orgs → `200 {authenticated: true, orgs: [...]}` (length 2). |
| `test_bulk_fetch_multi_org::test_primary_403_auto_demotes` | NEW-P0-B. Mock primary org returns 403; assert `creds["primary_org_id"]` is updated to the next org per resolution algorithm, run continues, and `_index.json` records `primary_demoted_from`. |
| `test_bulk_fetch_multi_org::test_primary_401_hard_aborts` | NEW-P0-B clarification. Primary returning 401 (not 403) does still hard-abort. |
| `test_bulk_fetch_multi_org::test_429_backoff_is_global_not_per_org` | NEW-P0-J. Mock org A returns 429 with `Retry-After: 60`; immediately query org B; assert org B's request is delayed ≥ 60s. Use injected `sleep_fn` to record sleeps. |
| `test_bulk_fetch_multi_org::test_retry_after_header_honored` | NEW-P1-K. 429 response includes `Retry-After: 5`; assert helper sleeps exactly 5s, not the exponential default. |
| `test_bulk_fetch_multi_org::test_index_json_atomic_under_crash` | NEW-P1-L. Simulate SIGKILL after org A completes but before org B; on next read, `_index.json` reflects only org A or is unchanged from prior — never a half-merged state. |
| `test_bulk_fetch_multi_org::test_index_json_status_only_after_full_persist` | NEW-P1-L. Simulate failure to write the last conversation in org A; `_index.json` does not record `status: ok` for org A. |
| `test_bulk_fetch_multi_org::test_org_names_refresh_on_fetch` | NEW-P2-M. Server changes Cowork's name from "Cowork" to "Acme"; on next fetch, `creds.json` org array reflects the new name without re-running capture. |
| `test_bulk_fetch_multi_org::test_concurrent_fetch_lock` | NEW-P2-N. Two `ClaudeFetcher.run_all_orgs()` invocations against the same `data_dir`; the second exits with `FetchInProgress` and does not touch `_index.json`. |
| `test_cli::test_list_orgs_prints_table` | NEW-P1-F. With creds containing two orgs, `claude-explorer list-orgs` prints both UUIDs + names + a `primary` marker on exactly one row. |
| `test_cli::test_set_primary_org_accepts_prefix` | NEW-P1-F. `set-primary-org abc12345` (8-char prefix) sets primary correctly when prefix uniquely matches one org; rejects with "Ambiguous prefix" when two orgs share the prefix. |
| `test_cli::test_wipe_creds_confirmation` | NEW-P1-H. `wipe-creds` prompts, removes all credential artifacts on yes, no-ops on no. |

## Verification

1. Phase 0 probe: `/api/organizations` returns ≥ 2 orgs, *and* a `/chat_conversations` request to each org returns 200 (or the expected scoped behavior is documented).
2. `uv run claude-explorer capture` writes `credentials.json` with `schema_version: 2`, an `orgs` array of length ≥ 2, and a deterministic `primary_org_id`. A simultaneous `kill -9` mid-write leaves either the old file intact or the new one — never a corrupt state.
3. `uv run claude-explorer fetch --full-refresh` produces `by-org/<personal>/...` and `by-org/<cowork>/...` directories. `_index.json` matches the documented v2 schema. Mid-run SIGINT leaves successful org subdirs intact and the partial org's subdir intact-but-incomplete (next incremental run resumes it).
4. `curl /api/conversations?organization_id=<cowork-uuid>` returns Cowork-only.
5. `curl /api/orgs` returns Personal + Cowork *without* `_claude_code`.
6. UI: open FetchDialog → progress emits `Fetching Personal…` then `Fetching Cowork…`; final `_index.json` reflects both orgs. Workspace `<Select>` appears (since orgs ≥ 2). With "Group by project" on, untagged JSONs land under "Untagged (re-fetch to assign workspace)" rather than the legacy `'Claude Desktop'`. Source-icon stays correct (blue MessageSquare for Claude.ai groups regardless of tenant label).
7. Force a secondary-org 403 (e.g. by editing the primary's `org_id` in credentials to be the only valid one): verify `_index.json` records `status: "skipped"`, the UI surfaces the skip in the FetchDialog summary, and primary-org data is unchanged.
8. Force a primary-org 401 (revoke session): verify the run hard-aborts with a clear "session expired" message in the UI/CLI; no `_index.json` is rewritten.
9. `uv run pytest backend/tests fetcher/tests` — full new test suite passes (see Test plan).
10. Backward-compat smoke: drop a v1 `credentials.json` + a flat-layout `data_dir` on a fresh checkout, run `claude-explorer fetch` once: migration runs, credentials get re-saved as v2 only on the next legitimate write, conversations relocate into `by-org/`, sentinel appears. Verify by re-running fetch — second run is a no-op for the migration step.
11. **Lost-update test (NEW-P0-A):** Run `claude-explorer capture` and the mitm capture in two terminals against the same creds file. Both complete without the org list silently truncating; final `creds["orgs"]` is the union.
12. **Auto-demote test (NEW-P0-B):** Set Cowork as primary, then revoke Cowork access. Next `claude-explorer fetch` does not hard-abort — it logs `primary_demoted_from`, switches to Personal, and continues.
13. **Three-state /api/orgs (NEW-P0-C):** With no creds, `curl /api/orgs` → `{authenticated: false, orgs: []}`. Corrupt the creds file, restart server, `curl /api/orgs` → `500 {error: "credentials_corrupt"}`. FetchDialog reflects each state correctly.
14. **`.bak` does not leak (NEW-P1-H):** `claude-explorer capture` twice in a row; assert no `.bak` or `.bak.prev` survives the second save.
15. **Migration progress visible (NEW-P1-G):** Drop 1000+ legacy JSONs into a fresh `data_dir`; open FetchDialog. The migration progress bar advances visibly; the per-org progress bar appears only after migration completes. No silent stall.
16. **list-orgs / set-primary-org (NEW-P1-F):** `claude-explorer list-orgs` prints the table; `claude-explorer set-primary-org <8-char-prefix>` sets primary.

## Phase 5 — Re-fetch (post-implementation)

After Phases 1-4 land, run `uv run claude-explorer capture` then `uv run claude-explorer fetch --full-refresh`. Existing on-disk JSONs lacking `organization_id` are migrated into `by-org/<primary_org>/` first (one-shot, idempotent), then re-fetched in place — the `--full-refresh` re-tags them with the up-to-date `organization_name`. After this, "Untagged (re-fetch to assign workspace)" should be empty for users with valid credentials.

## Risks / open items

- **Cowork actually scopes by something other than `org_id`.** Phase 0's chat-list probe is the only safeguard. If discovered post-coding, the multi-org loop becomes a multi-context loop with the additional axis (header/cookie). Cost is moderate — `ClaudeFetcher.run_all_orgs` becomes `run_all_contexts` and the credentials schema gains a per-org context blob.
- **mitmproxy capture without `/api/organizations` traffic.** Org names stay null until the next playwright capture. Plan handles this gracefully (selector renders `Workspace (<uuid_prefix>)` for null-name orgs); Council P0-4's response-hook decode work is the mitigation.
- **Disk migration of large existing data dirs.** `os.rename` on the same filesystem is metadata-only and fast. If `data_dir` is on a different filesystem from the system temp, fall back to copy-then-delete with progress.
- **External tooling reading `_index.json` v1.** We retain the top-level `org_id` mirror (= primary) for one minor version. Document deprecation in the next release notes.

## Council critique resolutions (audit trail)

| Finding | Severity | Resolution location |
|---|---|---|
| P0-1 Single normalization point claim is false | Blocker | New `fetcher/credentials.py` module; explicit grep audit in Edits table |
| P0-2 Filename collision across orgs | Blocker | "Storage layout: per-org subdirectory" + Edits to `bulk_fetch.py`, `local_claude_code.py`, `store.py`, `routers/fetch.py` |
| P0-3 Per-org `try/except` masks failures | Blocker | "Per-org error handling" + per-org status persisted in `_index.json` |
| P0-4 mitmproxy hook misparses compressed bodies | Blocker | `mitmproxy_addon.py` row in Edits + dedicated tests |
| P0-5 Non-atomic credentials writes | Blocker | "Atomic credentials writes" section + `fetcher/credentials.py::save_credentials` |
| P0-6 Phase 0 binary gate too coarse | Blocker | "Phase 0" section requires chat-list probe per org + cookie/header diff |
| P0-7 Rate-limit storms across orgs | Blocker | "Per-org error handling" defines 429 backoff and inter-org pacing |
| P1-1 `'Claude Desktop'` fallback conflates source vs tenant | Should-fix | "`'Claude Desktop'` legacy fallback" section + ConversationList.tsx changes |
| P1-2 Sidebar derives orgs from conversation list | Should-fix | New `GET /api/orgs` endpoint + `useOrgs` hook + Sidebar change |
| P1-3 `_index.json` schema break has no version field | Should-fix | "`_index.json` schema" section adds `schema_version: 2` |
| P1-4 `orgs[0]["uuid"]` is non-deterministic | Should-fix | "Primary org selection" defines a deterministic resolution order |
| P1-5 Filename includes org_id (collides with P0-2) | Should-fix | Same fix as P0-2 |
| P1-6 Test coverage insufficient | Should-fix | "Test plan" section enumerates every required test |
| P1-7 `capabilities` captured but unused | Should-fix | "Capabilities field" section commits to using or dropping |
| P2-1 Workspace names may be sensitive | Nice-to-have | Names redacted in capture output unless `--verbose` (Edits row for `playwright_capture.py`) |
| P2-2 Sidebar layout shift mid-fetch | Nice-to-have | Sidebar reserves slot to prevent shift |
| P2-3 Document cross-org UUID assumption | Nice-to-have | Per-org subdir layout makes the assumption moot; documented anyway in "Storage layout" |

### Pass-2 Council resolutions (Round 2 review of the post-Pass-1 plan)

| Finding | Severity | Resolution location |
|---|---|---|
| NEW-P0-A Lost-update race (fcntl.flock removal opened it) | Blocker | `portalocker` cross-platform lock + `merge_orgs_and_save` semantics in "Atomic credentials writes"; new `pyproject.toml` row in Edits |
| NEW-P0-B Sticky primary + hard-abort = permanent brick | Blocker | "Auto-demote on access loss" in "Primary org selection"; updated row in "Per-org error handling" table; SSE `primary_demoted` event in `routers/fetch.py` row |
| NEW-P0-C `/api/orgs` 200 [] ambiguity | Blocker | Three-state response in `backend/routers/orgs.py` row; `useOrgs.ts` maps to `{isAuthenticated, orgs, error}` |
| NEW-P0-D Migration content-injection not actually idempotent | Blocker | Per-file content-mutation guard in `migrate_to_v2.py` row + `test_skips_already_tagged_files` |
| NEW-P0-I Migration glob destroys `_index.json` | Blocker | UUID-regex glob filter in `migrate_to_v2.py` row + `test_excludes_non_uuid_files` |
| NEW-P0-J 429 backoff scoped wrong (session/IP, not org) | Blocker | Global `_cooldown_until` state in `bulk_fetch.py` row; honor `Retry-After`; `test_429_backoff_is_global_not_per_org` |
| NEW-P1-E Migration source branching misclassifies pre-source-field exports | Should-fix | Multi-signal classifier + `_unknown_source/` quarantine in `migrate_to_v2.py` row |
| NEW-P1-F `set-primary-org` UX dead-end (no `list-orgs`) | Should-fix | New `list-orgs` and prefix-matching subcommands in `fetcher/cli.py` row |
| NEW-P1-G SSE migration blocks UI silently | Should-fix | `migration_*` SSE events in `routers/fetch.py` row; FetchDialog phase bar; `claude-explorer migrate` CLI escape hatch |
| NEW-P1-H `.bak` retention leaks session secrets | Should-fix | `.bak`-only-during-write semantics + `0o600` perms + `wipe-creds` CLI in "Atomic credentials writes" |
| NEW-P1-K Backoff sleep policy ambiguous | Should-fix | Precise sleep policy + `sleep_fn` injection in "Per-org error handling" + `test_retry_after_header_honored` |
| NEW-P1-L `_index.json` global write not atomic | Should-fix | Atomic tmp+`os.replace` for `_index.json`; `status: ok` only after full persist; `test_index_json_atomic_under_crash` |
| NEW-P2-M Stale org names cached forever | Nice-to-have | `merge_orgs_and_save` on `/api/organizations` 200 inside `bulk_fetch.run_all_orgs` |
| NEW-P2-N Concurrent UI/CLI fetch race | Nice-to-have | `data_dir/.fetch.lock` via portalocker in `bulk_fetch.run_all_orgs`; `FetchInProgress` error
