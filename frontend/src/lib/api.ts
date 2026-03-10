import type {
  ConversationSummary,
  ConversationDetail,
  ConversationTree,
  ConversationFilters,
  SearchResult,
  AppConfig,
  ApiError as ApiErrorType,
} from './types'
import { ApiError } from './types'
import { mockConversations, mockConversationDetails, filterConversations } from './mockData'

const BASE_URL = '/api'

// Set to true to use mock data (for development without backend)
const USE_MOCK_DATA = false

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${url}`)
  if (!response.ok) {
    throw new ApiError(response.status, await response.text())
  }
  return response.json()
}

export const api = {
  getConversations: async (filters?: ConversationFilters): Promise<ConversationSummary[]> => {
    if (USE_MOCK_DATA) {
      // Simulate network delay
      await new Promise((resolve) => setTimeout(resolve, 300))
      return filterConversations(mockConversations, filters?.search)
    }
    const params = new URLSearchParams()
    if (filters?.search) params.set('search', filters.search)
    if (filters?.starred !== undefined) params.set('starred', String(filters.starred))
    if (filters?.model) params.set('model', filters.model)
    if (filters?.source) params.set('source', filters.source)
    if (filters?.sort) params.set('sort', filters.sort)
    if (filters?.includePhantom) params.set('include_phantom', 'true')
    const query = params.toString()
    return fetchJson<ConversationSummary[]>(`/conversations${query ? `?${query}` : ''}`)
  },

  getConversation: async (uuid: string): Promise<ConversationDetail> => {
    if (USE_MOCK_DATA) {
      await new Promise((resolve) => setTimeout(resolve, 200))
      const detail = mockConversationDetails[uuid]
      if (!detail) {
        throw new ApiError(404, 'Conversation not found')
      }
      return detail
    }
    return fetchJson<ConversationDetail>(`/conversations/${uuid}`)
  },

  getConversationTree: (uuid: string): Promise<ConversationTree> =>
    fetchJson<ConversationTree>(`/conversations/${uuid}/tree`),

  search: (query: string, source: 'all' | 'CLAUDE_AI' | 'CLAUDE_CODE' = 'all'): Promise<SearchResult[]> => {
    const params = new URLSearchParams({ q: query })
    if (source !== 'all') params.set('source', source)
    return fetchJson<SearchResult[]>(`/search?${params.toString()}`)
  },

  getConfig: (): Promise<AppConfig> => fetchJson<AppConfig>('/config'),

  exportMarkdown: (uuid: string, showToolCalls: boolean = true): Promise<Response> =>
    fetch(`${BASE_URL}/conversations/${uuid}/export/markdown?include_tools=${showToolCalls}`),

  exportPdf: (uuid: string, showToolCalls: boolean = true): Promise<Response> =>
    fetch(`${BASE_URL}/conversations/${uuid}/export/pdf?include_tools=${showToolCalls}`),

  exportAllMarkdown: (): Promise<Response> =>
    fetch(`${BASE_URL}/export/all/markdown`),

  // Fetch operations (Claude Desktop only)
  getFetchStatus: async (): Promise<{
    has_credentials: boolean
    credentials_path: string
    output_dir: string
    existing_count: number
  }> => fetchJson('/fetch/status'),

  // Returns EventSource for SSE streaming
  startFetch: (incremental: boolean = true): EventSource => {
    const params = new URLSearchParams()
    if (!incremental) params.set('incremental', 'false')
    return new EventSource(`${BASE_URL}/fetch/start?${params.toString()}`)
  },
}

export type { ApiErrorType }