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
import type { SearchResult, SortField, SortOrder } from '@/lib/types'

export interface SearchMatch {
  conversationUuid: string
  messageUuid: string // 'title' for title-only matches
  conversationName: string
  snippet: string
  matchStart: number
  matchEnd: number
  sender: string
  createdAt: string | null
  // Fallback timestamps used when the match has no per-message created_at
  // (e.g. title-only matches, or stale-cache responses from before the
  // backend began emitting per-message timestamps). Mirror backend behavior
  // in search.py: updated_at sort falls back to conversation_updated_at,
  // created_at sort falls back to conversation_created_at.
  conversationUpdatedAt: string
  conversationCreatedAt: string
}

export type SearchContextSize = 'snippet' | 'full'

interface SearchPanelContextType {
  isOpen: boolean
  query: string
  contextSize: SearchContextSize
  sortField: SortField
  sortOrder: SortOrder
  activeMatchIndex: number // -1 = no active match
  flatMatches: SearchMatch[]
  results: SearchResult[] // Raw grouped results (for section headers w/ timestamps)
  isLoading: boolean
  /** True whenever the search is in flight OR the input is debouncing
   *  toward a new query. SearchPanel uses this to show "Searching…"
   *  instead of "No matches" while the user waits for slow responses
   *  (manual finding 2026-05-03). */
  isSearching: boolean
  open: () => void
  close: () => void
  toggle: () => void
  setQuery: (q: string) => void
  setContextSize: (s: SearchContextSize) => void
  setSortField: (f: SortField) => void
  setSortOrder: (o: SortOrder) => void
  nextMatch: () => void
  prevMatch: () => void
  setActiveMatchIndex: (i: number) => void
  // Bumped by callers (Cmd+F handler) that want the SearchPanel to
  // re-focus its input even if the panel is already open. SearchPanel
  // listens to this counter via a useEffect and refocuses the input
  // whenever the value changes. Cmd+F is "find" muscle memory; the user
  // must be able to type the query immediately, regardless of whether
  // the panel was already open.
  focusRequestSeq: number
  requestFocus: () => void
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
  const [sortField, setSortFieldState] = useState<SortField>(() =>
    getStoredValue<SortField>('searchPanel.sortField', 'updated_at')
  )
  const [sortOrder, setSortOrderState] = useState<SortOrder>(() =>
    getStoredValue<SortOrder>('searchPanel.sortOrder', 'desc')
  )
  // Cmd+F focus-request counter. Bumping it triggers SearchPanel's
  // focus-input useEffect even when isOpen hasn't changed.
  const [focusRequestSeq, setFocusRequestSeq] = useState(0)

  // Fetch search results (updated useSearch signature accepts contextSize)
  const { data: rawResults, isLoading, isSearching } = useSearch(
    query,
    sourceFilter,
    contextSize,
    sortField,
    sortOrder
  )

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

  // Flatten results into navigable matches. Matches are then globally
  // re-sorted for time-based sort fields so the newest/oldest matching
  // MESSAGE (not session) lands at the top of the flat list.
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
            createdAt: msg.created_at,
            conversationUpdatedAt: result.conversation_updated_at,
            conversationCreatedAt: result.conversation_created_at,
          })
        }
      } else {
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
          createdAt: null,
          conversationUpdatedAt: result.conversation_updated_at,
          conversationCreatedAt: result.conversation_created_at,
        })
      }
    }

    // Global re-sort by message timestamp for time-based sort fields.
    //
    // Fallback semantics (mirrors backend/search.py:167-179): if a match has
    // no per-message created_at (title-only matches, or stale-cache data
    // from before the backend fix landed), fall back to the conversation's
    // updated_at (for updated_at sort) or created_at (for created_at sort).
    // This prevents two failure modes:
    //  1. Title matches being force-pushed to the bottom regardless of age.
    //  2. Stale-cache responses silently degrading to the server's
    //     session-level order — which is what the user reported as
    //     "sort is by session, not by message".
    //
    // Sort is NaN-guarded: unparseable timestamps deterministically sort
    // last (desc) or first (asc) via ±Infinity, so Array.sort never sees a
    // NaN from the comparator (which is engine-defined behavior).
    if (sortField === 'updated_at' || sortField === 'created_at') {
      const desc = sortOrder === 'desc'

      const toMs = (value: string | null | undefined): number | null => {
        if (!value) return null
        // Normalize microsecond ISO strings (e.g. "...973000Z") to
        // milliseconds before Date.parse. Chromium handles microseconds,
        // but older Safari/Firefox return NaN — cheap defense.
        const normalized = value.replace(/(\.\d{3})\d+Z$/, '$1Z')
        const ms = Date.parse(normalized)
        return Number.isFinite(ms) ? ms : null
      }

      matches.sort((a, b) => {
        const aFallback =
          sortField === 'created_at'
            ? a.conversationCreatedAt
            : a.conversationUpdatedAt
        const bFallback =
          sortField === 'created_at'
            ? b.conversationCreatedAt
            : b.conversationUpdatedAt

        const at = toMs(a.createdAt ?? aFallback) ?? (desc ? -Infinity : Infinity)
        const bt = toMs(b.createdAt ?? bFallback) ?? (desc ? -Infinity : Infinity)

        return desc ? bt - at : at - bt
      })
    }
    return matches
  }, [results, sortField, sortOrder])

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

  const setSortField = useCallback((f: SortField) => {
    setSortFieldState(f)
    localStorage.setItem('searchPanel.sortField', JSON.stringify(f))
  }, [])

  const setSortOrder = useCallback((o: SortOrder) => {
    setSortOrderState(o)
    localStorage.setItem('searchPanel.sortOrder', JSON.stringify(o))
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

  const requestFocus = useCallback(() => {
    // Open the panel if it's closed (so the input is mounted) and bump
    // the focus-request counter so SearchPanel's effect refocuses the
    // input even when isOpen was already true.
    setIsOpen((prev) => {
      if (!prev) {
        localStorage.setItem('searchPanel.isOpen', JSON.stringify(true))
        return true
      }
      return prev
    })
    setFocusRequestSeq((n) => n + 1)
  }, [])

  return (
    <SearchPanelContext.Provider
      value={{
        isOpen,
        query,
        contextSize,
        sortField,
        sortOrder,
        activeMatchIndex,
        flatMatches,
        results,
        isLoading,
        isSearching,
        open,
        close,
        toggle,
        setQuery,
        setContextSize,
        setSortField,
        setSortOrder,
        nextMatch,
        prevMatch,
        setActiveMatchIndex,
        focusRequestSeq,
        requestFocus,
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
