import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '../utils';
import { ConversationList } from '../../components/conversation/ConversationList';
import { server } from '../mocks/server';
import { http, HttpResponse } from 'msw';
import { mockConversations } from '../mocks/data';

describe('ConversationList', () => {
  it('renders loading skeletons while fetching', () => {
    // Delay the response to see loading state
    server.use(
      http.get('/api/conversations', async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return HttpResponse.json(mockConversations);
      })
    );

    render(<ConversationList />);

    // Should show skeleton loading state
    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('renders empty state when no conversations', async () => {
    server.use(
      http.get('/api/conversations', () => {
        return HttpResponse.json([]);
      })
    );

    render(<ConversationList />);

    await waitFor(() => {
      expect(screen.getByText('No conversations yet')).toBeInTheDocument();
    });
  });

  it('renders "No conversations found" when search has no results', async () => {
    server.use(
      http.get('/api/conversations', () => {
        return HttpResponse.json([]);
      })
    );

    render(<ConversationList searchQuery="nonexistent" />);

    await waitFor(() => {
      expect(screen.getByText('No conversations found')).toBeInTheDocument();
    });
  });

  it('renders conversation items sorted with starred first', async () => {
    render(<ConversationList />);

    await waitFor(() => {
      expect(screen.getByText('Starred')).toBeInTheDocument();
    });

    // Check that starred conversations appear
    expect(screen.getByText('Building a React App')).toBeInTheDocument();
    expect(screen.getByText('Debugging API Errors')).toBeInTheDocument();

    // Check that unstarred conversations also appear
    expect(screen.getByText('Python Data Analysis')).toBeInTheDocument();
    expect(screen.getByText('Learning TypeScript')).toBeInTheDocument();
  });

  it('shows star icon for starred conversations', async () => {
    render(<ConversationList />);

    await waitFor(() => {
      expect(screen.getByText('Building a React App')).toBeInTheDocument();
    });

    // Starred conversations should have filled star icons
    const starIcons = document.querySelectorAll('.fill-yellow-400');
    expect(starIcons.length).toBe(2); // Two starred conversations
  });

  it('shows branch indicator for branched conversations', async () => {
    render(<ConversationList />);

    await waitFor(() => {
      expect(screen.getByText('Python Data Analysis')).toBeInTheDocument();
    });

    // The branched conversation should have GitBranch icon
    // Python Data Analysis has has_branches: true
    const branchIcons = document.querySelectorAll('svg.lucide-git-branch');
    expect(branchIcons.length).toBe(1);
  });

  it('displays model badge, date, and message count', async () => {
    render(<ConversationList />);

    await waitFor(() => {
      expect(screen.getByText('Building a React App')).toBeInTheDocument();
    });

    // Check for model badges
    expect(screen.getAllByText('claude-sonnet-4-6').length).toBeGreaterThan(0);
    expect(screen.getByText('claude-3-opus-20240229')).toBeInTheDocument();

    // Check for message counts
    expect(screen.getByText('10 msgs')).toBeInTheDocument();
    expect(screen.getByText('8 msgs')).toBeInTheDocument();
  });

  it('shows error state when API fails', async () => {
    server.use(
      http.get('/api/conversations', () => {
        return new HttpResponse(null, { status: 500 });
      })
    );

    render(<ConversationList />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load conversations')).toBeInTheDocument();
    });
  });

  it('filters conversations by search query', async () => {
    server.use(
      http.get('/api/conversations', ({ request }) => {
        const url = new URL(request.url);
        const search = url.searchParams.get('search');

        if (search === 'React') {
          return HttpResponse.json([mockConversations[0]]); // Only React conversation
        }
        return HttpResponse.json(mockConversations);
      })
    );

    render(<ConversationList searchQuery="React" />);

    await waitFor(() => {
      expect(screen.getByText('Building a React App')).toBeInTheDocument();
    });

    // Other conversations should not be visible
    expect(screen.queryByText('Python Data Analysis')).not.toBeInTheDocument();
  });

  it('truncates long titles with ellipsis', async () => {
    server.use(
      http.get('/api/conversations', () => {
        return HttpResponse.json([
          {
            ...mockConversations[0],
            name: 'This is a very long conversation title that should be truncated with ellipsis when displayed in the list',
          },
        ]);
      })
    );

    render(<ConversationList />);

    await waitFor(() => {
      const title = screen.getByText(/This is a very long/);
      expect(title).toHaveClass('truncate');
    });
  });
});
