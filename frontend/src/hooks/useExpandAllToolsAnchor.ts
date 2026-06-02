/**
 * useExpandAllToolsAnchor — non-blocking expand/collapse-all-tools
 * transition with scroll-anchor restoration.
 *
 * Solves two UX problems that landed together in 2026-05-20:
 *
 *   Issue 2 — Long-running re-render: `setExpandAllTools` cascades a
 *   synchronous re-render through every ToolUseBlock / ToolResultBlock.
 *   On a long conversation that takes hundreds of ms with no feedback,
 *   the click feels broken. We wrap the state flip in `useTransition`
 *   so React deprioritizes the cascade, and surface `isExpandPending`
 *   so the toolbar button can swap to "Expanding…" / "Collapsing…"
 *   for instant acknowledgement.
 *
 *   Issue 3 — Scroll drift past the anchor: when a message has focus
 *   from a search hit (`?highlight=<uuid>` scrolled it to viewport
 *   center), expanding the tool bubbles ABOVE it pushes the focused
 *   message DOWN off-screen — and collapse pulls it UP. The two-step
 *   anchor-and-restore protocol below pins it:
 *
 *     1. handleToggleExpandAll captures the anchor element's viewport
 *        top into `expandAnchorBeforeRef` synchronously BEFORE the
 *        transition fires. Anchor priority: keyboard-selected message
 *        first, then the first message whose top is at-or-below the
 *        scroll container's top (the "first fully visible row").
 *
 *     2. The useLayoutEffect (keyed on `expandAllTools`) reads the new
 *        viewport top of the same uuid after the transition commits
 *        layout. The delta drives a scrollTop adjustment via
 *        `computeScrollAnchorAdjustment`. useLayoutEffect runs
 *        synchronously after DOM mutation and BEFORE the browser
 *        paints, so the user never sees the intermediate drifted
 *        position. The threshold inside `computeScrollAnchorAdjustment`
 *        absorbs sub-pixel noise to avoid scroll-anchoring fights
 *        with the browser.
 *
 * The anchor capture and the layout effect MUST stay co-located inside
 * this hook — splitting them across a hook boundary breaks the timing
 * (the layout effect would need stable access to a ref set by an
 * external callback, with no guarantee the callback ran in the same
 * synchronous tick as the upcoming commit).
 *
 * Extracted from ConversationPage.tsx (2026-05-31, Commit 6 of
 * PLANS/2026.05.31-conversationpage-decomposition.md). Behavior-preserving.
 */
import { useCallback, useLayoutEffect, useRef, useTransition, type RefObject } from 'react'
import { computeScrollAnchorAdjustment } from '@/components/conversation/expandAllToolsLabel'

interface UseExpandAllToolsAnchorArgs {
  /** Current toggle state. Reading this lets the hook flip it. */
  expandAllTools: boolean
  /** Settings setter — the hook flips inside `startTransition`. */
  setExpandAllTools: (next: boolean) => void
  /** Owned by ConversationPage; multiple sites read it. `current` is
   *  null until the scroll-area div mounts. */
  scrollAreaRef: RefObject<HTMLDivElement | null>
  /** Owned by ConversationPage; uuid → DOM node lookup. The ref is
   *  initialized with `new Map()` so `.current` is always defined. */
  messageRefs: RefObject<Map<string, HTMLDivElement>>
  /** Returns the currently keyboard-selected message uuid, or null. */
  getSelectedMessageId: () => string | null
}

interface UseExpandAllToolsAnchorResult {
  /** Toolbar click handler — captures the anchor + flips the state. */
  handleToggleExpandAll: () => void
  /** True while the React transition is in flight. Drives the button label. */
  isExpandPending: boolean
}

export function useExpandAllToolsAnchor({
  expandAllTools,
  setExpandAllTools,
  scrollAreaRef,
  messageRefs,
  getSelectedMessageId,
}: UseExpandAllToolsAnchorArgs): UseExpandAllToolsAnchorResult {
  const [isExpandPending, startExpandTransition] = useTransition()
  const expandAnchorBeforeRef = useRef<{ uuid: string; top: number } | null>(null)

  const handleToggleExpandAll = useCallback(() => {
    // Capture anchor position synchronously BEFORE the transition queues
    // the state change. Prefer the keyboard-selected message (the one
    // the user actually has focus on); fall back to first message whose
    // top is >= scroll container's top (i.e., first fully visible row).
    //
    // Recovery 2026-05-30 REG-4: drop the forbidden non-null assertions
    // (`.current!`). The Map is always populated — the parent passes a
    // stable `useRef(new Map())` whose `.current` type is `Map<...>` (NOT
    // `Map | null`) in React 19's typings. The `!` was load-bearing only
    // when an earlier RefObject<T>-with-nullable typing leaked through;
    // with the matching args type below, the assertion isn't needed and
    // its removal is behavior-preserving.
    //
    // We deliberately do NOT hoist `messageRefs.current` to a local
    // const. The React Compiler treats that hoist as a `.current` dep
    // and emits `Existing memoization could not be preserved` — see the
    // PLANS post-mortem for the diagnostic chain.
    const selectedId = getSelectedMessageId()
    let anchorUuid: string | null = selectedId ?? null
    if (!anchorUuid && scrollAreaRef.current) {
      const containerTop = scrollAreaRef.current.getBoundingClientRect().top
      for (const [uuid, el] of messageRefs.current.entries()) {
        if (el.getBoundingClientRect().top >= containerTop) {
          anchorUuid = uuid
          break
        }
      }
    }
    if (anchorUuid) {
      const el = messageRefs.current.get(anchorUuid)
      if (el) {
        expandAnchorBeforeRef.current = { uuid: anchorUuid, top: el.getBoundingClientRect().top }
      }
    }
    startExpandTransition(() => {
      setExpandAllTools(!expandAllTools)
    })
  }, [expandAllTools, setExpandAllTools, getSelectedMessageId, scrollAreaRef, messageRefs])

  // Restore the captured anchor's viewport top after the transition
  // commits the new layout. useLayoutEffect runs synchronously after
  // DOM mutations and BEFORE the browser paints, so the user never
  // sees the intermediate (drifted) scroll position.
  useLayoutEffect(() => {
    const before = expandAnchorBeforeRef.current
    if (!before || !scrollAreaRef.current) return
    const el = messageRefs.current.get(before.uuid)
    if (!el) {
      expandAnchorBeforeRef.current = null
      return
    }
    const newTop = el.getBoundingClientRect().top
    const delta = computeScrollAnchorAdjustment(before.top, newTop)
    if (delta !== 0) {
      scrollAreaRef.current.scrollTop += delta
    }
    expandAnchorBeforeRef.current = null
  }, [expandAllTools, scrollAreaRef, messageRefs])

  return { handleToggleExpandAll, isExpandPending }
}
