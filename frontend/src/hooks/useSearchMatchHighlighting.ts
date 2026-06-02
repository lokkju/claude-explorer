/**
 * useSearchMatchHighlighting — derive the two values that gate
 * search-hit highlighting on the active conversation bubble:
 *
 *   - `activeMatchUuid`     — UUID of the bubble that owns the search
 *     panel's current active match (Cmd+G / card-click / auto-promote).
 *     STABLE while the user is reading; only changes on the next
 *     navigation. The page uses this to decide which single bubble
 *     receives the live `searchQuery` for inline `<mark>` decoration.
 *
 *   - `deferredSearchQuery` — `useDeferredValue(query)` of the raw
 *     SearchPanel query. Lets React deprioritize the bulk re-render
 *     triggered by every keystroke. Paired with the per-bubble
 *     `searchQuery=message.uuid===activeMatchUuid ? deferred : ''`
 *     ternary in `renderBubbleRow.tsx`, this scopes the storm to
 *     a single bubble.
 *
 * Why we take `query` + `activeMatchIndex` + `flatMatches` as args
 * (rather than reading SearchPanelContext directly): the page already
 * subscribes to SearchPanelContext for `isOpen`, `markDemonstratedFocus`,
 * `demonstratedFocusUuidRef`, etc. Adding a second `useSearchPanel()`
 * call here would mean two `useContext(SearchPanelContext)` calls in
 * the same component tree per render — not a performance cascade
 * (same component, same render phase), but unnecessary noise. Same
 * args-in / values-out shape as `useScrollToHighlight`.
 *
 * Perf-regression rationale (2026-05-23, preserved verbatim from the
 * pre-extraction site):
 *
 *   An earlier iteration (c6c31b7) had every MessageBubble subscribe
 *   to SearchPanelContext directly via `useSearchPanelOptional()` so
 *   it could highlight the live query inline. On a 15K-message
 *   conversation, the resulting ALL-bubbles-re-render-per-keystroke
 *   storm locked the main thread for multiple seconds and starved
 *   the smooth-scroll animation that search-hit navigation depends
 *   on. Read `query` ONCE (one context subscription in the page),
 *   defer it (lets React deprioritize the bulk re-render), and
 *   thread it down as a prop. MessageBubble's memo comparator now
 *   includes `searchQuery` so the deferred-value flip actually
 *   short-circuits unchanged subtrees, and scrollIntoView wins its
 *   animation frame.
 *
 * Extracted from ConversationPage.tsx (2026-05-31, Commit 3 of
 * PLANS/2026.05.31-conversationpage-decomposition.md). Behavior-preserving.
 */
import { useDeferredValue } from 'react'
import type { SearchMatch } from '@/contexts/SearchPanelContext'

interface UseSearchMatchHighlightingArgs {
  query: string
  activeMatchIndex: number
  flatMatches: readonly SearchMatch[]
}

interface UseSearchMatchHighlightingResult {
  /** UUID of the message owning the search-panel's active match, or
   *  null when no match is selected (activeMatchIndex < 0) or the
   *  index is out of bounds. */
  activeMatchUuid: string | null
  /** `useDeferredValue(query)` — the deferred version of the live
   *  search input value. */
  deferredSearchQuery: string
}

export function useSearchMatchHighlighting({
  query,
  activeMatchIndex,
  flatMatches,
}: UseSearchMatchHighlightingArgs): UseSearchMatchHighlightingResult {
  const activeMatchUuid =
    activeMatchIndex >= 0 && activeMatchIndex < flatMatches.length
      ? flatMatches[activeMatchIndex]?.messageUuid ?? null
      : null
  const deferredSearchQuery = useDeferredValue(query)
  return { activeMatchUuid, deferredSearchQuery }
}
