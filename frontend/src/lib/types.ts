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
  git_branch?: string | null
  subagents?: SubagentSummary[]
}

export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'image'
  text?: string
  name?: string // tool_use
  input?: unknown // tool_use
  content?: ContentBlock[] // tool_result
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
  files: unknown[]
}

export interface ConversationDetail extends ConversationSummary {
  messages: Message[]
  current_leaf_message_uuid: string
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
}

export interface SearchResult {
  conversation_uuid: string
  conversation_name: string
  conversation_updated_at: string
  matching_messages: MessageSnippet[]
}

// Filter types

export type SourceFilter = 'all' | 'CLAUDE_AI' | 'CLAUDE_CODE'

export interface ConversationFilters {
  search?: string
  starred?: boolean
  model?: string
  source?: SourceFilter
  sort?: 'updated_at' | 'created_at' | 'name'
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