/**
 * Distance-gated, layout-shift-resilient scroll-into-view for message
 * bubbles. Used by the search-hit fast path
 * (`navigateToMatch.ts`) and the URL-highlight effect
 * (`ConversationPage.tsx`).
 *
 * Bug background (2026-05-20, 3-model LLM council):
 *   Native `scrollIntoView({behavior:'smooth', block:'center'})` aims
 *   at the target's `offsetTop` AT CALL TIME and animates over ~500ms.
 *   During the animation, lazy-loaded images
 *   (`<img loading="lazy">`, no intrinsic dimensions) above the target
 *   enter the swept region, decode, and grow from ~0px up to 384px
 *   each (`max-h-96` in MessageBubble.tsx). On a 15K-msg conversation,
 *   `scrollHeight` grew by 16,109 px during one observed animation,
 *   landing the target 4,000–5,300 px BELOW viewport center. Smooth
 *   scrollIntoView does NOT re-aim mid-flight.
 *
 * Strategy — distance-gated two-mode:
 *   - **Long hop** (target > 1.5 viewports from container center):
 *     scroll instantly with `behavior: 'auto'`. The intermediate
 *     lazy-image region is never swept, so it never inflates the
 *     document. The motion cue is informational noise for a 16K-px
 *     jump anyway (just blurs).
 *   - **Short hop** (≤ 1.5 viewports): keep `behavior: 'smooth'` for
 *     the motion cue. Drift is small because few unmounted images are
 *     swept.
 *
 *   Then ALWAYS a single 250ms post-settle correction: any image with
 *   `decoding="async"` that lands in viewport after the scroll can
 *   still push the target by up to ~384 px during the next few
 *   layout passes. The 250ms timeout covers decoding latency + one
 *   full layout commit. If the target is still off-center by >100 px,
 *   we issue a final `behavior: 'auto'` re-center (silent, snap-free).
 *
 * Concurrency — supersession token:
 *   Rapid Cmd+G hits (cycling through search matches) can queue
 *   multiple corrections. Without a token, hit-A's 250ms correction
 *   could fire AFTER hit-B's scroll, yanking the user back to hit A.
 *   `scrollToken` is a module-level monotonic counter; each call
 *   captures its token, and the correction no-ops if a newer call
 *   superseded it.
 *
 * Spec note — `behavior: 'auto'` vs `'instant'`:
 *   CSSOM-VIEW Level 1's `ScrollBehavior` enum is `'auto' | 'smooth'`.
 *   `'instant'` is a `scrollTo`-only value (Window/Element.scrollTo,
 *   Window/scrollBy) — TypeScript's `lib.dom.d.ts` rejects it for
 *   `scrollIntoView`. `'auto'` is the spec-correct way to request an
 *   instant scroll via scrollIntoView and is treated as instant in
 *   Chromium/Firefox/Safari when CSS `scroll-behavior` is unset (the
 *   default).
 *
 * Threshold note — 1.5 viewports:
 *   Empirical heuristic. Above ~1.5 viewports, the smooth-scroll
 *   motion provides no spatial context; below it, the motion cue is
 *   valuable and drift is bounded. WWCMM: smoke test on the 15K conv
 *   showing drift on hops <1.5 viewports → tighten threshold.
 *
 * Residual: this helper does NOT fix the root cause (images without
 * reserved dimensions). Layout shift will still occur AFTER landing
 * as the user scrolls further. Real fix is backend-provided image
 * dimensions + CSS `aspect-ratio`. Deferred — see follow-up issue.
 */

let scrollToken = 0

// Exported for testing only.
export const __getScrollToken = () => scrollToken
export const __resetScrollToken = () => { scrollToken = 0 }

const SCROLL_CONTAINER_SELECTOR = '[data-testid="message-stream"]'
const LONG_HOP_VIEWPORT_MULTIPLE = 1.5
const SETTLE_MS = 250
const CORRECTION_THRESHOLD_PX = 100

/**
 * Scroll a message bubble into the center of its message-stream
 * container, resilient to layout shift from lazy-loaded images. See
 * module docstring for full rationale.
 */
export function scrollBubbleIntoView(element: HTMLElement): void {
  const myToken = ++scrollToken
  const container = element.closest(SCROLL_CONTAINER_SELECTOR) as HTMLElement | null

  // Fallback for the rare case the bubble isn't in our standard
  // scroll container (e.g. printing, alternate layouts, tests that
  // mount bubbles directly into document.body). Keep behavior simple
  // and let the browser default handle it.
  if (!container) {
    element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    return
  }

  const containerRect = container.getBoundingClientRect()
  const targetRect = element.getBoundingClientRect()
  const viewportH = containerRect.height
  const targetCenter = targetRect.top + targetRect.height / 2
  const containerCenter = containerRect.top + viewportH / 2
  const distancePx = Math.abs(targetCenter - containerCenter)
  const isLongHop = distancePx > viewportH * LONG_HOP_VIEWPORT_MULTIPLE

  element.scrollIntoView({
    behavior: isLongHop ? 'auto' : 'smooth',
    block: 'center',
  })

  // Single post-settle correction. Covers async image decoding +
  // one re-layout commit. Bounded — one shot, not a loop.
  window.setTimeout(() => {
    if (myToken !== scrollToken) return // superseded by newer call
    if (!document.body.contains(element)) return
    const r = element.getBoundingClientRect()
    const c = container.getBoundingClientRect()
    const off = (r.top + r.height / 2) - (c.top + c.height / 2)
    if (Math.abs(off) > CORRECTION_THRESHOLD_PX) {
      element.scrollIntoView({ behavior: 'auto', block: 'center' })
    }
  }, SETTLE_MS)
}
