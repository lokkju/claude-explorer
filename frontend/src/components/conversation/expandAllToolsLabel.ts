/**
 * Label-state table for the "Expand/Collapse all tools" header button
 * in `ConversationPage`. Wrapping the setState in React 19's
 * `useTransition` lets the click feel instant — the button label flips
 * to "Expanding…" / "Collapsing…" the moment the user clicks, and the
 * heavy re-render of every tool bubble happens as a non-blocking
 * transition.
 *
 * Pure function so the four-state table is testable without flushing
 * React transitions inside vitest.
 */
export function expandAllToolsButtonLabel(
  expandAllTools: boolean,
  isPending: boolean,
): 'Expand' | 'Collapse' | 'Expanding…' | 'Collapsing…' {
  if (isPending) {
    return expandAllTools ? 'Collapsing…' : 'Expanding…'
  }
  return expandAllTools ? 'Collapse' : 'Expand'
}

/**
 * Issue 3 (2026-05-20) — scroll-anchor adjustment math.
 *
 * Before expand/collapse, ConversationPage captures the focused
 * message's `getBoundingClientRect().top`. After the transition
 * commits the new layout, the same element has a new top. To keep the
 * focused message at the same viewport pixel, scrollTop must shift by
 * (newTop - oldTop).
 *
 * The threshold filter avoids fighting sub-pixel layout noise — a
 * 0.3px delta from a font-metrics recalc isn't worth a scroll
 * adjustment.
 */
export function computeScrollAnchorAdjustment(
  beforeTop: number,
  afterTop: number,
  threshold = 0.5,
): number {
  const delta = afterTop - beforeTop
  return Math.abs(delta) > threshold ? delta : 0
}
