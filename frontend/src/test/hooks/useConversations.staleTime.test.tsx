/**
 * Hunt #5 (2026-05-18) — `staleTime` regression tests.
 *
 * Before this hunt:
 *
 *   - `useConversationTree`  had `staleTime: Infinity`.
 *   - `useConfigStats`       had `staleTime: Infinity`.
 *   - `routes/SettingsPage.tsx` had an INLINE `useQuery({queryKey:
 *     ['config-stats'], …, staleTime: Infinity})` that would override
 *     the hook's TTL per-observer.
 *
 * Symptoms of `Infinity` on mutable data:
 *   - tree modal showed pre-branch state after the fetch pipeline
 *     ingested a new branch — `refetchOnWindowFocus` was suppressed.
 *   - Settings page showed pre-fetch `conversation_count` indefinitely.
 *
 * The fix dropped `Infinity` to:
 *   - `useConversationTree`:  5min (mirrors useConversation defaults).
 *   - `useConfigStats`:       60s.
 *   - `SettingsPage` inline:  no override (inherits default 30s).
 *
 * These tests pin the values by reading the observer options that
 * TanStack Query records after the first mount — the same surface a
 * future "let's bring Infinity back" PR would have to touch.
 */

import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';

import { server } from '../mocks/server';
import {
  useConversationTree,
  useConfigStats,
} from '../../hooks/useConversations';
import { queryKeys } from '../../lib/queryClient';

function makeWrapperAndClient() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { Wrapper, qc };
}

describe('useConversationTree — staleTime (Hunt #5)', () => {
  it('uses a finite staleTime (NOT Infinity) so refetchOnWindowFocus fires after a branch is ingested', async () => {
    const { Wrapper, qc } = makeWrapperAndClient();
    const { result } = renderHook(() => useConversationTree('conv-2'), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // After first mount, the QueryCache has an entry with the observer's
    // resolved options. `staleTime` lives on the QueryObserver options;
    // we read it via the observer list on the cached entry.
    const cached = qc.getQueryCache().find({
      queryKey: queryKeys.conversations.tree('conv-2'),
    });
    expect(cached).toBeDefined();
    const observers = cached!.observers;
    expect(observers.length).toBeGreaterThan(0);
    const staleTime = observers[0].options.staleTime;
    expect(staleTime).not.toBe(Infinity);
    // Hunt #5 chose 5min to mirror useConversation.
    expect(staleTime).toBe(5 * 60 * 1000);
  });
});

describe('useConfigStats — staleTime (Hunt #5)', () => {
  it('uses a finite staleTime (NOT Infinity) so the Settings page picks up post-fetch conversation_count', async () => {
    // The shared MSW setup does not stub `/api/config/stats`; add a
    // minimal stub here so the observer mounts cleanly.
    server.use(
      http.get('/api/config/stats', () =>
        HttpResponse.json({ conversation_count: 0 }),
      ),
    );

    const { Wrapper, qc } = makeWrapperAndClient();
    const { result } = renderHook(() => useConfigStats(), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const cached = qc.getQueryCache().find({ queryKey: ['config-stats'] });
    expect(cached).toBeDefined();
    const observers = cached!.observers;
    expect(observers.length).toBeGreaterThan(0);
    const staleTime = observers[0].options.staleTime;
    expect(staleTime).not.toBe(Infinity);
    // Hunt #5 chose 60s — endpoint is slow enough that <60s churn isn't
    // worth the round-trip but `Infinity` is wrong.
    expect(staleTime).toBe(60 * 1000);
  });
});
