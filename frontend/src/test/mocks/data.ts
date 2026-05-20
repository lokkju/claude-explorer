import type {
  ConversationListItem,
  ConversationSummary,
  ConversationDetail,
  ConversationTree,
  MessageNode,
  Message,
  SearchResult,
  AppConfig,
} from '../../lib/types';

// Sidebar list fixtures use the SKINNY `ConversationListItem` shape
// served by /api/conversations (PLANS/SPLIT_CONVERSATION_SCHEMA.md).
// No `summary`, `human_message_count`, or `git_branch` — those stay
// on `ConversationSummary` for the detail-page fixture
// (`mockConversationDetail`) and on the MCP server's contracts.
export const mockConversations: ConversationListItem[] = [
  {
    uuid: 'conv-1',
    name: 'Building a React App',
    model: 'claude-sonnet-4-6',
    created_at: '2026-03-01T10:00:00Z',
    updated_at: '2026-03-01T12:00:00Z',
    is_starred: true,
    message_count: 10,
    has_branches: false,
    source: 'CLAUDE_AI',
  },
  {
    uuid: 'conv-2',
    name: 'Python Data Analysis',
    model: 'claude-3-opus-20240229',
    created_at: '2026-02-28T14:00:00Z',
    updated_at: '2026-02-28T16:30:00Z',
    is_starred: false,
    message_count: 8,
    has_branches: true,
    source: 'CLAUDE_AI',
  },
  {
    uuid: 'conv-3',
    name: 'Debugging API Errors',
    model: 'claude-sonnet-4-6',
    created_at: '2026-02-27T09:00:00Z',
    updated_at: '2026-02-27T11:00:00Z',
    is_starred: true,
    message_count: 15,
    has_branches: false,
    source: 'CLAUDE_AI',
  },
  {
    uuid: 'conv-4',
    name: 'Learning TypeScript',
    model: 'claude-3-5-sonnet-20241022',
    created_at: '2026-02-26T08:00:00Z',
    updated_at: '2026-02-26T10:00:00Z',
    is_starred: false,
    message_count: 6,
    has_branches: false,
    source: 'CLAUDE_CODE',
  },
];

// Mock messages
export const mockMessages: Message[] = [
  {
    uuid: 'msg-1',
    sender: 'human',
    text: 'How do I create a React component with TypeScript?',
    content: [{ type: 'text', text: 'How do I create a React component with TypeScript?' }],
    created_at: '2026-03-01T10:00:00Z',
    updated_at: '2026-03-01T10:00:00Z',
    truncated: false,
    parent_message_uuid: null,
    attachments: [],
    files: [],
  },
  {
    uuid: 'msg-2',
    sender: 'assistant',
    text: 'Here\'s how to create a React component with TypeScript:\n\n```tsx\nimport React from \'react\';\n\ninterface Props {\n  title: string;\n  count?: number;\n}\n\nexport function MyComponent({ title, count = 0 }: Props) {\n  return (\n    <div>\n      <h1>{title}</h1>\n      <p>Count: {count}</p>\n    </div>\n  );\n}\n```\n\nThis example shows:\n1. Type-safe props with an interface\n2. Optional props with default values\n3. Proper typing for the component',
    content: [{ type: 'text', text: 'Here\'s how to create a React component...' }],
    created_at: '2026-03-01T10:01:00Z',
    updated_at: '2026-03-01T10:01:00Z',
    truncated: false,
    parent_message_uuid: 'msg-1',
    attachments: [],
    files: [],
  },
  {
    uuid: 'msg-3',
    sender: 'human',
    text: 'Can you show me how to add state?',
    content: [{ type: 'text', text: 'Can you show me how to add state?' }],
    created_at: '2026-03-01T10:05:00Z',
    updated_at: '2026-03-01T10:05:00Z',
    truncated: false,
    parent_message_uuid: 'msg-2',
    attachments: [],
    files: [],
  },
  {
    uuid: 'msg-4',
    sender: 'assistant',
    text: 'Sure! Here\'s how to add typed state using useState:\n\n```tsx\nimport React, { useState } from \'react\';\n\ninterface User {\n  name: string;\n  email: string;\n}\n\nexport function UserForm() {\n  const [user, setUser] = useState<User | null>(null);\n  const [loading, setLoading] = useState(false);\n\n  return (\n    <form>\n      {loading ? <p>Loading...</p> : <p>{user?.name}</p>}\n    </form>\n  );\n}\n```',
    content: [{ type: 'text', text: 'Sure! Here\'s how to add typed state...' }],
    created_at: '2026-03-01T10:06:00Z',
    updated_at: '2026-03-01T10:06:00Z',
    truncated: false,
    parent_message_uuid: 'msg-3',
    attachments: [],
    files: [],
  },
];

// Mock message with tool use
export const mockMessageWithToolUse: Message = {
  uuid: 'msg-tool-1',
  sender: 'assistant',
  text: 'Let me read that file for you.',
  content: [
    { type: 'text', text: 'Let me read that file for you.' },
    {
      type: 'tool_use',
      name: 'read_file',
      input: { path: '/src/main.ts', encoding: 'utf-8' },
    },
    {
      type: 'tool_result',
      content: [{ type: 'text', text: 'export function main() {\n  console.log("Hello");\n}' }],
    },
    { type: 'text', text: 'The file contains a simple main function.' },
  ],
  created_at: '2026-03-01T10:10:00Z',
  updated_at: '2026-03-01T10:10:00Z',
  truncated: false,
  parent_message_uuid: 'msg-4',
  attachments: [],
  files: [],
};

// Mock conversation detail. ConversationDetail extends ConversationSummary,
// so the three fields stripped from `ConversationListItem` (summary,
// human_message_count, git_branch) must be re-added here — the
// per-conversation endpoint still serializes them.
const conv1Detail: ConversationSummary = {
  ...mockConversations[0],
  summary: 'Discussion about React best practices',
  human_message_count: 5,
};

export const mockConversationDetail: ConversationDetail = {
  ...conv1Detail,
  messages: mockMessages,
  current_leaf_message_uuid: 'msg-4',
};

// Mock search results
export const mockSearchResults: SearchResult[] = [
  {
    conversation_uuid: 'conv-1',
    conversation_name: 'Building a React App',
    conversation_updated_at: '2026-03-01T12:00:00Z',
    conversation_created_at: '2026-03-01T10:00:00Z',
    project_name: null,
    matching_messages: [
      {
        message_uuid: 'msg-1',
        sender: 'human',
        snippet: 'How do I create a **React** component with TypeScript?',
        match_start: 20,
        match_end: 25,
        created_at: '2026-03-01T11:50:00Z',
      },
    ],
  },
  {
    conversation_uuid: 'conv-2',
    conversation_name: 'Python Data Analysis',
    conversation_updated_at: '2026-02-28T16:30:00Z',
    conversation_created_at: '2026-02-28T15:00:00Z',
    project_name: null,
    matching_messages: [
      {
        message_uuid: 'msg-5',
        sender: 'assistant',
        snippet: 'You can also use **React** Query for data fetching...',
        match_start: 18,
        match_end: 23,
        created_at: '2026-02-28T16:25:00Z',
      },
    ],
  },
];

// Mock app config
export const mockConfig: AppConfig = {
  data_dir: '/Users/test/.claude-explorer/conversations',
};

// Mock conversation tree with branches
const makeMsgNode = (
  uuid: string,
  sender: 'human' | 'assistant',
  text: string,
  parentUuid: string | null,
  children: MessageNode[] = []
): MessageNode => ({
  message: {
    uuid,
    sender,
    text,
    content: [{ type: 'text', text }],
    created_at: '2026-03-01T10:00:00Z',
    updated_at: '2026-03-01T10:00:00Z',
    truncated: false,
    parent_message_uuid: parentUuid,
    attachments: [],
    files: [],
  },
  children,
});

export const mockConversationTree: ConversationTree = {
  uuid: 'conv-2',
  root_messages: [
    makeMsgNode('tree-msg-1', 'human', 'How do I analyze data in Python?', null, [
      makeMsgNode('tree-msg-2', 'assistant', 'You can use pandas for data analysis. Here\'s how:', 'tree-msg-1', [
        makeMsgNode('tree-msg-3', 'human', 'Show me an example with CSV files', 'tree-msg-2', [
          makeMsgNode('tree-msg-4', 'assistant', 'Here\'s how to read a CSV file with pandas...', 'tree-msg-3', []),
        ]),
        // Branch point - alternative follow-up
        makeMsgNode('tree-msg-5', 'human', 'What about Excel files?', 'tree-msg-2', [
          makeMsgNode('tree-msg-6', 'assistant', 'For Excel files, you can use pandas.read_excel()...', 'tree-msg-5', []),
        ]),
      ]),
    ]),
  ],
  active_path: ['tree-msg-1', 'tree-msg-2', 'tree-msg-3', 'tree-msg-4'],
};
