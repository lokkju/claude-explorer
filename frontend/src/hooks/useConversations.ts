import { useMemo, useState, useEffect } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/queryClient'
import type { ConversationFilters } from '@/lib/types'

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

export function useConversation(uuid: string) {
  return useQuery({
    queryKey: queryKeys.conversations.detail(uuid),
    queryFn: () => api.getConversation(uuid),
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
  contextSize: 'snippet' | 'full' = 'snippet'
) {
  const [debouncedQuery, setDebouncedQuery] = useState(query)

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 200)
    return () => clearTimeout(id)
  }, [query])

  return useQuery({
    queryKey: queryKeys.search(debouncedQuery, source, contextSize),
    queryFn: () => api.search(debouncedQuery, source, contextSize),
    enabled: debouncedQuery.length >= 2,
    staleTime: 60 * 1000, // 1 minute
    placeholderData: keepPreviousData, // keep last results visible while narrowing query
  })
}

export function useConfig() {
  return useQuery({
    queryKey: queryKeys.config,
    queryFn: () => api.getConfig(),
    staleTime: Infinity,
  })
}
