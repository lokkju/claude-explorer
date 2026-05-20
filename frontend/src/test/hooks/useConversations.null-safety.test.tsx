/**
 * Null-safety regression tests for `useConversations` (2026-05-18).
 *
 * Mirrors the backend null-safety fixes (commits 50b5cc5, adbe92d,
 * f9a2fd2): `data.get("key", "").lower()` crashed when the key existed
 * with value `None` because `dict.get` only defaults on MISSING keys.
 *
 * The same bug class applies to TS/React: `c.name.toLowerCase()` will
 * throw `TypeError: Cannot read properties of null (reading
 * 'toLowerCase')` if a `ConversationListItem.name` field arrives null
 * at runtime even though the TypeScript type declares it `string`.
 *
 * The risk vectors:
 *   - Backend API drift (Pydantic schema regressions, partial
 *     deserialization of older on-disk JSONs).
 *   - Mock test data shaped without a name field.
 *   - URL params / state hydration leaking null/undefined.
 *
 * The fix mirrors the backend's `(data.get(k) or "").lower()` with
 * `(c.name ?? '').toLowerCase()` — minimal, in-place, defensive.
 *
 * These tests are written RED-first (they were ALL FAILING before the
 * `?? ''` guards landed in `useConversations.ts`).
 */

import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';

import { server } from '../mocks/server';
import { useConversations } from '../../hooks/useConversations';
import type { ConversationListItem } from '../../lib/types';

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

/**
 * Build a `ConversationListItem` with optional null leakage on the
 * fields the runtime audit flagged (name, project_path). The cast is
 * deliberate: the goal is to simulate API drift where the wire format
 * disagrees with the TypeScript type.
 */
function makeListItemWithNulls(
  uuid: string,
  overrides: Partial<{ name: string | null; project_path: string | null }>,
): ConversationListItem {
  return {
    uuid,
    name: overrides.name as string,
    model: 'claude-sonnet-4-6',
    created_at: '2026-05-18T00:00:00Z',
    updated_at: '2026-05-18T00:00:00Z',
    is_starred: false,
    message_count: 1,
    has_branches: false,
    source: 'CLAUDE_AI',
    project_path: overrides.project_path as string | null,
  };
}

describe('useConversations — null-safety (mirrors backend H1-H4)', () => {
  it('does NOT throw when a conversation has name=null and the user is typing a search query', async () => {
    server.use(
      http.get('/api/conversations', () => {
        return HttpResponse.json([
          makeListItemWithNulls('null-name', { name: null }),
          makeListItemWithNulls('has-name', { name: 'Real Conversation' }),
        ]);
      }),
    );

    const Wrapper = makeWrapper();
    const { result } = renderHook(
      () => useConversations({ search: 'real' }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // The null-name row must not crash the client-side filter
    // (mirrors the backend `(data.get(k) or "").lower()` invariant).
    expect(result.current.error).toBeNull();
    expect(result.current.data).toBeDefined();
    // The "Real Conversation" must match; the null-named row must not
    // (its name normalizes to '' which doesn't include 'real').
    const filtered = result.current.data ?? [];
    expect(filtered.map((c) => c.uuid).sort()).toEqual(['has-name']);
  });

  it('does NOT throw when a conversation has project_path=null and the user searches', async () => {
    server.use(
      http.get('/api/conversations', () => {
        return HttpResponse.json([
          makeListItemWithNulls('null-project', { name: 'unrelated', project_path: null }),
          makeListItemWithNulls('has-project', { name: 'A', project_path: '/Users/me/code/foo' }),
        ]);
      }),
    );

    const Wrapper = makeWrapper();
    const { result } = renderHook(
      () => useConversations({ search: 'foo' }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBeNull();
    const filtered = result.current.data ?? [];
    // Project-path match works on the non-null row; the null-project
    // row is correctly ignored (its project_path normalizes to '').
    expect(filtered.map((c) => c.uuid).sort()).toEqual(['has-project']);
  });

  it('returns all rows (including null-name) when search is empty', async () => {
    server.use(
      http.get('/api/conversations', () => {
        return HttpResponse.json([
          makeListItemWithNulls('null-name', { name: null }),
          makeListItemWithNulls('has-name', { name: 'Real Conversation' }),
        ]);
      }),
    );

    const Wrapper = makeWrapper();
    const { result } = renderHook(
      () => useConversations({}),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBeNull();
    const all = result.current.data ?? [];
    expect(all.map((c) => c.uuid).sort()).toEqual(['has-name', 'null-name']);
  });
});
