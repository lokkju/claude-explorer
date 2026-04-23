import { useCallback, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/queryClient'
import { api } from '@/lib/api'
import { useKeyboardNavigation } from '@/contexts/KeyboardNavigationContext'
import type { SearchMatch } from '@/contexts/SearchPanelContext'

/**
 * Shared navigation logic for search matches. Fast-paths same-conversation
 * hops (no URL change) and navigates with a `?highlight=` query param for
 * cross-conversation jumps. Used by the SearchPanel.
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
        // Fast path: scroll to the message, no URL navigation
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
          }
          return
        }
      }

      // Cross-conversation: warm the cache if we don't have it yet
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
