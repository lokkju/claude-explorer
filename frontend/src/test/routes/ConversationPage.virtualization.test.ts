/**
 * Virtualization structural pin (2026-05-23) — ConversationPage MUST
 * virtualize the message-bubble list via `@tanstack/react-virtual` so
 * the rendered DOM contains only the visible window (≈20 rows) instead
 * of every visible message in the conversation.
 *
 * THE BUG THIS TEST PINS (perf regression):
 *
 * Pre-fix: `visibleMessages.map((message) => <MessageBubble ... />)`
 * unconditionally rendered ALL 4051 visible bubbles into the DOM on
 * every conversation navigation. ~141K DOM nodes per page, ~8.5s of
 * React commit work per warm-switch, ~12.6s on cold first-load. Per
 * `/tmp/perf-baseline-2026-05-23.json` and
 * `PLANS/PERFORMANCE_BASELINE_2026-05-23.md`.
 *
 * Post-fix: `useVirtualizer({ ... }).getVirtualItems()` drives the
 * render, and each row attaches `ref={virtualizer.measureElement}` plus
 * an absolute-positioned wrapper at `transform: translateY(<offset>px)`.
 * Only the visible window + overscan is mounted; remaining rows exist
 * only as virtualizer state.
 *
 * This is a STRUCTURAL secondary guard per agent playbook Rule P9 — the
 * user-observable budget pin lives in
 * `frontend/e2e/conversation-pane-virtualization.spec.ts`. The grep
 * below fires if someone reverts the virtualizer integration to the
 * unconditional .map(), which would re-introduce the regression.
 *
 * It does NOT pin which library is used (intentional — Virtuoso could
 * be a follow-up swap per the council Decision Record), only that some
 * recognizable virtualization primitive is wired in. We pin the
 * specific imported symbol (`useVirtualizer` from `@tanstack/react-virtual`)
 * to match the chosen library; if a future swap moves to Virtuoso, the
 * grep should be updated in the same commit.
 */

import { describe, it, expect } from 'vitest'
// 2026-05-31 (PLANS/2026.05.31-conversationpage-decomposition.md, Commit 8):
// The virtualizer wiring + the per-row absolute/translateY positioning + the
// virtualizer.measureElement call all moved out of ConversationPage.tsx into
// ConversationMessageStream.tsx. The structural invariants are unchanged;
// the file the pins read just moved. The useVirtualizer import + call still
// live in ConversationPage.tsx (the page owns the virtualizer instance and
// forwards it as a prop), so the first two tests still source-grep the page.
// The render-side pins now look at the stream component.
import conversationPageSrc from '@/routes/ConversationPage.tsx?raw'
import conversationMessageStreamSrc from '@/components/conversation/ConversationMessageStream.tsx?raw'

describe('ConversationPage — virtualization wiring pin', () => {
  it('imports useVirtualizer from @tanstack/react-virtual', () => {
    const src = conversationPageSrc
    const importPattern =
      /import\s*\{[^}]*\buseVirtualizer\b[^}]*\}\s*from\s*['"]@tanstack\/react-virtual['"]/
    expect(
      importPattern.test(src),
      'ConversationPage.tsx must import useVirtualizer from ' +
        '@tanstack/react-virtual to virtualize the bubble list. Without ' +
        'virtualization the 4051-bubble real-corpus conversation takes ' +
        '~10s warm-switch (see PLANS/PERFORMANCE_BASELINE_2026-05-23.md).',
    ).toBe(true)
  })

  it('calls useVirtualizer with getScrollElement and count parameters', () => {
    const src = conversationPageSrc
    // The hook must be CALLED, not just imported (someone could
    // accidentally remove the call and leave the import).
    const callPattern = /useVirtualizer\s*\(\s*\{/
    expect(
      callPattern.test(src),
      'ConversationPage.tsx must invoke useVirtualizer({ ... }).',
    ).toBe(true)
    // Spot-check the required config fields.
    const callSiteIdx = src.search(callPattern)
    const callRegion = src.slice(callSiteIdx, callSiteIdx + 800)
    expect(
      /\bcount\s*:/.test(callRegion),
      'useVirtualizer call must specify `count` (visibleMessages.length).',
    ).toBe(true)
    expect(
      /\bgetScrollElement\s*:/.test(callRegion),
      'useVirtualizer call must specify `getScrollElement` (the ' +
        'message-stream div ref).',
    ).toBe(true)
    expect(
      /\bestimateSize\s*:/.test(callRegion),
      'useVirtualizer call must specify `estimateSize` (variable-height ' +
        'bubbles still need an initial estimate).',
    ).toBe(true)
  })

  it('renders via virtualizer.getVirtualItems() rather than ' +
    'visibleMessages.map() inside the stream', () => {
    const src = conversationMessageStreamSrc
    // The render path MUST iterate the virtualizer's visible items.
    // Allow either `virtualizer.getVirtualItems()` or destructured
    // `const virtualItems = virtualizer.getVirtualItems()` then `virtualItems.map`.
    const usesVirtualItems =
      /virtualizer\.getVirtualItems\s*\(\s*\)/.test(src) ||
      /\bvirtualItems\s*\.\s*map\s*\(/.test(src)
    expect(
      usesVirtualItems,
      'ConversationMessageStream.tsx must render via virtualizer.getVirtualItems(). ' +
        'A bare visibleMessages.map() shipping all bubbles to the DOM is ' +
        'the regression this pin guards against.',
    ).toBe(true)
  })

  it('calls virtualizer.measureElement so each row is measured post-mount', () => {
    const src = conversationMessageStreamSrc
    // ResizeObserver-driven measurement is REQUIRED for variable-height
    // bubbles (1-line text vs 5000-char tool output). Without it the
    // virtualizer relies on estimateSize alone and scrollToIndex
    // mispositions wildly.
    //
    // Accept either form:
    //   1) `ref={virtualizer.measureElement}` directly on the row wrapper.
    //   2) `virtualizer.measureElement(el)` invoked from a combined-ref
    //      callback (required when we ALSO need to attach our own
    //      cached-per-id ref Map for anchor capture).
    const literalRefForm = /ref=\{[^}]*virtualizer\.measureElement[^}]*\}/
    const combinedRefForm = /virtualizer\.measureElement\s*\(/
    expect(
      literalRefForm.test(src) || combinedRefForm.test(src),
      'Each virtualized row must be measured by the virtualizer — either ' +
        'via `ref={virtualizer.measureElement}` directly, or via a combined ' +
        'ref callback that invokes `virtualizer.measureElement(el)`. Without ' +
        'measurement, scrollToIndex mispositions on the variable-height bubble list.',
    ).toBe(true)
  })

  it('positions each virtualized row with absolute + transform translateY', () => {
    const src = conversationMessageStreamSrc
    // The row wrapper must be absolutely positioned inside the total-
    // height spacer with a translateY based on the virtual item's start
    // offset. Both pieces are mandatory; absolute alone yields stacked
    // rows, translateY alone leaves them in normal flow.
    const absolutePattern = /position\s*:\s*['"]absolute['"]/
    const translatePattern = /translateY\s*\(\s*\$\{[^}]*\.start[^}]*\}px\s*\)/
    expect(
      absolutePattern.test(src),
      'Virtualized row wrappers must use position: absolute inside the ' +
        'total-size spacer.',
    ).toBe(true)
    expect(
      translatePattern.test(src),
      'Virtualized row wrappers must apply transform: translateY(${vi.start}px) ' +
        'so each row lands at its virtualizer-computed offset.',
    ).toBe(true)
  })
})
