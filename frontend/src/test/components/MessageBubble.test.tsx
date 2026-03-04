import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '../utils';
import { MessageBubble } from '../../components/message/MessageBubble';
import { mockMessages, mockMessageWithToolUse } from '../mocks/data';

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

  it('renders tool_use block as collapsible', () => {
    render(<MessageBubble message={mockMessageWithToolUse} />);

    // Should show tool name
    expect(screen.getByText('Tool: read_file')).toBeInTheDocument();

    // Tool block should be collapsed by default
    expect(screen.queryByText(/"path"/)).not.toBeInTheDocument();
  });

  it('expands tool_use block on click', async () => {
    render(<MessageBubble message={mockMessageWithToolUse} />);

    // Click to expand
    const toolButton = screen.getByText('Tool: read_file');
    fireEvent.click(toolButton);

    // Should now show the JSON input
    expect(screen.getByText(/"path"/)).toBeInTheDocument();
    expect(screen.getByText(/\/src\/main.ts/)).toBeInTheDocument();
  });

  it('renders tool_result block as collapsible', () => {
    render(<MessageBubble message={mockMessageWithToolUse} />);

    // Should show tool result label
    expect(screen.getByText('Tool Result')).toBeInTheDocument();
  });

  it('expands tool_result block on click', async () => {
    render(<MessageBubble message={mockMessageWithToolUse} />);

    // Click to expand
    const resultButton = screen.getByText('Tool Result');
    fireEvent.click(resultButton);

    // Should now show the result content
    expect(screen.getByText(/export function main/)).toBeInTheDocument();
  });

  it('has copy button in expanded tool_use block', async () => {
    render(<MessageBubble message={mockMessageWithToolUse} />);

    // Expand the tool block
    const toolButton = screen.getByText('Tool: read_file');
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
