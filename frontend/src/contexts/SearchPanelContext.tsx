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
import { useSearchPin } from '@/contexts/SearchPinContext'
import { useBookmarks } from '@/contexts/BookmarkContext'
import { useSettings } from '@/contexts/SettingsContext'
import { usePreferences } from '@/hooks/usePreferences'
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

export function SearchPanelProvider({ children }: { children: ReactNode }) {
  const { sourceFilter } = useSourceFilter()
  const { scope: pinScope } = useSearchPin()
  const { bookmarks } = useBookmarks()
  // 2026-05-11: thread the UI's "Show tool calls" pref into search so
  // the sidebar only shows hits the user can actually navigate to in
  // the conversation pane. When the toggle flips, useSearch's queryKey
  // changes and the network call re-fires automatically.
  const { showToolCalls } = useSettings()

  // P3e: dual-read/dual-write via usePreferences. The hook resolves
  // value as server.data[key] ?? localStorage[key] ?? fallback, and
  // setValue mirrors to BOTH server (PATCH /api/preferences) and
  // localStorage under the SAME legacy key — so existing browser
  // sessions keep working without a key rename.
  const [isOpen, setIsOpenPref] = usePreferences<boolean>(
    'searchPanel.isOpen',
    false,
  )
  const [contextSize, setContextSizePref] = usePreferences<SearchContextSize>(
    'searchPanel.contextSize',
    'snippet',
  )
  const [sortField, setSortFieldPref] = usePreferences<SortField>(
    'searchPanel.sortField',
    'updated_at',
  )
  const [sortOrder, setSortOrderPref] = usePreferences<SortOrder>(
    'searchPanel.sortOrder',
    'desc',
  )
  const [query, setQueryState] = useState<string>('')
  const [activeMatchIndex, setActiveMatchIndexState] = useState<number>(-1)
  // Cmd+F focus-request counter. Bumping it triggers SearchPanel's
  // focus-input useEffect even when isOpen hasn't changed.
  const [focusRequestSeq, setFocusRequestSeq] = useState(0)

  // Pin scope passed to useSearch. Pinned conversation/project is the
  // explicit user signal and always wins over the sidebar Source filter.
  // Bookmarks-as-scope plumbing exists end-to-end (api.search /
  // /api/search) for a future Starred sidebar value; not wired here yet.
  const scope = useMemo(() => {
    if (pinScope.kind === 'conversation') return { conversationUuid: pinScope.uuid }
    if (pinScope.kind === 'project') return { projectPath: pinScope.path }
    return undefined
  }, [pinScope])
  void bookmarks

  // Fetch search results (updated useSearch signature accepts contextSize)
  const { data: rawResults, isLoading, isSearching } = useSearch(
    query,
    sourceFilter,
    contextSize,
    sortField,
    sortOrder,
    scope,
    showToolCalls,
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

  // V1 polish: auto-focus the first match when results land for a fresh
  // query. Without this, the user types "needle", sees results in the
  // sidebar, but the conversation panel doesn't move — they have to
  // press Cmd+G or click a card to bootstrap navigation.
  //
  // Each gate is load-bearing:
  //   * !isSearching — wait for debounce + network to settle so we
  //     don't jump mid-keystroke (debounce in useSearch is 200ms,
  //     non-zero — verified before shipping).
  //   * flatMatches.length > 0 — don't waste a re-render on empty
  //     results.
  //   * activeMatchIndex === -1 — auto-promote ONCE per stable-query
  //     cycle; never overwrite the user's Cmd+G navigation when results
  //     refresh later (e.g., a new conversation arrives).
  //
  // The existing SearchPanel.tsx:82-93 effect picks up this index
  // change and calls navigateToMatch, which scrolls + ring-highlights
  // (navigateToMatch.ts:46-54) for 2s.
  useEffect(() => {
    if (!isSearching && flatMatches.length > 0 && activeMatchIndex === -1) {
      setActiveMatchIndexState(0)
    }
  }, [isSearching, flatMatches.length, activeMatchIndex])

  const open = useCallback(() => {
    setIsOpenPref(true)
  }, [setIsOpenPref])

  const close = useCallback(() => {
    setIsOpenPref(false)
  }, [setIsOpenPref])

  const toggle = useCallback(() => {
    setIsOpenPref(!isOpen)
  }, [isOpen, setIsOpenPref])

  const setQuery = useCallback((q: string) => {
    setQueryState(q)
  }, [])

  const setContextSize = useCallback(
    (s: SearchContextSize) => {
      setContextSizePref(s)
    },
    [setContextSizePref],
  )

  const setSortField = useCallback(
    (f: SortField) => {
      setSortFieldPref(f)
    },
    [setSortFieldPref],
  )

  const setSortOrder = useCallback(
    (o: SortOrder) => {
      setSortOrderPref(o)
    },
    [setSortOrderPref],
  )

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
    if (!isOpen) {
      setIsOpenPref(true)
    }
    setFocusRequestSeq((n) => n + 1)
  }, [isOpen, setIsOpenPref])

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
