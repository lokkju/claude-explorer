import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useSearch } from '@/hooks/useConversations'
import { useSourceFilter } from '@/contexts/SourceFilterContext'
import type { SearchResult } from '@/lib/types'

export interface SearchMatch {
  conversationUuid: string
  messageUuid: string // 'title' for title-only matches
  conversationName: string
  snippet: string
  matchStart: number
  matchEnd: number
  sender: string
}

export type SearchContextSize = 'snippet' | 'full'

interface SearchPanelContextType {
  isOpen: boolean
  query: string
  contextSize: SearchContextSize
  activeMatchIndex: number // -1 = no active match
  flatMatches: SearchMatch[]
  results: SearchResult[] // Raw grouped results (for section headers w/ timestamps)
  isLoading: boolean
  open: () => void
  close: () => void
  toggle: () => void
  setQuery: (q: string) => void
  setContextSize: (s: SearchContextSize) => void
  nextMatch: () => void
  prevMatch: () => void
  setActiveMatchIndex: (i: number) => void
}

const SearchPanelContext = createContext<SearchPanelContextType | null>(null)

// Helper to read from localStorage with fallback
function getStoredValue<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key)
    if (stored !== null) {
      return JSON.parse(stored) as T
    }
  } catch {
    // Ignore parse errors
  }
  return fallback
}

export function SearchPanelProvider({ children }: { children: ReactNode }) {
  const { sourceFilter } = useSourceFilter()

  const [isOpen, setIsOpen] = useState<boolean>(() =>
    getStoredValue<boolean>('searchPanel.isOpen', false)
  )
  const [contextSize, setContextSizeState] = useState<SearchContextSize>(() =>
    getStoredValue<SearchContextSize>('searchPanel.contextSize', 'snippet')
  )
  const [query, setQueryState] = useState<string>('')
  const [activeMatchIndex, setActiveMatchIndexState] = useState<number>(-1)

  // Fetch search results (updated useSearch signature accepts contextSize)
  const { data: rawResults, isLoading } = useSearch(query, sourceFilter, contextSize)

  // Client-side filter: while the user keeps typing (debounced query hasn't
  // caught up yet), narrow the stale results locally so additional characters
  // feel instantaneous. Also covers the case where conversation name or
  // message snippet contains the new query substring.
  //
  // In snippet mode this can produce false negatives (match context may not
  // include the new chars even if the source message does). Those matches
  // reappear once the debounced backend call resolves. Acceptable tradeoff
  // for instant perceived response.
  const results = useMemo<SearchResult[]>(() => {
    if (!rawResults) return []
    if (!query || query.length < 2) return rawResults
    const lower = query.toLowerCase()
    const filtered: SearchResult[] = []
    for (const r of rawResults) {
      const nameHit = r.conversation_name.toLowerCase().includes(lower)
      const msgMatches = r.matching_messages.filter((m) =>
        m.snippet.toLowerCase().includes(lower)
      )
      if (msgMatches.length > 0 || nameHit) {
        filtered.push({
          ...r,
          matching_messages: msgMatches.length > 0 ? msgMatches : r.matching_messages,
        })
      }
    }
    return filtered
  }, [rawResults, query])

  // Flatten results into navigable matches
  const flatMatches = useMemo<SearchMatch[]>(() => {
    const matches: SearchMatch[] = []
    for (const result of results) {
      const messageMatches = result.matching_messages.filter(
        (m) => m.message_uuid !== 'title'
      )
      if (messageMatches.length > 0) {
        for (const msg of messageMatches) {
          matches.push({
            conversationUuid: result.conversation_uuid,
            messageUuid: msg.message_uuid,
            conversationName: result.conversation_name,
            snippet: msg.snippet,
            matchStart: msg.match_start,
            matchEnd: msg.match_end,
            sender: msg.sender,
          })
        }
      } else {
        // Title-only match — synthesize a SearchMatch with messageUuid = 'title'
        const titleMatch = result.matching_messages.find(
          (m) => m.message_uuid === 'title'
        )
        matches.push({
          conversationUuid: result.conversation_uuid,
          messageUuid: 'title',
          conversationName: result.conversation_name,
          snippet: titleMatch?.snippet ?? result.conversation_name,
          matchStart: titleMatch?.match_start ?? 0,
          matchEnd: titleMatch?.match_end ?? 0,
          sender: titleMatch?.sender ?? '',
        })
      }
    }
    return matches
  }, [results])

  // Reset activeMatchIndex whenever the query changes
  useEffect(() => {
    setActiveMatchIndexState(-1)
  }, [query])

  const open = useCallback(() => {
    setIsOpen(true)
    localStorage.setItem('searchPanel.isOpen', JSON.stringify(true))
  }, [])

  const close = useCallback(() => {
    setIsOpen(false)
    localStorage.setItem('searchPanel.isOpen', JSON.stringify(false))
  }, [])

  const toggle = useCallback(() => {
    setIsOpen((prev) => {
      const next = !prev
      localStorage.setItem('searchPanel.isOpen', JSON.stringify(next))
      return next
    })
  }, [])

  const setQuery = useCallback((q: string) => {
    setQueryState(q)
  }, [])

  const setContextSize = useCallback((s: SearchContextSize) => {
    setContextSizeState(s)
    localStorage.setItem('searchPanel.contextSize', JSON.stringify(s))
  }, [])

  const setActiveMatchIndex = useCallback((i: number) => {
    setActiveMatchIndexState(i)
  }, [])

  const nextMatch = useCallback(() => {
    if (flatMatches.length === 0) return
    setActiveMatchIndexState((prev) => {
      if (prev < 0) return 0
      return (prev + 1) % flatMatches.length
    })
  }, [flatMatches.length])

  const prevMatch = useCallback(() => {
    if (flatMatches.length === 0) return
    setActiveMatchIndexState((prev) => {
      if (prev < 0) return flatMatches.length - 1
      return (prev - 1 + flatMatches.length) % flatMatches.length
    })
  }, [flatMatches.length])

  return (
    <SearchPanelContext.Provider
      value={{
        isOpen,
        query,
        contextSize,
        activeMatchIndex,
        flatMatches,
        results,
        isLoading,
        open,
        close,
        toggle,
        setQuery,
        setContextSize,
        nextMatch,
        prevMatch,
        setActiveMatchIndex,
      }}
    >
      {children}
    </SearchPanelContext.Provider>
  )
}

export function useSearchPanel() {
  const context = useContext(SearchPanelContext)
  if (!context) {
    throw new Error('useSearchPanel must be used within a SearchPanelProvider')
  }
  return context
}
