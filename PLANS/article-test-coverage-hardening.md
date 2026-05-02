# Article ↔ Test Coverage Audit + Test-Hardening Plan

## Context

`PLANS/articles/part_2_web_app.md` is a Medium-series draft describing the Claude Explorer UI. It was written before this session's bug-fix sweep, so several of its claims either describe behavior we shipped **after** the article was drafted, or describe behavior the code *still* doesn't actually have. The goal of this plan is to (1) make every UI claim in the article true, (2) lock each true claim in with an explicit Playwright test, and (3) ship a corrected article.

Audit scope: every UI assertion in the article (≈30 claims spanning sidebar, search, keyboard nav, conversation detail, theme, settings, exports). Findings cross-validated by an LLM Council (Gemini 3 Pro + GPT-5.2-pro), which caught two article/code mismatches I missed (A5, A6) and one false-positive in my audit (A2 already exists).

---

## Tier A — Article ↔ Code mismatches (decide: fix code or fix article)

| # | Claim | Reality | Decision |
|---|---|---|---|
| A1 | Image content blocks render in transcript (article line 180) | `MessageBubble.tsx` `ContentBlockRenderer` returns `null` for `image` blocks. Silently dropped. | **FIX CODE** (data-loss bug). Render `<img>` with `max-width:100%`, `alt` from source field. **Viewer-only**; export parity is a follow-up. |
| A2 | "Hit Enter to select this conversation" hint when stepping with Ctrl+P/N (article line 163) | **Already implemented** at `ConversationPage.tsx:222-225` + `HintState()` line 568. (Verified.) | **DOWNGRADE to Tier B** — write a test for the existing behavior. |
| A3 | Search prefetches **±2** adjacent matches (article line 104) | `navigateToMatch.ts:65` only prefetches the single current match. | **FIX ARTICLE** to "prefetches adjacent matches" (drop the numeric promise). Add a small unit test around `navigateToMatch` behavior so the docs claim is at least loosely backed. |
| A4 | Source filter labels are "All / Desktop / Code" (article line 61) | Actual labels: "All Conversations / Claude Desktop / Claude Code" (`Sidebar.tsx:130-146`). | **FIX ARTICLE** with literal strings. |
| A5 | Emacs `Ctrl+F / Ctrl+B` page (article line 127) | `Ctrl+F` toggles SearchPanel (`useKeyboardShortcuts.ts:130`); `Ctrl+B` doesn't exist; actual paging is `Alt+N / Alt+P` (lines 344-351). | **FIX ARTICLE** to reflect actual Emacs paging keys. |
| A6 | Vim `gg` jumps to top (article line 131) | Code handles single `g`, not `gg` (lines 269-275, 303-309). | **FIX ARTICLE** to single `g` (smaller change than implementing stateful `gg`). |

---

## Tier B — Article-true claims that lack Playwright coverage

Group | # | Claim | Notes
--- | --- | --- | ---
**Sidebar** | B1 | Source filter actually filters (Desktop / Code switch) | New test
| B2 | Project grouping is collapsible (CC sessions) | New test
| B3 | Sidebar row shows badge + formatted timestamp + message count | New test
| B4 | Starred group renders at top in flat AND grouped views | Extend existing `conversations.spec.ts`
| B5 | Refresh button triggers Desktop fetch + CC re-scan in one click | Extend `header-refresh-button.spec.ts`
| B6 | Phantom session toggle: hidden by default; toggle reveals | New test
| B7 | Caveat sessions with content stay visible, titled from first non-system message | New test
| B8 | Theme cycle order Light → Dark → System | Extend `theme.spec.ts`
| B9 | Cmd+R triggers refresh, prevents browser reload | Extend `keyboard-navigation.spec.ts`
**Search/Keyboard** | B10 | Cmd+G next / Cmd+Shift+G prev within conversation | Extend `keyboard-navigation.spec.ts`
| B11 | Cmd+G crosses conversation boundaries | Extend `keyboard-navigation.spec.ts`
| B12 | "Match N of M" overlay updates on navigation | Extend `keyboard-navigation.spec.ts`
| B13 | u/a jump next user/assistant; U/A reverse | Extend `keyboard-navigation.spec.ts`
| B14 | Emacs Ctrl+N/P movement, Alt+N/P paging (article-corrected) | Extend `keyboard-navigation.spec.ts`
| B15 | Vim j/k movement, g/G jump (article-corrected) | Extend `keyboard-navigation.spec.ts`
| B16 | Cmd+C copies focused message + speaker + timestamp; tool block verbatim if visible | Extend `keyboard-navigation.spec.ts`. **Requires clipboard permissions.**
| B17 | "Hit Enter" hint shows when sidebar selection differs from loaded detail (downgraded A2) | Extend `keyboard-navigation.spec.ts`
| B18 | data-allow-shortcuts: Cmd+K/F/G/Esc work while SearchPanel input has focus | Extend `keyboard-navigation.spec.ts`
**Detail/Export** | B19 | Header "Expand/Collapse All Tools" toggles every tool block | Extend `per-bubble-tools.spec.ts`
| B20 | Per-block hover-revealed copy icon copies that block | Extend `per-bubble-tools.spec.ts`
| B21 | `showToolCalls` toggle honored across viewer + clipboard + Markdown export + PDF export | Extend `per-bubble-tools.spec.ts` + new `exports.spec.ts`
| B22 | Search-result click jumps to specific message UUID | New `search-match-navigation.spec.ts`
| B23 | Local timestamps appear on BOTH user AND assistant messages | New `conversation-detail.spec.ts`
| B24 | Markdown export endpoint produces clean .md (assert content shape) | New `exports.spec.ts`
| B25 | PDF export endpoint produces a real PDF (Content-Type, magic bytes) | New `exports.spec.ts`
| B26 | Export endpoints honor `?include_tools=true|false` | New `exports.spec.ts`
| B27 | View branches button renders tree visualization (read-only) when `has_branches` | Verify existing `branch-switching.spec.ts` is sufficient; add gap tests if not

---

## Phases

### Phase 0a — Foundation: shared Playwright fixture (1 commit)

Create `frontend/e2e/fixtures.ts` exporting a `test.extend` fixture that:
- grants `clipboard-read` + `clipboard-write` browser context permissions (required for B16),
- centralizes `mockBackend()` (currently duplicated in `redownload-conversation.spec.ts`, `per-bubble-tools.spec.ts`, etc.),
- exports typed mock builders that match backend Pydantic schemas (`ConversationSummary`, `MessageNode`, etc.) — import the actual TS types from `frontend/src/lib/types.ts` so mock drift surfaces as compile errors,
- wraps every spec's `test()` so the same fixture applies repo-wide.

Replace the ad-hoc `mockBackend` definitions in existing specs as a follow-up cleanup (out of scope here unless trivial).

### Phase 0b — Article-only corrections (1 commit, docs-only)

Apply A3, A4, A5, A6 to `PLANS/articles/part_2_web_app.md`:
- A3: replace "±2 adjacent matches" with "adjacent matches"
- A4: replace short labels with literal labels
- A5: replace `Ctrl+F / Ctrl+B page` with actual Emacs paging (`Alt+N / Alt+P`); note `Ctrl+F` toggles SearchPanel
- A6: replace `gg` with `g`

This unblocks Phase 1 from chasing claims we already know are wrong.

### Phase 1 — Write Tier B tests (4 commits, batched by area)

**Commit 1 — Sidebar batch (B1-B9):**
- Extend `conversations.spec.ts` for B4
- New `sidebar-behavior.spec.ts` for B1, B2, B3, B6, B7
- Extend `header-refresh-button.spec.ts` for B5
- Extend `theme.spec.ts` for B8
- Extend `keyboard-navigation.spec.ts` for B9

**Commit 2 — Keyboard batch (B10-B18):** all extensions to `keyboard-navigation.spec.ts` (it already has Vim + Emacs `describe` blocks). Use the shared fixture's clipboard permissions for B16.

**Commit 3 — Detail/Export batch (B19-B27):**
- Extend `per-bubble-tools.spec.ts` for B19, B20, B21 (viewer half)
- New `search-match-navigation.spec.ts` for B22
- New `conversation-detail.spec.ts` for B23, B27
- New `exports.spec.ts` for B24, B25, B26 + B21 (export half)

**Commit 4 — Triage RED tests:** for every test that fails, decide fix-test vs fix-code; commit the fix in a separate small commit.

Test-design guardrails (from Council):
- **Always assert focus before next keystroke**: `await expect(locator).toBeFocused()` between `page.keyboard.press` calls.
- **No `waitForTimeout`** — wait on UI state, network, or URL changes.
- **Scroll-to-match assertions** use bounding-box "in viewport" rather than smooth-scroll timing.
- **Hover-only icons** (B20) require `await locator.hover()` before assertion.

### Phase 2 — A1 image rendering (1 commit + test)

Implement `image` content block in `MessageBubble.tsx` ContentBlockRenderer:
- For Desktop API attachments: render `<img src={url} alt={alt_text || 'image'} className="max-w-full rounded" />`
- For inline base64 / data-URI cases: same but with `src={data:...}`
- Add Playwright fixture with image-bearing message; assert the `<img>` renders with non-zero size.
- **Out of scope** (defer): export parity, lightbox, thumbnail preprocessing.

### Phase 3 — Final article reconciliation (1 commit, docs-only)

Walk every numbered claim in `part_2_web_app.md` and confirm it maps to a green test. For any claim still unsupported:
- add the missing test (if cheap), **or**
- **STOP and ask the user.** Never silently soften or remove an article claim. The user is the author; they decide whether to fix code, fix article, or leave the gap. Surface the gap with proposed options; do not edit the article unilaterally.

---

## Critical files

**Test infrastructure:**
- `frontend/e2e/fixtures.ts` — new (Phase 0a)
- `frontend/e2e/test-utils.ts` — existing helper, may absorb / be absorbed
- `frontend/e2e/keyboard-navigation.spec.ts` — major extension target
- `frontend/e2e/per-bubble-tools.spec.ts`, `theme.spec.ts`, `header-refresh-button.spec.ts`, `conversations.spec.ts`, `branch-switching.spec.ts` — extension targets

**New spec files (4 total):**
- `frontend/e2e/sidebar-behavior.spec.ts`
- `frontend/e2e/search-match-navigation.spec.ts`
- `frontend/e2e/conversation-detail.spec.ts`
- `frontend/e2e/exports.spec.ts`

**Code under test:**
- `frontend/src/components/layout/Sidebar.tsx` (filters, refresh, theme cycle, project grouping)
- `frontend/src/hooks/useKeyboardShortcuts.ts` (all keyboard tests)
- `frontend/src/components/conversation/MessageBubble.tsx` (image rendering, copy, timestamps)
- `frontend/src/routes/ConversationPage.tsx` (HintState, header buttons, branch view)
- `frontend/src/lib/navigateToMatch.ts` (search-match navigation, prefetch unit test)
- `backend/routers/export.py` + `backend/export.py` (Markdown/PDF export endpoints)

**Article:**
- `PLANS/articles/part_2_web_app.md` (Phase 0b corrections + Phase 3 final pass)

**Plan persistence:**
- `PLANS/article-test-coverage-hardening.md` — write the final plan into the repo's PLANS dir (mirror of this harness plan) so it's discoverable from the repo, per project convention.

---

## Verification

After Phase 1:
```bash
cd frontend && npm run test:e2e -- --reporter=list
```
Expected: every Tier B claim is covered by ≥1 explicit test; no `waitForTimeout` calls in new specs; clipboard tests pass headless.

After Phase 2:
```bash
cd frontend && npm run test:e2e -- conversation-detail.spec.ts
```
Expected: image-rendering test passes against fixture with image content block.

After Phase 3:
- Manual: re-read `PLANS/articles/part_2_web_app.md`; every claim numbered in this plan maps to a passing test in the suite.
- `npm run test:e2e` clean on main.

---

## Risks / open items

- **A1 export parity deferred** — image blocks will render in viewer but be silently dropped from Markdown/PDF exports. The article's "one truth, three surfaces" claim (line 186, 239) becomes false for images specifically. **Surface to user before editing the article**; options are (a) extend Phase 2 to cover Markdown/PDF export of images, (b) add image-export as a follow-up plan, or (c) edit the article — user decides.
- **Vim `gg` not implemented** — chose article-fix over code-fix. If we later want true `gg`, requires a stateful key-sequence handler. Not in this plan.
- **Emacs paging key relabeling** — if any user has muscle memory for `Ctrl+F` paging, the article previously misled them; the corrected article will match the actual code. No backwards-compat issue (the code never had `Ctrl+B`).
- **A1 image-block schema unverified** — Desktop API attachments and CC JSONL inline images may differ. Read `claude_code_reader.py` + a sample Desktop conversation JSON before coding Phase 2 to confirm the `image` block shape.

---

## Phase 1 Commit 4 — RED triage outcome (2026-05-01)

All Phase-1 newly-added tests pass:
- `sidebar-behavior.spec.ts` (6/6)
- `keyboard-shortcuts.spec.ts` (7/8 + 1 documented skip)
- `conversation-detail.spec.ts` (3/3)
- `search-match-navigation.spec.ts` (1/1)
- `exports.spec.ts` (4/4)
- Extensions to `header-refresh-button.spec.ts` (B5), `theme.spec.ts` (B8), `keyboard-navigation.spec.ts` (B9) all pass.

**One documented skip:**
- B11 — Cmd+G crosses conversation boundaries. The `navigateToMatch` prefetch races the `Cmd+G` handler under fully-mocked routes; the URL change isn't reliably observable inside a 10s window. Either (a) drive cross-conversation Cmd+G from a stable scroll/visibility signal, or (b) hook the prefetch promise via a `window.__navTestHook` instrumentation. Defer.

**Pre-existing test-infrastructure debt (NOT caused by this work):**
The full e2e suite has ~50 failures from stale tests that reference UI that has been refactored over the prior weeks:
- `refresh-toast.spec.ts`, `refresh-toast-duration.spec.ts`, `refresh-pipeline.spec.ts` — look for a button labeled `Fetch Claude Desktop conversations` that was removed when the redundant footer Refresh button was deleted (git: `98bf2f4 Wire header Refresh button to Build-9 pipeline; remove duplicate footer button`).
- `search.spec.ts` — asserts `getByPlaceholder('Search messages...').not.toBeVisible()` to detect a closed SearchPanel, but the panel now stays mounted and toggles visibility via aria-hidden + transform.
- `keyboard-navigation.spec.ts` — depends on a live backend with conversations on disk; flakes 8/19 when run in parallel.

These are out of scope for the article ↔ coverage plan but flagged here so they don't get conflated with regressions from this work. Recommendation: roll into a follow-up "stale e2e cleanup" plan that updates assertions to match the current UI (search panel via aria-hidden, refresh button via the header element) and skips/updates the live-backend keyboard-navigation tests.

---

## Phase 2 — Findings (NOT yet implemented; awaiting user decision)

Investigated the actual shape of "image content" in real Claude Desktop
conversations under `~/.claude-exporter/conversations/by-org/*/`:

- `Message.content[]` blocks of `type: 'image'` **do not exist** in any
  on-disk conversation. The TypeScript type `ContentBlock.type` includes
  `'image'` as a possibility, but the live API never produces one.
- Real images come through as entries in `Message.files[]` with
  `file_kind: 'image'`, including `thumbnail_url`, `preview_asset.url`,
  `image_width`, `image_height`, and `file_name`. These are file
  attachments associated with the message, not content blocks.
- `MessageBubble.tsx` does **not** read `Message.files` at all. So images
  attached to real Claude Desktop conversations are silently dropped from
  the rendered transcript. This is the actual data-loss bug.

The article (line 180) lists "`image` blocks for images in the
transcript" as one of the four block types. That phrasing is technically
wrong — the API doesn't deliver images as content blocks — but the
underlying *intent* (images should be rendered in the transcript) is
real and currently unmet.

**Decision required from the user before any code lands.** Options:

1. **Implement Message.files image rendering.** Add a renderer in
   `MessageBubble.tsx` that walks `message.files`, filters by
   `file_kind === 'image'`, and renders `<img>` from `thumbnail_url`
   (with `preview_asset.url` as a click-through). Update the article to
   describe images as attachments, not content blocks. Larger change
   (~50 lines + Message type extension + a Playwright test fixture with
   a real `files[]` entry).

2. **Add a no-op `<img>` renderer in the `image` ContentBlock case.**
   Matches the article literally but renders nothing in practice (no
   real data ever hits the case). Article remains accurate as written
   but the user-visible behavior doesn't change.

3. **Defer image rendering entirely.** Soften the article claim from
   "`image` blocks for images in the transcript" to something narrower.
   Would need explicit user approval (the no-silent-softening rule).

Phase 2 is **paused** until the user picks a path. No code change has
been written.

---

## Phase 3 — Article reconciliation (DOC-ONLY; no article edits without user consent)

Walked every numbered claim in `PLANS/articles/part_2_web_app.md` (already
covered by the audit table above as B1-B27 plus the four Tier-A items
A1-A6). This pass surfaces the small set of remaining claims that aren't
yet pinned to a Playwright test and asks the user to choose between
adding the test, accepting backend-unit-test-only coverage, or letting
me edit the article.

### A. Claims fully backed by green Playwright tests
B1 (source filter), B2 (project group collapse), B3 (row metadata), B4
(starred at top), B5 (refresh re-lists), B6 (phantom toggle), B7
(Caveat title), B8 (theme cycle), B9 (Cmd+R), B10 (Cmd+G/Shift+G), B12
(Match N of M), B13 (u/a/U/A), B14 (Emacs paging), B15 (Vim nav), B16
(Cmd+C copy), B17 (HintState), B18 (data-allow-shortcuts), B19
(Expand/Collapse), B20 (per-block copy), B21 (showToolCalls toggle
across viewer + export), B22 (search-result scroll-to-match), B23
(timestamps both sides), B24 (Markdown export), B25 (PDF export),
B26 (include_tools), B27 (View branches), plus the article corrections
A3-A6.

### B. Claims with backend coverage but no e2e
- **Search includes tool_use input AND tool_result body** (article line 90).
  Verified by reading `backend/search.py:34-44` — confirmed both block types
  are indexed. **No Playwright test asserts this end-to-end.** A small
  e2e would mock `/api/search` with a result whose snippet text comes
  from a `tool_use.input` dict and verify the UI renders the hit. Cheap
  to add (1 test in the existing `search-match-navigation.spec.ts`).
  **DECISION NEEDED: add e2e for search-tool-block coverage, or accept
  backend-only coverage?**

### C. Claims with no test of any kind
- **Performance numbers** (`~50ms warm cache`, `~0.07s listing`,
  `orjson + mtime-keyed FileCache + parallel reads via ThreadPoolExecutor`,
  article line 92). These are perf claims; not Playwright-shaped. We can
  ignore (the user will see in practice) or wire a load-time benchmark.
  **DECISION NEEDED: leave the perf numbers as journalistic, or drop them?**
- **"Click anywhere in either pane (background included) to focus it"**
  (line 120). The focus model is implemented; pane background click
  isn't explicitly e2e-tested. Cheap to add (~10 lines).
- **Help modal lists every binding** (line 137). Existing
  `keyboard-navigation.spec.ts` only verifies that the modal opens; it
  doesn't iterate the listed bindings. Cheap to add an assertion that
  several specific bindings appear.
- **Branch tree visualization is "intentionally read-only"** (line 188).
  The wording was true before Build-8 #6 wired up branch *switching*;
  now `branch-switching.spec.ts` proves clicking a branch leaf actually
  changes the displayed stream. **The article overstates the
  read-only-ness of the visualization.** Per the no-silent-softening
  rule, surfacing this rather than rewriting unilaterally.
  **DECISION NEEDED: how should the article describe branch behavior
  now that branch switching is interactive?**

### D. Claims that don't match real-world data
- **"`image` blocks for images in the transcript"** (line 180). See
  Phase 2 findings — real images live in `Message.files[]`, not
  `Message.content[]`. The article's framing is inaccurate; the real
  data-loss bug (file-attachment images dropped from the bubble)
  remains. **DECISION NEEDED: see Phase 2 options 1/2/3.**

### Recommendation
- **Cheap to fix without rewording:** add e2e for tool-block search (B-list),
  pane-background focus click and help-modal binding list (C-list).
- **Article wording decisions for the user:** branch-tree
  read-only-ness (C-list), perf numbers (C-list), image content blocks
  vs. file attachments (D-list).

No edits to `PLANS/articles/part_2_web_app.md` beyond the four Tier-A
corrections already shipped in Phase 0b.
