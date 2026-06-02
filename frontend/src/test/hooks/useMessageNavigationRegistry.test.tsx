/**
 * useMessageNavigationRegistry — unit contract.
 *
 * Three effect groups:
 *
 *   1. UUID-change reset: calling with a new uuid triggers
 *      setSelectedMessageIndex(0). Same-uuid re-render is a no-op.
 *
 *   2. Registry sync: setMessagesAndPinSelection fires with the
 *      filtered list (prelude / tool-only respect the booleans).
 *
 *   3. Selection scroll:
 *      - Mounted bubble (in messageRefs): element.scrollIntoView fires.
 *      - Unmounted bubble (NOT in messageRefs) but in visibleMessages:
 *        virtualizer.scrollToIndex fires with the matching visIdx.
 *      - focusArea !== 'detail': no scroll either way.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useRef } from 'react'
import { useMessageNavigationRegistry } from '../../hooks/useMessageNavigationRegistry'
import type { Message, ConversationDetail } from '../../lib/types'
import type { Virtualizer } from '@tanstack/react-virtual'
import type { FocusArea, MessageInfo } from '../../contexts/KeyboardNavigationContext'

// Recovery 2026-05-30 REG-5: explicit signatures for every mock so the
// args object is assignable to UseMessageNavigationRegistryArgs without
// `as unknown as` casts. Without these, `ReturnType<typeof vi.fn>`
// resolves to `Mock<Procedure | Constructable>` and tsc rejects every
// assignment at the call site.
type ScrollToIndexFn = Virtualizer<HTMLDivElement, Element>['scrollToIndex']
type SetMessagesFn = (msgs: MessageInfo[]) => void
type SetSelectedMessageIndexFn = (i: number) => void
type GetSelectedMessageIdFn = () => string | null

function makeMessage(uuid: string, overrides: Partial<Message> = {}): Message {
  return {
    uuid,
    sender: 'human',
    text: 'hi',
    content: [],
    created_at: '2026-05-30T12:00:00Z',
    updated_at: '2026-05-30T12:00:00Z',
    is_prelude: false,
    ...overrides,
  } as unknown as Message
}

function makeConversation(messages: Message[]): ConversationDetail {
  return {
    uuid: 'conv-1',
    messages,
    compact_markers: [],
  } as unknown as ConversationDetail
}

function makeVirtualizer(): { scrollToIndex: ReturnType<typeof vi.fn<ScrollToIndexFn>> } & Partial<Virtualizer<HTMLDivElement, Element>> {
  return {
    scrollToIndex: vi.fn<ScrollToIndexFn>(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Element.prototype.scrollIntoView is mocked in setup.ts; spy on it here.
  vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {})
})

interface HookArgsOverride {
  uuid?: string
  conversation?: ConversationDetail | null
  visibleMessages?: Message[]
  showPrelude?: boolean
  showToolCalls?: boolean
  focusArea?: FocusArea
  selectedMessageId?: string | null
  selectedMessageIndex?: number
  setSelectedMessageIndex?: ReturnType<typeof vi.fn<SetSelectedMessageIndexFn>>
  setMessages?: ReturnType<typeof vi.fn<SetMessagesFn>>
  setMessagesAndPinSelection?: ReturnType<typeof vi.fn<SetMessagesFn>>
  messageRefs?: Map<string, HTMLDivElement>
  virtualizer?: { scrollToIndex: ReturnType<typeof vi.fn<ScrollToIndexFn>> } & Partial<Virtualizer<HTMLDivElement, Element>>
}

function renderRegistry(overrides: HookArgsOverride = {}) {
  const setSelectedMessageIndex = overrides.setSelectedMessageIndex ?? vi.fn<SetSelectedMessageIndexFn>()
  const setMessages = overrides.setMessages ?? vi.fn<SetMessagesFn>()
  const setMessagesAndPinSelection = overrides.setMessagesAndPinSelection ?? vi.fn<SetMessagesFn>()
  const messageRefsMap = overrides.messageRefs ?? new Map<string, HTMLDivElement>()
  const virtualizer = overrides.virtualizer ?? makeVirtualizer()
  const getSelectedMessageId = vi.fn<GetSelectedMessageIdFn>().mockReturnValue(overrides.selectedMessageId ?? null)

  const args = {
    uuid: overrides.uuid ?? 'conv-1',
    conversation: overrides.conversation ?? makeConversation([makeMessage('m-1')]),
    visibleMessages: overrides.visibleMessages ?? [makeMessage('m-1')],
    showPrelude: overrides.showPrelude ?? false,
    showToolCalls: overrides.showToolCalls ?? false,
    focusArea: (overrides.focusArea ?? 'detail') as FocusArea,
    selectedMessageIndex: overrides.selectedMessageIndex ?? 0,
    setSelectedMessageIndex,
    setMessages,
    setMessagesAndPinSelection,
    getSelectedMessageId,
  }

  const result = renderHook(
    (props: typeof args) => {
      const messageRefs = useRef<Map<string, HTMLDivElement>>(messageRefsMap)
      // virtualizer is a partial mock — the hook reads only `scrollToIndex`.
      // Cast at this call site is the narrow seam where the partial
      // mock meets the hook's full type. Surfacing the cast here (rather
      // than spreading it through every test) keeps the unit isolated
      // from the full Virtualizer API.
      useMessageNavigationRegistry({
        ...props,
        messageRefs,
        virtualizer: virtualizer as unknown as Virtualizer<HTMLDivElement, Element>,
      })
    },
    { initialProps: args },
  )

  return {
    ...result,
    setSelectedMessageIndex,
    setMessages,
    setMessagesAndPinSelection,
    getSelectedMessageId,
    virtualizer,
    messageRefsMap,
  }
}

// ---- UUID-change reset --------------------------------------------------

describe('useMessageNavigationRegistry — uuid-change reset', () => {
  it('calls setSelectedMessageIndex(0) on first mount with a uuid', () => {
    const { setSelectedMessageIndex } = renderRegistry({ uuid: 'conv-a' })
    expect(setSelectedMessageIndex).toHaveBeenCalledWith(0)
  })

  it('does NOT call setSelectedMessageIndex again on same-uuid re-render', () => {
    const { setSelectedMessageIndex, rerender } = renderRegistry({ uuid: 'conv-a' })
    setSelectedMessageIndex.mockClear()
    rerender({
      uuid: 'conv-a',
      conversation: makeConversation([makeMessage('m-1')]),
      visibleMessages: [makeMessage('m-1')],
      showPrelude: false,
      showToolCalls: false,
      focusArea: 'detail' as FocusArea,
      selectedMessageIndex: 0,
      setSelectedMessageIndex,
      setMessages: vi.fn<SetMessagesFn>(),
      setMessagesAndPinSelection: vi.fn<SetMessagesFn>(),
      getSelectedMessageId: vi.fn<GetSelectedMessageIdFn>().mockReturnValue(null),
    })
    expect(setSelectedMessageIndex).not.toHaveBeenCalled()
  })
})

// ---- Registry sync ------------------------------------------------------

describe('useMessageNavigationRegistry — registry sync', () => {
  it('calls setMessagesAndPinSelection with visible-content messages', () => {
    const msgs = [makeMessage('m-1'), makeMessage('m-2')]
    const { setMessagesAndPinSelection } = renderRegistry({
      conversation: makeConversation(msgs),
    })
    expect(setMessagesAndPinSelection).toHaveBeenCalledWith([
      { uuid: 'm-1', sender: 'human' },
      { uuid: 'm-2', sender: 'human' },
    ])
  })

  it('excludes is_prelude messages when showPrelude=false', () => {
    const msgs = [
      makeMessage('m-prelude', { is_prelude: true }),
      makeMessage('m-1'),
    ]
    const { setMessagesAndPinSelection } = renderRegistry({
      conversation: makeConversation(msgs),
      showPrelude: false,
    })
    expect(setMessagesAndPinSelection).toHaveBeenCalledWith([
      { uuid: 'm-1', sender: 'human' },
    ])
  })

  it('includes is_prelude messages when showPrelude=true', () => {
    const msgs = [
      makeMessage('m-prelude', { is_prelude: true }),
      makeMessage('m-1'),
    ]
    const { setMessagesAndPinSelection } = renderRegistry({
      conversation: makeConversation(msgs),
      showPrelude: true,
    })
    expect(setMessagesAndPinSelection).toHaveBeenCalledWith([
      { uuid: 'm-prelude', sender: 'human' },
      { uuid: 'm-1', sender: 'human' },
    ])
  })
})

// ---- Selection scroll ---------------------------------------------------

describe('useMessageNavigationRegistry — selection-driven scroll', () => {
  // Recovery 2026-05-30 REG-6: the auto-scroll is now gated on a
  // selectedMessageIndex CHANGE — not the first run, not a
  // visibleMessages / focusArea identity flip. These tests render
  // first (priming `prevSelectedMessageIndexRef`), then rerender with
  // a new index to exercise the scroll. Pinned against the
  // toggle-yank regression in
  // `e2e/toggle-preserves-focus-scroll.spec.ts::NEGATIVE PAIR`.
  it('calls element.scrollIntoView when the selected message ref is mounted AND selectedMessageIndex changes', () => {
    const el0 = document.createElement('div') as HTMLDivElement
    const el1 = document.createElement('div') as HTMLDivElement
    const scrollSpy = vi.spyOn(el1, 'scrollIntoView').mockImplementation(() => {})
    const messageRefs = new Map<string, HTMLDivElement>([
      ['m-0', el0],
      ['m-1', el1],
    ])
    const visibleMessages = [makeMessage('m-0'), makeMessage('m-1')]

    // First render — primes prevSelectedMessageIndexRef to 0 without
    // scrolling. The test would FAIL pre-fix here (it would scroll on
    // first run).
    const getSelectedMessageId = vi.fn<GetSelectedMessageIdFn>().mockReturnValue('m-0')
    const setSelectedMessageIndex = vi.fn<SetSelectedMessageIndexFn>()
    const setMessages = vi.fn<SetMessagesFn>()
    const setMessagesAndPinSelection = vi.fn<SetMessagesFn>()
    const virtualizer = makeVirtualizer()
    const args = {
      uuid: 'conv-1',
      conversation: makeConversation(visibleMessages),
      visibleMessages,
      showPrelude: false,
      showToolCalls: false,
      focusArea: 'detail' as FocusArea,
      selectedMessageIndex: 0,
      setSelectedMessageIndex,
      setMessages,
      setMessagesAndPinSelection,
      getSelectedMessageId,
    }
    const { rerender } = renderHook(
      (props: typeof args) => {
        const ref = useRef<Map<string, HTMLDivElement>>(messageRefs)
        useMessageNavigationRegistry({
          ...props,
          messageRefs: ref,
          virtualizer: virtualizer as unknown as Virtualizer<HTMLDivElement, Element>,
        })
      },
      { initialProps: args },
    )
    expect(scrollSpy).not.toHaveBeenCalled()

    // Second render — selectedMessageIndex changes 0 → 1. THIS scrolls.
    getSelectedMessageId.mockReturnValue('m-1')
    rerender({ ...args, selectedMessageIndex: 1 })
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
  })

  it('falls back to virtualizer.scrollToIndex when the ref is missing AND selectedMessageIndex changes', () => {
    const visibleMessages = [
      makeMessage('m-1'),
      makeMessage('m-2'),
      makeMessage('m-3'),
    ]
    const virtualizer = makeVirtualizer()
    const getSelectedMessageId = vi.fn<GetSelectedMessageIdFn>().mockReturnValue('m-1')
    const setSelectedMessageIndex = vi.fn<SetSelectedMessageIndexFn>()
    const setMessages = vi.fn<SetMessagesFn>()
    const setMessagesAndPinSelection = vi.fn<SetMessagesFn>()
    const args = {
      uuid: 'conv-1',
      conversation: makeConversation(visibleMessages),
      visibleMessages,
      showPrelude: false,
      showToolCalls: false,
      focusArea: 'detail' as FocusArea,
      selectedMessageIndex: 0,
      setSelectedMessageIndex,
      setMessages,
      setMessagesAndPinSelection,
      getSelectedMessageId,
    }
    const { rerender } = renderHook(
      (props: typeof args) => {
        const ref = useRef<Map<string, HTMLDivElement>>(new Map())
        useMessageNavigationRegistry({
          ...props,
          messageRefs: ref,
          virtualizer: virtualizer as unknown as Virtualizer<HTMLDivElement, Element>,
        })
      },
      { initialProps: args },
    )
    expect(virtualizer.scrollToIndex).not.toHaveBeenCalled()

    // selectedMessageIndex changes 0 → 2. Virtualizer fallback fires.
    getSelectedMessageId.mockReturnValue('m-3')
    rerender({ ...args, selectedMessageIndex: 2 })
    expect(virtualizer.scrollToIndex).toHaveBeenCalledWith(2, { align: 'center' })
  })

  // Recovery 2026-05-30 REG-6: this is the unit-level pin for the
  // toggle-yank regression. visibleMessages identity churns (e.g.
  // hiding compactions filters the array) BUT selectedMessageIndex
  // stays the same. The auto-scroll MUST NOT fire — the user never
  // navigated.
  it('does NOT scroll when visibleMessages identity changes without selectedMessageIndex changing', () => {
    const el = document.createElement('div') as HTMLDivElement
    const scrollSpy = vi.spyOn(el, 'scrollIntoView').mockImplementation(() => {})
    const messageRefs = new Map<string, HTMLDivElement>([['m-1', el]])
    const virtualizer = makeVirtualizer()
    const getSelectedMessageId = vi.fn<GetSelectedMessageIdFn>().mockReturnValue('m-1')
    const setSelectedMessageIndex = vi.fn<SetSelectedMessageIndexFn>()
    const setMessages = vi.fn<SetMessagesFn>()
    const setMessagesAndPinSelection = vi.fn<SetMessagesFn>()
    const initialVisible = [makeMessage('m-1'), makeMessage('m-2'), makeMessage('m-compact')]
    const args = {
      uuid: 'conv-1',
      conversation: makeConversation(initialVisible),
      visibleMessages: initialVisible,
      showPrelude: false,
      showToolCalls: false,
      focusArea: 'detail' as FocusArea,
      selectedMessageIndex: 0,
      setSelectedMessageIndex,
      setMessages,
      setMessagesAndPinSelection,
      getSelectedMessageId,
    }
    const { rerender } = renderHook(
      (props: typeof args) => {
        const ref = useRef<Map<string, HTMLDivElement>>(messageRefs)
        useMessageNavigationRegistry({
          ...props,
          messageRefs: ref,
          virtualizer: virtualizer as unknown as Virtualizer<HTMLDivElement, Element>,
        })
      },
      { initialProps: args },
    )
    expect(scrollSpy).not.toHaveBeenCalled()

    // Simulate the user toggling Show Compactions OFF: visibleMessages
    // identity changes (compact row filtered out), but
    // selectedMessageIndex stays at 0. The pre-fix code would scroll;
    // the post-fix code MUST NOT.
    const newVisible = [makeMessage('m-1'), makeMessage('m-2')]
    rerender({ ...args, visibleMessages: newVisible })
    expect(scrollSpy).not.toHaveBeenCalled()
    expect(virtualizer.scrollToIndex).not.toHaveBeenCalled()
  })

  // Recovery 2026-05-30 REG-6: same regression pin, for the
  // focusArea-flip vector. The outer `<div onClick={() =>
  // setFocusArea('detail')}>` in ConversationPage fires on any click
  // inside the page (e.g., the Show Compactions checkbox bubbles up).
  // The auto-scroll MUST NOT fire on this transition either.
  it('does NOT scroll when focusArea flips from list to detail without selectedMessageIndex changing', () => {
    const el = document.createElement('div') as HTMLDivElement
    const scrollSpy = vi.spyOn(el, 'scrollIntoView').mockImplementation(() => {})
    const messageRefs = new Map<string, HTMLDivElement>([['m-1', el]])
    const virtualizer = makeVirtualizer()
    const getSelectedMessageId = vi.fn<GetSelectedMessageIdFn>().mockReturnValue('m-1')
    const setSelectedMessageIndex = vi.fn<SetSelectedMessageIndexFn>()
    const setMessages = vi.fn<SetMessagesFn>()
    const setMessagesAndPinSelection = vi.fn<SetMessagesFn>()
    const visible = [makeMessage('m-1')]
    const args = {
      uuid: 'conv-1',
      conversation: makeConversation(visible),
      visibleMessages: visible,
      showPrelude: false,
      showToolCalls: false,
      focusArea: 'list' as FocusArea,
      selectedMessageIndex: 0,
      setSelectedMessageIndex,
      setMessages,
      setMessagesAndPinSelection,
      getSelectedMessageId,
    }
    const { rerender } = renderHook(
      (props: typeof args) => {
        const ref = useRef<Map<string, HTMLDivElement>>(messageRefs)
        useMessageNavigationRegistry({
          ...props,
          messageRefs: ref,
          virtualizer: virtualizer as unknown as Virtualizer<HTMLDivElement, Element>,
        })
      },
      { initialProps: args },
    )
    expect(scrollSpy).not.toHaveBeenCalled()

    rerender({ ...args, focusArea: 'detail' as FocusArea })
    expect(scrollSpy).not.toHaveBeenCalled()
    expect(virtualizer.scrollToIndex).not.toHaveBeenCalled()
  })

  it('does NOT scroll when focusArea is not "detail"', () => {
    const el = document.createElement('div') as HTMLDivElement
    const scrollSpy = vi.spyOn(el, 'scrollIntoView').mockImplementation(() => {})
    const virtualizer = makeVirtualizer()
    renderRegistry({
      conversation: makeConversation([makeMessage('m-1')]),
      visibleMessages: [makeMessage('m-1')],
      messageRefs: new Map([['m-1', el]]),
      virtualizer,
      selectedMessageId: 'm-1',
      focusArea: 'list',
    })
    expect(scrollSpy).not.toHaveBeenCalled()
    expect(virtualizer.scrollToIndex).not.toHaveBeenCalled()
  })
})
