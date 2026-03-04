import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '../utils';
import { TreeView } from '../../components/branch/TreeView';
import { mockConversationTree } from '../mocks/data';

describe('TreeView', () => {
  const mockOnSelectPath = vi.fn();

  beforeEach(() => {
    mockOnSelectPath.mockClear();
  });

  it('renders the tree structure', () => {
    render(
      <TreeView tree={mockConversationTree} onSelectPath={mockOnSelectPath} />
    );

    // Should show root message
    expect(screen.getByText(/How do I analyze data in Python/)).toBeInTheDocument();
  });

  it('displays sender labels', () => {
    render(
      <TreeView tree={mockConversationTree} onSelectPath={mockOnSelectPath} />
    );

    // Should show You and Claude labels
    expect(screen.getAllByText('You').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Claude').length).toBeGreaterThan(0);
  });

  it('highlights active path messages', () => {
    render(
      <TreeView tree={mockConversationTree} onSelectPath={mockOnSelectPath} />
    );

    // Active path messages should have amber background
    const activeMessages = document.querySelectorAll('.bg-amber-50, [class*="bg-amber"]');
    expect(activeMessages.length).toBeGreaterThan(0);
  });

  it('shows branch count for nodes with multiple children', () => {
    render(
      <TreeView tree={mockConversationTree} onSelectPath={mockOnSelectPath} />
    );

    // The assistant's first response has 2 children (branches)
    expect(screen.getByText('2 branches')).toBeInTheDocument();
  });

  it('calls onSelectPath when a message is clicked', () => {
    render(
      <TreeView tree={mockConversationTree} onSelectPath={mockOnSelectPath} />
    );

    // Click on the root message
    const rootMessage = screen.getByText(/How do I analyze data in Python/);
    fireEvent.click(rootMessage.closest('[class*="cursor-pointer"]')!);

    expect(mockOnSelectPath).toHaveBeenCalled();
  });

  it('displays message preview text', () => {
    render(
      <TreeView tree={mockConversationTree} onSelectPath={mockOnSelectPath} />
    );

    // Should show truncated message previews
    expect(screen.getByText(/You can use pandas for data analysis/)).toBeInTheDocument();
  });

  it('shows both branch alternatives', () => {
    render(
      <TreeView tree={mockConversationTree} onSelectPath={mockOnSelectPath} />
    );

    // Should show both follow-up questions (branches)
    expect(screen.getAllByText(/CSV/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Excel/i).length).toBeGreaterThan(0);
  });
});
