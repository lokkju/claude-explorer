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

  it('highlights ONLY the active path messages, not the off-path branches', () => {
    // 2026-05-18 council audit: the prior assertion was
    // `expect(activeMessages.length).toBeGreaterThan(0)`, which passed
    // for ANY non-zero count (zero would have failed). It said nothing
    // about WHICH messages were highlighted. A regression that
    // highlighted off-path nodes — or no nodes at all — could slip past.
    //
    // The mock conversation tree's active_path is
    // ['tree-msg-1', 'tree-msg-2', 'tree-msg-3', 'tree-msg-4']. The
    // off-path branch contains 'tree-msg-5' and 'tree-msg-6'. Both
    // sets must show in the rendered DOM (the tree shows ALL branches
    // at once); the active set must carry the amber-tinted bubble
    // class, and the off-path set must NOT.
    render(
      <TreeView tree={mockConversationTree} onSelectPath={mockOnSelectPath} />
    );

    // Look up each node's bubble by its preview text (the text content
    // chosen for the mock fixture). The bubble carries the amber bg
    // class on active nodes only.
    const ACTIVE_TEXTS: Array<string | RegExp> = [
      /How do I analyze data in Python/,
      /You can use pandas/,
      /Show me an example with CSV/,
      /how to read a CSV file/,
    ];
    const OFF_PATH_TEXTS: Array<string | RegExp> = [
      /What about Excel files/,
      /For Excel files, you can use pandas\.read_excel/,
    ];

    for (const t of ACTIVE_TEXTS) {
      const node = screen.getByText(t).closest('.rounded-lg');
      expect(node, `expected active node for ${t} to be rendered`).not.toBeNull();
      expect(node!.className).toMatch(/bg-amber/);
    }
    for (const t of OFF_PATH_TEXTS) {
      const node = screen.getByText(t).closest('.rounded-lg');
      expect(node, `expected off-path node for ${t} to be rendered`).not.toBeNull();
      expect(node!.className).not.toMatch(/bg-amber/);
    }
  });

  it('shows branch count for nodes with multiple children', () => {
    render(
      <TreeView tree={mockConversationTree} onSelectPath={mockOnSelectPath} />
    );

    // The assistant's first response has 2 children (branches)
    expect(screen.getByText('2 branches')).toBeInTheDocument();
  });

  it('calls onSelectPath with the full path-to-leaf when the root is clicked', () => {
    // 2026-05-18 council audit: prior assertion was
    // `expect(mockOnSelectPath).toHaveBeenCalled()`, which provides
    // false security against synthetic event leaks — any spurious
    // invocation (with wrong args, with no args) would pass. Pin the
    // exact argument: clicking the root walks down the first child
    // chain to the leaf, so the callback must receive the FULL active
    // path (mock fixture: root → first-child branch → leaf).
    render(
      <TreeView tree={mockConversationTree} onSelectPath={mockOnSelectPath} />
    );

    const rootMessage = screen.getByText(/How do I analyze data in Python/);
    fireEvent.click(rootMessage.closest('[class*="cursor-pointer"]')!);

    expect(mockOnSelectPath).toHaveBeenCalledTimes(1);
    // TreeNode.handleClick calls buildPathToLeaf which follows the
    // FIRST child at every fork. Root's first child is tree-msg-2,
    // its first child is tree-msg-3 (CSV branch), its first child
    // is tree-msg-4. The path includes the root itself.
    expect(mockOnSelectPath).toHaveBeenCalledWith([
      'tree-msg-1',
      'tree-msg-2',
      'tree-msg-3',
      'tree-msg-4',
    ]);
  });

  it('calls onSelectPath with the OFF-path branch when an alternative leaf is clicked', () => {
    // Counter-test: clicking the off-path Excel branch must select THAT
    // path, not the current default. Catches a regression where the
    // click handler always returned the active path regardless of
    // which node the user targeted.
    mockOnSelectPath.mockClear();
    render(
      <TreeView tree={mockConversationTree} onSelectPath={mockOnSelectPath} />
    );

    const excelLeaf = screen.getByText(/For Excel files, you can use pandas\.read_excel/);
    fireEvent.click(excelLeaf.closest('[class*="cursor-pointer"]')!);

    expect(mockOnSelectPath).toHaveBeenCalledTimes(1);
    expect(mockOnSelectPath).toHaveBeenCalledWith([
      'tree-msg-1',
      'tree-msg-2',
      'tree-msg-5',
      'tree-msg-6',
    ]);
  });

  it('displays message preview text', () => {
    render(
      <TreeView tree={mockConversationTree} onSelectPath={mockOnSelectPath} />
    );

    // Should show truncated message previews
    expect(screen.getByText(/You can use pandas for data analysis/)).toBeInTheDocument();
  });

  it('shows both branch alternatives with their full preview text', () => {
    // 2026-05-18 council audit: prior assertion was
    // `getAllByText(/CSV/i).length).toBeGreaterThan(0)`, which passes
    // for ONE or TWENTY matches — verifies existence, not quantity or
    // uniqueness. A regression that rendered only one branch (or
    // rendered the same branch twice) would slip past. Pin the EXACT
    // preview text of each alternative so any drift fails loudly.
    render(
      <TreeView tree={mockConversationTree} onSelectPath={mockOnSelectPath} />
    );

    // The TreeNode preview truncates after 60 chars; both mock-fixture
    // branch texts are well under that, so they render in full.
    expect(
      screen.getByText('Show me an example with CSV files'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('What about Excel files?'),
    ).toBeInTheDocument();
    // Same for the leaf assistant responses on each branch.
    expect(
      screen.getByText(/Here's how to read a CSV file with pandas/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/For Excel files, you can use pandas\.read_excel/),
    ).toBeInTheDocument();
  });
});
