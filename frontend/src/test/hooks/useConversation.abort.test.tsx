/**
 * Hunt #5 (2026-05-18) — `useConversation` AbortController plumbing.
 *
 * Verifies that the AbortSignal supplied by React Query v5's queryFn
 * `({ signal })` callback is threaded through `api.getConversation()` →
 * `fetchJson(url, signal)` → `fetch(url, { signal })`, so when the user
 * navigates between conversations via keyboard the in-flight multi-MB
 * detail fetch for the conversation they LEFT is cancelled instead of
 * landing in the cache and being discarded.
 *
 * Pairs with `useSearch.abort.test.tsx` — both are RED before the
 * Hunt #5 plumbing lands.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';

import { server } from '../mocks/server';
import { useConversation } from '../../hooks/useConversations';

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

describe('useConversation — AbortController plumbing (Hunt #5)', () => {
  it('aborts the in-flight /api/conversations/:uuid request when the hook unmounts', async () => {
    let capturedSignal: AbortSignal | undefined;
    const requestReceived = vi.fn();

    server.use(
      http.get('/api/conversations/:uuid', async ({ request }) => {
        requestReceived();
        capturedSignal = request.signal;
        // Hang so unmount fires while the "fetch" is still in flight.
        await new Promise((resolve) => setTimeout(resolve, 5000));
        return HttpResponse.json({});
      }),
    );

    const Wrapper = makeWrapper();
    const { unmount } = renderHook(
      () => useConversation('some-uuid'),
      { wrapper: Wrapper },
    );

    // Detail has no debounce — request fires immediately on mount.
    await waitFor(
      () => expect(requestReceived).toHaveBeenCalled(),
      { timeout: 2000 },
    );

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(false);

    unmount();

    await waitFor(
      () => expect(capturedSignal!.aborted).toBe(true),
      { timeout: 2000 },
    );
  });
});
