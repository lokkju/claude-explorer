import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '../utils';
import { MessageBubble } from '../../components/message/MessageBubble';
import { useSettings } from '../../contexts/SettingsContext';
import { useEffect } from 'react';
import { mockMessages, mockMessageWithToolUse } from '../mocks/data';
import type { Message } from '../../lib/types';

/**
 * MessageBubble's tool_use / tool_result blocks are gated on
 * `showToolCalls` from SettingsContext. The default is false (a V1
 * UX choice — most users don't want tool noise). For the tool-block
 * tests below, we mount a tiny helper that flips the setting on
 * first render so the assertions can find the rendered tool labels.
 */
function EnableToolCalls() {
  const { showToolCalls, setShowToolCalls } = useSettings();
  useEffect(() => {
    if (!showToolCalls) {
      setShowToolCalls(true);
    }
  }, [showToolCalls, setShowToolCalls]);
  return null;
}

describe('MessageBubble', () => {
  it('renders human message with correct alignment', () => {
    const humanMessage = mockMessages[0];
    render(<MessageBubble message={humanMessage} />);

    // Human messages should show "You"
    expect(screen.getByText('You')).toBeInTheDocument();

    // Should have the message text
    expect(
      screen.getByText('How do I create a React component with TypeScript?')
    ).toBeInTheDocument();

    // Human messages should be right-aligned (flex-row-reverse)
    const container = screen.getByText('You').closest('.flex.gap-3');
    expect(container).toHaveClass('flex-row-reverse');
  });

  it('renders assistant message with correct alignment', () => {
    const assistantMessage = mockMessages[1];
    render(<MessageBubble message={assistantMessage} />);

    // Assistant messages should show "Claude"
    expect(screen.getByText('Claude')).toBeInTheDocument();

    // Assistant messages should be left-aligned (flex-row)
    const container = screen.getByText('Claude').closest('.flex.gap-3');
    expect(container).toHaveClass('flex-row');
    expect(container).not.toHaveClass('flex-row-reverse');
  });

  it('displays timestamp', () => {
    const message = mockMessages[0];
    render(<MessageBubble message={message} />);

    // formatDate returns "MMM d" for past dates (e.g., "Mar 1")
    // The date is 2026-03-01T10:00:00Z
    const header = screen.getByText('You').parentElement;
    expect(header?.textContent).toContain('Mar 1');
  });

  it('shows truncated indicator when message is truncated', () => {
    const truncatedMessage = {
      ...mockMessages[0],
      truncated: true,
    };
    render(<MessageBubble message={truncatedMessage} />);

    expect(screen.getByText('(truncated)')).toBeInTheDocument();
  });

  it('does not show truncated indicator for non-truncated messages', () => {
    const message = mockMessages[0];
    render(<MessageBubble message={message} />);

    expect(screen.queryByText('(truncated)')).not.toBeInTheDocument();
  });

  it('renders tool_use block as collapsible', async () => {
    render(
      <>
        <EnableToolCalls />
        <MessageBubble message={mockMessageWithToolUse} />
      </>,
    );

    // Should show tool name (after EnableToolCalls flips the setting).
    expect(await screen.findByText('Tool: read_file')).toBeInTheDocument();

    // Tool block should be collapsed by default
    expect(screen.queryByText(/"path"/)).not.toBeInTheDocument();
  });

  it('expands tool_use block on click', async () => {
    render(
      <>
        <EnableToolCalls />
        <MessageBubble message={mockMessageWithToolUse} />
      </>,
    );

    // Click to expand
    const toolButton = await screen.findByText('Tool: read_file');
    fireEvent.click(toolButton);

    // Should now show the JSON input
    expect(screen.getByText(/"path"/)).toBeInTheDocument();
    expect(screen.getByText(/\/src\/main.ts/)).toBeInTheDocument();
  });

  it('renders tool_result block as collapsible', async () => {
    render(
      <>
        <EnableToolCalls />
        <MessageBubble message={mockMessageWithToolUse} />
      </>,
    );

    // Should show tool result label
    expect(await screen.findByText('Tool Result')).toBeInTheDocument();
  });

  it('expands tool_result block on click', async () => {
    render(
      <>
        <EnableToolCalls />
        <MessageBubble message={mockMessageWithToolUse} />
      </>,
    );

    // Click to expand
    const resultButton = await screen.findByText('Tool Result');
    fireEvent.click(resultButton);

    // Should now show the result content
    expect(screen.getByText(/export function main/)).toBeInTheDocument();
  });

  it('has copy button in expanded tool_use block', async () => {
    render(
      <>
        <EnableToolCalls />
        <MessageBubble message={mockMessageWithToolUse} />
      </>,
    );

    // Expand the tool block
    const toolButton = await screen.findByText('Tool: read_file');
    fireEvent.click(toolButton);

    // Should have a copy button (Copy icon)
    const copyButton = document.querySelector('button svg.lucide-copy');
    expect(copyButton).toBeInTheDocument();
  });

  it('renders markdown content correctly', () => {
    const messageWithMarkdown = {
      ...mockMessages[1],
      content: [],
      text: '# Header\n\nThis is **bold** and *italic* text.\n\n```js\nconst x = 1;\n```',
    };
    render(<MessageBubble message={messageWithMarkdown} />);

    // Should render markdown (MarkdownRenderer handles this)
    expect(screen.getByText('Header')).toBeInTheDocument();
  });

  it('uses human avatar for human messages', () => {
    render(<MessageBubble message={mockMessages[0]} />);

    // Should have user icon
    const userIcon = document.querySelector('svg.lucide-user');
    expect(userIcon).toBeInTheDocument();
  });

  it('uses bot avatar for assistant messages', () => {
    render(<MessageBubble message={mockMessages[1]} />);

    // Should have bot icon
    const botIcon = document.querySelector('svg.lucide-bot');
    expect(botIcon).toBeInTheDocument();
  });

  it('applies correct background colors for human messages', () => {
    render(<MessageBubble message={mockMessages[0]} />);

    const contentDiv = screen.getByText('You').closest('.rounded-lg');
    expect(contentDiv).toHaveClass('bg-blue-50');
  });

  it('applies correct background colors for assistant messages', () => {
    render(<MessageBubble message={mockMessages[1]} />);

    const contentDiv = screen.getByText('Claude').closest('.rounded-lg');
    expect(contentDiv).toHaveClass('bg-zinc-100');
  });
});

/**
 * V1 polish cleanup (2026-05-13): the per-block hover-revealed copy +
 * bookmark buttons MUST NOT be offered on argless command-marker bubbles
 * (`is_command_marker === true`: `/exit`, `/clear`, `/compact`, prelude
 * rows). Those bubbles are CHROME — the backend export, search, and
 * full-conversation copy all already exclude them via the
 * `_is_excludable_marker` / `isExcludableMarker` predicate. Without this
 * guard, the per-block copy icon would leak `**You:**\n\nSession: /exit`
 * to the clipboard, breaking the "one truth, four surfaces" invariant
 * (viewer + search + server export + client copy).
 *
 * Bidirectional contract pinned here:
 *
 *   NEGATIVE (chrome — copy + bookmark hidden):
 *     - argless /exit marker (is_command_marker=true) -> no copy, no bookmark
 *     - prelude marker (is_prelude=true → is_command_marker=true) -> ditto
 *
 *   POSITIVE (real content — copy + bookmark visible):
 *     - argful /coding marker (is_command_marker=false carries user prose)
 *     - regular human message (no marker fields)
 *     - regular assistant message (no marker fields)
 */
describe('MessageBubble — per-block copy/bookmark hover overlay vs argless markers (V1 cleanup)', () => {
  function makeMarker(overrides: Partial<Message>): Message {
    return {
      uuid: 'mark-1',
      sender: 'human',
      text: 'Session: /exit',
      content: [{ type: 'text', text: 'Session: /exit' }],
      created_at: '2026-05-13T00:00:00Z',
      updated_at: '2026-05-13T00:00:00Z',
      truncated: false,
      parent_message_uuid: null,
      attachments: [],
      files: [],
      ...overrides,
    };
  }

  // The hover overlay only renders its action buttons inside the bubble's
  // own DOM subtree. We assert presence/absence of the Copy button (by
  // title) and Star bookmark button (by accessible label) scoped to the
  // bubble locator so we don't false-positive on icons elsewhere in the
  // tree.
  function copyButtonInBubble(bubble: HTMLElement): HTMLElement | null {
    return bubble.querySelector('button[title="Copy message as Markdown"]') as HTMLElement | null;
  }
  function bookmarkButtonInBubble(bubble: HTMLElement): HTMLElement | null {
    return (
      bubble.querySelector('button[aria-label="Bookmark message"]') as HTMLElement | null
    );
  }

  it('hides copy button for argless /exit marker (is_command_marker=true)', () => {
    const marker = makeMarker({
      is_command_marker: true,
      slash_command: '/exit',
    });
    render(<MessageBubble message={marker} conversationId="conv-1" />);
    // The bubble still renders (SlashCommandBadge is part of CC viewer UX),
    // but the per-block copy affordance must not be offered. We locate the
    // bubble by its data-message-uuid attribute, then scope the assertion.
    const bubble = document.querySelector(
      '[data-message-uuid="mark-1"]',
    ) as HTMLElement;
    expect(bubble).not.toBeNull();
    expect(copyButtonInBubble(bubble)).toBeNull();
  });

  it('hides bookmark button for argless /exit marker', () => {
    const marker = makeMarker({
      is_command_marker: true,
      slash_command: '/exit',
    });
    render(<MessageBubble message={marker} conversationId="conv-1" />);
    const bubble = document.querySelector(
      '[data-message-uuid="mark-1"]',
    ) as HTMLElement;
    expect(bubble).not.toBeNull();
    expect(bookmarkButtonInBubble(bubble)).toBeNull();
  });

  it('hides copy/bookmark for prelude marker (is_prelude=true → is_command_marker=true)', () => {
    const marker = makeMarker({
      uuid: 'mark-2',
      is_command_marker: true,
      is_prelude: true,
      slash_command: '/clear',
      text: 'Session: /clear',
      content: [{ type: 'text', text: 'Session: /clear' }],
    });
    render(<MessageBubble message={marker} conversationId="conv-1" />);
    const bubble = document.querySelector(
      '[data-message-uuid="mark-2"]',
    ) as HTMLElement;
    expect(bubble).not.toBeNull();
    expect(copyButtonInBubble(bubble)).toBeNull();
    expect(bookmarkButtonInBubble(bubble)).toBeNull();
  });

  // POSITIVE — counter-tests. The predicate must NOT over-suppress.

  it('shows copy + bookmark buttons for argful /coding marker (is_command_marker=false)', () => {
    const argful = makeMarker({
      uuid: 'mark-3',
      is_command_marker: false,
      slash_command: '/coding',
      text: 'Double-check your plan with the LLM council.',
      content: [
        { type: 'text', text: 'Double-check your plan with the LLM council.' },
      ],
    });
    render(<MessageBubble message={argful} conversationId="conv-1" />);
    const bubble = document.querySelector(
      '[data-message-uuid="mark-3"]',
    ) as HTMLElement;
    expect(bubble).not.toBeNull();
    // Argful markers carry the user's real prose; both action buttons
    // must remain available.
    expect(copyButtonInBubble(bubble)).not.toBeNull();
    expect(bookmarkButtonInBubble(bubble)).not.toBeNull();
  });

  it('shows copy + bookmark for a regular human message (no marker fields)', () => {
    // mockMessages[0] is the canonical "regular human message"; pin the
    // bubble lookup via its uuid.
    render(<MessageBubble message={mockMessages[0]} conversationId="conv-1" />);
    const bubble = document.querySelector(
      `[data-message-uuid="${mockMessages[0].uuid}"]`,
    ) as HTMLElement;
    expect(bubble).not.toBeNull();
    expect(copyButtonInBubble(bubble)).not.toBeNull();
    expect(bookmarkButtonInBubble(bubble)).not.toBeNull();
  });

  it('shows copy + bookmark for a regular assistant message (no marker fields)', () => {
    render(<MessageBubble message={mockMessages[1]} conversationId="conv-1" />);
    const bubble = document.querySelector(
      `[data-message-uuid="${mockMessages[1].uuid}"]`,
    ) as HTMLElement;
    expect(bubble).not.toBeNull();
    expect(copyButtonInBubble(bubble)).not.toBeNull();
    expect(bookmarkButtonInBubble(bubble)).not.toBeNull();
  });

  it('keeps copy + bookmark even when string-typed is_command_marker leaks in (strict === true guard)', () => {
    // Defense-in-depth: a future JSON-deserialization path might leak a
    // string-typed "true". The shared predicate uses strict identity, so
    // the bubble MUST still expose copy/bookmark — same contract as the
    // isExcludableMarker tests in conversationToMarkdown.test.ts.
    const marker = makeMarker({
      uuid: 'mark-4',
      // @ts-expect-error — deliberate type bypass
      is_command_marker: 'true',
      text: 'Body text.',
      content: [{ type: 'text', text: 'Body text.' }],
    });
    render(<MessageBubble message={marker} conversationId="conv-1" />);
    const bubble = document.querySelector(
      '[data-message-uuid="mark-4"]',
    ) as HTMLElement;
    expect(bubble).not.toBeNull();
    expect(copyButtonInBubble(bubble)).not.toBeNull();
    expect(bookmarkButtonInBubble(bubble)).not.toBeNull();
  });
});

/**
 * Hunt #11 (timer lifecycle): the copy-feedback `setTimeout` that flips
 * `setCopied(false)` after 2000ms must be cleared on unmount. Otherwise a
 * user who hits Copy and then switches conversation within 2s drives the
 * timer callback at a dead component (React 18 silently no-ops the setState,
 * but the timer + closure leak in memory, and any future refactor that
 * resurrects the warning would surface a real bug).
 *
 * The original version used `vi.getTimerCount()` deltas — which can
 * tie at zero-delta when React 18 strict-mode or react-query schedules
 * a timer concurrently with the unmount cleanup. The robust pattern is
 * to spy on `clearTimeout` directly: the cleanup effect calls it with
 * the ref'd timer ID, and the spy proves it ran. Without the cleanup,
 * the spy is never called with our specific timer ID.
 */
describe('MessageBubble — timer cleanup on unmount (Hunt #11)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('clears the copy-feedback timer when MessageBubble unmounts', async () => {
    const humanMessage = mockMessages[0];

    // Capture the setTimeout ID that handleCopyMessage schedules. We
    // intercept setTimeout via a spy so we know EXACTLY which ID belongs
    // to our timer (vs the ones react-query / msw scheduled).
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    const { unmount } = render(<MessageBubble message={humanMessage} />);

    const copyButton = screen.getByTitle('Copy message as Markdown');

    await act(async () => {
      fireEvent.click(copyButton);
      // Flush microtasks so handleCopyMessage's post-await continuation
      // (which schedules the 2000ms setTimeout) runs.
      await Promise.resolve();
      await Promise.resolve();
    });

    // The Copy → Check icon swap confirms setCopied(true) committed,
    // which means the 2000ms reset setTimeout was scheduled.
    expect(document.querySelector('svg.lucide-check')).toBeInTheDocument();

    // Find the 2000ms timer we just scheduled. (react-query and other
    // sources schedule timers with different delays.)
    const ourTimerCall = setTimeoutSpy.mock.calls.find(
      (call) => call[1] === 2000
    );
    expect(ourTimerCall, '2000ms copy-reset timer should have been scheduled')
      .toBeDefined();
    const ourTimerId = setTimeoutSpy.mock.results[
      setTimeoutSpy.mock.calls.indexOf(ourTimerCall!)
    ].value;

    // Reset clearTimeout spy so we only see calls during unmount.
    clearTimeoutSpy.mockClear();

    // Unmount BEFORE the timer fires.
    unmount();

    // Load-bearing assertion: the cleanup effect must have called
    // clearTimeout with OUR specific timer ID. Without the cleanup
    // useEffect, no such call happens for our ID, and the timer would
    // fire setCopied(false) on a dead component.
    const clearedIds = clearTimeoutSpy.mock.calls.map((call) => call[0]);
    expect(clearedIds).toContain(ourTimerId);
  });
});
