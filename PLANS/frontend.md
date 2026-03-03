# Frontend — Detailed Plan

## Overview

A React 18 + TypeScript single-page application for browsing, searching, and exporting
Claude conversations stored as local JSON files. The frontend communicates exclusively
with the FastAPI backend.

**Primary Goals:**
1. Provide a consumer-grade reading experience for archived conversations
2. Visualize conversation branches (messages form trees, not flat lists)
3. Enable full-text search across all conversations
4. Export conversations to Markdown and PDF

---

## Tech Stack

| Library | Version | Purpose |
|---------|---------|---------|
| React | 18.x | UI framework |
| TypeScript | 5.x | Type safety |
| Vite | 5.x | Build tool, dev server |
| Tailwind CSS | 4.x | Utility-first styling |
| shadcn/ui | latest | Radix-based component library |
| TanStack Query | 5.x | Server state, caching, mutations |
| React Router | 7.x | Client-side routing |
| react-markdown | 9.x | Markdown rendering |
| rehype-highlight | 7.x | Syntax highlighting in code blocks |
| Lucide React | latest | Icons |
| date-fns | 3.x | Date formatting |
| cmdk | 1.x | Command palette |

---

## Routes / Pages

| Route | Component | Description |
|-------|-----------|-------------|
| `/` | `HomePage` | Redirects to `/conversations` |
| `/conversations` | `ConversationsPage` | List view with sidebar + empty state |
| `/conversations/:uuid` | `ConversationPage` | Conversation detail view |
| `/conversations/:uuid/tree` | `TreeViewPage` | Full branch tree visualization |
| `/search` | `SearchPage` | Dedicated search results page |
| `/settings` | `SettingsPage` | App configuration (theme, data dir) |

### URL Query Parameters

**`/conversations`**
- `?search=<str>` — filter by search term
- `?starred=true` — show only starred
- `?model=<str>` — filter by model name

**`/search`**
- `?q=<str>` — search query (required)

---

## Component Architecture

### Component Tree

```
App
├── ThemeProvider (dark/light mode)
├── QueryClientProvider (TanStack Query)
└── RouterProvider
    └── RootLayout
        ├── CommandPalette (cmdk, global)
        ├── Sidebar
        │   ├── SidebarHeader
        │   │   ├── Logo
        │   │   └── SearchTrigger
        │   ├── ConversationList
        │   │   ├── ConversationListFilters
        │   │   └── ConversationListItem[] (virtualized)
        │   └── SidebarFooter
        │       ├── ExportAllButton
        │       └── SettingsLink
        └── MainContent (Outlet)
            ├── ConversationPage
            │   ├── ConversationHeader
            │   │   ├── Title
            │   │   ├── MetadataBadges (model, date, count)
            │   │   ├── BranchIndicator
            │   │   └── ExportMenu
            │   ├── MessageList
            │   │   └── MessageBubble[]
            │   │       ├── MessageHeader (sender, timestamp)
            │   │       ├── MessageContent
            │   │       │   ├── MarkdownRenderer
            │   │       │   ├── ToolUseBlock (collapsible)
            │   │       │   └── ToolResultBlock (collapsible)
            │   │       └── BranchSwitcher (if alternates exist)
            │   └── ScrollToBottomFAB
            ├── TreeViewPage
            │   ├── TreeViewHeader
            │   └── BranchTree (recursive)
            │       └── TreeNode[]
            ├── SearchPage
            │   ├── SearchHeader
            │   └── SearchResults
            │       └── SearchResultCard[]
            └── SettingsPage
                ├── ThemeToggle
                ├── DataDirectoryInfo
                └── CacheControls
```

---

## State Management

### Server State (TanStack Query)

All API data is managed via TanStack Query. No Redux or Zustand needed.

#### Query Keys

```typescript
const queryKeys = {
  conversations: {
    all: ['conversations'] as const,
    list: (filters: ConversationFilters) =>
      ['conversations', 'list', filters] as const,
    detail: (uuid: string) =>
      ['conversations', 'detail', uuid] as const,
    tree: (uuid: string) =>
      ['conversations', 'tree', uuid] as const,
  },
  search: (query: string) => ['search', query] as const,
  config: ['config'] as const,
};
```

#### Custom Hooks

```typescript
// List conversations with filters
function useConversations(filters?: ConversationFilters) {
  return useQuery({
    queryKey: queryKeys.conversations.list(filters ?? {}),
    queryFn: () => api.getConversations(filters),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Get single conversation (active branch)
function useConversation(uuid: string) {
  return useQuery({
    queryKey: queryKeys.conversations.detail(uuid),
    queryFn: () => api.getConversation(uuid),
    enabled: !!uuid,
  });
}

// Get full conversation tree
function useConversationTree(uuid: string) {
  return useQuery({
    queryKey: queryKeys.conversations.tree(uuid),
    queryFn: () => api.getConversationTree(uuid),
    enabled: !!uuid,
  });
}

// Full-text search
function useSearch(query: string) {
  return useQuery({
    queryKey: queryKeys.search(query),
    queryFn: () => api.search(query),
    enabled: query.length >= 2,
    staleTime: 60 * 1000, // 1 minute
  });
}

// App config
function useConfig() {
  return useQuery({
    queryKey: queryKeys.config,
    queryFn: () => api.getConfig(),
    staleTime: Infinity, // rarely changes
  });
}
```

### Local State

| State | Scope | Storage | Purpose |
|-------|-------|---------|---------|
| `theme` | Global | localStorage | dark/light mode |
| `sidebarCollapsed` | Global | localStorage | sidebar toggle |
| `selectedConversation` | URL | React Router | current conversation |
| `expandedToolBlocks` | Component | useState | which tool blocks are open |
| `activeBranch` | Component | useState | selected branch path (tree view) |
| `commandPaletteOpen` | Global | useState | cmdk visibility |

---

## Key Components

### ConversationList

**Props:**
```typescript
interface ConversationListProps {
  conversations: ConversationSummary[];
  isLoading: boolean;
  selectedUuid?: string;
  onSelect: (uuid: string) => void;
}
```

**Behavior:**
- Virtualized list for performance (react-window or @tanstack/virtual)
- Starred conversations pinned at top with divider
- Shows loading skeletons during fetch
- Empty state when no conversations match filters
- Keyboard navigation: Arrow keys, Enter to select

**Sub-components:**
- `ConversationListItem` — single row with title, model badge, date, message count
- `ConversationListFilters` — search input, model dropdown, starred toggle

---

### ConversationListItem

**Props:**
```typescript
interface ConversationListItemProps {
  conversation: ConversationSummary;
  isSelected: boolean;
  onClick: () => void;
}
```

**Visual Design:**
```
┌─────────────────────────────────────────┐
│ ★  Conversation Title Here              │
│    claude-sonnet-4-6 · Feb 25 · 42 msgs │
└─────────────────────────────────────────┘
```

- Starred indicator (filled star icon if `is_starred`)
- Title truncated with ellipsis
- Model name as muted badge
- Relative date (e.g., "2 hours ago", "Feb 25")
- Message count
- Selected state: highlighted background
- Hover state: subtle background change
- Branch indicator icon if `has_branches`

---

### MessageBubble

**Props:**
```typescript
interface MessageBubbleProps {
  message: Message;
  isLastInBranch: boolean;
  alternates?: Message[];  // sibling messages at this position
  onSwitchBranch?: (uuid: string) => void;
}
```

**Layout:**
- Human messages: right-aligned, accent background color
- Assistant messages: left-aligned, neutral background, full width available
- Timestamps shown on hover (tooltip) or always in compact mode

**Content Rendering:**
- Text content → `<MarkdownRenderer>`
- Tool use blocks → `<ToolUseBlock>` (collapsible)
- Tool results → `<ToolResultBlock>` (collapsible)
- Attachments → file icons with names
- Images → inline with lightbox on click

---

### MarkdownRenderer

**Props:**
```typescript
interface MarkdownRendererProps {
  content: string;
  className?: string;
}
```

**Implementation:**
```tsx
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';

function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <ReactMarkdown
      className={cn('prose prose-sm dark:prose-invert max-w-none', className)}
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        code: CodeBlock,
        a: ExternalLink,
        img: ZoomableImage,
      }}
    />
  );
}
```

**Custom Components:**
- `CodeBlock` — syntax highlighting, copy button, language badge
- `ExternalLink` — opens in new tab with icon indicator
- `ZoomableImage` — click to expand in modal

---

### ToolUseBlock

**Props:**
```typescript
interface ToolUseBlockProps {
  name: string;
  input: Record<string, unknown>;
  isExpanded: boolean;
  onToggle: () => void;
}
```

**Visual Design:**
```
┌─────────────────────────────────────────┐
│ 🔧 Tool: read_file                    ▼ │
├─────────────────────────────────────────┤
│ {                                       │
│   "path": "/src/main.ts",               │
│   "encoding": "utf-8"                   │
│ }                                       │
└─────────────────────────────────────────┘
```

- Distinct background (muted, slightly tinted)
- Collapsible with chevron indicator
- JSON input displayed with syntax highlighting
- Default: collapsed for tool_use, expanded for brief ones

---

### ToolResultBlock

**Props:**
```typescript
interface ToolResultBlockProps {
  content: ContentBlock[];
  isExpanded: boolean;
  onToggle: () => void;
}
```

**Behavior:**
- Similar to ToolUseBlock but for results
- May contain text, images, or nested content
- Truncate long results with "Show more" button
- Default: collapsed if > 500 characters

---

### BranchSwitcher

**Props:**
```typescript
interface BranchSwitcherProps {
  currentUuid: string;
  alternates: Array<{ uuid: string; preview: string; createdAt: Date }>;
  onSwitch: (uuid: string) => void;
}
```

**Visual Design:**
```
┌─────────────────────────┐
│ Branch 2 of 3  ◀ ▶     │
└─────────────────────────┘
```

- Shows current position in branch list
- Arrow buttons to navigate between branches
- Dropdown to jump to specific branch
- Preview shows first ~50 chars of message

---

### BranchTree

**Props:**
```typescript
interface BranchTreeProps {
  tree: ConversationTree;
  activePath: string[];  // UUIDs of active branch
  onSelectNode: (uuid: string) => void;
}
```

**Visual Design:**
```
     ○ You: "Help me with..."        (root)
     │
     ○ Claude: "Sure, I can..."
     │
     ├─○ You: "Actually..."          (branch 1)
     │ │
     │ ○ Claude: "No problem..."
     │
     └─● You: "What about..."        (branch 2, active)
       │
       ● Claude: "Here's how..."     (current leaf)
```

- Tree rendered vertically
- Active path highlighted (filled circles)
- Inactive branches muted (hollow circles)
- Click node to switch active branch
- Horizontal scroll if tree is wide
- Nodes show sender + preview text

---

### CommandPalette

**Implementation:** Uses `cmdk` library

**Trigger:** `Cmd+K` (Mac) / `Ctrl+K` (Windows/Linux)

**Commands:**
| Command | Shortcut | Action |
|---------|----------|--------|
| Search conversations | (default) | Filter conversation list |
| Go to conversation | `>` prefix | Jump to specific conversation |
| Export current | `Cmd+E` | Export current conversation |
| Export all | `Cmd+Shift+E` | Export all as zip |
| Toggle theme | `Cmd+Shift+T` | Switch dark/light mode |
| Settings | `Cmd+,` | Open settings page |

**Sections:**
1. Recent conversations (last 5 viewed)
2. Starred conversations
3. Search results (live as you type)
4. Actions (export, settings, theme)

---

### ExportMenu

**Props:**
```typescript
interface ExportMenuProps {
  conversationUuid: string;
  conversationName: string;
}
```

**Options:**
- Export as Markdown (.md)
- Export as PDF (.pdf)
- Copy Markdown to clipboard

**Implementation:**
```tsx
function ExportMenu({ conversationUuid, conversationName }: ExportMenuProps) {
  const handleExport = async (format: 'markdown' | 'pdf') => {
    const url = `/api/conversations/${conversationUuid}/export/${format}`;
    const response = await fetch(url);
    const blob = await response.blob();
    downloadBlob(blob, `${sanitizeFilename(conversationName)}.${format === 'markdown' ? 'md' : 'pdf'}`);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Download className="mr-2 h-4 w-4" />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onClick={() => handleExport('markdown')}>
          <FileText className="mr-2 h-4 w-4" />
          Markdown (.md)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport('pdf')}>
          <FileType className="mr-2 h-4 w-4" />
          PDF (.pdf)
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleCopyMarkdown}>
          <Copy className="mr-2 h-4 w-4" />
          Copy as Markdown
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

---

### SearchResults

**Props:**
```typescript
interface SearchResultsProps {
  results: SearchResult[];
  query: string;
  isLoading: boolean;
}
```

**Visual Design:**
```
┌─────────────────────────────────────────────────────────┐
│ "React hooks"                           42 results      │
├─────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────┐ │
│ │ Building a Todo App                                 │ │
│ │ Feb 25, 2026 · claude-sonnet-4-6                    │ │
│ │ ─────────────────────────────────────────────────── │ │
│ │ You: "How do I use **React hooks** for state..."   │ │
│ │ Claude: "**React hooks** like useState and..."     │ │
│ └─────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ Advanced Patterns                                   │ │
│ │ ...                                                 │ │
│ └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

- Query term highlighted in results (bold or background)
- Shows conversation title + metadata
- Shows matching message snippets with context
- Click to navigate to conversation at that message
- Loading state with skeletons

---

## Styling Approach

### Tailwind CSS v4 Configuration

```css
/* app.css */
@import "tailwindcss";

@theme {
  /* Custom color tokens */
  --color-sidebar: var(--color-zinc-50);
  --color-sidebar-dark: var(--color-zinc-900);

  --color-bubble-human: var(--color-blue-50);
  --color-bubble-human-dark: var(--color-blue-950);

  --color-bubble-assistant: var(--color-zinc-100);
  --color-bubble-assistant-dark: var(--color-zinc-800);

  --color-tool-block: var(--color-amber-50);
  --color-tool-block-dark: var(--color-amber-950);

  /* Spacing */
  --spacing-sidebar-width: 320px;
  --spacing-sidebar-collapsed: 64px;
  --spacing-message-max-width: 768px;

  /* Typography */
  --font-sans: "Inter", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", "Fira Code", monospace;
}
```

### shadcn/ui Components Used

| Component | Usage |
|-----------|-------|
| `Button` | Actions, export, navigation |
| `Input` | Search, filters |
| `Select` | Model filter, branch switcher |
| `DropdownMenu` | Export menu, context menus |
| `Dialog` | Confirmations, image lightbox |
| `Sheet` | Mobile sidebar |
| `Tooltip` | Timestamps, truncated text |
| `Skeleton` | Loading states |
| `Badge` | Model names, counts |
| `Collapsible` | Tool blocks |
| `ScrollArea` | Message list, sidebar |
| `Separator` | Visual dividers |
| `Command` | Command palette (cmdk integration) |
| `Toast` | Notifications (export complete, errors) |

### Responsive Breakpoints

| Breakpoint | Layout |
|------------|--------|
| `< 640px` (mobile) | Sidebar hidden, sheet trigger; single-column messages |
| `640px - 1024px` (tablet) | Collapsed sidebar; narrower messages |
| `> 1024px` (desktop) | Full sidebar; optimal message width |

### Dark Mode

Implemented via Tailwind's `dark:` variant and class strategy:

```tsx
// ThemeProvider.tsx
function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const stored = localStorage.getItem('theme');
    if (stored) return stored as 'light' | 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('theme', theme);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
```

---

## Keyboard Shortcuts

| Shortcut | Context | Action |
|----------|---------|--------|
| `Cmd/Ctrl + K` | Global | Open command palette |
| `Cmd/Ctrl + /` | Global | Toggle sidebar |
| `Cmd/Ctrl + E` | Conversation | Export current |
| `Cmd/Ctrl + Shift + E` | Global | Export all |
| `Cmd/Ctrl + ,` | Global | Open settings |
| `Cmd/Ctrl + Shift + T` | Global | Toggle theme |
| `↑` / `↓` | Sidebar | Navigate conversation list |
| `Enter` | Sidebar | Select conversation |
| `Escape` | Command palette | Close palette |
| `j` / `k` | Conversation | Scroll messages |
| `[` / `]` | Conversation | Switch branch (if available) |
| `g` then `t` | Conversation | Go to tree view |
| `g` then `l` | Tree view | Go back to list view |

### Implementation

```tsx
// useKeyboardShortcuts.ts
function useKeyboardShortcuts() {
  const navigate = useNavigate();
  const { setCommandPaletteOpen } = useCommandPalette();
  const { toggleTheme } = useTheme();
  const { toggleSidebar } = useSidebar();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;

      // Cmd+K: Command palette
      if (isMod && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }

      // Cmd+/: Toggle sidebar
      if (isMod && e.key === '/') {
        e.preventDefault();
        toggleSidebar();
      }

      // Cmd+Shift+T: Toggle theme
      if (isMod && e.shiftKey && e.key === 't') {
        e.preventDefault();
        toggleTheme();
      }

      // More shortcuts...
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
```

---

## API Client

### Type Definitions

```typescript
// types.ts

interface ConversationSummary {
  uuid: string;
  name: string;
  summary: string;
  model: string;
  created_at: string;  // ISO date
  updated_at: string;
  is_starred: boolean;
  is_temporary: boolean;
  message_count: number;
  human_message_count: number;
  has_branches: boolean;
}

interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'image';
  text?: string;
  name?: string;       // tool_use
  input?: unknown;     // tool_use
  content?: ContentBlock[];  // tool_result
}

interface Message {
  uuid: string;
  sender: 'human' | 'assistant';
  text: string;
  content: ContentBlock[];
  created_at: string;
  updated_at: string;
  truncated: boolean;
  parent_message_uuid: string | null;
  attachments: unknown[];
  files: unknown[];
}

interface ConversationDetail extends ConversationSummary {
  messages: Message[];
  current_leaf_message_uuid: string;
}

interface MessageNode {
  message: Message;
  children: MessageNode[];
}

interface ConversationTree {
  uuid: string;
  root_messages: MessageNode[];
  active_path: string[];
}

interface MessageSnippet {
  message_uuid: string;
  sender: string;
  snippet: string;
  match_start: number;
  match_end: number;
}

interface SearchResult {
  conversation_uuid: string;
  conversation_name: string;
  conversation_updated_at: string;
  matching_messages: MessageSnippet[];
}

interface ConversationFilters {
  search?: string;
  starred?: boolean;
  model?: string;
  sort?: 'updated_at' | 'created_at' | 'name';
}

interface AppConfig {
  data_dir: string;
  conversation_count: number;
}
```

### API Functions

```typescript
// api.ts

const BASE_URL = '/api';

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${url}`);
  if (!response.ok) {
    throw new ApiError(response.status, await response.text());
  }
  return response.json();
}

export const api = {
  getConversations: (filters?: ConversationFilters) => {
    const params = new URLSearchParams();
    if (filters?.search) params.set('search', filters.search);
    if (filters?.starred !== undefined) params.set('starred', String(filters.starred));
    if (filters?.model) params.set('model', filters.model);
    if (filters?.sort) params.set('sort', filters.sort);
    const query = params.toString();
    return fetchJson<ConversationSummary[]>(`/conversations${query ? `?${query}` : ''}`);
  },

  getConversation: (uuid: string) =>
    fetchJson<ConversationDetail>(`/conversations/${uuid}`),

  getConversationTree: (uuid: string) =>
    fetchJson<ConversationTree>(`/conversations/${uuid}/tree`),

  search: (query: string) =>
    fetchJson<SearchResult[]>(`/search?q=${encodeURIComponent(query)}`),

  getConfig: () =>
    fetchJson<AppConfig>('/config'),

  exportMarkdown: (uuid: string) =>
    fetch(`${BASE_URL}/conversations/${uuid}/export/markdown`),

  exportPdf: (uuid: string) =>
    fetch(`${BASE_URL}/conversations/${uuid}/export/pdf`),

  exportAllMarkdown: () =>
    fetch(`${BASE_URL}/export/all/markdown`),
};
```

---

## File Structure

```
frontend/
├── index.html
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── postcss.config.js
├── components.json           # shadcn/ui config
├── public/
│   └── favicon.svg
└── src/
    ├── main.tsx              # Entry point
    ├── App.tsx               # Root component, providers
    ├── index.css             # Tailwind imports, custom CSS
    ├── vite-env.d.ts
    │
    ├── routes/
    │   ├── root.tsx          # RootLayout with sidebar
    │   ├── home.tsx          # Redirect to /conversations
    │   ├── conversations.tsx # List page
    │   ├── conversation.tsx  # Detail page
    │   ├── tree.tsx          # Tree view page
    │   ├── search.tsx        # Search results page
    │   └── settings.tsx      # Settings page
    │
    ├── components/
    │   ├── ui/               # shadcn/ui components (auto-generated)
    │   │   ├── button.tsx
    │   │   ├── input.tsx
    │   │   ├── dialog.tsx
    │   │   └── ...
    │   │
    │   ├── layout/
    │   │   ├── Sidebar.tsx
    │   │   ├── SidebarHeader.tsx
    │   │   ├── SidebarFooter.tsx
    │   │   └── MainContent.tsx
    │   │
    │   ├── conversation/
    │   │   ├── ConversationList.tsx
    │   │   ├── ConversationListItem.tsx
    │   │   ├── ConversationListFilters.tsx
    │   │   ├── ConversationHeader.tsx
    │   │   ├── MessageList.tsx
    │   │   ├── MessageBubble.tsx
    │   │   ├── BranchSwitcher.tsx
    │   │   └── ScrollToBottomFAB.tsx
    │   │
    │   ├── message/
    │   │   ├── MarkdownRenderer.tsx
    │   │   ├── CodeBlock.tsx
    │   │   ├── ToolUseBlock.tsx
    │   │   ├── ToolResultBlock.tsx
    │   │   └── Attachment.tsx
    │   │
    │   ├── tree/
    │   │   ├── BranchTree.tsx
    │   │   ├── TreeNode.tsx
    │   │   └── TreePath.tsx
    │   │
    │   ├── search/
    │   │   ├── SearchResults.tsx
    │   │   ├── SearchResultCard.tsx
    │   │   └── HighlightedText.tsx
    │   │
    │   ├── export/
    │   │   ├── ExportMenu.tsx
    │   │   └── ExportAllButton.tsx
    │   │
    │   └── common/
    │       ├── CommandPalette.tsx
    │       ├── ThemeToggle.tsx
    │       ├── EmptyState.tsx
    │       ├── ErrorBoundary.tsx
    │       └── LoadingSpinner.tsx
    │
    ├── hooks/
    │   ├── useConversations.ts
    │   ├── useConversation.ts
    │   ├── useConversationTree.ts
    │   ├── useSearch.ts
    │   ├── useConfig.ts
    │   ├── useKeyboardShortcuts.ts
    │   ├── useLocalStorage.ts
    │   └── useMediaQuery.ts
    │
    ├── lib/
    │   ├── api.ts            # API client
    │   ├── types.ts          # TypeScript types
    │   ├── utils.ts          # Utility functions (cn, formatDate, etc.)
    │   ├── queryClient.ts    # TanStack Query setup
    │   └── router.tsx        # React Router configuration
    │
    ├── contexts/
    │   ├── ThemeContext.tsx
    │   ├── SidebarContext.tsx
    │   └── CommandPaletteContext.tsx
    │
    └── test/
        ├── setup.ts          # Vitest setup
        ├── utils.tsx         # Test utilities, render helpers
        ├── mocks/
        │   ├── handlers.ts   # MSW request handlers
        │   ├── server.ts     # MSW server setup
        │   └── data.ts       # Mock conversation data
        └── components/
            ├── ConversationList.test.tsx
            ├── MessageBubble.test.tsx
            ├── MarkdownRenderer.test.tsx
            ├── BranchTree.test.tsx
            ├── SearchResults.test.tsx
            └── CommandPalette.test.tsx
```

---

## Test Plan

### Testing Stack
- **Vitest** — test runner (Vite-native)
- **React Testing Library** — component testing
- **MSW (Mock Service Worker)** — API mocking
- **@testing-library/user-event** — user interaction simulation
- **Playwright** — E2E tests (Phase 4)

### Component Tests

#### ConversationList.test.tsx
- `renders loading skeletons while fetching`
- `renders empty state when no conversations`
- `renders conversation items sorted by updated_at`
- `pins starred conversations at top`
- `filters by search term`
- `filters by model`
- `selects conversation on click`
- `navigates with keyboard (arrow keys + enter)`
- `truncates long titles with ellipsis`
- `shows branch indicator for branched conversations`

#### ConversationListItem.test.tsx
- `renders title, model, date, and message count`
- `shows filled star for starred conversations`
- `shows relative date format`
- `applies selected styles when isSelected`
- `calls onClick when clicked`

#### MessageBubble.test.tsx
- `renders human message right-aligned`
- `renders assistant message left-aligned`
- `renders markdown content correctly`
- `shows timestamp on hover`
- `renders tool_use block as collapsible`
- `renders tool_result block as collapsible`
- `shows branch switcher when alternates exist`
- `handles truncated message indicator`

#### MarkdownRenderer.test.tsx
- `renders plain text`
- `renders headers`
- `renders code blocks with syntax highlighting`
- `renders inline code`
- `renders links with external indicator`
- `renders lists (ordered and unordered)`
- `renders tables (GFM)`
- `renders images`
- `sanitizes potentially dangerous HTML`

#### ToolUseBlock.test.tsx
- `renders tool name`
- `renders input JSON formatted`
- `toggles expanded state on click`
- `starts collapsed by default`
- `shows copy button for input`

#### BranchTree.test.tsx
- `renders tree structure correctly`
- `highlights active path`
- `shows message preview in nodes`
- `calls onSelectNode when node clicked`
- `handles deep nesting`
- `handles wide trees (many branches)`

#### BranchSwitcher.test.tsx
- `shows current position (e.g., "2 of 3")`
- `navigates to previous branch`
- `navigates to next branch`
- `disables prev button at first branch`
- `disables next button at last branch`
- `shows preview of each branch`

#### SearchResults.test.tsx
- `renders search results with highlighted matches`
- `shows conversation metadata`
- `shows matching message snippets`
- `navigates to conversation on click`
- `shows empty state for no results`
- `shows loading state`

#### CommandPalette.test.tsx
- `opens with Cmd+K`
- `closes with Escape`
- `filters results as you type`
- `shows recent conversations`
- `shows starred conversations`
- `executes action on Enter`
- `navigates with arrow keys`

#### ExportMenu.test.tsx
- `renders export button`
- `shows dropdown with Markdown and PDF options`
- `triggers Markdown download`
- `triggers PDF download`
- `shows copy to clipboard option`

### Integration Tests

#### Conversation Flow
- `loads conversation list on mount`
- `displays conversation when selected from list`
- `updates URL when conversation selected`
- `loads conversation from URL on direct navigation`
- `shows 404 for unknown conversation UUID`
- `caches conversations for back navigation`

#### Search Flow
- `searches as user types (debounced)`
- `shows results in command palette`
- `navigates to search page on enter`
- `navigates to specific conversation from result`
- `highlights search term in conversation view`

#### Export Flow
- `downloads Markdown file`
- `downloads PDF file`
- `downloads all as zip`
- `shows success toast after download`
- `shows error toast on failure`

#### Branch Navigation
- `shows branch indicator in message list`
- `switches branch via BranchSwitcher`
- `updates message list when branch changes`
- `navigates to tree view`
- `selects branch from tree view`
- `returns to list view with selected branch`

### E2E Tests (Playwright, Phase 4)

- `full user journey: browse → search → read → export`
- `keyboard-only navigation`
- `mobile responsive layout`
- `dark mode toggle persists`
- `handles large conversation list (1000+)`
- `handles long conversation (500+ messages)`

---

## Performance Considerations

### List Virtualization
Use `@tanstack/react-virtual` for conversation list and message list:
```tsx
const rowVirtualizer = useVirtualizer({
  count: conversations.length,
  getScrollElement: () => parentRef.current,
  estimateSize: () => 72, // estimated row height
  overscan: 5,
});
```

### Image Lazy Loading
Use native `loading="lazy"` and Intersection Observer:
```tsx
<img src={url} loading="lazy" alt={alt} />
```

### Code Splitting
- Route-based splitting via React Router lazy loading
- Heavy components (tree view, PDF viewer) loaded on demand

```tsx
const TreeViewPage = lazy(() => import('./routes/tree'));
```

### Query Caching
- `staleTime: 5 minutes` for conversation list
- `staleTime: Infinity` for conversation detail (immutable once fetched)
- Prefetch on hover for likely navigation targets

---

## Accessibility

- Semantic HTML (`<nav>`, `<main>`, `<article>`, `<aside>`)
- ARIA labels for interactive elements
- Focus management for modals and command palette
- Keyboard navigation for all features
- Color contrast ratios meet WCAG 2.1 AA
- Skip link to main content
- Screen reader announcements for dynamic content

---

## Error Handling

### Error Boundary
```tsx
function ErrorBoundary({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundaryPrimitive
      fallbackRender={({ error, resetErrorBoundary }) => (
        <div className="flex flex-col items-center justify-center h-full p-8">
          <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
          <h2 className="text-xl font-semibold mb-2">Something went wrong</h2>
          <p className="text-muted-foreground mb-4">{error.message}</p>
          <Button onClick={resetErrorBoundary}>Try again</Button>
        </div>
      )}
    >
      {children}
    </ErrorBoundaryPrimitive>
  );
}
```

### API Error Handling
```tsx
function useConversation(uuid: string) {
  return useQuery({
    queryKey: ['conversation', uuid],
    queryFn: () => api.getConversation(uuid),
    retry: (failureCount, error) => {
      // Don't retry 404s
      if (error instanceof ApiError && error.status === 404) return false;
      return failureCount < 3;
    },
  });
}
```

### Toast Notifications
- Success: export completed, clipboard copied
- Error: API failures, export failures
- Info: background operations

---

## Open Questions / Risks

1. **Message tree size**: Deeply nested or wide conversation trees may need
   special handling. Need to test with real-world branched conversations.

2. **Large message content**: Some Claude responses are very long (10k+ tokens).
   Need to ensure markdown rendering stays performant. Consider virtualization
   within a single message.

3. **Code block language detection**: `rehype-highlight` may not auto-detect
   all languages. May need explicit language hints from content.

4. **Mobile branch navigation**: Tree visualization on small screens needs
   careful design. May need alternative linear branch selector.

5. **Offline support**: Consider adding Service Worker for offline viewing
   of already-fetched conversations (stretch goal).

6. **Image handling**: Conversations may contain image attachments. Need to
   understand the URL format and whether we can serve them from the backend.

7. **Syntax highlighting themes**: Need to select/create themes that work
   well in both light and dark mode.

8. **Search performance**: Full-text search is done backend-side, but we
   may want to add client-side filtering for the command palette.

9. **Date localization**: Currently using `date-fns` with default locale.
   May need to support user locale preferences.

10. **Conversation mutations**: The current plan is read-only. If we add
    starring/unstarring, need to add mutation hooks and optimistic updates.

---

## Implementation Phases

### Phase 3a — Scaffold (1-2 days)
- [ ] Initialize Vite + React + TypeScript project
- [ ] Configure Tailwind CSS v4
- [ ] Set up shadcn/ui
- [ ] Configure React Router v7
- [ ] Set up TanStack Query
- [ ] Create basic layout (sidebar + main content)
- [ ] Implement theme provider (dark/light)

### Phase 3b — Core Features (3-4 days)
- [ ] ConversationList with loading/empty states
- [ ] ConversationListItem with all metadata
- [ ] ConversationPage with MessageList
- [ ] MessageBubble with MarkdownRenderer
- [ ] Tool use/result blocks (collapsible)
- [ ] API client and query hooks
- [ ] Basic search (filter conversation list)

### Phase 3c — Export (1 day)
- [ ] ExportMenu component
- [ ] Markdown download
- [ ] Copy to clipboard
- [ ] Export all button

### Phase 4a — Branch Visualization (2-3 days)
- [ ] BranchSwitcher in messages
- [ ] TreeViewPage with BranchTree
- [ ] Branch selection navigation
- [ ] URL state for active branch

### Phase 4b — Polish (2-3 days)
- [ ] CommandPalette with cmdk
- [ ] Keyboard shortcuts
- [ ] Mobile responsive layout
- [ ] Loading skeletons
- [ ] Error boundaries
- [ ] Toast notifications
- [ ] PDF export integration

### Phase 4c — Testing (2 days)
- [ ] Set up Vitest + RTL + MSW
- [ ] Component tests for all major components
- [ ] Integration tests for user flows
- [ ] Accessibility audit

---

## Dependencies (package.json)

```json
{
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router": "^7.0.0",
    "@tanstack/react-query": "^5.50.0",
    "@tanstack/react-virtual": "^3.5.0",
    "react-markdown": "^9.0.0",
    "rehype-highlight": "^7.0.0",
    "remark-gfm": "^4.0.0",
    "date-fns": "^3.6.0",
    "lucide-react": "^0.400.0",
    "cmdk": "^1.0.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.3.0",
    "class-variance-authority": "^0.7.0",
    "@radix-ui/react-dialog": "^1.1.0",
    "@radix-ui/react-dropdown-menu": "^2.1.0",
    "@radix-ui/react-tooltip": "^1.1.0",
    "@radix-ui/react-collapsible": "^1.1.0",
    "@radix-ui/react-scroll-area": "^1.1.0",
    "@radix-ui/react-select": "^2.1.0",
    "@radix-ui/react-separator": "^1.1.0",
    "@radix-ui/react-slot": "^1.1.0",
    "sonner": "^1.5.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "tailwindcss": "^4.0.0",
    "postcss": "^8.4.0",
    "autoprefixer": "^10.4.0",
    "vitest": "^2.0.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.5.0",
    "@testing-library/jest-dom": "^6.4.0",
    "jsdom": "^24.1.0",
    "msw": "^2.3.0"
  }
}
```