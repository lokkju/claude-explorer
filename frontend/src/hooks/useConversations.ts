import { useMemo, useState, useEffect } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/queryClient'
import type { ConversationFilters, SortField, SortOrder } from '@/lib/types'

export function useConversations(
  filters?: ConversationFilters,
  options?: { enabled?: boolean },
) {
  const { search, ...serverFilters } = filters ?? {}

  // Fetch the full list without search — stable cache key across keystrokes.
  //
  // `options.enabled` defaults to true (existing callers unchanged). The
  // SearchPanelProvider opt-in to false when there's no active filter,
  // because: (a) the list is only needed to resolve filter→UUIDs, so
  // fetching it when no filter exists is wasted work, and (b) a fetch
  // in-flight during page navigation has been observed to trip
  // Chromium's net::ERR_NETWORK_CHANGED on reload in headless
  // Playwright (2026-05-15 regression diagnosis). Gating the fetch
  // avoids both costs.
  // staleTime/gcTime are inherited from queryClient.setQueryDefaults
  // for the ['conversations', 'list'] key prefix (see lib/queryClient.ts).
  // Task A6 (2026-05-18): list is 30s — refresh aggressively now that the
  // backend warm path is ~87ms.
  const query = useQuery({
    queryKey: queryKeys.conversations.list(serverFilters),
    queryFn: () => api.getConversations(serverFilters),
    enabled: options?.enabled ?? true,
  })

  // Filter client-side — no network round-trip per keystroke.
  // Scope: title (`name`) OR `project_path` only. Intentionally NOT
  // `summary`, because users typing in the sidebar's "Search titles
  // and projects" input expect the placeholder's promise: matches must
  // come from the title or the project path, not the body summary.
  // (P1.2, 2026-05-04.)
  const data = useMemo(() => {
    if (!search?.trim() || !query.data) return query.data
    const lower = search.toLowerCase()
    return query.data.filter(c =>
      c.name.toLowerCase().includes(lower) ||
      (c.project_path ?? '').toLowerCase().includes(lower)
    )
  }, [query.data, search])

  return { ...query, data }
}

export function useConversation(uuid: string, leaf?: string) {
  // staleTime is inherited from queryClient.setQueryDefaults for the
  // ['conversations', 'detail'] key prefix (see lib/queryClient.ts).
  // Task A6 (2026-05-18): detail is 5min — previously Infinity, which
  // suppressed refetchOnWindowFocus and let the fetch pipeline's new
  // messages stay invisible until a hard refresh.
  return useQuery({
    queryKey: leaf
      ? [...queryKeys.conversations.detail(uuid), 'leaf', leaf]
      : queryKeys.conversations.detail(uuid),
    queryFn: () => api.getConversation(uuid, leaf),
    enabled: !!uuid,
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
  sortOrder: SortOrder = 'desc',
  scope: {
    conversationUuid?: string
    projectPath?: string
    bookmarks?: string[]
    // 2026-05-14 sidebar-scope propagation: workspace + active-filter set.
    organizationId?: string | null
    conversationUuids?: string[]
  } | undefined = undefined,
  // 2026-05-11: REQUIRED, no default. Threaded all the way down to the
  // /api/search query param. Mandatory so any future call site is
  // forced (via TypeScript) to wire in useSettings().showToolCalls
  // rather than silently inheriting an unfiltered default — which
  // would re-introduce the sidebar/conv-pane mismatch bug.
  includeToolCalls: boolean,
) {
  const [debouncedQuery, setDebouncedQuery] = useState(query)

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 200)
    return () => clearTimeout(id)
  }, [query])

  const queryResult = useQuery({
    // Include includeToolCalls in the key so toggling re-fires the network
    // call and React Query doesn't return a stale cached payload that
    // contains tool-block snippets.
    queryKey: queryKeys.search(debouncedQuery, source, contextSize, sort, sortOrder, scope, includeToolCalls),
    queryFn: () => api.search(debouncedQuery, source, contextSize, sort, sortOrder, scope, includeToolCalls),
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
