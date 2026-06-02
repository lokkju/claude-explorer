/**
 * Perf-regression contract (2026-05-23) — ConversationPage MUST only
 * pass `searchQuery` to the bubble whose UUID matches the current
 * search-hit target (`highlightMessageId` from URL `?highlight=` or
 * `?m=`). All other bubbles MUST receive `searchQuery=''`.
 *
 * THE BUG THIS TEST PINS:
 *
 * Live Playwright profiling on the user's 16K-message corpus showed
 * typing in the SearchPanel input produced 8-9 second long tasks per
 * settled debounce — keystrokes landed ~17 seconds apart instead of
 * the keyboard rate's 180ms. Root cause: ConversationPage threaded
 * `deferredSearchQuery` (from useSearchPanel().query → useDeferredValue)
 * as a prop to EVERY one of the 4014 MessageBubbles. React.memo's
 * comparator included `searchQuery`, so when the deferred value
 * flipped, every bubble's memo bailed out → every MarkdownRenderer
 * re-walked markdown AST and re-wrapped matched tokens in <mark> →
 * ~9 seconds of synchronous work blocking the 200ms debounce timer
 * and the next keystroke.
 *
 * The fix: highlight ONLY the actively-navigated bubble. Cmd+G
 * already moves the active match by setting `?highlight=<uuid>` in
 * the URL. So pass `searchQuery` only when
 * `message.uuid === highlightMessageId`; pass `''` for everyone else.
 * That's O(1) re-renders per debounce settle instead of O(4000).
 *
 * UX impact: the user sees a yellow band on the message they're
 * looking at (where their eye is) and no highlights elsewhere. The
 * SearchPanel sidebar still lists all matches in card form with
 * highlights — the user can still scan/scroll all hits. The
 * conversation-pane highlight was a nice-to-have that broke the
 * core typing UX.
 *
 * The grep test below is unconditional: if someone re-introduces
 * `searchQuery={deferredSearchQuery}` on the generic MessageBubble
 * call site, the test fires. Same pattern as
 * `MessageBubble.no-settings-import.test.ts`.
 */

import { describe, it, expect } from 'vitest'
// Vite's `?raw` query suffix loads the file as a string at bundle/test
// time. Cross-toolchain: works in tsc + vitest + production builds
// without needing Node `fs`/`@types/node` in the app tsconfig.
//
// 2026-05-31 (PLANS/2026.05.31-conversationpage-decomposition.md, Commit 1):
// The per-bubble `<MessageBubble searchQuery={...} />` call site that this
// regression test pins was lifted out of ConversationPage.tsx into a
// dedicated module, `renderBubbleRow.tsx`. The structural invariant —
// "highlight gated on a uuid-equality ternary, NOT a bare
// `searchQuery={deferredSearchQuery}` on the generic call" — is unchanged;
// only the file it lives in moved. Point the source-grep at the new file
// so the same shape pin still fires on a future regression.
import renderBubbleRowSrc from '@/components/conversation/renderBubbleRow.tsx?raw'

describe('ConversationPage — active-match-only search highlight (perf regression pin)', () => {
  it('NEGATIVE: does not unconditionally pass deferredSearchQuery to every MessageBubble', () => {
    const src = renderBubbleRowSrc
    // Forbid the literal pattern that caused the regression.
    // Any future code must either:
    //   a) Compute a per-bubble query (e.g. ternary based on uuid match), or
    //   b) Not pass searchQuery at all (full revert).
    //
    // Both forms read as:
    //   searchQuery={message.uuid === highlightMessageId ? deferredSearchQuery : ''}
    // OR
    //   <MessageBubble ...  /> (no searchQuery prop)
    //
    // The forbidden form is the bare `searchQuery={deferredSearchQuery}`
    // attribute. Match with whitespace tolerance.
    const bareUnguardedPattern =
      /searchQuery\s*=\s*\{\s*deferredSearchQuery\s*\}/
    expect(
      bareUnguardedPattern.test(src),
      'ConversationPage.tsx must NOT pass deferredSearchQuery unconditionally to ' +
        'MessageBubble — gate on `message.uuid === highlightMessageId` per the ' +
        '2026-05-23 perf regression doc in the file header.',
    ).toBe(false)
  })

  it('POSITIVE: passes searchQuery gated on a uuid-equality ternary to ONE bubble at a time', () => {
    const src = renderBubbleRowSrc
    // §5.13 lesson (2026-05-24): the previous version of this test
    // pinned the literal variable name `highlightMessageId` in the
    // gate. When the bug fix on 2026-05-24 changed the gate to
    // `activeMatchUuid` (because `highlightMessageId` was the
    // ephemeral URL `?highlight=` param that cleared after 2s,
    // dropping yellow marks mid-read), this test failed for the
    // WRONG reason — it ratified the OLD broken implementation.
    //
    // Pin the SHAPE, not the specific identifier: a ternary that
    // gates `deferredSearchQuery` on some uuid-equality check,
    // emitting '' to non-matching bubbles. Either side of the
    // comparison can be `message.uuid`. The RHS identifier is
    // implementation choice (`highlightMessageId` vs
    // `activeMatchUuid` vs future names) and not user-observable.
    //
    // The user-observable contracts (one bubble at a time, persists
    // past URL cleanup) are pinned by
    // `e2e/search-highlight-persists-past-url-cleanup.spec.ts`.
    const gatedPattern =
      /searchQuery\s*=\s*\{\s*(message\.uuid\s*===\s*\w+|\w+\s*===\s*message\.uuid)\s*\?\s*deferredSearchQuery\s*:\s*['"]['"]\s*\}/
    expect(
      gatedPattern.test(src),
      'ConversationPage.tsx must pass searchQuery gated on a uuid-equality ' +
        'ternary, e.g. `searchQuery={message.uuid === <someActiveUuid> ? ' +
        "deferredSearchQuery : ''}`. The RHS identifier name is " +
        'implementation choice; the shape is the contract.',
    ).toBe(true)
  })
})
