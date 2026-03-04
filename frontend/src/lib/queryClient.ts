import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      retry: (failureCount, error) => {
        // Don't retry 404s
        if (error instanceof Error && 'status' in error && error.status === 404) {
          return false
        }
        return failureCount < 3
      },
    },
  },
})

// Query keys factory
export const queryKeys = {
  conversations: {
    all: ['conversations'] as const,
    list: (filters?: object) =>
      ['conversations', 'list', filters] as const,
    detail: (uuid: string) => ['conversations', 'detail', uuid] as const,
    tree: (uuid: string) => ['conversations', 'tree', uuid] as const,
  },
  search: (query: string) => ['search', query] as const,
  config: ['config'] as const,
}