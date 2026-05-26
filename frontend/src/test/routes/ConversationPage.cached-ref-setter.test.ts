/**
 * P11.A11.1 antipattern pin (2026-05-23) — ConversationPage MUST use a
 * cached-per-id ref-setter factory for the message-bubble wrappers, NOT
 * inline `ref={(el) => map.set/delete}` callbacks that re-allocate on
 * every parent render.
 *
 * THE BUG THIS TEST PINS:
 *
 * Inline arrow refs change function identity on every parent render.
 * React invokes the previous ref callback with `null` (detach) and the
 * new ref callback with the element on each render — at N=4051 visible
 * MessageBubbles in the real-corpus conversation, a single parent
 * re-render fires 2N = 8102 redundant ref-callback invocations. This
 * compounds with context churn (SettingsContext, SearchPanelContext)
 * that already re-renders the parent on unrelated state changes.
 *
 * The fix: cached factory keyed by message uuid. First call for a given
 * uuid creates and caches the ref callback; subsequent calls return the
 * same function identity. React's ref reconciler treats unchanged
 * identity as a no-op. Cleanup branch deletes BOTH the DOM ref AND the
 * cached factory entry so the cache doesn't grow unbounded for
 * removable / filterable lists.
 *
 * Reference: agent playbook Rule P11.A11.1 (LLM Council Coding
 * Performance Work Playbook).
 *
 * Why source-grep instead of behavior: the antipattern is purely a
 * function-identity issue, not a render-output issue. A behavioral test
 * can't distinguish "ref fires 1 time" from "ref fires 8102 times"
 * because both produce the same final DOM. The grep pins the structural
 * fix; the perf budget is covered by the e2e measurement.
 */

import { describe, it, expect } from 'vitest'
// Vite's `?raw` query suffix loads file contents at bundle/test time.
import conversationPageSrc from '@/routes/ConversationPage.tsx?raw'

describe('ConversationPage — cached-per-id ref-setter (A11.1 antipattern pin)', () => {
  it('NEGATIVE: does not attach inline arrow refs inside the bubble list .map()', () => {
    const src = conversationPageSrc

    // Find the visibleMessages.map(...) span.
    const mapStartIdx = src.indexOf('visibleMessages.map(')
    expect(
      mapStartIdx,
      'ConversationPage.tsx must still contain visibleMessages.map(...) — ' +
        'test fixture out of date if this fails.',
    ).toBeGreaterThan(-1)

    // The mapped region runs from there to the closing `})}` of the map.
    // A coarse upper bound is the rest of the file from mapStartIdx; the
    // antipattern (if present) will appear inside this region. False
    // positives outside the .map() are tolerated — the .map() is the
    // hot path the rule targets.
    const mappedRegion = src.slice(mapStartIdx)

    // Forbid inline arrow ref callbacks of the shape:
    //   ref={(el) => {  ...  }}
    //   ref={(el) => { if (el) refs.current.set(...) }}
    //   ref={ (foo) => ... }
    const inlineRefPattern = /ref=\{\s*\(?[A-Za-z_$][A-Za-z0-9_$]*\)?\s*=>/
    expect(
      inlineRefPattern.test(mappedRegion),
      'ConversationPage.tsx must NOT use inline `ref={(el) => …}` callbacks ' +
        'inside the visibleMessages.map() — those re-fire 2N times per ' +
        'parent render (Rule P11.A11.1). Use a cached-per-id getSetRef factory.',
    ).toBe(false)
  })

  it('POSITIVE: defines a cached-per-id ref-setter factory (getSetRef or equivalent)', () => {
    const src = conversationPageSrc

    // We require a factory whose stable identity is cached per uuid.
    // The accepted shape is:
    //   const getSetRef = useCallback((uuid: string) => { ... }, [])
    //   ... ref={getSetRef(message.uuid)}
    //
    // The cache itself MUST live in a useRef (so it survives renders)
    // and MUST be a Map keyed by string. Two grep hooks:
    //   1. A useRef holding a Map<string, …> for ref-setter callbacks.
    //   2. The factory's invocation inside the JSX, returning a stable
    //      function that the JSX uses as `ref={getSetRef(uuid)}`.
    const factoryRefCachePattern =
      /useRef\s*<\s*Map\s*<\s*string\s*,\s*\(/  // Map<string, (el ...) => ...
    expect(
      factoryRefCachePattern.test(src),
      'ConversationPage.tsx must define a useRef<Map<string, RefCallback>> ' +
        'to cache the per-id ref-setter functions (Rule P11.A11.1 fix).',
    ).toBe(true)

    // The factory MUST be invoked somewhere in the render path. We
    // accept three valid shapes because the virtualization integration
    // composes the cached ref with `virtualizer.measureElement`:
    //   1) Direct: `ref={getSetRef(message.uuid)}`
    //   2) Via a helper that takes the factory as a dep: `getSetRef(message.uuid)`
    //      called inside a helper function (still inside ConversationPage source).
    //   3) Via a combined-ref callback that calls `getSetRef(uuid)` once to
    //      get the cached function and forwards the DOM node to it.
    // All three satisfy the structural fix (function identity stable
    // across renders). The pattern below requires only that
    // `getSetRef(...uuid)` appears in the source — invocation, not just
    // import/definition.
    const factoryInvocationPattern = /\bgetSetRef\s*\(\s*[^)]*\buuid\b[^)]*\)/
    expect(
      factoryInvocationPattern.test(src),
      'ConversationPage.tsx must invoke the cached factory as ' +
        '`getSetRef(<uuid>)` somewhere in the render path. The factory ' +
        'returns a stable function per uuid across renders so React skips ' +
        'redundant attach/detach calls (Rule P11.A11.1 fix).',
    ).toBe(true)
  })
})
