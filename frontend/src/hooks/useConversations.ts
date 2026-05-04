import { useMemo, useState, useEffect } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/queryClient'
import type { ConversationFilters, SortField, SortOrder } from '@/lib/types'

export function useConversations(filters?: ConversationFilters) {
  const { search, ...serverFilters } = filters ?? {}

  // Fetch the full list without search — stable cache key across keystrokes
  const query = useQuery({
    queryKey: queryKeys.conversations.list(serverFilters),
    queryFn: () => api.getConversations(serverFilters),
    staleTime: 5 * 60 * 1000, // 5 minutes
  })

  // Filter client-side — no network round-trip per keystroke
  const data = useMemo(() => {
    if (!search?.trim() || !query.data) return query.data
    const lower = search.toLowerCase()
    return query.data.filter(c =>
      c.name.toLowerCase().includes(lower) ||
      (c.summary ?? '').toLowerCase().includes(lower) ||
      (c.project_path ?? '').toLowerCase().includes(lower)
    )
  }, [query.data, search])

  return { ...query, data }
}

export function useConversation(uuid: string, leaf?: string) {
  return useQuery({
    queryKey: leaf
      ? [...queryKeys.conversations.detail(uuid), 'leaf', leaf]
      : queryKeys.conversations.detail(uuid),
    queryFn: () => api.getConversation(uuid, leaf),
    enabled: !!uuid,
    staleTime: Infinity, // Conversation content doesn't change
  })
}

export function useConversationTree(uuid: string) {
  return useQuery({
    queryKey: queryKeys.conversations.tree(uuid),
    queryFn: () => api.getConversationTree(uuid),
    enabled: !!uuid,
    staleTime: Infinity,
  })
}

export function useSearch(
  query: string,
  source: 'all' | 'CLAUDE_AI' | 'CLAUDE_CODE' = 'all',
  contextSize: 'snippet' | 'full' = 'snippet',
  sort: SortField = 'updated_at',
  sortOrder: SortOrder = 'desc'
) {
  const [debouncedQuery, setDebouncedQuery] = useState(query)

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 200)
    return () => clearTimeout(id)
  }, [query])

  const queryResult = useQuery({
    queryKey: queryKeys.search(debouncedQuery, source, contextSize, sort, sortOrder),
    queryFn: () => api.search(debouncedQuery, source, contextSize, sort, sortOrder),
    enabled: debouncedQuery.length >= 2,
    staleTime: 60 * 1000, // 1 minute
    placeholderData: keepPreviousData, // keep last results visible while narrowing query
  })

  // Bug B (2026-05-03): the SearchPanel needs a unified "is the search
  // in flight or about to be in flight?" signal so it can show a
  // loading affordance instead of a misleading "No matches".
  //
  //   - isLoading: only true on the *first* fetch for a key (TanStack v5).
  //     Subsequent fetches with `placeholderData: keepPreviousData`
  //     leave isLoading=false and surface state via isFetching only.
  //   - isFetching: true whenever any request is in flight (initial OR
  //     refetch).
  //   - The 200ms debounce window is also "search is about to fire"
  //     time, during which we shouldn't claim "No matches" either.
  //
  // We OR all three together into a single flag the consumer can rely
  // on. (We keep the original isLoading on the result so callers that
  // care about first-fetch-only can still discriminate.)
  const debouncing = query.trim() !== debouncedQuery.trim() && query.length >= 2
  const isSearching = queryResult.isLoading || queryResult.isFetching || debouncing

  return { ...queryResult, isSearching }
}

export function useConfigStats() {
  // Slower /config/stats endpoint that populates conversation_count.
  // Use ONLY where the user is willing to wait (e.g. Settings page).
  return useQuery({
    queryKey: ['config-stats'],
    queryFn: () => api.getConfigStats(),
    staleTime: Infinity,
  })
}

export function useConfig() {
  return useQuery({
    queryKey: queryKeys.config,
    queryFn: () => api.getConfig(),
    staleTime: Infinity,
  })
}
