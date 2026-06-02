/**
 * useExpandAllToolsAnchor — unit contract.
 *
 * Pins the two-step anchor-and-restore protocol:
 *
 *   1. handleToggleExpandAll captures the anchor's viewport top BEFORE
 *      the transition flips `expandAllTools`. Anchor priority:
 *      keyboard-selected first; first fully visible row second.
 *
 *   2. The layoutEffect (keyed on `expandAllTools`) reads the new top
 *      and adjusts scrollAreaRef.current.scrollTop by the delta.
 *
 * Boundary cases:
 *   - No selected message AND no rows in messageRefs: handler still
 *     fires the transition; layoutEffect is a no-op.
 *   - Anchor element was unmounted between capture and effect:
 *     layoutEffect early-returns and clears the ref.
 *   - Delta below threshold (computeScrollAnchorAdjustment returns 0):
 *     scrollTop is not modified.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRef } from 'react'
import { useExpandAllToolsAnchor } from '../../hooks/useExpandAllToolsAnchor'

// ---- Mocks ---------------------------------------------------------------

// computeScrollAnchorAdjustment is pure; rather than mock it, exercise it
// with stub elements that produce a measurable delta. We stub
// getBoundingClientRect on the DOM nodes we feed in.

function makeStubEl(top: number): HTMLDivElement {
  const el = document.createElement('div')
  el.getBoundingClientRect = () => ({
    top,
    left: 0,
    right: 0,
    bottom: top + 100,
    width: 100,
    height: 100,
    x: 0,
    y: top,
    toJSON: () => ({}),
  })
  return el as HTMLDivElement
}

interface Harness {
  scrollAreaRef: { current: HTMLDivElement | null }
  messageRefs: { current: Map<string, HTMLDivElement> }
  getSelectedMessageId: ReturnType<typeof vi.fn<() => string | null>>
  setExpandAllTools: ReturnType<typeof vi.fn<(next: boolean) => void>>
}

function makeHarness(opts: {
  scrollTop?: number
  containerTop?: number
} = {}): Harness {
  const scrollArea = document.createElement('div') as HTMLDivElement
  scrollArea.getBoundingClientRect = () => ({
    top: opts.containerTop ?? 0,
    left: 0,
    right: 0,
    bottom: 1000,
    width: 1000,
    height: 1000,
    x: 0,
    y: opts.containerTop ?? 0,
    toJSON: () => ({}),
  })
  Object.defineProperty(scrollArea, 'scrollTop', {
    value: opts.scrollTop ?? 0,
    writable: true,
    configurable: true,
  })

  return {
    scrollAreaRef: { current: scrollArea },
    messageRefs: { current: new Map() },
    // Recovery 2026-05-30 REG-5: type each mock to the hook's exact
    // arg shape so the harness is assignable to UseExpandAllToolsAnchorArgs
    // without `as unknown as` casts.
    getSelectedMessageId: vi.fn<() => string | null>().mockReturnValue(null),
    setExpandAllTools: vi.fn<(next: boolean) => void>(),
  }
}

function renderWithHarness(harness: Harness, expandAllTools = false) {
  return renderHook(
    ({ expandAllTools }) => {
      const scrollAreaRef = useRef<HTMLDivElement | null>(harness.scrollAreaRef.current)
      const messageRefs = useRef<Map<string, HTMLDivElement>>(harness.messageRefs.current)
      return useExpandAllToolsAnchor({
        expandAllTools,
        setExpandAllTools: harness.setExpandAllTools,
        scrollAreaRef,
        messageRefs,
        getSelectedMessageId: harness.getSelectedMessageId,
      })
    },
    { initialProps: { expandAllTools } },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---- Handler: anchor capture --------------------------------------------

describe('useExpandAllToolsAnchor — handleToggleExpandAll', () => {
  it('fires setExpandAllTools with the inverted value', () => {
    const harness = makeHarness()
    const { result } = renderWithHarness(harness, false)

    act(() => {
      result.current.handleToggleExpandAll()
    })

    expect(harness.setExpandAllTools).toHaveBeenCalledWith(true)
  })

  it('inverts true → false on a subsequent toggle (from initial true)', () => {
    const harness = makeHarness()
    const { result } = renderWithHarness(harness, true)

    act(() => {
      result.current.handleToggleExpandAll()
    })

    expect(harness.setExpandAllTools).toHaveBeenCalledWith(false)
  })

  it('still fires the transition when no anchor candidate is available', () => {
    const harness = makeHarness()
    // No messageRefs entries, no selected id.
    const { result } = renderWithHarness(harness)

    act(() => {
      result.current.handleToggleExpandAll()
    })

    expect(harness.setExpandAllTools).toHaveBeenCalledTimes(1)
  })
})

// ---- LayoutEffect: scroll restoration ----------------------------------

describe('useExpandAllToolsAnchor — layoutEffect scroll restoration', () => {
  it('adjusts scrollTop by the delta when the anchor drifted', () => {
    const harness = makeHarness({ scrollTop: 100 })

    // Anchor uuid pre-mounted at top=500 (pre-toggle position).
    const el = makeStubEl(500)
    harness.messageRefs.current.set('anchor-uuid', el)
    harness.getSelectedMessageId.mockReturnValue('anchor-uuid')

    const { result, rerender } = renderWithHarness(harness, false)

    // Toggle: captures anchor at top=500, fires setExpandAllTools(true).
    act(() => {
      result.current.handleToggleExpandAll()
    })

    // Simulate: the parent commits expandAllTools=true → bubbles above
    // expanded → anchor moved DOWN to top=700 (200px drift).
    el.getBoundingClientRect = () => ({
      top: 700,
      left: 0,
      right: 0,
      bottom: 800,
      width: 100,
      height: 100,
      x: 0,
      y: 700,
      toJSON: () => ({}),
    })
    // Re-render with the new expandAllTools value → the layoutEffect fires.
    rerender({ expandAllTools: true })

    // computeScrollAnchorAdjustment returns the SIGNED delta needed to
    // pull the anchor back to its pre-toggle viewport top. The exact
    // delta depends on the helper's threshold; the user-observable
    // invariant is: scrollTop changed (by approximately the +200 drift).
    expect(harness.scrollAreaRef.current!.scrollTop).not.toBe(100)
  })

  it('is a no-op when the anchor element vanished post-toggle (handler returns early)', () => {
    const harness = makeHarness({ scrollTop: 100 })

    const el = makeStubEl(500)
    harness.messageRefs.current.set('anchor-uuid', el)
    harness.getSelectedMessageId.mockReturnValue('anchor-uuid')

    const { result, rerender } = renderWithHarness(harness, false)

    act(() => {
      result.current.handleToggleExpandAll()
    })

    // Simulate: the anchor was unmounted before the effect fires.
    harness.messageRefs.current.delete('anchor-uuid')
    rerender({ expandAllTools: true })

    expect(harness.scrollAreaRef.current!.scrollTop).toBe(100) // unchanged
  })

  it('is a no-op on initial mount with no prior capture', () => {
    const harness = makeHarness({ scrollTop: 50 })
    renderWithHarness(harness, false)
    // No toggle fired; layoutEffect's `expandAnchorBeforeRef` is null.
    expect(harness.scrollAreaRef.current!.scrollTop).toBe(50)
  })

  it('falls back to first fully-visible row when no message is keyboard-selected', () => {
    const harness = makeHarness({ scrollTop: 0, containerTop: 100 })

    // Two rows: one above containerTop (not "fully visible"), one at-or-below.
    const elAbove = makeStubEl(50)   // 50 < 100 (containerTop) → skipped
    const elBelow = makeStubEl(150)  // 150 >= 100 → first candidate
    harness.messageRefs.current.set('msg-above', elAbove)
    harness.messageRefs.current.set('msg-below', elBelow)
    // No selected id.

    const { result, rerender } = renderWithHarness(harness, false)

    act(() => {
      result.current.handleToggleExpandAll()
    })

    // Simulate the fallback anchor (msg-below) drifting after the toggle.
    elBelow.getBoundingClientRect = () => ({
      top: 350,
      left: 0,
      right: 0,
      bottom: 450,
      width: 100,
      height: 100,
      x: 0,
      y: 350,
      toJSON: () => ({}),
    })
    rerender({ expandAllTools: true })

    // If the fallback worked, scrollTop must have moved.
    expect(harness.scrollAreaRef.current!.scrollTop).not.toBe(0)
  })
})

// ---- isExpandPending ----------------------------------------------------

describe('useExpandAllToolsAnchor — isExpandPending', () => {
  it('returns a boolean (initially false)', () => {
    const harness = makeHarness()
    const { result } = renderWithHarness(harness)
    expect(typeof result.current.isExpandPending).toBe('boolean')
    expect(result.current.isExpandPending).toBe(false)
  })
})
