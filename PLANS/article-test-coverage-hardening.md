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
