/**
 * useBookmarkHotkey — unit contract.
 *
 * Pins the listener behavior:
 *   - 'b' on selected message → toggleBookmark fires with the right shape.
 *   - 'B' (shift/capslock) also fires.
 *   - No conversation → no listener mounted.
 *   - No selected message → no-op.
 *   - Cmd/Ctrl/Alt + 'b' → skipped (browser-nav collision guard).
 *   - Typing in <input> → skipped (the guard still fires).
 *   - source mapping: CLAUDE_AI → 'claude_desktop'; otherwise 'claude_code'.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useBookmarkHotkey } from '../../hooks/useBookmarkHotkey'
import type { Bookmark, ConversationDetail, ConversationSource } from '../../lib/types'

type ToggleBookmarkFn = (input: Omit<Bookmark, 'id' | 'created_at'>) => Promise<void>

function makeConversation(overrides: {
  source?: ConversationSource
  uuid?: string
  messages?: Array<{ uuid: string; sender: string; text?: string }>
} = {}): ConversationDetail {
  return {
    uuid: overrides.uuid ?? 'conv-1',
    source: overrides.source ?? 'CLAUDE_AI',
    messages: overrides.messages ?? [
      { uuid: 'm-1', sender: 'human', text: 'Hello' },
      { uuid: 'm-2', sender: 'assistant', text: 'Reply' },
    ],
  } as unknown as ConversationDetail
}

function mount(args: {
  conversation: ConversationDetail | null
  selectedId: string | null
  toggleBookmark?: ReturnType<typeof vi.fn<ToggleBookmarkFn>>
}) {
  // Recovery 2026-05-30 REG-5: type the mock so it's assignable to the
  // hook's `toggleBookmark` prop without `as unknown as` casts.
  // `.mockResolvedValue(undefined)` satisfies the Promise<void> return.
  const toggleBookmark =
    args.toggleBookmark ?? vi.fn<ToggleBookmarkFn>().mockResolvedValue(undefined)
  const getSelectedMessageId = vi.fn<() => string | null>().mockReturnValue(args.selectedId)
  renderHook(() =>
    useBookmarkHotkey({
      conversation: args.conversation,
      getSelectedMessageId,
      toggleBookmark,
    }),
  )
  return { toggleBookmark, getSelectedMessageId }
}

function dispatchKey(opts: {
  key?: string
  target?: EventTarget | null
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
}) {
  const event = new KeyboardEvent('keydown', {
    key: opts.key ?? 'b',
    metaKey: opts.metaKey ?? false,
    ctrlKey: opts.ctrlKey ?? false,
    altKey: opts.altKey ?? false,
    bubbles: true,
    cancelable: true,
  })
  if (opts.target) {
    Object.defineProperty(event, 'target', { value: opts.target, configurable: true })
  }
  window.dispatchEvent(event)
  return event
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useBookmarkHotkey', () => {
  it("fires toggleBookmark when 'b' pressed on a selected message", () => {
    const { toggleBookmark } = mount({
      conversation: makeConversation(),
      selectedId: 'm-1',
    })
    dispatchKey({ key: 'b' })
    expect(toggleBookmark).toHaveBeenCalledTimes(1)
    expect(toggleBookmark).toHaveBeenCalledWith({
      conversation_id: 'conv-1',
      message_uuid: 'm-1',
      source: 'claude_desktop',
      note: '',
      snippet: 'Hello',
    })
  })

  it("'B' (shift / capslock) also fires", () => {
    const { toggleBookmark } = mount({
      conversation: makeConversation(),
      selectedId: 'm-1',
    })
    dispatchKey({ key: 'B' })
    expect(toggleBookmark).toHaveBeenCalledTimes(1)
  })

  it('CLAUDE_CODE source maps to claude_code', () => {
    const { toggleBookmark } = mount({
      conversation: makeConversation({ source: 'CLAUDE_CODE' }),
      selectedId: 'm-1',
    })
    dispatchKey({ key: 'b' })
    expect(toggleBookmark).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'claude_code' }),
    )
  })

  it('CLAUDE_COWORK source also maps to claude_code (non-AI bucket)', () => {
    const { toggleBookmark } = mount({
      conversation: makeConversation({ source: 'CLAUDE_COWORK' }),
      selectedId: 'm-1',
    })
    dispatchKey({ key: 'b' })
    expect(toggleBookmark).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'claude_code' }),
    )
  })

  it('no conversation: no listener registered, b is a no-op', () => {
    const { toggleBookmark } = mount({
      conversation: null,
      selectedId: 'm-1',
    })
    dispatchKey({ key: 'b' })
    expect(toggleBookmark).not.toHaveBeenCalled()
  })

  it('no selected message: no-op', () => {
    const { toggleBookmark } = mount({
      conversation: makeConversation(),
      selectedId: null,
    })
    dispatchKey({ key: 'b' })
    expect(toggleBookmark).not.toHaveBeenCalled()
  })

  it('Cmd+b: skipped (browser-nav collision guard)', () => {
    const { toggleBookmark } = mount({
      conversation: makeConversation(),
      selectedId: 'm-1',
    })
    dispatchKey({ key: 'b', metaKey: true })
    expect(toggleBookmark).not.toHaveBeenCalled()
  })

  it('Ctrl+b: skipped', () => {
    const { toggleBookmark } = mount({
      conversation: makeConversation(),
      selectedId: 'm-1',
    })
    dispatchKey({ key: 'b', ctrlKey: true })
    expect(toggleBookmark).not.toHaveBeenCalled()
  })

  it('Alt+b: skipped', () => {
    const { toggleBookmark } = mount({
      conversation: makeConversation(),
      selectedId: 'm-1',
    })
    dispatchKey({ key: 'b', altKey: true })
    expect(toggleBookmark).not.toHaveBeenCalled()
  })

  it("typing in <input>: 'b' goes to the field, not the bookmark", () => {
    const { toggleBookmark } = mount({
      conversation: makeConversation(),
      selectedId: 'm-1',
    })
    const input = document.createElement('input')
    document.body.appendChild(input)
    dispatchKey({ key: 'b', target: input })
    expect(toggleBookmark).not.toHaveBeenCalled()
    document.body.removeChild(input)
  })

  it('typing in <textarea>: skipped', () => {
    const { toggleBookmark } = mount({
      conversation: makeConversation(),
      selectedId: 'm-1',
    })
    const ta = document.createElement('textarea')
    document.body.appendChild(ta)
    dispatchKey({ key: 'b', target: ta })
    expect(toggleBookmark).not.toHaveBeenCalled()
    document.body.removeChild(ta)
  })

  it('snippet truncated to 140 chars from message.text', () => {
    const longText = 'x'.repeat(300)
    const { toggleBookmark } = mount({
      conversation: makeConversation({
        messages: [{ uuid: 'm-1', sender: 'human', text: longText }],
      }),
      selectedId: 'm-1',
    })
    dispatchKey({ key: 'b' })
    expect(toggleBookmark).toHaveBeenCalledWith(
      expect.objectContaining({ snippet: 'x'.repeat(140) }),
    )
  })

  it('message.text empty/undefined: snippet is empty string (no crash)', () => {
    const { toggleBookmark } = mount({
      conversation: makeConversation({
        messages: [{ uuid: 'm-1', sender: 'human' }],
      }),
      selectedId: 'm-1',
    })
    dispatchKey({ key: 'b' })
    expect(toggleBookmark).toHaveBeenCalledWith(
      expect.objectContaining({ snippet: '' }),
    )
  })
})
