import type {
  ConversationSummary,
  ConversationDetail,
  ConversationTree,
  ConversationFilters,
  OrgsResponse,
  SearchResult,
  SortField,
  SortOrder,
  AppConfig,
  AppConfigStats,
  Bookmark,
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
    if (filters?.sortOrder) params.set('sort_order', filters.sortOrder)
    if (filters?.includePhantom) params.set('include_phantom', 'true')
    if (filters?.organization_id) params.set('organization_id', filters.organization_id)
    const query = params.toString()
    return fetchJson<ConversationSummary[]>(`/conversations${query ? `?${query}` : ''}`)
  },

  getOrgs: (): Promise<OrgsResponse> => fetchJson<OrgsResponse>('/orgs'),

  getConversation: async (uuid: string, leaf?: string): Promise<ConversationDetail> => {
    if (USE_MOCK_DATA) {
      await new Promise((resolve) => setTimeout(resolve, 200))
      const detail = mockConversationDetails[uuid]
      if (!detail) {
        throw new ApiError(404, 'Conversation not found')
      }
      return detail
    }
    const qs = leaf ? `?leaf=${encodeURIComponent(leaf)}` : ''
    return fetchJson<ConversationDetail>(`/conversations/${uuid}${qs}`)
  },

  getConversationTree: (uuid: string): Promise<ConversationTree> =>
    fetchJson<ConversationTree>(`/conversations/${uuid}/tree`),

  search: (
    query: string,
    source: 'all' | 'CLAUDE_AI' | 'CLAUDE_CODE',
    contextSize: 'snippet' | 'full',
    sort: SortField,
    sortOrder: SortOrder,
    scope: { conversationUuid?: string; projectPath?: string; bookmarks?: string[] } | undefined,
    // 2026-05-11: REQUIRED, no default. The backend default is True (for
    // backward compat with external scripts hitting /api/search), but every
    // in-app call site MUST pass the user's showToolCalls preference so
    // hits in hidden tool/thinking blocks don't bleed into the sidebar.
    // Making this mandatory means TypeScript catches any new call site
    // that forgets to wire useSettings().showToolCalls.
    includeToolCalls: boolean,
  ): Promise<SearchResult[]> => {
    const params = new URLSearchParams({ q: query })
    if (source !== 'all') params.set('source', source)
    if (contextSize !== 'snippet') params.set('context_size', contextSize)
    if (sort !== 'updated_at') params.set('sort', sort)
    if (sortOrder !== 'desc') params.set('sort_order', sortOrder)
    if (scope?.conversationUuid) params.set('conversation_uuid', scope.conversationUuid)
    if (scope?.projectPath) params.set('project_path', scope.projectPath)
    if (scope?.bookmarks && scope.bookmarks.length > 0) {
      params.set('bookmarks', scope.bookmarks.join(','))
    }
    // Only append the query param when filtering — keeps URLs short
    // for the common-case (tool calls visible) request.
    if (!includeToolCalls) params.set('include_tool_calls', 'false')
    return fetchJson<SearchResult[]>(`/search?${params.toString()}`)
  },

  getConfig: (): Promise<AppConfig> => fetchJson<AppConfig>('/config'),

  getConfigStats: (): Promise<AppConfigStats> => fetchJson<AppConfigStats>('/config/stats'),

  exportMarkdown: (uuid: string, showToolCalls: boolean = true): Promise<Response> =>
    fetch(`${BASE_URL}/conversations/${uuid}/export/markdown?include_tools=${showToolCalls}`),

  // Issue #4 — Markdown bundle (zip with conversation.md + images/).
  exportMarkdownBundle: (
    uuid: string,
    showToolCalls: boolean = true,
    dialect: 'commonmark' | 'obsidian' = 'commonmark',
  ): Promise<Response> =>
    fetch(
      `${BASE_URL}/conversations/${uuid}/export/markdown-bundle?include_tools=${showToolCalls}&dialect=${dialect}`,
    ),

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
    credentials_age_days: number | null
  }> => fetchJson('/fetch/status'),

  forceRefetchConversation: async (uuid: string): Promise<{ uuid: string; status: string; name: string }> => {
    const r = await fetch(`${BASE_URL}/fetch/conversation/${uuid}`, { method: 'POST' })
    if (!r.ok) {
      // Build-9 Bug 3: surface the backend's friendly `detail` string,
      // not the raw `{"detail":"..."}` JSON. The route now returns
      // user-facing copy in `detail` for 404/401/503; falling back to
      // the raw text only when the body isn't valid JSON.
      const raw = await r.text()
      let message = raw
      try {
        const parsed = JSON.parse(raw)
        if (typeof parsed?.detail === 'string') {
          message = parsed.detail
        }
      } catch {
        // Body isn't JSON — keep the raw text.
      }
      throw new ApiError(r.status, message)
    }
    return r.json()
  },

  // Returns EventSource for SSE streaming
  startFetch: (incremental: boolean = true): EventSource => {
    const params = new URLSearchParams()
    if (!incremental) params.set('incremental', 'false')
    return new EventSource(`${BASE_URL}/fetch/start?${params.toString()}`)
  },

  // Build-9: combined capture + fetch pipeline (the Refresh button's owner).
  startRefresh: (incremental: boolean = true): EventSource => {
    const params = new URLSearchParams()
    if (!incremental) params.set('incremental', 'false')
    return new EventSource(`${BASE_URL}/fetch/refresh?${params.toString()}`)
  },

  // Bookmarks (Build-4)
  listBookmarks: async (): Promise<Bookmark[]> => {
    const r = await fetch(`${BASE_URL}/bookmarks`)
    if (!r.ok) throw new ApiError(r.status, await r.text())
    const body = (await r.json()) as { bookmarks: Bookmark[] }
    return body.bookmarks
  },

  createBookmark: async (input: Omit<Bookmark, 'id' | 'created_at'>): Promise<Bookmark> => {
    const r = await fetch(`${BASE_URL}/bookmarks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!r.ok) throw new ApiError(r.status, await r.text())
    return r.json()
  },

  updateBookmark: async (id: string, partial: Partial<Pick<Bookmark, 'note' | 'snippet'>>): Promise<Bookmark> => {
    const r = await fetch(`${BASE_URL}/bookmarks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(partial),
    })
    if (!r.ok) throw new ApiError(r.status, await r.text())
    return r.json()
  },

  deleteBookmark: async (id: string): Promise<void> => {
    const r = await fetch(`${BASE_URL}/bookmarks/${id}`, { method: 'DELETE' })
    if (!r.ok) throw new ApiError(r.status, await r.text())
  },
}

export type { ApiErrorType }