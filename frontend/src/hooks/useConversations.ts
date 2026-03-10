import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/queryClient'
import type { ConversationFilters } from '@/lib/types'

export function useConversations(filters?: ConversationFilters) {
  return useQuery({
    queryKey: queryKeys.conversations.list(filters),
    queryFn: () => api.getConversations(filters),
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
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

export function useSearch(query: string, source: 'all' | 'CLAUDE_AI' | 'CLAUDE_CODE' = 'all') {
  return useQuery({
    queryKey: queryKeys.search(query, source),
    queryFn: () => api.search(query, source),
    enabled: query.length >= 2,
    staleTime: 60 * 1000, // 1 minute
  })
}

export function useConfig() {
  return useQuery({
    queryKey: queryKeys.config,
    queryFn: () => api.getConfig(),
    staleTime: Infinity,
  })
}