import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      retry: (failureCount, error) => {
        // Don't retry 404s
        if (error instanceof Error && 'status' in error && (error as any).status === 404) {
          return false
        }
        // Retry connection errors more times (backend might be starting)
        return failureCount < 5
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000), // Exponential backoff, max 10s
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
  search: (
    query: string,
    source?: string,
    contextSize?: string,
    sort?: string,
    sortOrder?: string,
    scope?: { conversationUuid?: string; projectPath?: string; bookmarks?: string[] },
    // 2026-05-11: include_tool_calls toggles search scope. Must be part
    // of the key so toggling the UI's "Show tool calls" pref re-fires
    // the network request and the cache doesn't return stale results.
    includeToolCalls?: boolean,
  ) => ['search', query, source, contextSize, sort, sortOrder, scope, includeToolCalls] as const,
  config: ['config'] as const,
}