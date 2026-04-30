# Explorer Improvements — Build Phase

This is Phase 2 of two paired plans. Phase 1 (`PLANS/explorer-improvements-investigation.md`) gathered the data signals and bug root causes. All five Inv items are closed; their findings are folded in below.

LLM Council (Gemini 3 Pro + GPT-5.2) was consulted on bookmarks, filter grammar, URL nouns, URL grammar, compact-marker UX, and the manual-vs-auto compact distinction. Council disagreements and final reconciliations are noted inline where they affected the spec.

This plan also folds in the 11 items from `PLANS/part2_revision_followups.md` so the user can clear two backlogs in one push. Each Build-8 item is **TDD**: a failing Playwright or pytest test must be committed first, then the fix.

---

## v1 implementation order

v1 is the BLOCKER + bug-fix + quick-wins set. v2 is everything else. The user runs the v1 stack end-to-end (re-capture credentials, refetch, browse), reviews, then we resume with v2.

| # | Item | Type | Test framework |
|---|------|------|----------------|
| 1 | Build-8 #2 — credentials file `0o600` perms | BLOCKER bug-fix | pytest |
| 2 | Build-8 #3 — port-conflict actionable error | BLOCKER bug-fix | pytest |
| 3 | Build-8 #1 — search-in-tool-usage broken | BLOCKER bug-fix | pytest (integration) |
| 4 | Build-2 — Claude Code title fix | bug-fix | pytest with golden JSONL fixtures |
| 5 | Build-1 — Refresh toast + 401/403 mapping + age warning | feature | Playwright + pytest |
| 6 | Build-3 — Jump-to-top / right-panel-aware button stack | feature | Playwright |
| 7 | Build-8 #10 — "Copy" → "Copy as Markdown" label | quick-win | Playwright |
| 8 | Build-8 #4 — Help-modal Cmd/Ctrl glyph by platform | quick-win | vitest |
| 9 | Build-8 #8 — Esc closes Settings page | quick-win | Playwright |
| 10 | Build-8 #11 — upstream repo rename to `rpeck/claude-explorer` | one-shot | n/a (no test) |

**STOP after v1.** User tests, then we resume with v2.

### v2 (after v1 ships and is verified)

- Build-4 (bookmarks)
- Build-5 (sidebar filters with the v2 grammar below)
- Build-6 (URL-parameter navigation)
- Build-7 (compact markers — auto + manual, with user-prompt rendering)
- Build-8 #5 (per-message tool-block toggle)
- Build-8 #6 (branch switching wire-up)
- Build-8 #7 (dark-mode runtime breakage)
- Build-8 #9 (mobile responsive layout)
- "Force update single conversation" affordance (replacement for Inv-3 patch)

---

## Build-1. Refresh-button: ephemeral toast notifications + credentials-expired handling

**Why:** Inv-1 root-caused the refresh regression to expired credentials (53 days old). The fetcher was failing on the first API call and the modal-only error surface hid it. The toast surface plus widened error mapping ensures the user sees actionable failures and stale-credential warnings.

**Spec:**

- Add a toast system (use `sonner` — already a peer of shadcn). Mount `<Toaster />` at the root layout.
- Refresh click → toast `"Fetching…"` (in-progress, no auto-dismiss while SSE active).
- Success → toast `"Fetch complete: +N new conversations"`, auto-dismiss after 5s.
- Error → toast `"Fetch failed: <reason>"`, **sticky** (no auto-dismiss; user closes manually).
- Keep `FetchDialog` as an optional "Details…" surface from the toast for users who want progress numbers + Full-Refresh.
- Wire `eventSource.onerror` and `error`-type SSE events to the toast (today they only flow into modal state).

**Credentials-expired error mapping (from Inv-1):**

- `backend/routers/fetch.py` and `fetcher/bulk_fetch.py` must catch **both** `401` and `403`. The current code only string-matches `"401"` (line 187). Cloudflare blocks return `403` with header `cf-mitigated: challenge` and that path is currently dropped through to a generic `"Fetch failed: 403 Client Error..."`.
- New mapping: any `401`, any `403` with `cf-mitigated` present, OR any `403` returned by the Anthropic API host → toast text `"Session expired or Cloudflare-blocked. Re-run claude-explorer capture."`
- Add a `credentials_age_days` field to `GET /fetch/status`, computed from the credentials file `mtime`. If `>14`, the toast on next Refresh is yellow and reads `"Credentials are N days old; re-capture if fetch fails."` (informational, not blocking).
- Fix the README/CLAUDE.md path mismatch (`~/.claude-exporter/` is what the code uses; the docs say `~/.claude-explorer/`). For v1 just update docs to reflect the legacy path; defer dir-rename to a separate decision so user data isn't moved mid-Medium-series.

**"Force update" affordance (replaces dropped Inv-3 patch):**

- Per-conversation context-menu item "Force re-fetch" → calls a new `/api/fetch/conversation/<uuid>` route that bypasses the incremental skip. Surfaces stale Desktop-side renames without forcing a `--full-refresh`.

**Files:** `frontend/src/components/fetch/FetchDialog.tsx`, new `frontend/src/components/fetch/FetchToast.tsx`, root layout to mount `<Toaster />`, `frontend/src/lib/api.ts` (for the new force-refetch call), `backend/routers/fetch.py` (error mapping + credentials_age + per-conv route), `fetcher/bulk_fetch.py` (force flag plumbed), `README.md` + `CLAUDE.md` (path correction).

**Tests:**

- Playwright: `tests/e2e/refresh-toast.spec.ts` — success-path 5s auto-dismiss; sticky error path; "Details" link opens the modal mid-fetch.
- pytest: `backend/tests/test_fetch_errors.py` — 403-with-cf-mitigated → "re-capture" string; 401 → same; generic 500 → generic message; credentials >14d old → status payload includes `credentials_age_days`.

---

## Build-2. Session-title fix (Claude Code only)

Implements the title rule validated in Inv-2: `_resolve_session_title(entries) = entries.filter(type=='summary').last().summary`, with fallbacks.

**Inv-3 outcome:** the Desktop API title patch is **dropped**. Inv-3 confirmed `name` is the right field and the bug is rare (1 of 89 conversations had empty `name`, and that one had zero messages). The user-reported Desktop title mismatch was misidentification — the screenshot example was a Claude Code session, not a Desktop chat. The "Force update single conversation" affordance in Build-1 covers stale-rename recovery without a code change.

**Spec (Claude Code path):**

- Replace `backend/claude_code_reader.py:_extract_title_from_message` (line ~90) with `_resolve_session_title(entries: list[dict], fallback_iso_date: str) -> str`.
- Resolution rule:
  1. Filter entries to `type == "summary"`. Take the **last** one. Use `entry["summary"]`.
  2. If no `summary` entries, fall back to current behavior (first user-message clean line).
  3. If both fail, return `f"Untitled — {fallback_iso_date}"`.
- Cache invalidation: the resolver runs inside the `parse_jsonl_fast` cached path (keyed by mtime), so titles refresh automatically when the JSONL changes.

**Tests (must fail first):**

- `backend/tests/test_claude_code_title.py` with **6 golden JSONL fixtures**:
  1. `a70251a5` — 40 summary entries, expected: `Claude Desktop Message Exporter Polish Features`.
  2. `1e3c6db9` — 107 summary entries, expected: `FDGRX NAV Skill + Daily Check-ins + Parallelization`.
  3. `f2e550c9` — 1 summary entry, expected: `Building LinkedIn Tab Title Userscripts with Git`.
  4. `1c68065c` — 30 summaries, expected: `React Component Rendering with Dynamic Key Prop`.
  5. `482c65de` — 2 summaries, expected: `Download script retries, Emacs gptel config`.
  6. **No-summary fixture** (synthetic, derived from any of the ~488 sessions without `type:summary`): expected fallback = first user-message clean line.
- Plus an empty-file fixture: expected `Untitled — <iso-date>`.
- Run with the test that asserts the **CURRENT bug** (first-message text leaks through) is committed before the fix lands.

**Files:** `backend/claude_code_reader.py`, `backend/tests/fixtures/jsonl/*.jsonl` (small slices of the real files — keep ≤200 lines each), `backend/tests/test_claude_code_title.py`.

**Re-fetch note:** Claude Code titles update on the next sidebar render (no fetch needed; JSONL is read live). Desktop conversations need a `--full-refresh` only if the user has Desktop-side renames they want to pull in — the per-conv "Force re-fetch" affordance from Build-1 handles the common case.

---

## Build-3. Jump-to-top / Jump-to-bottom buttons that don't get obscured

**Spec:**

- Add a Jump-to-Top button mirroring the existing Jump-to-Bottom.
- Both buttons live in a vertical stack at the bottom-right of the message stream.
- When the right-side search panel is open, the button stack shifts left by the search-panel width (use the same width source-of-truth as the panel's CSS — read from a CSS custom property `--search-panel-width` set on the panel container).
- Show/hide logic: top button visible when scrolled below the first-message threshold; bottom button visible when scrolled above the last-message threshold (current behavior preserved for bottom).
- Keyboard: `g g` (top) and `Shift+G` (bottom), vim-style — opt-in via a settings toggle if it conflicts with existing shortcuts (defer the toggle if no conflict found).

**Tests:**

- Playwright `tests/e2e/jump-buttons.spec.ts`: assert both buttons exist; open search panel and assert the stack's `right` offset increases by the panel width; close panel and assert it returns; click jump-to-top from mid-conversation and assert scrollTop is 0; press `g g` and `Shift+G` and assert the same.

**Files:** `frontend/src/routes/ConversationPage.tsx`, CSS for `--search-panel-width`.

---

## Build-4 (v2). Message bookmarks

Deferred to v2. Spec preserved verbatim from prior draft for continuity:

**Storage:** backend JSON `~/.claude-explorer/bookmarks.json` (resolve `~/.claude-explorer/` vs `~/.claude-exporter/` as part of the path-fix in Build-1; bookmarks goes into whichever the data dir resolves to). New router `backend/routers/bookmarks.py` (CRUD: list, create, delete, update note). Council unanimously rejected localStorage as volatile and incompatible with the Medium-export pipeline.

```json
{
  "bookmarks": [
    {
      "id": "<uuid>",
      "conversation_id": "<uuid>",
      "message_uuid": "<uuid>",
      "source": "claude_desktop" | "claude_code",
      "created_at": "<iso8601>",
      "note": "<user-supplied string>",
      "snippet": "<auto-truncated message text, ~140 chars>"
    }
  ]
}
```

**UI:** right-pane second tab `Search | Bookmarks`; per-message hover-revealed star button; `b` toggles bookmark; `Shift+B` opens note popover; gutter ticks on the message stream; flat-list bookmarks tab with conversation grouping; "Export to Markdown" button producing a single `.md` with deep-link citation anchors. Notes only — no tags in v2 either; Council called tags a "taxonomy bikeshed."

**Deep links:** `/conversations/<conv-id>?m=<msg-uuid>` (see Build-6 grammar).

---

## Build-5 (v2). Persistent rich title-based sidebar filters

Deferred to v2. The grammar below is the Council-agreed final form, written in detail per the user's request.

### Grammar

A **filter set** is an ordered list of named filters. The result of applying a filter set to the conversation list is:

```
result = [c for c in all_conversations if all(filter_passes(c, f) for f in active_filters)]
```

That is — **multiple active filters AND together** (every filter must pass). Within a single filter, a list of **patterns ORs together** (any pattern matching counts as a match for that filter). A filter has a **polarity**: `include` means "must match at least one pattern"; `exclude` means "must match zero patterns."

A single filter looks like:

```
name:        Frontend work
patterns:    *react*, *typescript*, *css*
polarity:    include    # (or "exclude")
mode:        glob       # (or "regex")
target:      title      # v1: title only; v2 adds project_path, source
pinned:      true       # auto-applies on every page load
active:      true       # ad-hoc per session for unpinned filters
```

#### Match semantics

- **Glob mode (default):** patterns use shell-style globbing (`*`, `?`, `[abc]`). Matches are case-insensitive against the title. A pattern with no wildcards is treated as `*pattern*` (substring match).
- **Regex mode:** patterns are JS `RegExp` (frontend) compiled with the `i` flag. Invalid regex → red border in editor, filter disabled until valid.
- **Pattern OR within a filter:** patterns are entered as a comma-separated list in the editor. Whitespace around commas is trimmed. To include a literal comma, use regex mode.

#### Filter AND across filters

All active filters must pass. An `include` filter passes when at least one of its patterns matches. An `exclude` filter passes when none of its patterns match.

#### Worked examples

**Example A — narrowing two facets:**

```
Filter "Frontend":  include  glob   *react*, *typescript*
Filter "Recent":    include  regex  ^(2026-04|2026-03)
```

A conversation passes iff its title matches `*react*` OR `*typescript*` AND its title also matches `^(2026-04|2026-03)`. (Two AND-ed filters, each with internal OR.)

**Example B — exclusion:**

```
Filter "Hide tests":  exclude  glob   *test*, *spec*
Filter "MCP work":    include  glob   *mcp*
```

Pass iff the title contains `mcp` AND does not contain `test` or `spec`.

**Example C — pinned-plus-ad-hoc:**

User pins `Filter "Hide deleted": exclude glob *DELETED*` so it auto-applies every session. They temporarily activate (un-pinned) `Filter "Filters review": include glob *filter*` while triaging this very feature. Both filters AND together. When they close the tab, the pinned filter persists and the ad-hoc one is dropped.

### Storage

`localStorage` (UI prefs, single-user, low risk). Pinned filters and their definitions persist; `active` state for un-pinned filters resets per session. Schema:

```json
{
  "filters": [
    {
      "id": "<uuid>",
      "name": "Frontend",
      "patterns": ["*react*", "*typescript*"],
      "polarity": "include",
      "mode": "glob",
      "target": "title",
      "pinned": true
    }
  ],
  "active_filter_ids": ["<uuid>", ...]
}
```

### UI

- **Sidebar surface:** compact chip rail below the search box. Each chip shows the filter name + a polarity glyph (`+` include, `−` exclude) + an active-state toggle (filled vs outline). Click chip → toggle active. Click "Manage filters…" → modal.
- **Manage filters modal:** list of filters; per-row name input, comma-separated patterns input, polarity radio, mode toggle (glob/regex), target select (v1: disabled at "title"), pin checkbox.
- **Live preview** in the modal: while typing a pattern, show match count + first 5 matching titles. Council unanimous on this.
- **Empty-state banner:** when filters hide everything, show `"All N conversations hidden by M active filters"` + "Clear all filters" button. Never silently render a blank list.
- **Performance:** client-side `useMemo` + 150ms debounce on pattern input.

**Files:** `frontend/src/components/filters/FilterChipRail.tsx`, `frontend/src/components/filters/ManageFiltersModal.tsx`, `frontend/src/contexts/FilterContext.tsx`, `frontend/src/lib/filterEngine.ts`.

---

## Build-6 (v2). URL-parameter navigation

Deferred to v2. Two unresolved questions are settled here per Council debate.

### Resolved: URL noun is `conversation`

Codebase audit (executed before plan rewrite):

| Term | Backend hits | Frontend hits |
|------|--------------|---------------|
| `conversation` | 76 | 99 |
| `session` | 7 | 3 |

The Desktop API endpoint is `/api/organizations/<org>/chat_conversations/`. Claude Code uses `sessionId` only as a transport identifier inside JSONL — there is no user-facing "session" concept in either Anthropic surface. Both Council members concurred: **`conversation` is the term.** No `/sessions` URL anywhere.

### Resolved: URL grammar is resource-oriented

The Council debated `/conversations/search?q=...` (verb-as-page) vs `/conversations?q=...` (resource-with-query):

- **GPT-5.2 argued** for `/conversations/search` on UX grounds: search has its own page-level affordances (results list, snippet rendering) and segregating it from the default conversation list makes intent clear.
- **Gemini argued** for resource-oriented: search is a query on the same resource, not a separate resource. With one route, deep-linkable filter+search states compose cleanly. REST conventions support it. The user's instinct (`/projects/titles?...`) was actually verb-shaped and Gemini argued this was the wrong direction.
- **Resolution:** resource-oriented. One route per noun; query strings carry filters and search. Avoids the `/search` shaped inconsistency in the prior draft.

### Routes

| URL | Effect |
|---|---|
| `/projects/<slug>` | Sidebar pre-filtered to project; conversation list shows that project only. |
| `/conversations/<id>` | Opens conversation detail. |
| `/conversations/<id>?m=<msg-uuid>` | Opens conversation, scrolls to and flashes message. |
| `/conversations?q=<text>` | Conversation list with full-text search active. |
| `/conversations?title=<glob-or-regex>&filterMode=glob` | Conversation list with transient title filter (not saved to filter set). |
| `/conversations?project=<slug>&q=<text>&title=<pattern>` | All three compose; equivalent to `/projects/<slug>` + the two filters. |

**No `/search` route.** Search is a query, not a resource.

**Files:** `frontend/src/App.tsx` (router), `frontend/src/routes/ConversationPage.tsx` (read `?m=...` and scroll using `data-message-uuid` data attribute on `MessageBubble`), `frontend/src/contexts/FilterContext.tsx` (read `?title=...`).

**Tests:** Playwright tests for each route + a combined-params test asserting `?project=foo&q=bar&title=baz` filters all three ways.

---

## Build-7 (v2). /compact markers + jump navigation

Deferred to v2. Inv-5 confirmed the structural signal; this section adds the auto-vs-manual distinction and the user-prompt rendering the user requested.

### Detection rule (re-verified 2026-04-30)

**Primary signal:** entries with `isCompactSummary == true`. Validated against `~/.claude/projects/-Users-rpeck-Source-claude-desktop-message-exporter/a70251a5-*.jsonl` (19 such entries; all `type: "user"`; all carry stable `uuid`, `timestamp`, `parentUuid`, `sessionId`, `slug`).

**Auto vs manual:** the manual `/compact` user-text record appears in the JSONL **AFTER** the `isCompactSummary` message (the synthetic compact-summary message starts the new context window; the user's original `/compact` command from the prior context is replayed for transcript fidelity in the entries immediately following). The discriminator:

```python
def classify_compact(entries: list[dict], compact_idx: int) -> dict:
    """
    Classify a compact event as 'auto' or 'manual'. If manual, also extract
    the user's typed instruction from <command-args>...</command-args>.
    """
    # Search a small window AFTER the compact-summary entry for the replayed user command.
    LOOKAHEAD = 8
    for j in range(compact_idx + 1, min(compact_idx + 1 + LOOKAHEAD, len(entries))):
        e = entries[j]
        msg = e.get('message', {})
        content = msg.get('content', '')
        if isinstance(content, list):
            content = ' '.join(b.get('text', '') for b in content if b.get('type') == 'text')
        if isinstance(content, str) and '<command-name>/compact</command-name>' in content:
            args_match = re.search(r'<command-args>(.*?)</command-args>', content, re.DOTALL)
            user_prompt = args_match.group(1).strip() if args_match else ''
            return {'kind': 'manual', 'user_prompt': user_prompt}
    return {'kind': 'auto', 'user_prompt': None}
```

**Re-verified Desktop API parity (re-ran the scan against `~/.claude-exporter/conversations/*.json`, 50-file sample):** zero compact-related fields. Top-level union of keys: `chat_messages, created_at, current_leaf_message_uuid, is_starred, is_temporary, model, name, platform, project, project_uuid, settings, summary, updated_at, uuid`. Message-level union: `attachments, created_at, files, files_v2, index, input_mode, parent_message_uuid, sender, stop_reason, sync_sources, text, truncated, updated_at, uuid`. No `is_compact_summary`, no `compact_summary`, no `summary_message`, no boundary marker. The conversation-level `summary` field is the long auto-narrative, unrelated to compaction. **Compact markers are CC-only, confirmed twice.**

### UX

- **Inline marker:** full-width dashed divider with centered pill `✂ Compacted · HH:MM` (purple/indigo, matching branch-tree affordances). For manual compacts, the pill reads `✂ Compacted (manual) · HH:MM`. For auto, just `✂ Compacted · HH:MM`.
- **Pill is also a button:** clicking it expands a `<details>`-style panel below the divider. The panel content depends on kind:
  - **Manual:** Two sections, both rendered prominently:
    1. **"You asked:"** — the `user_prompt` from `<command-args>` (this is what the user typed and wanted summarized into). Rendered in the same bubble style as a normal user message so it reads natively.
    2. **"Summary:"** — the post-compact summary text from the `isCompactSummary` message body.
  - **Auto:** one section: **"Summary:"** with the post-compact summary text. (No user prompt to render for auto-compacts.)
- **Both kinds show the summary by default-expanded?** No — pill is collapsed by default to keep the timeline scannable. The "You asked:" prompt for manual compacts is **always shown inline** on the divider itself (truncated to ~120 chars with hover-tooltip for full text), since that's the most-load-bearing piece of context for the user. Council disagreement: GPT wanted both auto + manual to default-expand the summary; Gemini wanted both default-collapsed; the user's stated requirement ("the message they typed should be visible") tips the balance — manual prompts visible inline, summary expandable.
- **Keyboard:** `[` and `]` for prev/next compact within the open conversation. `Shift+[` and `Shift+]` jump to the first / last compact.
- **Inline navigation buttons** inside the expanded panel: `[ Prev ]` `[ Next ]` for keyboard-shy users.
- **Toggle:** "View → Hide compact markers" menu item; default ON. Persisted in `SettingsContext`.
- **Right-rail minimap:** Council recommends skip in v1 and v2. Variable-height streams make minimaps imprecise.
- **Scope:** CC JSONL conversations only. Hide the View-menu toggle entry for non-CC conversations.

**Files:** `frontend/src/components/conversation/CompactMarker.tsx`, `frontend/src/routes/ConversationPage.tsx` (mount markers + keyboard handlers), `backend/claude_code_reader.py` (extract compact markers into a per-conversation `compact_markers: list[CompactMarker]` field with shape `{message_uuid, timestamp, kind: 'auto' | 'manual', user_prompt: str | null, summary_text: str}`).

**Tests:**

- pytest: `backend/tests/test_compact_markers.py` — JSONL fixtures with (a) auto-only compacts, (b) manual-only compacts, (c) mixed; assertions on `kind` classification, `user_prompt` extraction, and `summary_text` content.
- Playwright: `tests/e2e/compact-markers.spec.ts` — pill renders for both kinds; manual pill shows truncated `<command-args>`; clicking expands "You asked" + "Summary"; `[`/`]` navigate; `Shift+[`/`Shift+]` jump to first/last; non-CC conversation does not show the View-menu toggle.

---

## Build-8. Folded-in items from `PLANS/part2_revision_followups.md`

Each item is **TDD**: a failing test must be committed first, then the fix in a follow-up commit. Item 11 is the exception (no test — it's a one-shot infrastructure rename).

### v1 (in this push)

#### Build-8 #1 — BLOCKER: search-in-tool-usage broken

**Failing test (committed first):** `backend/tests/test_search_tool_usage.py` — pytest integration test that builds a synthetic conversation with one `tool_use` block (input `{"command": "search-target-token-A"}`) and one `tool_result` block (text `"search-target-token-B"`), then asserts `search.search_conversations("search-target-token-A")` and `search.search_conversations("search-target-token-B")` each return at least one hit referencing this conversation.

**Fix:** investigate `backend/search.py` + `backend/cache.py:parse_jsonl_fast` + `_parse_content_blocks`. Likely cause is the search index path skipping non-text content blocks. If the bug shape is unclear after one investigation pass, file a follow-up note in this plan rather than thrashing — but the user expects a real fix here, not a defer.

#### Build-8 #2 — BLOCKER: credentials file `0o600` perms

**Failing test (committed first):** `fetcher/tests/test_credentials_perms.py` — pytest that calls the credentials-write code path (mock the Playwright capture; just exercise the file-write helper) into a tmp dir, then asserts `Path(creds).stat().st_mode & 0o777 == 0o600` and `Path(creds).parent.stat().st_mode & 0o777 == 0o700`.

**Fix:** `fetcher/playwright_capture.py:199-202` — set `umask(0o077)` around the write OR use `os.open(path, os.O_WRONLY|os.O_CREAT|os.O_TRUNC, 0o600)` then `os.chmod` afterward to be belt-and-suspenders. Also `os.chmod(parent, 0o700)`. Coordinate with `PLANS/cowork-multi-org.md` BLOCKER #2 (which adopts `portalocker` + `os.chmod`) so the fix lands once, not twice — but since cowork-multi-org isn't yet implemented, ship this fix here and let the cowork plan absorb / dedup when it lands.

#### Build-8 #3 — BLOCKER: port-conflict actionable error

**Failing test (committed first):** `fetcher/tests/test_port_conflict.py` — pytest that monkeypatches `uvicorn.run` to raise `OSError("[Errno 48] Address already in use")`, then invokes the `serve` CLI command and asserts `SystemExit` with a stderr message containing `"port"` AND `"--port"` (the suggested flag) AND the actually-conflicted port number.

**Fix:** `fetcher/cli.py:267-272` — wrap `uvicorn.run` in `try/except OSError` mapping address-in-use to a friendly stderr message and `sys.exit(1)`. Other `OSError`s re-raise.

#### Build-8 #4 — Help-modal Cmd/Ctrl glyph by platform

**Failing test (committed first):** `frontend/src/test/components/KeyboardHelpModal.test.tsx` — vitest that mounts the modal with `vi.stubGlobal('navigator', { platform: 'MacIntel' })` and asserts `⌘` glyph; then with `'Win32'` and asserts `Ctrl`.

**Fix:** `frontend/src/components/KeyboardHelpModal.tsx` — platform detect via `navigator.platform.startsWith('Mac')` (acceptable; `userAgentData.platform` exists but isn't widely supported yet).

#### Build-8 #8 — Esc closes Settings page

**Failing test (committed first):** `tests/e2e/settings-esc.spec.ts` — Playwright navigates to `/settings`, presses `Escape`, asserts URL changes back to the prior route.

**Fix:** `frontend/src/routes/SettingsPage.tsx` — `useEffect` keydown listener calling `navigate(-1)`. Cleanup on unmount.

#### Build-8 #10 — "Copy" → "Copy as Markdown" label rename

**Failing test (committed first):** `tests/e2e/copy-button-label.spec.ts` — Playwright opens any conversation, asserts a button with accessible name `"Copy as Markdown"` (currently `"Copy"`).

**Fix:** `frontend/src/routes/ConversationPage.tsx:289` (or wherever the button label currently lives) — string change.

#### Build-8 #11 — Repo rename to `rpeck/claude-explorer` (upstream only)

**No test.** One-shot infrastructure change.

- Run `gh repo rename claude-explorer -R rpeck/claude-desktop-message-exporter` (rename the GitHub remote).
- Update `git remote set-url origin git@github.com:rpeck/claude-explorer.git` locally.
- README badge URLs and the Part 1 / Part 2 article references (in `PLANS/articles/*`) updated to point at the new remote.
- **Do NOT rename the on-disk directory** (`/Users/rpeck/Source/claude-desktop-message-exporter`). Multiple shell aliases, editor projects, and possibly the `~/.claude/projects/-Users-rpeck-Source-claude-desktop-message-exporter/` JSONL store key off the current name. Renaming mid-Medium-series would invalidate the dogfooding setup the articles describe.
- **Do NOT rename `~/.claude-exporter/`** (the data directory). User has 89 Desktop conversations + JSONL caches there; a rename would force a re-fetch and risk losing the credentials file mid-cycle. Defer to a separate decision after the Medium series wraps.
- The README path-mismatch fix from Build-1 stays: docs reflect `~/.claude-exporter/` (the legacy path the code uses).

### v2 (deferred from this push)

- **Build-8 #5** — Per-message tool-block toggle. Per-bubble chevron on `tool_use` / `tool_result` blocks. Files: `frontend/src/routes/ConversationPage.tsx`, `MessageBubble`. Test: Playwright assertion that the chevron toggles a `data-collapsed` attribute on the bubble.
- **Build-8 #6** — Branch switching wire-up. `ConversationPage.tsx:350-353` `onSelectPath` callback → reload with `branchUuid` query param. Test: Playwright clicks a branch in the tree view, asserts URL updates and message stream changes.
- **Build-8 #7** — Dark-mode runtime breakage. Verify `.dark` class reaches `document.documentElement`; check Tailwind v4 config (`darkMode: "class"`); add Playwright `theme.spec.ts`. May require an investigation step first.
- **Build-8 #9** — Mobile responsive layout. `useMediaQuery("(max-width: 768px)")`; sidebar → shadcn `<Sheet>` slide-out drawer below breakpoint. Test: Playwright with mobile viewport asserts drawer behavior.

---

## Test plan (consolidated)

Per-feature unit + integration tests as listed above. Plus, at the v1-completion gate:

- **E2E Playwright suite (v1):** refresh-toast (success + sticky-error + Details), jump-buttons (visibility + repositioning), copy-button label, settings-Esc.
- **Backend pytest (v1):** credentials perms, port-conflict error mapping, search-in-tool-usage integration, claude-code title resolver against ≥6 fixtures, fetch-error mapping (401/403/cf-mitigated/credentials_age).
- **Frontend vitest (v1):** KeyboardHelpModal platform glyph.

v2 adds: bookmarks CRUD, filter modal + chip rail + pinning across reloads, URL-param navigation per route + combination, compact-marker keyboard nav + auto-vs-manual rendering, dark-mode toggle, mobile layout.

---

## Sequencing (commit cadence)

Each numbered v1 item above is one (or two — failing test, then fix) commit(s). The user reviews after each commit lands. Order is the v1 implementation table at the top.

After v1 is reviewed and tested by the user, this plan is reopened to address the v2 list.

---

## Risks / open items

- **Build-8 #1 risk:** the search-in-tool-usage bug shape is not fully diagnosed. If the failing test reveals the issue is in indexing rather than query parsing, the fix may grow in scope. Cap the spike at 90 minutes and surface findings as a comment on this plan if it threatens to balloon.
- **Build-8 #2 coordination with cowork-multi-org:** that plan also touches credentials writing. If the cowork work lands first, this fix is absorbed there. If this fix lands first (as ordered), cowork's credentials-write path must merge cleanly with the `0o600`-enforcing helper introduced here.
- **Build-1 path-mismatch:** the data dir is at the legacy `~/.claude-exporter/` path. v1 only updates docs. A future migration to `~/.claude-explorer/` is out of scope until the Medium series wraps.
- **Build-2 fixture sourcing:** the 6 golden JSONLs need to be small (≤200 lines each) to keep the test repo from bloating. Slice the original files to keep just the first user message + a few summary entries + the synthetic last-summary-wins target.
- **Build-7 manual classification window:** the lookahead window of 8 entries was tuned against one session (`a70251a5`). If user reports manual compacts being misclassified as auto, widen the window or refine the rule.

---

## Cross-references

- `PLANS/explorer-improvements-investigation.md` — Phase 1, all five items closed.
- `PLANS/cowork-multi-org.md` — coordinate with Build-8 #2 (credentials perms).
- `PLANS/part2_revision_followups.md` — items 1-11 absorbed into Build-8 above; mark "absorbed into explorer-improvements-build.md" once v1 ships.

---

## v2 backlog (deferred — to-do list for next session)

- Build-4 (bookmarks).
- Build-5 (sidebar filters; grammar finalized above).
- Build-6 (URL-parameter navigation; nouns and grammar finalized above).
- Build-7 (compact markers; auto + manual + user-prompt rendering finalized above).
- Build-8 #5 (per-message tool-block toggle).
- Build-8 #6 (branch switching wire-up).
- Build-8 #7 (dark-mode runtime breakage; may need investigation pass).
- Build-8 #9 (mobile responsive layout).
- "Force update single conversation" full implementation (the v1 stub from Build-1 may need extension).
- Bookmark tags (Build-4 v3, deferred further — Council called it a taxonomy bikeshed).
- Filter scopes beyond title (`project_path`, `source`).
- Backend filtering when message-content filtering needs it.
- Compact-marker right-rail minimap (low priority; Council recommends skip).
- "Collapse earlier messages" tied to compact markers.
- Filter sync across browsers via backend storage.
- Migration of `~/.claude-exporter/` → `~/.claude-explorer/` (post-Medium-series).
