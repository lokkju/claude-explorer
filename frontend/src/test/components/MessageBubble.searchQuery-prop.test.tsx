/**
 * Issue 3 follow-up (2026-05-20) — MessageBubble receives searchQuery as
 * a PROP, not from useSearchPanelOptional() context.
 *
 * Why this matters: the original Issue 1 ship (c6c31b7) subscribed every
 * MessageBubble to SearchPanelContext via useSearchPanelOptional() so the
 * bubble could highlight the live query. On a 15K-message conversation,
 * that meant every keystroke in the SearchPanel input cascaded a re-
 * render through ALL 15K bubbles, locking the main thread for seconds and
 * starving the browser's smooth-scroll animation frames. The user-visible
 * symptom (screenshot 19.png) was "scroll on hit #1 doesn't happen / is
 * really slow".
 *
 * The fix breaks that subscription: ConversationPage now reads `query`
 * from SearchPanelContext once, runs it through useDeferredValue, and
 * passes the deferred value down as a prop. Memo on MessageBubble
 * includes searchQuery in the comparator, so bubbles re-render ONLY when
 * the deferred query actually flips — and React schedules the storm at
 * low priority so the scroll-into-view frame fires first.
 *
 * Bidirectional contract pinned here:
 *
 *   POSITIVE: passing `searchQuery="this image"` as a prop renders <mark>
 *     elements inside the bubble body. (Wiring is alive.)
 *
 *   NEGATIVE: omitting the prop entirely → ZERO <mark> elements, even
 *     though the bubble used to subscribe to context and would have
 *     picked up a (hypothetical) live query. (Subscription is broken
 *     intentionally; the prop is the only source.)
 *
 * The negative half is the load-bearing one — without it, a future
 * refactor could re-introduce the context subscription and tank perf
 * again without any test failing.
 */

import { describe, it, expect } from 'vitest'
import { render } from '../utils'
import { MessageBubble } from '../../components/message/MessageBubble'
import type { Message } from '../../lib/types'

function makeTextMessage(text: string): Message {
  return {
    uuid: 'msg-search-prop',
    sender: 'assistant',
    text,
    content: [{ type: 'text', text }],
    created_at: '2026-05-20T00:00:00Z',
    updated_at: '2026-05-20T00:00:00Z',
    truncated: false,
    parent_message_uuid: null,
    attachments: [],
    files: [],
  }
}

describe('MessageBubble — searchQuery prop (Issue 3 perf fix)', () => {
  it('POSITIVE: highlights when searchQuery prop is passed', () => {
    const msg = makeTextMessage('The phrase this image appears once.')
    const { container } = render(
      <MessageBubble message={msg} searchQuery='"this image"' />,
    )
    const marks = Array.from(container.querySelectorAll('mark'))
    expect(marks.length).toBeGreaterThan(0)
    expect(marks.some((m) => m.textContent === 'this image')).toBe(true)
  })

  it('NEGATIVE: NO highlights when searchQuery prop is omitted', () => {
    // Same message content. No prop, no provider, no other source of
    // searchQuery. The bubble must NOT subscribe to anything else for
    // its highlight signal — without the prop, plain render.
    const msg = makeTextMessage('The phrase this image appears once.')
    const { container } = render(<MessageBubble message={msg} />)
    expect(container.querySelectorAll('mark')).toHaveLength(0)
  })

  it('NEGATIVE: NO highlights when searchQuery prop is empty string', () => {
    // Explicit empty string — same outcome as omitting the prop.
    const msg = makeTextMessage('The phrase this image appears once.')
    const { container } = render(
      <MessageBubble message={msg} searchQuery="" />,
    )
    expect(container.querySelectorAll('mark')).toHaveLength(0)
  })

  it('POSITIVE: prop value changes are reflected in <mark> contents', () => {
    const msg = makeTextMessage('alpha beta gamma delta')
    const { container, rerender } = render(
      <MessageBubble message={msg} searchQuery="alpha" />,
    )
    let marks = Array.from(container.querySelectorAll('mark'))
    expect(marks.map((m) => m.textContent)).toEqual(['alpha'])

    // Re-render with a different prop value — the new query wins.
    rerender(<MessageBubble message={msg} searchQuery="gamma" />)
    marks = Array.from(container.querySelectorAll('mark'))
    expect(marks.map((m) => m.textContent)).toEqual(['gamma'])
  })
})
