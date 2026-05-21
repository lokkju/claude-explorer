import { useCallback, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/queryClient'
import { api } from '@/lib/api'
import { useKeyboardNavigation } from '@/contexts/KeyboardNavigationContext'
import type { SearchMatch } from '@/contexts/SearchPanelContext'

/**
 * Shared navigation logic for search matches. Two-tier strategy:
 *
 *   1. **Fast path** (same conversation, bubble already mounted): scroll
 *      to the bubble in place via `scrollIntoView`, flash a yellow ring
 *      for 2 s, and skip URL navigation. Lowest-latency outcome for the
 *      common case and avoids transient `?highlight=` in the URL bar.
 *
 *   2. **URL fallback** (cross-conversation, OR same-conversation but
 *      bubble not yet mounted): `navigate('/conversations/<uuid>?highlight=<uuid>')`.
 *      `ConversationPage`'s highlight effect (routes/ConversationPage.tsx
 *      ~363-406) owns scroll + ring-flash + focus + URL cleanup.
 *
 * The fast path's "fall through to URL when the bubble isn't mounted"
 * behavior is the bug fix shipped on 2026-05-20. The previous version
 * `return`ed unconditionally after the keyboard-nav state update, even
 * when the synchronous `document.querySelector` returned `null` (React
 * 19 hadn't committed the focus state change yet on large
 * conversations). Result: clicking a search hit on a 15K-message
 * conversation was a no-op. Now the synchronous query is treated as
 * opportunistic — when it fails we hand off to the URL path so the
 * highlight effect can find the bubble after its 100 ms settle.
 *
 * The ring-flash inside the fast path uses a raw `setTimeout` (NOT
 * `useUnmountSafeTimer`) so rapid back-to-back navigations (Cmd+G
 * cycling matches) create independent ring-clear timers — without
 * that, the second click would cancel the first's clear timer and the
 * first match's ring would stick until unmount. Pinned by
 * `e2e/search-auto-focus.spec.ts` "does NOT yank the user back to
 * first match after Cmd+G navigation".
 *
 * Council decision history (2026-05-20): an initial pass collapsed to
 * a single URL path (Option A2). That broke two existing e2e
 * contracts: `search-focus-model` (highlight effect always calls
 * `element.focus()` — steals focus from search input on Cmd+G) and
 * `search-auto-focus` (the highlight effect's shared
 * `scheduleHighlightClear` cancels prior ring-clear timers). Reverted
 * to A1 (this two-tier strategy) after a 3-persona unanimous re-vote.
 * The fast path's accessibility gap (no `.focus()` call on
 * same-conv hits) is a pre-existing behavior preserved by the
 * `search-focus-model` test; a follow-up should address it without
 * the focus-stealing side effect.
 */
export function useNavigateToMatch() {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { setFocusArea, setSelectedMessageIndex, messages, setNavSource } =
    useKeyboardNavigation()

  const currentUuid = useMemo(() => {
    const match = location.pathname.match(/\/conversations\/(.+)/)
    return match?.[1]
  }, [location.pathname])

  const navigateToMatch = useCallback(
    (match: SearchMatch) => {
      const isSameConversation = match.conversationUuid === currentUuid
      const hasRealMessage = match.messageUuid && match.messageUuid !== 'title'

      // Record that this navigation originated from the search panel, so
      // Escape from the detail pane returns focus to the panel rather than
      // the left sidebar.
      setNavSource('search')

      if (isSameConversation && hasRealMessage) {
        // Fast path attempt: only succeeds when the bubble is already
        // committed to the DOM. Otherwise we fall through to the URL
        // navigation branch below.
        const msgIdx = messages.findIndex((m) => m.uuid === match.messageUuid)
        if (msgIdx !== -1) {
          setSelectedMessageIndex(msgIdx)
          setFocusArea('detail')
          const element = document.querySelector(
            `[data-message-uuid="${match.messageUuid}"]`
          )
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' })
            element.classList.add('ring-2', 'ring-yellow-400', 'ring-offset-2')
            setTimeout(() => {
              element.classList.remove(
                'ring-2',
                'ring-yellow-400',
                'ring-offset-2'
              )
            }, 2000)
            return
          }
          // Element not in DOM (e.g. React 19 concurrent render hasn't
          // committed yet on a large conversation, or the bubble's
          // MessageBubble returned null due to filter state churn).
          // Fall through to the URL fallback so ConversationPage's
          // highlight effect (100 ms settle + querySelector) can find
          // the bubble. THIS is the load-bearing change for the
          // 2026-05-20 fix: pre-fix, the code unconditionally
          // `return`ed here and the click became a silent no-op.
        }
      }

      // URL fallback: cross-conversation hops, OR same-conversation
      // hits that couldn't take the fast path. Warm the cache for the
      // cross-conversation case so the destination renders without a
      // loading skeleton.
      const isCached = !!queryClient.getQueryData(
        queryKeys.conversations.detail(match.conversationUuid)
      )
      if (!isCached) {
        queryClient.prefetchQuery({
          queryKey: queryKeys.conversations.detail(match.conversationUuid),
          queryFn: () => api.getConversation(match.conversationUuid),
          staleTime: Infinity,
        })
      }

      navigate(
        `/conversations/${match.conversationUuid}${
          hasRealMessage ? `?highlight=${match.messageUuid}` : ''
        }`
      )
    },
    [
      currentUuid,
      messages,
      setSelectedMessageIndex,
      setFocusArea,
      setNavSource,
      queryClient,
      navigate,
    ]
  )

  return navigateToMatch
}
