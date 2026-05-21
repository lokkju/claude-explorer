/**
 * scrollBubbleIntoView — distance-gated scroll with post-settle
 * correction. Pins the 5 invariants the 3-model LLM council settled
 * on (2026-05-20):
 *
 *   1. Long hop (>1.5 viewports) → `behavior: 'auto'` (instant) on
 *      initial scroll. Avoids the lazy-image swept-region inflation.
 *   2. Short hop (≤1.5 viewports) → `behavior: 'smooth'` on initial
 *      scroll. Preserves motion cue for the working case.
 *   3. No scroll container → falls back to `smooth, center` direct.
 *      Keeps the helper safe for printing / alternate layouts / tests.
 *   4. Post-settle correction fires at 250ms and uses `behavior: 'auto'`
 *      (snap, not animate) ONLY when target is off-center by >100px.
 *      No-ops otherwise.
 *   5. Supersession token: a NEWER call after the initial scroll but
 *      BEFORE the 250ms correction cancels the older correction. Pins
 *      the rapid-Cmd+G race the council called out.
 *
 * These are bidirectional — for each rule we assert both that the
 * triggering condition produces the behavior AND that the inverse
 * condition does NOT.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  scrollBubbleIntoView,
  __resetScrollToken,
} from '@/lib/scrollBubbleIntoView'

interface RectInit {
  top: number
  left?: number
  width?: number
  height: number
}

/**
 * Stub `getBoundingClientRect` on a real DOM element. jsdom returns
 * all-zeros by default; the helper needs real geometry to take
 * branch decisions.
 */
function stubRect(el: Element, init: RectInit) {
  const { top, left = 0, width = 100, height } = init
  const rect: DOMRect = {
    top,
    left,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  }
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(rect)
}

describe('scrollBubbleIntoView — distance-gated scroll + supersession', () => {
  let scrollIntoViewSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    __resetScrollToken()
    vi.useFakeTimers()
    Element.prototype.scrollIntoView = vi.fn()
    scrollIntoViewSpy = vi.spyOn(Element.prototype, 'scrollIntoView')
  })

  afterEach(() => {
    vi.useRealTimers()
    scrollIntoViewSpy.mockRestore()
    document.body.innerHTML = ''
  })

  // ─────────────────────────────────────────────────────────────
  // Helper: build a `[data-testid="message-stream"]` container of
  // height=1000 with a target bubble inside positioned by `targetTop`
  // (relative to viewport, simulating where rect.top would be).
  // ─────────────────────────────────────────────────────────────
  function setupContainerAndTarget(targetTop: number, targetHeight = 80) {
    const container = document.createElement('div')
    container.setAttribute('data-testid', 'message-stream')
    const target = document.createElement('div')
    container.appendChild(target)
    document.body.appendChild(container)
    // Container is the viewport. height=1000, top=0 → center=500.
    stubRect(container, { top: 0, height: 1000 })
    stubRect(target, { top: targetTop, height: targetHeight })
    return { container, target }
  }

  // Rule 1 — long hop → instant ('auto').
  it('long hop (>1.5 viewports off-center) → behavior:auto on initial scroll', () => {
    // viewport h=1000, center=500. Target top=3000 → center=3040.
    // distance=2540px = 2.54 viewports >1.5 → long hop.
    const { target } = setupContainerAndTarget(3000)
    scrollBubbleIntoView(target as HTMLElement)
    expect(scrollIntoViewSpy).toHaveBeenCalledWith({ behavior: 'auto', block: 'center' })
  })

  // Rule 2 — short hop → smooth.
  it('short hop (≤1.5 viewports off-center) → behavior:smooth on initial scroll', () => {
    // viewport h=1000, center=500. Target top=1000 → center=1040.
    // distance=540px = 0.54 viewports ≤1.5 → short hop.
    const { target } = setupContainerAndTarget(1000)
    scrollBubbleIntoView(target as HTMLElement)
    expect(scrollIntoViewSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
  })

  // Rule 3 — no container → fallback to smooth/center direct.
  it('no [data-testid="message-stream"] container → fallback to smooth/center', () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    scrollBubbleIntoView(target as HTMLElement)
    expect(scrollIntoViewSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
  })

  // Rule 4a — correction fires when target ends up off-center by >100px.
  it('post-settle correction fires when target drifted >100px during animation', () => {
    const { container, target } = setupContainerAndTarget(1000)
    scrollBubbleIntoView(target as HTMLElement)
    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1)

    // Simulate lazy-image growth shifting the target's post-scroll
    // position to 200px below container center.
    stubRect(target, { top: 600, height: 80 })  // center=640, container center=500, off=140 >100
    stubRect(container, { top: 0, height: 1000 })

    vi.advanceTimersByTime(250)
    // Second call from the correction. Must be 'auto' (snap, not
    // animate) so the user doesn't see two competing smooth motions.
    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(2)
    expect(scrollIntoViewSpy).toHaveBeenLastCalledWith({ behavior: 'auto', block: 'center' })
  })

  // Rule 4b — correction NO-OPS when target landed within ±100px.
  it('post-settle correction does NOT fire when target landed within ±100px', () => {
    const { container, target } = setupContainerAndTarget(1000)
    scrollBubbleIntoView(target as HTMLElement)
    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1)

    // Simulate target landed close to center: top=450, height=80
    // → center=490, container center=500, off=10 ≤100. No correction.
    stubRect(target, { top: 450, height: 80 })
    stubRect(container, { top: 0, height: 1000 })

    vi.advanceTimersByTime(250)
    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1)
  })

  // Rule 5 — supersession: newer call cancels older correction.
  //
  // Discriminator: targetA is positioned where it would TRIGGER a
  // correction (off by >100px) if the token logic were broken. targetB
  // is positioned where its OWN correction no-ops (landed on-center).
  // So:
  //   - Broken token logic → A's stale correction fires + B's no-ops
  //     = 3 total scrollIntoView calls (A init, B init, A stale).
  //   - Correct token logic → A's stale correction superseded, B's
  //     no-ops = 2 total calls (A init, B init).
  it('newer call supersedes the older correction (rapid Cmd+G race)', () => {
    const { container: containerA, target: targetA } = setupContainerAndTarget(1000)
    scrollBubbleIntoView(targetA as HTMLElement)
    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1)

    // Second target — positioned EXACTLY on container center so its
    // own correction is guaranteed to no-op (off=0px ≤100). This
    // isolates the test to "did A's stale correction fire?".
    const targetB = document.createElement('div')
    containerA.appendChild(targetB)
    stubRect(targetB, { top: 460, height: 80 })  // center=500 = container center

    scrollBubbleIntoView(targetB as HTMLElement)
    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(2)

    // Make targetA appear off-center so its correction WOULD fire if
    // the token check didn't supersede it.
    stubRect(targetA, { top: 5000, height: 80 })
    stubRect(containerA, { top: 0, height: 1000 })

    vi.advanceTimersByTime(250)
    // Token-correct: only 2 calls. B's correction no-ops (on-center),
    // A's stale correction is superseded.
    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(2)
  })

  // Rule 5 (negative) — if user does NOT click again, the correction
  // does fire (sanity check that the token logic isn't blanket-blocking).
  it('without a newer call, correction fires for the original target', () => {
    const { container, target } = setupContainerAndTarget(1000)
    scrollBubbleIntoView(target as HTMLElement)

    // Same drift as the 4a case.
    stubRect(target, { top: 600, height: 80 })
    stubRect(container, { top: 0, height: 1000 })

    vi.advanceTimersByTime(250)
    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(2)
  })
})
