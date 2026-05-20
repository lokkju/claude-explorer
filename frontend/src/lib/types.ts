// Conversation types

export type ConversationSource = 'CLAUDE_AI' | 'CLAUDE_CODE'

export interface SubagentSummary {
  uuid: string
  agent_id: string
  name: string
  model: string
  created_at: string
  updated_at: string
  message_count: number
}

// Skinny per-row payload served by `/api/conversations`. Mirrors the
// backend's `ConversationListItem` (backend/models.py). Three fields
// from `ConversationSummary` (summary, human_message_count, git_branch)
// are intentionally absent here because:
//
//   - `summary` is only consumed by the backend's server-side
//     `?search=` filter (runs BEFORE the projection) and by MCP
//     `export_session`. The sidebar never renders it.
//   - `human_message_count` is only consumed by MCP `list_sessions`.
//     The sidebar never renders it.
//   - `git_branch` is only rendered by the conversation detail page,
//     which goes through `ConversationDetail` (which still extends
//     `ConversationSummary`, where the field stays).
//
// See PLANS/SPLIT_CONVERSATION_SCHEMA.md.
export interface ConversationListItem {
  uuid: string
  name: string
  model: string
  created_at: string
  updated_at: string
  is_starred: boolean
  message_count: number
  has_branches: boolean
  source: ConversationSource
  project_path?: string | null
  project_name?: string | null
  // cowork-multi-org C6: workspace metadata. Null for legacy untagged
  // JSONs that haven't been re-fetched yet.
  organization_id?: string | null
  organization_name?: string | null
  subagents?: SubagentSummary[]
}

// Full per-conversation payload. Returned by `GET /api/conversations/{uuid}`
// and extended by `ConversationDetail`. The three fields below
// (`summary`, `human_message_count`, `git_branch`) are STRIPPED from
// the `/api/conversations` LIST wire format (see `ConversationListItem`
// above) but stay on this interface because the per-conversation
// endpoint, MCP tools, and the detail-page render path all read them.
export interface ConversationSummary {
  uuid: string
  name: string
  // Stays on ConversationSummary because the backend's
  // /api/conversations?search= filter matches against it (server-side,
  // BEFORE the ConversationListItem projection runs) and MCP
  // `export_session` threads it through the sliced ConversationDetail.
  // Stripped from `ConversationListItem` — the sidebar never renders it.
  summary: string
  model: string
  created_at: string
  updated_at: string
  is_starred: boolean
  message_count: number
  // Stays on ConversationSummary for the MCP server's public
  // `list_sessions` output (mcp_server/SPEC.md). Stripped from
  // `ConversationListItem` — not consumed by the frontend.
  human_message_count: number
  has_branches: boolean
  source: ConversationSource
  project_path?: string | null
  project_name?: string | null
  // Stays on ConversationSummary for ConversationPage's Details
  // disclosure (ConversationDetail extends this interface, so the
  // field must live here). Stripped from `ConversationListItem` —
  // the sidebar never renders it.
  git_branch?: string | null
  // cowork-multi-org C6: workspace metadata. Null for legacy untagged
  // JSONs that haven't been re-fetched yet.
  organization_id?: string | null
  organization_name?: string | null
  subagents?: SubagentSummary[]
}

// cowork-multi-org C6: workspace selector source.
export interface Org {
  org_id: string
  name: string | null
  is_primary: boolean
}

export interface OrgsResponse {
  authenticated: boolean
  orgs: Org[]
}

export interface ImageBlockSource {
  type: 'base64' | 'url'
  // base64
  media_type?: string
  data?: string
  // url variant (claude.ai sometimes uses this for hosted refs)
  url?: string
}

export interface ContentBlock {
  // 'thinking' carries Claude's internal reasoning text (CC + extended-
  // thinking-enabled Desktop). The V1 viewer has no `case 'thinking':`
  // renderer in MessageBubble.tsx — these blocks are silently dropped
  // from the rendered output (paired with the backend search exclusion
  // in search.py:_extract_searchable_text). The type is included here
  // so the field round-trips through the API without TypeScript
  // narrowing it to `never`, and so any future "Show thinking"
  // affordance can branch on it without re-widening the union.
  type: 'text' | 'tool_use' | 'tool_result' | 'image' | 'thinking'
  text?: string
  name?: string // tool_use
  input?: unknown // tool_use
  content?: ContentBlock[] // tool_result
  // image content blocks (Claude Code embeds images inline as base64
  // here, alongside a sibling text block that carries the "[Image #N]"
  // marker).
  source?: ImageBlockSource
}

// Image asset metadata (thumbnail or preview variant). Returned by
// claude.ai's chat_conversations API inside Message.files / files_v2.
export interface ImageAsset {
  url: string
  file_variant?: string
  primary_color?: string
  image_width?: number
  image_height?: number
}

export interface ImageFile {
  file_kind: 'image' | string
  file_uuid: string
  file_name: string
  created_at: string
  thumbnail_url?: string
  thumbnail_asset?: ImageAsset
  preview_asset?: ImageAsset
  // Other file_kind values (e.g. 'document') exist; they're carried through
  // but the renderer only treats file_kind === 'image' specially.
}

export interface Message {
  uuid: string
  sender: 'human' | 'assistant'
  text: string
  content: ContentBlock[]
  created_at: string
  updated_at: string
  truncated: boolean
  parent_message_uuid: string | null
  attachments: unknown[]
  files: ImageFile[]
  // claude.ai sometimes ships a v2 array alongside the legacy 'files'
  // with overlapping entries. Render after deduping by file_uuid.
  files_v2?: ImageFile[]
  // CC-only flags emitted by the backend's collapse/fold/prelude passes
  // for slash-command boilerplate (V1 polish, 2026-05-12). Absent on
  // Desktop messages and on regular CC turns.
  //   - is_command_marker: this row is the synthetic "Session: /foo"
  //     marker that replaces a /exit-style triplet.
  //   - is_prelude: this marker is part of the LEADING run of session
  //     prelude markers. The ConversationPage hides these by default
  //     and surfaces them via <SessionPreludeAffordance />.
  //   - assistant_canned_response_consumed: the marker absorbed CC's
  //     literal "No response requested." reply. Carried for debugging
  //     / future UI surfacing; renderers currently ignore it.
  is_command_marker?: boolean
  is_prelude?: boolean
  assistant_canned_response_consumed?: boolean
  // Slash-command name (e.g. "/coding", "/plan") for CC command-marker
  // rows; null/undefined for any other message. V1 polish round 3,
  // 2026-05-12 — paired with the args-preservation change that puts the
  // user's real prompt text into `Message.text` when the command carried
  // `<command-args>`. The MessageBubble renders a muted
  // `<SlashCommandBadge command="/coding" />` above the body whenever
  // this is truthy. Render guard MUST be `if (message.slash_command)`
  // so empty-string / null / undefined are all skipped.
  slash_command?: string | null
}

export interface CompactMarker {
  message_uuid: string
  summary_text: string
  timestamp: string
  kind: 'auto' | 'manual'
  user_prompt: string | null
}

export interface ConversationDetail extends ConversationSummary {
  messages: Message[]
  current_leaf_message_uuid: string
  file_path?: string | null
  compact_markers?: CompactMarker[]
  // CC-only count of LEADING is_prelude messages (V1 polish, 2026-05-12).
  // 0 for Desktop conversations and for CC conversations whose first
  // message isn't a slash-command marker.
  prelude_hidden_count?: number
}

export interface MessageNode {
  message: Message
  children: MessageNode[]
}

export interface ConversationTree {
  uuid: string
  root_messages: MessageNode[]
  active_path: string[]
}

// Search types

export interface MessageSnippet {
  message_uuid: string
  sender: string
  snippet: string
  match_start: number
  match_end: number
  created_at: string | null
}

export interface SearchResult {
  conversation_uuid: string
  conversation_name: string
  conversation_updated_at: string
  conversation_created_at: string
  project_name: string | null
  matching_messages: MessageSnippet[]
}

// Filter types

export type SourceFilter = 'all' | 'CLAUDE_AI' | 'CLAUDE_CODE'

export type SortField = 'updated_at' | 'created_at' | 'name' | 'project'
export type SortOrder = 'asc' | 'desc'

export interface ConversationFilters {
  search?: string
  starred?: boolean
  model?: string
  source?: SourceFilter
  sort?: SortField
  sortOrder?: SortOrder
  includePhantom?: boolean
  // cowork-multi-org C6: filter conversations by workspace.
  organization_id?: string
}

// Bookmark types

export interface Bookmark {
  id: string
  conversation_id: string
  message_uuid: string
  source: 'claude_code' | 'claude_desktop'
  created_at: string
  note: string
  snippet: string
}

// Config types

export interface AppConfig {
  data_dir: string
}

export interface AppConfigStats extends AppConfig {
  conversation_count: number
}

// API Error

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}