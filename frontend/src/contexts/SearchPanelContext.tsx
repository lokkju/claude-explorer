import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useConversations, useSearch } from '@/hooks/useConversations'
import { useSourceFilter } from '@/contexts/SourceFilterContext'
import { useSearchPin } from '@/contexts/SearchPinContext'
import { useBookmarks } from '@/contexts/BookmarkContext'
import { useSettings } from '@/contexts/SettingsContext'
import { useFilters } from '@/contexts/FilterContext'
import { applyActiveFilter } from '@/lib/filterEngine'
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
  const { sourceFilter, organizationId } = useSourceFilter()
  const { scope: pinScope } = useSearchPin()
  const { bookmarks } = useBookmarks()
  // 2026-05-11: thread the UI's "Show tool calls" pref into search so
  // the sidebar only shows hits the user can actually navigate to in
  // the conversation pane. When the toggle flips, useSearch's queryKey
  // changes and the network call re-fires automatically.
  const { showToolCalls } = useSettings()
  // 2026-05-14 sidebar-scope propagation: the active-filter graph lives
  // in FilterContext, the sidebar applies it client-side via
  // applyActiveFilter(). For search to honor the SAME predicate, we
  // need the conversation list (post source + workspace) and the filter
  // state. The list comes from useConversations with the same scope
  // params the sidebar uses; we then map+filter to UUIDs.
  const { filtersState } = useFilters()
  // Only fetch the conversation list when there's an enabled active
  // filter (we need it to resolve filter→UUIDs). With no active filter,
  // SearchPanel doesn't need the list, and an unconditional fetch on
  // mount tripped net::ERR_NETWORK_CHANGED in Playwright page.reload()
  // calls (2026-05-15). The Sidebar still fetches independently — same
  // queryKey, so when the filter eventually activates the cache is
  // already warm via TanStack Query dedupe.
  const needsConversationList = !!filtersState.activeId &&
    !!filtersState.nodes[filtersState.activeId]?.enabled
  const conversationsQuery = useConversations(
    {
      source: sourceFilter,
      organization_id: organizationId ?? undefined,
    },
    { enabled: needsConversationList },
  )

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

  // 2026-05-14 sidebar-scope propagation: the set of UUIDs that PASS the
  // active-filter graph. undefined → no constraint (filter is null OR
  // passes everything). Empty array → "filter excludes everything"
  // (backend short-circuits to empty results).
  //
  // Performance: applyActiveFilter is glob/regex on conversation NAME;
  // for a 1500-conv corpus this is a sub-millisecond loop. Re-runs
  // only when the conversation list or filter state changes.
  //
  // The "no-op short-circuit" (passing.length === total.length) keeps
  // us from sending a payload at all when the filter is permissive.
  // It does NOT save us from "almost all" cases (1499/1500 passing) —
  // for those, api.search switches to POST automatically.
  const conversationsList = conversationsQuery.data
  const passingUuids = useMemo<string[] | undefined>(() => {
    if (!conversationsList) return undefined
    if (!filtersState.activeId) return undefined
    const activeNode = filtersState.nodes[filtersState.activeId]
    if (!activeNode || !activeNode.enabled) return undefined
    const passing = conversationsList.filter((c) =>
      applyActiveFilter(c.name, filtersState),
    )
    if (passing.length === conversationsList.length) return undefined
    return passing.map((c) => c.uuid)
  }, [conversationsList, filtersState])

  // Pin scope passed to useSearch. Pinned conversation/project is the
  // explicit user signal and always wins over the sidebar Source filter.
  // Bookmarks-as-scope plumbing exists end-to-end (api.search /
  // /api/search) for a future Starred sidebar value; not wired here yet.
  //
  // 2026-05-14 sidebar-scope propagation: organizationId (workspace
  // dropdown) and conversationUuids (active-filter set) compose into the
  // same scope object. queryKey changes when any of these flip → search
  // auto re-fires (spec invariant I4). When the user has pinned a
  // conversation, that pin remains the most-specific filter on the
  // BACKEND side (search.py strips conversation_uuids when
  // conversation_uuid is set), so we still pass the workspace and the
  // filter set without breaking the precedence rule.
  const scope = useMemo(() => {
    const out: {
      conversationUuid?: string
      projectPath?: string
      organizationId?: string | null
      conversationUuids?: string[]
    } = {}
    if (pinScope.kind === 'conversation') out.conversationUuid = pinScope.uuid
    if (pinScope.kind === 'project') out.projectPath = pinScope.path
    if (organizationId) out.organizationId = organizationId
    if (passingUuids !== undefined) out.conversationUuids = passingUuids
    // Return undefined when there's truly no constraint, so the cache
    // key stays minimal for the common case.
    if (Object.keys(out).length === 0) return undefined
    return out
  }, [pinScope, organizationId, passingUuids])
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
  // Multi-word AND semantics (V1 polish 2026-05-14): when the query contains
  // whitespace we require every WORD (case-insensitive substring) to appear
  // in the snippet — NOT the literal whole-query substring. With AND-of-tokens
  // backend semantics, scattered tokens within a snippet are valid hits, so
  // a literal `.includes(lower)` check would falsely drop them. Quoted phrase
  // queries (`"foo bar baz"`) keep the literal-substring contract by stripping
  // the quotes and matching the inner phrase.
  //
  // In snippet mode this can still produce false negatives (one token may live
  // outside the ±150 char snippet window). Those matches reappear once the
  // debounced backend call resolves. Acceptable tradeoff for instant feel.
  const results = useMemo<SearchResult[]>(() => {
    if (!rawResults) return []
    if (!query || query.length < 2) return rawResults
    const trimmed = query.trim()
    let needles: string[]
    if (
      trimmed.length >= 3 &&
      trimmed.startsWith('"') &&
      trimmed.endsWith('"')
    ) {
      // Phrase mode — strip quotes; match the literal inner phrase.
      const inner = trimmed.slice(1, -1).trim().toLowerCase()
      needles = inner ? [inner] : []
    } else {
      needles = trimmed.toLowerCase().split(/\s+/).filter(Boolean)
    }
    if (needles.length === 0) return rawResults
    const filtered: SearchResult[] = []
    for (const r of rawResults) {
      const nameLower = r.conversation_name.toLowerCase()
      const nameHit = needles.every((n) => nameLower.includes(n))
      const msgMatches = r.matching_messages.filter((m) => {
        const snippetLower = m.snippet.toLowerCase()
        return needles.every((n) => snippetLower.includes(n))
      })
      if (msgMatches.length > 0 || nameHit) {
        filtered.push({
          ...r,
          matching_messages: msgMatches.length > 0 ? msgMatches : r.matching_messages,
        })
      }
    }
    return filtered
  }, [rawResults, query])

  // Flatten results into navigable matches. The order is conversation-major,
  // message-minor — exactly the shape the backend returns from
  // `_sort_results` in `backend/search.py:_sort_results`. The backend is
  // the SINGLE SOURCE OF TRUTH for sort field + sort order; the frontend
  // does NOT re-sort.
  //
  // Sort contract (V1 polish 2026-05-14, Bug B SECOND fix):
  //   * Conversation-level sort key is `conversation_updated_at` (or
  //     `conversation_created_at`) directly — matching the date label
  //     the UI renders in each result card.
  //   * Within a conversation, messages sort by their own `created_at`
  //     (null → conversation_updated_at fallback). That's intentional:
  //     multiple matched messages inside the same conv group should
  //     appear in time order under the conv's title.
  //   * The previous version used `max(matched_msg.created_at)` as the
  //     conv-level key. That inverted the visible date column for any
  //     conv where the matched body was older than the conv's most
  //     recent activity. See backend/tests/test_search_sort_by_conversation_updated_at.py
  //     for the pin.
  //
  // `sortField`/`sortOrder` are NOT dependencies of this useMemo because
  // the backend already sorted `results`; the queryKey on `useSearch`
  // re-fires the request whenever they change, and `results` is re-derived
  // from `rawResults`.
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
    return matches
  }, [results])

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
