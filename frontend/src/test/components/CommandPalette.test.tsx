import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '../utils';
import { CommandPalette } from '../../components/search/CommandPalette';

describe('CommandPalette', () => {
  beforeEach(() => {
    // Clear any existing dialogs
    document.body.innerHTML = '';
  });

  it('is not visible by default', () => {
    render(<CommandPalette />);
    expect(screen.queryByPlaceholderText('Search messages...')).not.toBeInTheDocument();
  });

  it('opens when Cmd+K is pressed', async () => {
    render(<CommandPalette />);

    // Press Cmd+K
    fireEvent.keyDown(document, { key: 'k', metaKey: true });

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search messages...')).toBeInTheDocument();
    });
  });

  it('opens when Ctrl+K is pressed', async () => {
    render(<CommandPalette />);

    // Press Ctrl+K
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search messages...')).toBeInTheDocument();
    });
  });

  it('closes when clicking backdrop', async () => {
    render(<CommandPalette />);

    // Open
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search messages...')).toBeInTheDocument();
    });

    // Click the backdrop (the div with aria-hidden="true")
    const backdrop = document.querySelector('[aria-hidden="true"]');
    expect(backdrop).toBeInTheDocument();
    fireEvent.click(backdrop!);

    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Search messages...')).not.toBeInTheDocument();
    });
  });

  it('closes when clicking close button', async () => {
    render(<CommandPalette />);

    // Open
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search messages...')).toBeInTheDocument();
    });

    // Click the X button
    const closeButton = document.querySelector('button');
    expect(closeButton).toBeInTheDocument();
    fireEvent.click(closeButton!);

    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Search messages...')).not.toBeInTheDocument();
    });
  });

  it('shows hint when query is too short', async () => {
    render(<CommandPalette />);

    // Open
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search messages...')).toBeInTheDocument();
    });

    // Type 1 character
    const input = screen.getByPlaceholderText('Search messages...');
    fireEvent.change(input, { target: { value: 'a' } });

    await waitFor(() => {
      expect(screen.getByText(/Type at least 2 characters/)).toBeInTheDocument();
    });
  });

  it('shows loading state when searching', async () => {
    render(<CommandPalette />);

    // Open
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search messages...')).toBeInTheDocument();
    });

    // Type a search query
    const input = screen.getByPlaceholderText('Search messages...');
    fireEvent.change(input, { target: { value: 'React' } });

    // Should show loading initially or results
    await waitFor(() => {
      const searching = screen.queryByText('Searching...');
      const hasResults = screen.queryByText('Building a React App');
      expect(searching || hasResults).toBeTruthy();
    });
  });

  it('displays search results with conversation names', async () => {
    render(<CommandPalette />);

    // Open
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search messages...')).toBeInTheDocument();
    });

    // Type a search query
    const input = screen.getByPlaceholderText('Search messages...');
    fireEvent.change(input, { target: { value: 'React' } });

    // Wait for results
    await waitFor(() => {
      expect(screen.getByText('Building a React App')).toBeInTheDocument();
    });
  });

  it('displays message snippets in results', async () => {
    render(<CommandPalette />);

    // Open
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search messages...')).toBeInTheDocument();
    });

    // Type a search query
    const input = screen.getByPlaceholderText('Search messages...');
    fireEvent.change(input, { target: { value: 'React' } });

    // Wait for results with snippets
    await waitFor(() => {
      // Should show "You:" or "Claude:" labels
      const youLabel = screen.queryAllByText(/You:/);
      const claudeLabel = screen.queryAllByText(/Claude:/);
      expect(youLabel.length + claudeLabel.length).toBeGreaterThan(0);
    });
  });

  it('shows no results message when search has no matches', async () => {
    render(<CommandPalette />);

    // Open
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search messages...')).toBeInTheDocument();
    });

    // Type a search query that won't match anything
    const input = screen.getByPlaceholderText('Search messages...');
    fireEvent.change(input, { target: { value: 'xyznonexistent' } });

    // Wait for no results
    await waitFor(() => {
      expect(screen.getByText('No results found.')).toBeInTheDocument();
    });
  });

  it('shows keyboard shortcut hint in footer', async () => {
    render(<CommandPalette />);

    // Open
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search messages...')).toBeInTheDocument();
    });

    expect(screen.getByText('to close')).toBeInTheDocument();
  });
});
