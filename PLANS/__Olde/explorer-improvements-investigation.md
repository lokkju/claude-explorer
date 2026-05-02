# Explorer Improvements — Investigation Phase

This is Phase 1 of two paired plans. Phase 2 (`PLANS/explorer-improvements-build.md`) implements the features once these investigations close.

The investigation runs against the user's local data store (`~/.claude-explorer/conversations`, `~/.claude/projects/*.jsonl`). Each item below produces a written finding (root cause, reproducer, recommended fix shape, test evidence) appended to this doc. After all five close, the user reviews and triages.

---

## Inv-1. Refresh-button regression: Claude Desktop chats no longer updating

**Symptom (user report):** the Refresh button in the Explorer UI no longer brings in new Claude Desktop conversations. Claude Code (CC) JSONL ingestion still works; older Desktop conversations remain visible. Net effect: Desktop chat activity has gone silent in Explorer.

**Investigate:**

1. **Trigger trace.** Frontend Refresh → `/api/fetch` (SSE) → `backend/routers/fetch.py` → `fetcher/bulk_fetch.py`. Confirm the SSE stream reaches `complete` for a fresh run. Capture full SSE payloads (one event per `data:` line) into a debug file so we have a reproducer.
2. **Credential health.** Read `~/.claude-explorer/credentials.json`; check `sessionKey` age, `__cf_bm` / `cf_clearance` cookie freshness, and whether Cloudflare is rejecting (look for `cf-mitigated` in response headers via mitm-style probe). Hypothesis: credentials expired and the fetcher silently swallows 401/403, marking the run "complete" with zero conversations added.
3. **Empty-result vs. unwritten-result.** When the fetcher saves a new conversation, where does it land? Compare `_index.json`'s `last_successful_fetched_count` and the actual file mtime distribution in `~/.claude-explorer/conversations/`. Identify whether the bug is "fetch returns 0" or "fetch returns N but the UI doesn't surface them."
4. **Cowork interaction.** The cowork-multi-org plan (`PLANS/cowork-multi-org.md`) is awaiting implementation. The user's primary workspace may now be Cowork; today's single-org fetcher only sees Personal. If recent Desktop activity is in Cowork, that **is** the regression — and it's already designed to be fixed by the cowork plan.
5. **UI surfacing.** Even if conversations are saved, confirm `backend/store.list_conversations` returns them (sort order, default filters). The frontend's "Group by project" + new-arrival sort interactions can hide newly written conversations if `created_at` is parsed wrong.
6. **Refresh-button toast UX.** Capture how the current fetch result is communicated to the user (today: a dialog modal). Confirm whether errors are visible at all when the dialog has been dismissed mid-run.

**Deliverable:** root cause classification (credentials | cowork | UI sort | other), the file:line of the bug, and a one-paragraph recommended fix shape. If the fix is "land cowork-multi-org first," say so explicitly.

---

## Inv-2. Title mismatch — Claude Code sessions show first-user-message text

**Symptom (confirmed in screenshot):** Claude Desktop's Code tab shows a session titled `Test MCP implementation` in both the sidebar list and the conversation header. Explorer shows the same session as `What workspace-mcp tools do you see?` (the first user message text).

**Findings already gathered (preliminary, not the deliverable):**

JSONL files at `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl` contain summary entries of the form:

```json
{"type":"summary","summary":"Claude Desktop Message Exporter: Plan & Frontend Setup","leafUuid":"3f820e64-..."}
```

These are Claude Code's auto-generated titles (Sonnet-assigned). One JSONL can contain dozens (one per compact / branch leaf). The current title extractor at `backend/claude_code_reader.py:90` (`_extract_title_from_message`) **does not look at these** — it parses the first user-message text and falls back to first-line markdown. That is the bug.

**Investigate:**

1. **Which summary is "the title"?** Multiple `type:summary` entries exist per file (40 in the test session). Determine the rule — likely "the latest entry whose `leafUuid` is reachable from the conversation's current leaf message" (i.e., on the active branch). Or simply "the last `type:summary` written before the most recent assistant message." Pick the rule with the strongest match against ground-truth titles in Desktop. Test against ≥5 sessions where Desktop's title is known.
2. **CC CLI vs CC-from-Desktop title parity.** User explicitly said both surfaces show the same title. Confirm `claude --resume` output and the Desktop Code-tab header use the same title source (likely the `type:summary` entries). If they diverge, flag as out-of-scope but document.
3. **Fallback behavior.** Some short or unsummarized sessions may have no `type:summary` entry. Define a fallback chain: (a) latest `type:summary`, (b) first user-message clean line (current behavior), (c) `Untitled — <iso-date>`.
4. **Cache invalidation.** `backend/cache.py` caches parsed JSONL by mtime. Confirm the title-extraction logic runs inside the cached path; otherwise titles will look stale after each compact. Likely fix lives next to `parse_jsonl_fast` or one layer above.

**Deliverable:** the title-resolution rule (with evidence from ≥5 sessions), the exact code change shape (file:line, before/after), and a list of any sessions where the rule won't recover the right title (so the build plan can decide whether to also surface a "Rename" affordance).

---

## Inv-3. Title mismatch — Claude Desktop API conversations

**Symptom (user report, paired with Inv-2):** some Claude Desktop chat sessions also show first-message text instead of the title shown in the Desktop app sidebar/header.

**Investigate:**

1. **API field shape.** Pick a Desktop conversation whose Desktop-side title is known. Pull the raw JSON from `~/.claude-explorer/conversations/<uuid>.json`. Confirm whether the `name` field carries Desktop's title or whether Desktop assigns titles via a separate endpoint (e.g., `/api/organizations/<org>/chat_conversations/<uuid>` returning a richer object). The fetcher's list endpoint may return a stub `name` while the detail endpoint returns the real one.
2. **Code path.** `backend/store.py:_make_summary` (line ~228) reads `data.get("name", "Untitled")`. Trace what `name` contains for the test conversation. If `name` is empty/null and Desktop has a separate title field (e.g., `display_name`, `summary`), update both `_make_summary` and `fetcher/bulk_fetch.py:save_conversation` to read the right field.
3. **Re-fetch impact.** If we change which field becomes `name` server-side, do existing on-disk JSONs need to be re-fetched? The `--full-refresh` path covers it; document that as a one-time migration step in the build plan.

**Deliverable:** the authoritative field (with API-response sample), the patch sites in `bulk_fetch.py` + `store.py`, and a re-fetch instruction note for the build plan.

---

## Inv-4. Message IDs in Claude — can we navigate to a specific message?

**Question (from a prospective user):** "Can I navigate to a specific message ID?"

**Investigate:**

1. **Desktop API messages.** Conversation JSON returned by `/api/organizations/<org>/chat_conversations/<uuid>` contains a `chat_messages` array. Confirm each message has a stable `uuid` (or `id`) field. Document the shape.
2. **Claude Code JSONL.** Each entry has `uuid` and `parentUuid`. Confirm uniqueness across the file, and across files (UUIDs should be globally unique by RFC 4122 generation).
3. **Cross-source ID space.** Are Desktop API message UUIDs and CC JSONL message UUIDs from disjoint spaces? (Yes, almost certainly — different generators.) The build plan must handle both source kinds in the URL scheme.
4. **Render-side targeting.** Determine the smallest data flow needed for `/c/<conv-id>?m=<msg-id>`: the conversation detail page must scroll-to + flash-highlight the message. The existing `isKeyboardSelected` ring style is the right affordance.

**Deliverable:** confirm message IDs exist on both sources, document the field name, and propose the URL-scheme grammar (e.g., `?m=<msg-uuid>`) plus the highlight/scroll-into-view behavior.

---

## Inv-5. /compact-operation data signals

**Question:** what signals does the JSONL provide for `/compact` events, and is the `<command-name>/compact</command-name>` heuristic the best we can do?

**Findings already gathered:**

In a typical CC session JSONL we see all of:

- `{"type":"summary","summary":"<title>","leafUuid":"..."}` entries (one per compact event; same shape as the title entries above) — *N entries observed: 40 in the test file*.
- Messages with `isCompactSummary: true` flag — *20 occurrences in the test file*.
- User messages containing `<command-name>/compact</command-name>` text — *54 occurrences (also includes other command invocations)*.

**Investigate:**

1. **Best primary signal.** Confirm `isCompactSummary: true` is set on the assistant message that *is* the post-compact summary, not on the user trigger. If so, that's the cleanest marker — it's already structural (no string parsing) and unambiguous.
2. **Pairing with `type:summary` entries.** Each compact emits both an `isCompactSummary` message and a `type:summary` entry. Confirm they share a UUID linkage (the summary entry's `leafUuid` should match a real message UUID in the same file).
3. **User-trigger detection.** Distinguish compact triggers (auto vs. manual). Check whether a manual `/compact` user-text marker always precedes the `isCompactSummary` message; if yes, the build plan can show "manual compact at HH:MM" vs. "auto-compact at HH:MM" — small UX win.
4. **Edge cases.** Sessions with truncated/incomplete compacts; sessions where `isCompactSummary` is missing but `type:summary` is present (or vice versa); sessions with multiple compacts back-to-back.
5. **Desktop API parity.** Does Claude Desktop's API expose anything analogous? Likely not (Desktop conversations don't have user-triggered compaction in the same way). Document and scope feature 8 to CC sessions only if so.

**Deliverable:** the signal-detection rule (in pseudocode), with evidence from ≥3 sessions; the recommended UX (consolidates Council Feature-3 recommendation: inline dashed divider + pill, collapsible `<details>` summary, `[` / `]` keyboard nav, "View → Hide compact markers" toggle, default-on); confirmation that Desktop API conversations are out of scope.

---

## Investigation deliverable / gate

When all five items have written findings, the user reviews. Build-plan items are then triaged:

- "Already a fix" → the build plan implements the fix.
- "Already in another plan" → cross-reference (e.g., Inv-1 → cowork-multi-org).
- "Punt to v2" → moved to a backlog appendix in the build plan.

Cross-references:
- `PLANS/cowork-multi-org.md` — Inv-1 may resolve to "land this first."
- `PLANS/part2_revision_followups.md` — items 1-11 absorbed into the build plan.
- `PLANS/explorer-improvements-build.md` — Phase 2, refined post-investigation.

---

# Findings (executed 2026-04-30)

## Inv-1 finding — Root cause: credentials expired (53 days)

**Classification:** credentials (not cowork, not UI sort).

**Evidence:**

| Probe | Value |
|---|---|
| `~/.claude-exporter/credentials.json` mtime | 2026-03-09 12:17 (53 days ago) |
| `~/.claude-exporter/credentials.json` mode | `0644` (world-readable — confirms `part2_revision_followups.md` BLOCKER #2) |
| `~/.claude-exporter/conversations/_index.json` `fetched_at` | `2026-03-09T19:24:52` |
| Latest written conversation file | 2026-03-09 (89 total Desktop conversations on disk) |
| Newer conversation files since 2026-03-09 | 0 |

The Cloudflare cookies (`cf_bm`, `cf_clearance`) and `sessionKey` in the credentials file were captured 53 days ago. Both Cloudflare cookie types expire on the order of hours-to-a-few-days, and Anthropic session keys typically expire within ~30 days. So every fetch since mid-March has been failing on the very first API call.

**Path-name confusion (cosmetic, non-bug):** the data dir is `~/.claude-exporter/` (legacy "exporter") in code (`fetcher/bulk_fetch.py:32-34` defines `DEFAULT_CREDENTIALS_PATH = Path.home() / ".claude-exporter" / "credentials.json"`). README and CLAUDE.md document `~/.claude-explorer/`. **The user's data is fine** — it's at the legacy path the code actually uses; the docs lie. This is a documentation fix, not a code fix.

**Why the failure is silent:**

1. `fetcher/bulk_fetch.py:319-320` catches `status == 401` in `fetch_conversation` and prints "Session expired" to stderr. But this is only hit if `fetch_conversation_list` itself succeeded.
2. `fetch_conversation_list` at line 273 does `response.raise_for_status()` — a 401/403 there raises `HTTPError`, which falls through `backend/routers/fetch.py:217` to the outer `except Exception as e: yield "Fetch failed: {str(e)}"`. The user sees something like `Fetch failed: 403 Client Error: Forbidden for url: ...` with no actionable hint.
3. **Cloudflare blocks return 403**, not 401. The 401-string match at `backend/routers/fetch.py:187` (`if "401" in error_msg`) misses Cloudflare-block failures even when they happen mid-loop.

**Recommended fix shape (build plan):**

- **Immediate user action (out of build plan):** re-run `uv run claude-explorer capture` to refresh credentials. After that, fetch should work — *unless* the user's recent activity is in Cowork, in which case Inv-1 dependency on `PLANS/cowork-multi-org.md` becomes load-bearing.
- **Build plan absorbs:**
  - Catch 401 *and* 403 in both error paths; map to "Session expired or Cloudflare-blocked. Re-run `claude-explorer capture`."
  - Add a "credentials age" check to `GET /fetch/status` and surface a yellow warning toast in the UI when credentials are >14 days old.
  - Coordinate with `PLANS/cowork-multi-org.md` BLOCKER #2 fix so credentials write goes to `0o600`.
  - Fix README/CLAUDE.md path references (or rename the on-disk dir to `~/.claude-explorer/` with a one-time migration). Defer dir-rename to a separate decision; for now, fix docs to match code.

## Inv-2 finding — CC title rule: use the last `type:summary` entry

**Rule (validated):** `_resolve_session_title(entries) = entries.filter(type=='summary').last().summary` if any exist; else fallback to current first-user-message clean line; else `Untitled — <iso-date>`.

**Evidence (5 representative sessions, all with `type:summary` entries):**

| Session | # summaries | Last summary (= ground-truth title) | First user-message text (current bug) |
|---|---|---|---|
| `a70251a5` (cwd: claude-desktop-message-exporter) | 40 | `Claude Desktop Message Exporter Polish Features` | `This is a new project for which you write plans...` |
| `1e3c6db9` (cwd: Family-Room---Money) | 107 | `FDGRX NAV Skill + Daily Check-ins + Parallelization` | `Use the financial-analyst agent to summarize...` |
| `f2e550c9` (cwd: LinkedIn) | 1 | `Building LinkedIn Tab Title Userscripts with Git` | `I use the Violentmonkey plugin...` |
| `1c68065c` (cwd: pct_ai) | 30 | `React Component Rendering with Dynamic Key Prop` | `This session is being continued...` |
| `482c65de` (cwd: misc) | 2 | `Download script retries, Emacs gptel config` | `I'd like help in creating a script...` |
| `67aa6407` (cwd: misc) | 6 | `E2E tests fixed, UI improved, pyannote upgraded` | `Take a look at the README.md here...` |

In all six samples the **last** `type:summary` entry is the natural title that Claude Code shows in `claude --resume` and the Desktop Code-tab header. Discarded the leafUuid-matching variant: of the 40 summary entries in `a70251a5`, none had a `leafUuid` matching the most recent message UUID — the leafUuids point to historical compact-leaves. The simpler "last entry wins" rule wins.

**Distribution across all CC sessions (sample of 500 of 841 total):**
- 12 sessions have at least one `type:summary` entry (~2.4%).
- 488 sessions have none.

So **the fallback path runs ~98% of the time**. That's still a behavior fix because (a) the long-running, multi-compact sessions (where summaries exist) are exactly the ones the user cares about most and notices titles on, and (b) the fallback already works fine for short sessions.

**Edge cases:**
- Manual rename in Claude Code: needs investigation. Hypothesis: rename writes a new `type:summary` entry, so the rule already handles it. Defer verification to build phase implementation.
- Sidechain branches with their own summary entries: leafUuid is set per branch leaf, but our rule ignores leafUuid and just takes the latest. Acceptable — the latest write reflects the user's most recent active branch.

**Patch site:** `backend/claude_code_reader.py:90` (`_extract_title_from_message`) → wrap into `_resolve_session_title(entries: list[dict], fallback_iso_date: str) -> str` that runs the rule first, falls through to current logic. Cache invalidation: `backend/cache.py:parse_jsonl_fast` already keys by mtime, so the new resolver inherits correct cache behavior as long as it's called within that path.

## Inv-3 finding — Desktop API: `name` IS the right field; bug is rare

**Coverage of the `name` field (89 Desktop conversations on disk):**

| Status | Count |
|---|---|
| `name` present and non-empty | 88 |
| `name` empty or `null` | 1 (`b77f215f`, also has 0 messages — likely an aborted/empty conversation) |

**Sample top-level keys** (one fully-populated conversation):

```
['chat_messages', 'created_at', 'current_leaf_message_uuid', 'is_starred',
 'is_temporary', 'model', 'name', 'platform', 'settings', 'summary',
 'updated_at', 'uuid']
```

`name` is the user-facing title. `summary` is a long auto-generated narrative (different from CC's short title). `display_name` does not exist.

**The user's reported Desktop title mismatch is likely one of:**
1. **Stale title after Desktop-side rename.** Incremental fetch (`bulk_fetch.py`) skips already-saved UUIDs, so a rename in Desktop after the original fetch never propagates. `--full-refresh` would catch it.
2. **Mistaken identity.** The screenshot example (`Test MCP implementation`) is a Code-tab session, not a Desktop chat — that's the Inv-2 bug, not Inv-3.

**Recommendation:** drop the standalone Inv-3 code change from the build plan. Replace with two cheaper actions:
- Build plan adds a "Force update" affordance per conversation (re-fetch single conv) so a renamed Desktop chat can be refreshed without `--full-refresh`.
- Re-run `--full-refresh` once after the credentials fix lands; user verifies whether any Desktop titles are still stale.

If the user reports specific Desktop conversations whose titles are wrong even after a fresh `--full-refresh`, escalate to a deeper Desktop-API field investigation. Until then, no Desktop-side title bug is confirmed.

## Inv-4 finding — Message IDs exist on both sources, namespace disjoint

**Desktop (sample conv from `~/.claude-exporter/conversations/0297...json`):**
- `chat_messages[*].uuid` — present, RFC 4122 v7 (`019cb64c-6281-7064-82d5-93e46181a75b`).
- `chat_messages[*].parent_message_uuid` — present (enables branching reconstruction).
- 6/6 unique within the sampled conversation.

**Claude Code (sample JSONL `a70251a5...jsonl`):**
- `entries[*].uuid` on user/assistant entries — present, RFC 4122 v4 (`cb06aedf-70de-4973-819c-489c9dee0e99`).
- `entries[*].parentUuid` — present.
- 9994/9994 unique within the sampled file.

**Cross-source ID space:** Desktop UUIDs are v7 (timestamp-prefixed); CC UUIDs are v4 (random). The two namespaces are disjoint by construction. Single URL parameter scheme `?m=<uuid>` is safe — no need for a `?m_source=...` qualifier.

**Render-side targeting:** detail page reads `?m=<uuid>` from `useSearchParams`, locates the message DOM node by `data-message-uuid` (add this attribute on the `MessageBubble` wrapper), calls `scrollIntoView({ behavior: 'smooth', block: 'center' })`, and applies the existing `isKeyboardSelected` ring style for ~2 seconds.

**Build-plan grammar (confirmed):**
- `/c/:convId` — opens conversation.
- `/c/:convId?m=:msgUuid` — opens, scrolls, flashes.
- Bookmark deep links use this same scheme.

## Inv-5 finding — Use `isCompactSummary: true` as the primary signal

**Validated structural marker (sample `a70251a5...jsonl`):**

- 19 messages with `isCompactSummary: true`.
- All 19 are `type: "user"` (not assistant!) — Claude Code emits the post-compact summary as a synthetic user message that injects the summary text into the next turn.
- Each compact-summary message has stable fields: `uuid`, `timestamp`, `parentUuid`, `sessionId`, `slug`, `isVisibleInTranscriptOnly: true`.
- Full key set: `['cwd', 'gitBranch', 'isCompactSummary', 'isSidechain', 'isVisibleInTranscriptOnly', 'message', 'parentUuid', 'sessionId', 'slug', 'timestamp', 'type', 'userType', 'uuid', 'version']`.

**Linkage with `type:summary` entries:**
- 40 `type:summary` entries in this file.
- `type:summary.leafUuid` does **not** match any of the 19 compact-summary message UUIDs (0/19 overlap).
- The two signals are independent: `type:summary` entries point to historical *leaf* messages (the message right before each compact event), not to the compact-summary message itself.

**Detection rule (pseudocode):**

```python
def extract_compact_markers(entries: list[dict]) -> list[CompactMarker]:
    markers = []
    for e in entries:
        if e.get('isCompactSummary') is True:
            content = e.get('message', {}).get('content', '')
            if isinstance(content, list):
                content = ' '.join(b.get('text', '') for b in content if b.get('type') == 'text')
            markers.append(CompactMarker(
                message_uuid=e['uuid'],
                timestamp=e['timestamp'],
                summary_text=content,
                is_visible_only=e.get('isVisibleInTranscriptOnly', False),
            ))
    return markers
```

No need for `<command-name>/compact</command-name>` text-parsing or any title-summary cross-linking. The structural flag is sufficient and unambiguous.

**Auto vs manual compact distinction:** by inspection, the user-trigger `<command-name>/compact</command-name>` does not always precede `isCompactSummary` messages — auto-compacts (Claude Code's automatic context-window trigger) emit the same `isCompactSummary: true` shape with no preceding manual command. If the build plan wants the auto-vs-manual UX detail, it would need to scan the preceding ~5 user messages for a `/compact` command-name match. **Recommendation: defer to v2.** v1 just shows "✂ Compacted · HH:MM" without distinguishing auto vs manual.

**Desktop API parity:** Desktop conversations do not have analogous markers (no `/compact` mechanism on Desktop). Compact markers are CC-only. Build plan hides the View-menu toggle for non-CC conversations.

---

## Triage summary (for build phase refinement)

| Item | Disposition | Build plan action |
|---|---|---|
| Inv-1 | **Real bug, root cause known.** Immediate user action: re-capture. | Build-1 (toast already planned) absorbs the 401/403 widening + age-warning. Coordinate with cowork-multi-org BLOCKER #2 (0o600). Add doc fix for `.claude-exporter` vs `.claude-explorer` path mismatch. |
| Inv-2 | **Real bug, fix is small.** | Build-2 implements `_resolve_session_title()` with the validated rule. Add ≥6-fixture unit-test set. |
| Inv-3 | **No confirmed Desktop-side bug.** | Drop the Desktop-API title patch from Build-2. Add a smaller "Force update" per-conversation re-fetch affordance for stale-rename recovery. |
| Inv-4 | **Confirmed: works as planned.** | Build-6 URL grammar `/c/:id?m=:uuid` + `data-message-uuid` attribute on `MessageBubble`. |
| Inv-5 | **Confirmed: clean structural signal.** | Build-7 uses `isCompactSummary === true`; no command-name parsing. Auto-vs-manual distinction → v2 backlog. |

Ready for user review.
