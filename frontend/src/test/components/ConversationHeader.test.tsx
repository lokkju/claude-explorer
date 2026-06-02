/**
 * ConversationHeader — unit contract.
 *
 * Pins the four user-observable surfaces:
 *
 *   1. Title rendering: name shown verbatim; "Untitled" when name is empty.
 *   2. Source badge variant: each of CLAUDE_CODE / CLAUDE_COWORK /
 *      CLAUDE_AI renders the correct SourceBadge (via lucide icon class).
 *   3. Branches button: hidden when has_branches=false; visible and
 *      wires onOpenTree when has_branches=true.
 *   4. Copy buttons in the details collapsible:
 *      - UUID button: always rendered; shows Check when copiedUuid=true,
 *        Copy icon when false; wires onCopyUuid on click.
 *      - file_path button: only rendered when file_path is non-null;
 *        same Check/Copy swap on copiedPath; wires onCopyPath on click.
 *
 * The header consumes SearchPinContext via the embedded PinScopeButton,
 * so the test wraps in a SearchPinProvider + MemoryRouter (the latter
 * because SearchPinProvider's useLocation needs a router).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { ConversationHeader } from '../../components/conversation/ConversationHeader'
import { SearchPinProvider } from '../../contexts/SearchPinContext'
import type { ConversationDetail, ConversationSource } from '../../lib/types'

function makeConversation(overrides: Partial<ConversationDetail> = {}): ConversationDetail {
  return {
    uuid: 'conv-uuid-1',
    name: 'Test conversation',
    source: 'CLAUDE_AI',
    model: 'claude-opus',
    created_at: '2026-05-30T12:00:00Z',
    updated_at: '2026-05-30T12:00:00Z',
    message_count: 42,
    has_branches: false,
    messages: [],
    compact_markers: [],
    prelude_hidden_count: 0,
    file_path: null,
    project_path: null,
    git_branch: null,
    sandbox_path: null,
    error: null,
    ...overrides,
  } as unknown as ConversationDetail
}

function renderHeader(
  conversation: ConversationDetail,
  callbackOverrides: Partial<{
    copiedUuid: boolean
    copiedPath: boolean
    onCopyUuid: () => void
    onCopyPath: () => void
    onOpenTree: () => void
  }> = {},
) {
  const props = {
    copiedUuid: false,
    copiedPath: false,
    onCopyUuid: vi.fn(),
    onCopyPath: vi.fn(),
    onOpenTree: vi.fn(),
    ...callbackOverrides,
  }
  const utils = render(
    <MemoryRouter>
      <SearchPinProvider>
        <ConversationHeader conversation={conversation} {...props} />
      </SearchPinProvider>
    </MemoryRouter>,
  )
  return { ...utils, props }
}

describe('ConversationHeader — title', () => {
  it('renders the conversation name as the h1', () => {
    renderHeader(makeConversation({ name: 'My great chat' }))
    expect(screen.getByRole('heading', { level: 1, name: 'My great chat' })).toBeInTheDocument()
  })

  it('falls back to "Untitled" when name is empty', () => {
    renderHeader(makeConversation({ name: '' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Untitled' })).toBeInTheDocument()
  })
})

describe('ConversationHeader — source badge variant', () => {
  const sources: Array<{ source: ConversationSource; iconClass: string }> = [
    { source: 'CLAUDE_CODE', iconClass: 'lucide-terminal' },
    { source: 'CLAUDE_COWORK', iconClass: 'lucide-sparkles' },
    { source: 'CLAUDE_AI', iconClass: 'lucide-message-square' },
  ]
  for (const { source, iconClass } of sources) {
    it(`${source} renders the ${iconClass} icon in the SourceBadge`, () => {
      const { container } = renderHeader(makeConversation({ source }))
      expect(container.querySelector(`.${iconClass}`)).not.toBeNull()
    })
  }
})

describe('ConversationHeader — branches button', () => {
  it('is hidden when has_branches=false', () => {
    renderHeader(makeConversation({ has_branches: false }))
    expect(screen.queryByText('View branches')).toBeNull()
  })

  it('renders when has_branches=true and fires onOpenTree on click', async () => {
    const user = userEvent.setup()
    const { props } = renderHeader(makeConversation({ has_branches: true }))
    const btn = screen.getByText('View branches')
    expect(btn).toBeInTheDocument()
    await user.click(btn)
    expect(props.onOpenTree).toHaveBeenCalledTimes(1)
  })
})

describe('ConversationHeader — UUID copy button', () => {
  it('renders the UUID text and Copy icon when copiedUuid=false', () => {
    const { container } = renderHeader(makeConversation({ uuid: 'abc-123' }), {
      copiedUuid: false,
    })
    expect(screen.getByText('abc-123')).toBeInTheDocument()
    // Copy icon present, Check absent
    const uuidBtn = screen.getByTitle('Click to copy UUID')
    expect(uuidBtn.querySelector('.lucide-copy')).not.toBeNull()
    expect(uuidBtn.querySelector('.lucide-check')).toBeNull()
    expect(container).toBeTruthy()
  })

  it('shows the Check icon (success feedback) when copiedUuid=true', () => {
    renderHeader(makeConversation(), { copiedUuid: true })
    const uuidBtn = screen.getByTitle('Click to copy UUID')
    expect(uuidBtn.querySelector('.lucide-check')).not.toBeNull()
    expect(uuidBtn.querySelector('.lucide-copy')).toBeNull()
  })

  it('fires onCopyUuid on click', async () => {
    const user = userEvent.setup()
    const { props } = renderHeader(makeConversation())
    await user.click(screen.getByTitle('Click to copy UUID'))
    expect(props.onCopyUuid).toHaveBeenCalledTimes(1)
  })
})

describe('ConversationHeader — file_path copy button', () => {
  it('is hidden when conversation.file_path is null', () => {
    renderHeader(makeConversation({ file_path: null }))
    expect(screen.queryByTitle('Click to copy file path')).toBeNull()
  })

  it('renders the path text and Copy icon when present and copiedPath=false', () => {
    renderHeader(makeConversation({ file_path: '/Users/test/conv.json' }), {
      copiedPath: false,
    })
    expect(screen.getByText('/Users/test/conv.json')).toBeInTheDocument()
    const pathBtn = screen.getByTitle('Click to copy file path')
    expect(pathBtn.querySelector('.lucide-copy')).not.toBeNull()
    expect(pathBtn.querySelector('.lucide-check')).toBeNull()
  })

  it('shows the Check icon when copiedPath=true', () => {
    renderHeader(makeConversation({ file_path: '/path' }), { copiedPath: true })
    const pathBtn = screen.getByTitle('Click to copy file path')
    expect(pathBtn.querySelector('.lucide-check')).not.toBeNull()
    expect(pathBtn.querySelector('.lucide-copy')).toBeNull()
  })

  it('fires onCopyPath on click', async () => {
    const user = userEvent.setup()
    const { props } = renderHeader(makeConversation({ file_path: '/path' }))
    await user.click(screen.getByTitle('Click to copy file path'))
    expect(props.onCopyPath).toHaveBeenCalledTimes(1)
  })
})

describe('ConversationHeader — Cowork sandbox path', () => {
  it('renders the sandbox path with the "Sandbox path:" label for CLAUDE_COWORK', () => {
    renderHeader(
      makeConversation({
        source: 'CLAUDE_COWORK',
        sandbox_path: '/sessions/vm-1',
      }),
    )
    expect(screen.getByTestId('cowork-sandbox-path')).toBeInTheDocument()
    expect(screen.getByText('/sessions/vm-1')).toBeInTheDocument()
    expect(screen.getByText('Sandbox path:')).toBeInTheDocument()
  })

  it('does not render the sandbox row when source is not CLAUDE_COWORK', () => {
    renderHeader(makeConversation({ source: 'CLAUDE_AI', sandbox_path: '/sessions/vm-1' }))
    expect(screen.queryByTestId('cowork-sandbox-path')).toBeNull()
  })
})
