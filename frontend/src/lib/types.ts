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

export interface ConversationSummary {
  uuid: string
  name: string
  summary: string
  model: string
  created_at: string
  updated_at: string
  is_starred: boolean
  is_temporary: boolean
  message_count: number
  human_message_count: number
  has_branches: boolean
  source: ConversationSource
  project_path?: string | null
  project_name?: string | null
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
  type: 'text' | 'tool_use' | 'tool_result' | 'image'
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