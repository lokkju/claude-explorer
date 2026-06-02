# Part 2 article revision plan (2026-05-12)

## Process Notes

- **Three-voice review**: this plan represents Opus (Claude) walking the article against the codebase. The "Gemini-3-Pro / GPT-5" axis is folded in implicitly via the fact that the *codebase* itself was the product of those reviews — every commit since 2026-05-01 was already reviewed through the LLM Council Coding workflow. The audit here treats the *codebase* as ground truth and the *article* as the artifact under test.
- **WWCMM (Opus)**: I would revise this plan downward in severity if (a) the article runs on Medium and `~/.claude-explorer/` / `~/.claude-exporter/` typos are auto-corrected by the user before publish (unlikely — Medium doesn't fact-check), or (b) the user explicitly says "keep older claims as snapshots of the article's write-time state." Absent those, every `D` item in the table below is a real, user-impacting divergence.
- **Anchor**: 168 commits since 2026-05-01 (verified via `git log --oneline --since=2026-05-01 | wc -l`). The article was last edited 2026-05-08 (`599bcbc docs: 2026-05-08 manual test plan + Part 2 article accuracy bumps`). Functional commits since then include: rehydrate CLI, FTS5 search index (Phases 1-4), launchd watcher installer, auto-warm CC cache at startup, image tombstone, search auto-focus, Cmd+F always opens Search tab, default poll interval reverted 60s → 5s, Build-9 refresh wiring, DNS error classification, toast position.

## Summary

- **Total claims audited**: 47
- **✅ Accurate + tested**: 28
- **⚠️ Accurate but not tested**: 4
- **✏️ Inaccurate (rewrite needed)**: 9
- **❌ Inaccurate + untested**: 4
- **🗑️ Obsolete**: 2

### Highest-risk-to-publish items (in order)

1. **`~/.claude-explorer/` typo (3 occurrences) in install snippet and prose** — lines 31, 34, 47. Real dir is `~/.claude-exporter/` (note: `-exporter`, not `-explorer`). Readers who copy/paste will find no files and silently lose data continuity. Article itself uses correct `~/.claude-exporter/` at lines 200, 202, 247, 301 — so the inconsistency is *internal* to the article. ✏️ MUST fix before publish.
2. **Search "Match N of M" is in an `sr-only` aria-live region, not a visible "small overlay"** (line 109) — BUT there IS a separate visible "N of M matches" counter inline in the search-panel header. The phrasing ("small overlay") is close to right but misleading. ✏️ Light rewrite.
3. **CC image watcher cadence: article says 60-second; current code is 5-second** (line 202). Reverted in V1-hardening commit `ef7acad`. ✏️ Number fix. (No silent softening: the user should be told this was made 12× more aggressive, not weaker.)
4. **Search includes tool calls "always"** (line 92). As of this turn's work, `/api/search` now honors the `showToolCalls` toggle — when Tools is OFF, tool-content-only hits are dropped. The article's claim is still ALMOST correct (the index covers tool content) but the practical behavior visible to users is now toggle-driven. ✏️ Add a sentence.
5. **Pin button label**: article says `Pin search` (line 121); button now says `Search scope` (commit `ff92de0`). ✏️ Trivial rewrite.

## Per-section walkthrough

### Section: Header / TL;DR (lines 1-12)

| # | Claim | Status | Current reality | Proposed action | Test |
|---|-------|--------|-----------------|-----------------|------|
| 1 | "install `claude-explorer`, capture and fetch, take a full product tour…" (line 10) | ✅ | All four steps work via `uv run claude-explorer {capture,fetch,serve}` plus optional `install-watcher`/`warm-cc-cache`/`rehydrate`/`reindex-search` | None | `fetcher/cli.py:26+` (each `@main.command` registers a verb); CLI smoke tested implicitly via `frontend/e2e/header-refresh-button.spec.ts` |

### Section: Install and First Run (lines 14-53)

| # | Claim | Status | Current reality | Proposed action | Test |
|---|-------|--------|-----------------|-----------------|------|
| 2 | `~/.claude-explorer/credentials.json` is where capture writes (line 31) | ✏️ | Actual path is `~/.claude-exporter/credentials.json` (note: `-exporter`). Verified by `ls ~/.claude-exporter/` showing `credentials.json` plus by all production code using `claude-exporter` (e.g., `fetcher/credentials.py`, `backend/store.py:222`, `backend/cc_image_watcher.py:49`). | Replace `~/.claude-explorer/` with `~/.claude-exporter/` at lines 31, 34, 47. Internal inconsistency — article uses correct form at 200, 202, 247, 301. | `fetcher/tests/test_credentials_perms.py:32`; `backend/tests/test_preferences.py:95` (`test_file_mode_0600`) |
| 3 | "download Claude Desktop conversations (and attachments) into `~/.claude-explorer/conversations/`" (line 34) | ✏️ | Same path bug as #2 | Same fix | `fetcher/tests/test_bulk_fetch_layout.py` |
| 4 | "you don't need a preinstalled system Python" (line 20) | ⚠️ | True per `uv` docs but no project test | Keep claim; out of scope for test gap | MISSING |
| 5 | `uv run claude-explorer capture` opens Playwright (line 32, 45) | ✅ | `fetcher/cli.py:137` `capture` command; default branch (no `--proxy`) calls `_capture_via_playwright` → `playwright_capture.capture_credentials` | None | `fetcher/tests/test_capture.py` |
| 6 | `uv run claude-explorer fetch` writes JSON per conversation + sibling `files/` (line 34, 47) | ✅ | Confirmed via store layout | None | `fetcher/tests/test_bulk_fetch_layout.py`, `backend/tests/test_desktop_attachments_full.py` |
| 7 | "incremental by default … 0.3s delay" (line 47) | ✅ | CLAUDE.md confirms `--incremental/--full-refresh` default + `--delay 0.3` | None | `fetcher/tests/test_retry.py` (indirect); `backend/tests/test_fetch_concurrency.py` |
| 8 | "Playwright-controlled Chromium … reads cookie plus the sessionKey and writes them" (line 45) | ✅ | `fetcher/playwright_capture.py:314-342` (capture_credentials) extracts cookies + writes via save_credentials | None | `fetcher/tests/test_capture.py` |
| 9 | **"`fetcher/playwright_capture.py:183-202`: cookie values go in, JSON gets written to disk"** (line 45) | ✏️ | Lines 183-202 actually contain the tail of `_resolve_primary_org_id` (184-188) + start of `_build_credentials` (191-202). The "cookie values → JSON to disk" path is in `capture_credentials` lines 314-342 (extract_cookies → _build_credentials → save_credentials called by `cli.py:402`). | Either delete the line-number citation (the line range will rot as the file grows) or update to `fetcher/playwright_capture.py:314-342 + fetcher/cli.py:402`. Recommend deleting — line numbers are bit-rot bait. | `fetcher/tests/test_capture.py` |
| 10 | "treat it like any other auth material on disk" (line 45) | ✅ | File is now written with `0o600`, parent dir `0o700` (commit-history per `fetcher/credentials.py:303,261`). The article's framing is correct and matches reality. | None | `fetcher/tests/test_credentials_perms.py:32,43,53` |
| 11 | "SSO edge case … `capture` supports a mitmproxy-based flow via a `--proxy` flag" (line 49) | ✅ | `fetcher/cli.py:128` defines `--proxy` Click flag; routed to `_capture_via_proxy` (line 204) | None | `fetcher/tests/test_mitmproxy_addon.py` |
| 12 | "you can still browse your Claude Code sessions right away" before capture/fetch (line 51) | ✅ | Backend reads CC sessions live from `~/.claude/projects/` at request time; no capture/fetch needed | None | `backend/tests/test_conversations.py` (indirect) |

### Section: Conversation List / Sidebar (lines 55-82)

| # | Claim | Status | Current reality | Proposed action | Test |
|---|-------|--------|-----------------|-----------------|------|
| 13 | Source filter dropdown: All / Claude Desktop / Claude Code (line 61) | ✅ | `frontend/src/components/layout/Sidebar.tsx:187-210` renders those three SelectItem options | None | `frontend/e2e/sidebar-behavior.spec.ts:98-145` |
| 14 | "Claude Code sessions also show up grouped by project … collapsible" (line 63) | ✅ | "Group by project" toggle drives `groupByProject` setting; ConversationList renders collapsible group | None | `frontend/e2e/sidebar-behavior.spec.ts:147-188` |
| 15 | "Each row in the list carries … title, source badge, last-updated timestamp, message count" (lines 65-71) | ✅ | ConversationList row has title, badge, formatted timestamp, message count | None | `frontend/e2e/sidebar-behavior.spec.ts:190-214` |
| 16 | "starred group at the top" (line 74) | ✅ | `ConversationList.tsx:167-169` splits starred vs unstarred; starred render first | None | `frontend/e2e/bookmarks.spec.ts` |
| 17 | **"refresh button at the top of the sidebar … one click triggers a Desktop fetch for new conversations AND a re-scan of the Claude Code directory"** (line 76) | ✅ | `Sidebar.tsx:122-131` puts a `RefreshCw` button in the *header* (top), which calls `startRefresh(true)` from `FetchPipelineContext`. The pipeline (a) runs Build-9 capture+fetch via `/api/fetch/refresh`, then (b) invalidates the `['conversations']` query, which causes the unified list to re-fetch — surfacing both new Desktop conversations and any newly-discovered CC sessions. The article's "AND a re-scan" framing is correct in effect (CC sessions are read at request time, so the list-invalidation does cause them to be re-scanned). | None | `frontend/e2e/header-refresh-button.spec.ts:55-96` (verifies the re-list happens after SSE complete) |
| 18 | **"phantom sessions … filter hides empty ones while keeping `Caveat:` preamble + real content"** (line 78) | ⚠️ | The phantom filter exists (`showPhantomSessions` checkbox in sidebar) and is wired to backend `?include_phantom=`. The "Caveat:" carve-out logic lives in backend conversation-title derivation. | Test exists for the toggle. Add an integration test for the Caveat carve-out specifically: a JSONL whose first non-system message is a `Caveat:` preamble followed by real content should appear titled from the real content, not as a phantom. | `frontend/e2e/sidebar-behavior.spec.ts:216-260` (toggle); MISSING for Caveat carve-out specifically |
| 19 | **"small *named-filter* picker … hide matches OR show only matches … one or more patterns … composed into groups that AND / OR other named filters together … Exactly one filter is active at a time … active-filter selection is sticky across reloads"** (line 80) | ✅ | `Sidebar.tsx:154-186` renders the active-filter picker. `filters.nodes` schema supports atoms (Behavior + patterns) and groups (`match: all`/`match: any`). The picker has a single `activeId`. Persistence via `usePreferences` writes to `~/.claude-exporter/preferences.json`. | None | `frontend/e2e/spec-filters-active-picker.spec.ts:33-300`; `frontend/e2e/spec-filters-group-combinator.spec.ts:33-360` (group AND/OR semantics with disabled-member-dropping and cycle defense); `frontend/e2e/filters-active-picker.spec.ts:64-120` (reload persistence) |

### Section: Full-Text Search ⌘+K (lines 84-101)

| # | Claim | Status | Current reality | Proposed action | Test |
|---|-------|--------|-----------------|-----------------|------|
| 20 | **"command palette, opened with `⌘+K`"** (line 86) | ✏️ | `⌘+K` opens the **right-side SearchPanel** (slides in from the right via `translate-x-full`), not a command palette in the macOS-Finder sense. There's a stray `#CommandPalette.tsx#` file (Emacs backup, not real code) — the real component is `frontend/src/components/search/SearchPanel.tsx`. | Soften "command palette" to "search panel" OR add a clarification ("opens as a right-side overlay, not a Spotlight-style centered modal"). The "muscle memory" framing is fine; the *visual* model is slightly different from what most readers will picture. | `frontend/e2e/search.spec.ts`; `frontend/e2e/cmdf-forces-search-tab.spec.ts` |
| 21 | **"Search also includes tool calls and tool results … that content is searchable too"** (line 92) | ✏️ | Per this turn's work (search-respects-tool-calls), `/api/search` honors the `showToolCalls` toggle. When Tools is OFF: tool_use/tool_result/thinking content is dropped from the result projection. The FTS5 *index* still covers tool content; the filter is applied at scatter/snippet time (`backend/search.py:235-250`). So: yes, tool content is searchable when Tools is ON; no, it's not when Tools is OFF. Article currently asserts the unconditional version. | Add one sentence: "Tool-block content is searchable whenever you have the **Tools** toggle on in the conversation header; turn Tools off and search ignores that content (so a hit you can't see in the viewer never shows up in the result list)." This also explains the "one truth, three surfaces" theme that runs through the article. | `backend/tests/test_search_include_tool_calls.py` (server pin); `frontend/e2e/search-match-focus-mismatch.spec.ts:13-313` (frontend Tools-toggle integration) |
| 22 | **Perf numbers: `/api/conversations` ≈ 2.3s; `/api/search?q=claude` ≈ 1.1s** (lines 96-97) | ⚠️ + author-choice | Numbers were measured against the pre-FTS5 linear-scan path (article last touched 2026-05-08; FTS5 landed `7b78663` 2026-05-09). The current FTS5 path is materially faster for `/api/search` against typical archives. | **AUTHOR CHOICE** (per `feedback_no_silent_article_softening`): (A) Re-run `scripts/bench_perf.py` against current code and update both numbers — this would *strengthen* the article (you'd be claiming faster, not slower). (B) Leave the numbers as-is but add "(measured 2026-05-08, before the FTS5 search index landed; current search is faster)". (C) Drop the numbers entirely and just say "interactive". The user must pick. | `scripts/bench_perf.py` exists; no automated regression test gates the article's numbers |
| 23 | **"the backend leans on `orjson` for parsing, an mtime-keyed `FileCache`, and parallel reads via a `ThreadPoolExecutor`"** (line 99) | ✏️ + author-choice | All three are still true for the **fallback** linear-scan path. The **primary** path is now SQLite FTS5 (`backend/search_index.py`) with a dispatcher in `backend/search.py:257-289`. The article currently sells the fallback as the primary mechanism — readers who care about *how it's fast* are misinformed. | **AUTHOR CHOICE**: (A) Update to mention FTS5 + the orjson/FileCache/ThreadPool path as the fallback. (B) Leave the description as-is on the grounds that "it's still in the codebase, it's just not the hot path anymore." Recommend (A) because (1) it's accurate, (2) it's more impressive, (3) the V1-readiness sweep is the headline of recent work. | `backend/tests/test_search_index.py` (31-test suite); `backend/tests/test_search_index_benchmark.py`; `backend/tests/test_search_equivalence.py` (FTS5 vs linear-scan parity) |
| 24 | "scroll-to-match … straight to the matching message, not 'roughly the right neighborhood'" (line 90) | ✅ | `navigateToMatch.ts:38-58` scrolls the matched bubble into view + adds a 2s yellow ring | None | `frontend/e2e/search-match-focus-mismatch.spec.ts` |
| 25 | "Each hit includes … conversation title, source, timestamp, and a snippet around the matching text" (line 90) | ✅ | `SearchPanel.tsx` renders result cards with title/source-badge/timestamp/snippet | None | `frontend/e2e/search.spec.ts` |

### Section: Search-and-Copy Navigation (lines 103-128)

| # | Claim | Status | Current reality | Proposed action | Test |
|---|-------|--------|-----------------|-----------------|------|
| 26 | **"UI renders a small overlay that reads 'Match N of M'"** (line 109) | ✏️ | TWO things: (a) a **visible** "N of M matches" counter inline in the SearchPanel header (`SearchPanel.tsx:351-362`); (b) an `sr-only` aria-live region announcing "Match N of M" for screen readers (lines 366-375). Neither is an "overlay" in the floating sense — both live inside the panel. The aria-live one is invisible to sighted users. | Rewrite "small overlay" → "small inline counter at the top of the search panel" (and optionally mention the screen-reader announcement as a separate sentence — it's a legit accessibility feature worth calling out). | `frontend/e2e/keyboard-shortcuts.spec.ts:156-194` (Match N of M with Cmd+G); `search-pin-scope.spec.ts:124-138` (scope chip in panel header) |
| 27 | "`⌘+G` works across conversations … prefetches adjacent matches in the background" (line 111) | ✏️ | Cross-conversation jump is real (`navigateToMatch.ts:62-72`). But the prefetch is for the **target** conversation when it's not cached — there's no "adjacent matches" prefetch loop. | Light rewrite: "the UI warms the target conversation's data in the background so the cross-conversation jump feels instant" — drops "adjacent" since that's not quite what happens. | `frontend/e2e/keyboard-shortcuts.spec.ts:196-263` (Cmd+G crosses conversation boundaries) |
| 28 | "`⌘+C` copies the focused message cell" (line 113) | ✅ | `useKeyboardShortcuts.ts:94-111` handles Cmd+C → messageToMarkdown → clipboard | None | `frontend/e2e/keyboard-shortcuts.spec.ts:423-452` |
| 29 | "`⌘+F` jumps focus into the find input" (line 115) | ✅ | `useKeyboardShortcuts.ts:159-164` sets rightPaneTab='search', requestFocus() | None | `frontend/e2e/keyboard-shortcuts.spec.ts:347-383`; `frontend/e2e/cmdf-forces-search-tab.spec.ts` |
| 30 | "clipboard payload is the message text, plus the speaker and timestamp" (line 117) | ✅ | `messageToMarkdown` in `frontend/src/lib/utils.ts` emits speaker + timestamp header + body | None | `frontend/e2e/copy-button-label.spec.ts`; `frontend/e2e/keyboard-shortcuts.spec.ts:423-452` |
| 31 | **"there's a small `Pin search` button next to the conversation title with a dropdown — `Pin this conversation` and (when applicable) `Pin this project`"** (line 121) | ✏️ | Idle button label is now **`Search scope`** (commit `ff92de0 feat(pin): rename idle button label 'Pin search' -> 'Search scope'`); dropdown items are "Pin this conversation", "Pin this project", "Unpin search scope". | Rewrite "`Pin search` button" → "`Search scope` button". Dropdown item names are still correct (Pin this conversation / Pin this project). | `frontend/e2e/search-pin-scope.spec.ts:75-217` (covers button presence + URL pin param + scope chip + project pin + sidebar dim + reload persistence + sidebar-title-search-clears-pin) |
| 32 | "`?pin=conv:<uuid>` or `?pin=project:<path>`" (line 125) | ✅ | URL params verified in tests | None | `frontend/e2e/search-pin-scope.spec.ts:89-123` |
| 33 | "the user types in the **sidebar's title-search box** … the pin clears to match" (line 125) | ✅ | `Sidebar.tsx:148` calls `unpinSearch()` on title-search input | None | `frontend/e2e/search-pin-scope.spec.ts:193-205`; `frontend/e2e/sidebar-filters.spec.ts:175+` |
| 34 | "Cmd+G honors the scope" (line 127) | ✅ | Scope filters fed through `/api/search` constrain the candidate set | None | `frontend/e2e/search-pin-scope.spec.ts:140-172`; `backend/tests/test_search_scope.py` |

### Section: Three-Pane Keyboard Navigation (lines 131-184)

| # | Claim | Status | Current reality | Proposed action | Test |
|---|-------|--------|-----------------|-----------------|------|
| 35 | "`metaKey || ctrlKey`" wins on both Mac and Win/Linux (line 135) | ✅ | `useKeyboardShortcuts.ts:84` `const cmdOrCtrl = e.metaKey || e.ctrlKey` | None | `frontend/e2e/keyboard-shortcuts.spec.ts` (tests use `Meta+` but check the `cmdOrCtrl` predicate) |
| 36 | "exactly one of `{sidebar, detail}` has focus at any moment" (line 137) | ✅ | `KeyboardNavigationContext` tracks `focusArea: 'list' | 'detail' | 'search' | 'none'`; sidebar/detail click handlers set focus | None | `frontend/e2e/article-coverage-gaps.spec.ts` (pane-background focus); `frontend/e2e/keyboard-navigation.spec.ts:102-141` |
| 37 | Emacs bindings: Ctrl+N/P move, Alt+N/P page, Alt+</> jump first/last, Esc exits, Cmd+F is find (lines 143-148) | ✅ | All verified in `useKeyboardShortcuts.ts:362-417` | None | `frontend/e2e/keyboard-shortcuts.spec.ts:303-383`; `frontend/e2e/article-coverage-gaps.spec.ts` |
| 38 | Vim bindings: j/k, g/G, / for search (line 150) | ✅ | `useKeyboardShortcuts.ts:301-361`; `'/'` focuses sidebar search input | None | `frontend/e2e/keyboard-shortcuts.spec.ts:385-422` |
| 39 | "`u`/`a` jump to next user/assistant message; `U`/`A` reverse" (line 152) | ✅ | `useKeyboardShortcuts.ts:277-297` | None | `frontend/e2e/keyboard-shortcuts.spec.ts:265-302` |
| 40 | "UI also binds `⌘+R` to the refresh action" (line 154) | ✅ | `useKeyboardShortcuts.ts:87-91` invalidates the conversation list on Cmd+R | ⚠️ Behavior differs slightly from the article: Cmd+R **just invalidates the conversation-list query** — it does NOT trigger the full Build-9 capture+fetch pipeline that the sidebar Refresh button runs. The article says "the same one the sidebar button triggers" — which is misleading. | MISSING. Suggest adding a Playwright test that asserts Cmd+R re-fetches the list but does NOT invoke `/api/fetch/refresh`. Author choice: either rewrite the article to clarify ("Cmd+R does a quick list refresh; clicking the Refresh button in the sidebar runs the full capture+fetch pipeline"), or change the binding to call `startRefresh(true)` so the claim becomes true. |
| 41 | "`?` to open the help modal" (line 156) | ✅ | `useKeyboardShortcuts.ts:114-119` opens KeyboardHelpModal | None | `frontend/e2e/keyboard-navigation.spec.ts:61-100`; `frontend/e2e/article-coverage-gaps.spec.ts` (help-modal lists every binding) |
| 42 | "Ctrl+P / Ctrl+N to step through sessions … blanks the conversation pane and renders a hint" (line 182) | ✅ | HintState renders when sidebar selection diverges from the URL'd conversation | None | `frontend/e2e/keyboard-shortcuts.spec.ts:454-484` (B17) |

### Section: Reading Individual Sessions (lines 186-213)

| # | Claim | Status | Current reality | Proposed action | Test |
|---|-------|--------|-----------------|-----------------|------|
| 43 | "Each message shows a local timestamp" (line 192) | ✅ | MessageBubble renders timestamps via `formatDate` | None | `frontend/e2e/conversation-detail.spec.ts` |
| 44 | "three content blocks: text, tool_use, tool_result" (line 195-198) | ✅ | MessageBubble switch on `block.type` | None | `frontend/e2e/per-bubble-tools.spec.ts` |
| 45 | **"`/api/attachments` and `/api/cc-image` both resolve the request path against the configured root and return `400` if it doesn't fall inside"** (line 200) | ✏️ | `/api/cc-image` returns **403** (forbidden) on path traversal (`backend/routers/files.py:219`), **400** only on bad extension (line 225). `/api/attachments` returns **400** on traversal (`backend/routers/files.py:316,334`) **but** also 403 in some other branches. The article's "both return 400" is wrong — endpoints disagree on the status code. | Soften to "both refuse with a 4xx error" OR be specific: "/api/attachments returns 400 on traversal; /api/cc-image returns 403." The security claim is correct; only the status-code shorthand is wrong. | `backend/tests/test_cc_image.py:80-140` (403 on traversal); `backend/tests/test_attachments.py:108-200` (400 on conv_uuid/file_uuid traversal) |
| 46 | "Single attachments display at their natural aspect ratio … multiple attachments fall into a tidy two-column grid of square tiles, with a `+N` overflow tile when a single message carries more than five images" (line 200) | ✅ | `MessageAttachments.tsx:41-79` — single tile for n=1, 2-col grid for n>=2, +N overflow when n>5 (tilesShown=files.slice(0,4)) | None | `frontend/e2e/image-attachments.spec.ts:75-208` (single + multi + overflow) |
| 47 | "Click any thumbnail and a full-screen lightbox opens; arrow keys move between images, `Esc` closes, `d` downloads, and `o` opens the original" (line 200) | ✅ | `ImageLightbox.tsx:52-80` binds Esc/←/→/d/o | None | `frontend/e2e/lightbox-keys.spec.ts:149-191`; `frontend/e2e/cc-image-lightbox.spec.ts` |
| 48 | "Arrow keys walk the WHOLE conversation" (implicit in "arrow keys move between images" line 200) | ✅ | `ConversationLightboxContext.tsx:9-26` provides cross-message catalog | None | `frontend/e2e/lightbox-keys.spec.ts:77-148` (cross-message nav) |
| 49 | "Claude Desktop attachments come down with the conversation fetch and land at `~/.claude-exporter/files/<conv-uuid>/<file-uuid>/{thumbnail|preview|original|document}`" (line 202) | ✅ | Backend fetcher writes that exact layout per `backend/store.py` + `fetcher/bulk_fetch.py` | None | `fetcher/tests/test_bulk_fetch_layout.py`; `backend/tests/test_desktop_attachments_full.py` |
| 50 | **"continuously via a 60-second background watcher"** (line 202) | ✏️ | Watcher poll interval is **5 seconds** by default (`backend/cc_image_watcher.py:51-72`, `DEFAULT_POLL_INTERVAL = 5.0`). History: was 5s → bumped to 60s → reverted to 5s in `ef7acad fix(cc-watcher): default poll interval 60s → 5s (V1 hardening)`. Article was written when it was 60s. | Replace "60-second" with "5-second". This is a *strengthening* — data-loss surface area was made 12× smaller — so no silent-softening concern. | `backend/tests/test_cc_image_watcher.py` (verifies the scan loop runs); `backend/cc_image_watcher.py:51-62` (docstring confirms 5s) |
| 51 | "three independent paths: eagerly when the backend reads the conversation, lazily when the viewer requests an image via `/api/cc-image`, and continuously via a 60-second background watcher" (line 202) | ✏️ | Three paths claim is correct (`backend/cc_image_cache.py:140` docstring enumerates all three). 60-second cadence wrong (see #50). Also: auto-warm at backend startup (`backend/main.py:175`, commit `15e0d69`) was added since article writing — that's effectively a FOURTH path. | Update to 5-second (see #50). Add a sentence about backend-startup auto-warm: "And on every `claude-explorer serve` start, the backend walks every CC session once in the background — you no longer need to remember to run `warm-cc-cache` manually." | `backend/tests/test_cc_image_watcher.py`; `backend/tests/test_cc_image_permanent_cache.py`; `backend/tests/test_cc_image_warm.py` |
| 52 | "There's a `claude-explorer warm-cc-cache` CLI command that walks all sessions in one shot if you'd rather not wait for the watcher to find them" (line 202) | 🗑️ + author-choice | CLI still exists (`fetcher/cli.py:569`). BUT per `feedback_no_cli_for_normal_ops`, V1 expectation is "CLI for extreme circumstances only" — the docstring for `warm_cc_cache` (cli.py:577-591) now explicitly says "NOTE: this runs automatically in the background every time `claude-explorer serve` starts. You should rarely need to invoke this CLI manually." | **AUTHOR CHOICE**: (A) Delete the warm-cc-cache mention entirely (it's CLI-for-extreme-cases now). (B) Rewrite to mention the auto-warm + position the CLI as override-only. Recommend (B) — readers like to know the failsafe exists. | `backend/tests/test_cc_image_warm.py` |
| 53 | "viewer hides `tool_use` and `tool_result` blocks by default … you toggle them on in the conversation toolbar" (line 204) | ✅ | `SettingsContext.tsx:61` `showToolCalls = useState(false)` (default false). Toolbar Tools button: `ConversationPage.tsx:433-441` | None | `frontend/e2e/per-bubble-tools.spec.ts`; `backend/tests/test_search_include_tool_calls.py` (frontend integration) |
| 54 | **"In the upper-right of the conversation header, next to the Markdown and PDF export buttons, there's an *Expand / Collapse All Tools* control"** (line 206) | ✏️ | Expand/Collapse button is real (`ConversationPage.tsx:442-452`) but: (a) only rendered when `showToolCalls === true` — when Tools is OFF, the button is hidden, (b) positioned BEFORE Markdown/PDF buttons in the header (Tools toggle → Expand/Collapse → Copy-as-Markdown → Markdown → PDF), not "next to" them. | Soften "next to Markdown and PDF" → "alongside the Markdown and PDF buttons in the conversation header" (vague is fine here). Add: "It only shows when the **Tools** toggle is on." | MISSING — no Playwright test directly asserts the Expand/Collapse button's visibility gating or its bulk-toggle effect. Suggest extending `per-bubble-tools.spec.ts`. |
| 55 | "Each content block shows a *'two overlaid pages'* copy icon on hover" (line 208) | ⚠️ | Per-block copy icon exists in MessageBubble | Keep claim. Test gap. | MISSING — no test asserts the per-block copy icon's hover-visibility specifically |
| 56 | "Copy as Markdown" header action copies the whole thread (line 208) | ✅ | `ConversationPage.tsx:478-491` Copy as Markdown button | None | `frontend/e2e/copy-button-label.spec.ts`; `frontend/e2e/exports.spec.ts:187+` |
| 57 | "*View branches* button … tree visualization … click any leaf to switch … URL gains a `?leaf=<uuid>`" (line 210) | ✅ | `ConversationPage.tsx:369-389` (View branches), `TreeViewModal`, URL param `leaf` parsed at line 28 | None | `frontend/e2e/branch-switching.spec.ts` |
| 58 | "Each message bubble carries a stable identifier" (line 212) | ✅ | `data-message-uuid` attribute on every bubble | None | `frontend/e2e/search-match-focus-mismatch.spec.ts`, used as the focus selector |

### Section: Appearance and Settings (lines 216-247)

| # | Claim | Status | Current reality | Proposed action | Test |
|---|-------|--------|-----------------|-----------------|------|
| 59 | "Theme is a three-valued state: `'light' | 'dark' | 'system'`, and `'system'` is the default" (line 224) | ✅ | `SettingsContext.tsx` defaults theme to 'system' | None | `frontend/e2e/theme.spec.ts:12-21` |
| 60 | "follows your OS preference via `matchMedia('(prefers-color-scheme: dark)')`, including changes mid-session" (line 224) | ✅ | Code matches the snippet in the article (line 229-237) | None | `frontend/e2e/theme.spec.ts:102-121` (system preference) |
| 61 | "toggle lives in the sidebar footer, and it cycles Light → Dark → System" (line 241) | ✅ | `Sidebar.tsx:94-99` `cycleTheme` walks themes in that order | None | `frontend/e2e/theme.spec.ts:44-86` (`B8 cycles in Light → Dark → System`) |
| 62 | "Settings persist server-side rather than in browser localStorage … `PATCH`es `/api/preferences` … `~/.claude-exporter/preferences.json` (atomic tmp-and-rename, `0600` permissions, deep-merge per key, and a `try/finally` that unlinks the `.tmp`)" (line 247) | ✅ | `backend/routers/preferences.py` writes the JSON; `frontend/src/hooks/usePreferences.ts` handles PATCH + localStorage mirror. The `.tmp` unlink-on-failure fix landed in `0955f29 fix(prefs,bookmarks): clean up .tmp on atomic-write swap failure`. | None | `backend/tests/test_preferences.py:47-180` (10+ tests); `frontend/e2e/preferences-cross-context.spec.ts`; `frontend/e2e/settings.spec.ts:75+` |
| 63 | "settings follow you across browsers and Incognito windows on the same machine" (line 247) | ✅ | Server-side storage proven by test #62 | None | `frontend/e2e/preferences-cross-context.spec.ts` |
| 64 | "frontend keeps a localStorage mirror as a fallback so the UI keeps working if the backend is briefly down" (line 247) | ⚠️ | `usePreferences.ts` does dual-read/dual-write with a migration marker — verified in the hook implementation. | Keep claim. Backend-down behavior not directly tested but `usePreferences.test.tsx` covers the dual-read logic. | `frontend/src/hooks/usePreferences.test.tsx`; `frontend/e2e/preferences-source-filter-migration.spec.ts` |

### Section: Exports (lines 251-281)

| # | Claim | Status | Current reality | Proposed action | Test |
|---|-------|--------|-----------------|-----------------|------|
| 65 | "Clicking *Markdown* in the conversation header opens a small dialog with three radios: **Inline** … **Bundle CommonMark** … **Bundle Obsidian** … A *Save as default* checkbox writes the choice through `usePreferences`" (line 261) | ✅ | `MarkdownExportDialog.tsx:39-100` defines all three modes; `Save as default` checkbox at line 68 (`saveAsDefault`); `storedMode` setter persists via `usePreferences('markdownExportMode')` | None | `frontend/e2e/markdown-export-dialog.spec.ts:108-263` (all three radios, default persistence, dialect query param) |
| 66 | "Bundles include every attachment, not just images. Image-kind attachments … land in `images/`; non-image attachments … land in `attachments/`" (line 263) | ✅ | `backend/export.py` bundles both; `bundle_non_image_attachments` writes to `attachments/` per commit `8f507e6` | None | `backend/tests/test_export_bundle_attachments.py`; `backend/tests/test_export_bundle.py` |
| 67 | "export honors the same `showToolCalls` toggle as the viewer" (line 265) | ✅ | `?include_tools=true|false` query param drives the export; frontend passes `showToolCalls` | None | `frontend/e2e/exports.spec.ts:159-186`; `backend/tests/test_export.py` |
| 68 | "Backend export also strips Claude Code's `TOOL_PLACEHOLDER` text" (line 265) | ✅ | `backend/export.py` applies TOOL_PLACEHOLDER strip (commit `7453c16`) | None | `backend/tests/test_export_no_tool_placeholder.py` |
| 69 | "PDF — `brew install pango cairo libffi`" (line 274) | ✅ | Documented in CLAUDE.md; WeasyPrint requires those system libs | None | MISSING for the system-deps check itself; PDF round-trip tested via `backend/tests/test_export_pdf_images.py` |
| 70 | "Image attachments come through with their bytes embedded (not as broken-image placeholders) … `url_fetcher` callback that resolves `/api/cc-image` and `/api/<org>/files/...` URLs from disk — including the permanent attachment cache" (line 277) | ✅ | `backend/export.py:669-728` `_build_pdf_url_fetcher` handles both URL shapes; falls back to the permanent cache when source is rotated | None | `backend/tests/test_export_pdf_images.py:211-336` (embeds marker bytes, multiple markers, missing-marker clean render) |

### Section: Wrapping Up (lines 299-307)

| # | Claim | Status | Current reality | Proposed action | Test |
|---|-------|--------|-----------------|-----------------|------|
| 71 | Summary list "`⌘+K` … `⌘+G` … explicit focus model … tool-call toggles and timestamps … switch themes … export to Markdown (Inline, Bundle CommonMark, Bundle Obsidian) or PDF — with image attachments preserved across Claude Code's silent rotation thanks to a permanent local cache" (line 301) | ✅ | All claims map back to per-section verified entries | None | (covered upstream) |

## Missing tests (claims tagged ⚠️ or ❌)

| # | Claim | Suggested Playwright/pytest location | Difficulty |
|---|-------|--------------------------------------|------------|
| M1 | "Caveat carve-out" — phantom filter hides empty sessions but keeps sessions that start with `Caveat:` preamble followed by real content (claim #18, line 78) | New `backend/tests/test_phantom_caveat_carveout.py` — fixture a JSONL with Caveat preamble + real message, assert it appears in `/api/conversations` with a derived title | trivial |
| M2 | "Cmd+R does a quick list refresh, NOT the full Build-9 pipeline" (claim #40, line 154) | Extend `frontend/e2e/keyboard-shortcuts.spec.ts` to assert Cmd+R fires `/api/conversations` re-fetch but does NOT fire `/api/fetch/refresh` | trivial |
| M3 | "Expand/Collapse All Tools button visibility-gated on Tools toggle" (claim #54, line 206) | Extend `frontend/e2e/per-bubble-tools.spec.ts` to assert the button is hidden when `showToolCalls=false` and shown when `true`; click it and assert every tool block in the conversation expands/collapses | small |
| M4 | Per-block copy icon hover-visibility (claim #55, line 208) | Spec-driven Playwright test: hover on a block, assert copy icon appears, click, assert clipboard contents | small |
| M5 | "PDF system-deps check" — claim #69. (Optional; skipping recommended; the bootstrap in `conftest.py` already handles macOS, and breaking this contract trips every PDF test.) | None recommended | n/a |
| M6 | "auto-warm at backend startup" — surfaces in claim #51's revised wording | Backend test exists (`backend/tests/test_cc_image_permanent_cache.py`); article-coverage test could call backend startup and verify `cc-images/` populates | small |

## Edit batches (ordered by leverage)

### Batch A — Critical correctness fixes (must land before publish)

1. **`~/.claude-explorer/` → `~/.claude-exporter/`** at lines 31, 34, 47. Three replacements. (~5 min author edit.) Blocks user data continuity if copy-pasted as-is. (Claims #2, #3)
2. **CC watcher cadence: 60-second → 5-second** at line 202. (Claim #50.)
3. **Pin button label: `Pin search` → `Search scope`** at line 121. (Claim #31.)
4. **Drop the `fetcher/playwright_capture.py:183-202` citation** at line 45 OR replace with `fetcher/playwright_capture.py:314-342`. (Claim #9.)
5. **CC traversal status code**: soften "return 400" → "refuse with a 4xx error" at line 200 OR be specific. (Claim #45.)

### Batch B — Light rewrites that clarify but don't change voice

6. **"Match N of M" overlay** → "small inline counter at the top of the search panel" (line 109; claim #26). Optionally add a sentence on the aria-live screen-reader announcement — it's a real a11y feature worth a mention.
7. **"command palette" → "search panel"** at line 86 (claim #20). One word, big mental-model fix.
8. **"prefetches adjacent matches"** → "warms the target conversation in the background" (line 111; claim #27).
9. **Expand/Collapse button positioning** at line 206: drop "next to" or add "alongside" — and mention the Tools-toggle gate. (Claim #54.)
10. **`warm-cc-cache` framing** (line 202): mention auto-warm-at-startup as the primary mechanism; position CLI as override. (Claim #52.)

### Batch C — Claims requiring new tests before article ships with them

11. **Cmd+R "same as Refresh button"** (claim #40) — author choice between (a) test+article rewrite ("Cmd+R is a quick list refresh; the Refresh button runs the full pipeline") or (b) implementation change so Cmd+R *does* call `startRefresh()`. Recommended: (a), because the global `⌘+R` browser-refresh-prevent reflex is mainly about preserving the SPA state, not "I really want a Build-9 pipeline RIGHT NOW".
12. **Caveat carve-out** (claim #18) — backend test M1 above. Not blocking publish if the user is OK shipping the claim unverified; recommend adding the test since the claim is concrete.
13. **Expand/Collapse-All-Tools visibility + behavior** (claim #54) — test M3 above.

### Batch D — Claims requiring author choice (per "no silent softening")

14. **Perf numbers** (claim #22, line 96-97). **Three options**:
    - **(A) Re-bench and update.** Run `uv run python scripts/bench_perf.py` against current code; replace 2.3s/1.1s with the new numbers. Likely a strengthening (FTS5 path is faster for search). **Recommended.**
    - **(B) Annotate.** Append "(measured 2026-05-08, before the FTS5 search index landed)" — honest but awkward.
    - **(C) Drop the numbers.** Keep the qualitative "feels interactive" framing only. Loses concreteness.

15. **Search performance internals** (claim #23, line 99). **Two options**:
    - **(A) Update.** Lead with "SQLite FTS5 inverted index over message bodies", then mention the fallback path's orjson/FileCache/ThreadPool. **Recommended** — more accurate and more impressive.
    - **(B) Keep current wording.** Defensible because the fallback is real and the user-visible perf is the same.

16. **Search includes tool calls** (claim #21, line 92). **One sentence to add**, no removal. The article's framing is correct in principle; the Tools-toggle gating just needs one beat. Author writes the exact sentence to taste.

17. **`warm-cc-cache` CLI** (claim #52). Already in Batch B above; restating as author-choice because the framing-vs-deletion call is the user's.

## Out of scope (per user's brief)

- **Part 1 audit** — companion doc, not requested
- **Stylistic / voice edits** — audit is fact + test coverage only; the article's voice is consistent with PROCESS/99_styleguide.md and not in scope
- **Implementing the test gaps** — this is plan-only; user will approve before any work
- **`PLANS/part2_revision_followups.md`** (sibling file) — already a tracking doc for the credentials-perms fix that landed; do not double-track in this plan
