/**
 * Commit 6 — React Query duplicate-fetch fix: /api/conversations/<uuid>/tree.
 *
 * Playwright investigation on 2026-05-23 (real corpus, dev server):
 *
 *   navigating to /conversations/<uuid> fires:
 *     /api/conversations/<uuid>        → 1 call (correct — detail dedup works)
 *     /api/conversations/<uuid>/tree   → 2 calls (BUG)
 *
 * Root cause: TreeViewModal calls `useConversationTree(uuid)`
 * UNCONDITIONALLY before its `if (!isOpen) return null` early
 * return. The hook fires the query the moment the component mounts,
 * not when the user actually opens the modal. Combined with React
 * 19 StrictMode dev-mode double-mount, the same query fires twice
 * before the user has interacted with anything.
 *
 * Fix: thread an `enabled` parameter through useConversationTree.
 * TreeViewModal passes `isOpen` so the query only fires when the
 * user clicks "View branches" to open the modal.
 *
 * Contract pinned here: rendering <TreeViewModal isOpen={false} />
 * issues ZERO `/api/conversations/<uuid>/tree` fetches.
 */
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';

import { render, screen, waitFor } from '../utils';
import { server } from '../mocks/server';
import { TreeViewModal } from '../../components/branch/TreeViewModal';

describe('TreeViewModal — /api/conversations/<uuid>/tree fetch gating', () => {
  it('does NOT fetch /tree when isOpen=false', async () => {
    const spy = vi.fn();
    server.use(
      http.get('/api/conversations/test-uuid-001/tree', () => {
        spy();
        return HttpResponse.json({
          uuid: 'test-uuid-001',
          root_messages: [],
          active_path: [],
        });
      }),
    );

    render(
      <TreeViewModal
        uuid="test-uuid-001"
        isOpen={false}
        onClose={() => {}}
        onSelectPath={() => {}}
      />,
    );

    // Wait longer than React Query's typical settle time. If the
    // fetch had fired, MSW's spy would have been called by now.
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(spy).toHaveBeenCalledTimes(0);
  });

  it('fetches /tree exactly once when isOpen=true', async () => {
    const spy = vi.fn();
    server.use(
      http.get('/api/conversations/test-uuid-002/tree', () => {
        spy();
        return HttpResponse.json({
          uuid: 'test-uuid-002',
          root_messages: [],
          active_path: [],
        });
      }),
    );

    render(
      <TreeViewModal
        uuid="test-uuid-002"
        isOpen={true}
        onClose={() => {}}
        onSelectPath={() => {}}
      />,
    );

    // Wait for the query to settle (modal renders content once tree
    // data arrives or shows an empty state).
    await waitFor(
      () => {
        // The modal shows "Conversation Tree" header once mounted +
        // open. Use that as the "settle" signal.
        expect(screen.getByText('Conversation Tree')).toBeInTheDocument();
      },
      { timeout: 1500 },
    );

    // Settle a bit more to catch any racing re-fetches.
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(spy).toHaveBeenCalledTimes(1);
  });
});
