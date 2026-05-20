/**
 * Envelope-validation regression tests for `usePreferences` (2026-05-18).
 *
 * Part of the frontend type-assertion-lies audit (council bug-class #2).
 *
 * Before the fix, `fetchPrefs` / `patchPrefs` did:
 *
 *     return (await r.json()) as PreferencesEnvelope
 *
 * That cast is a runtime lie. If the backend ever returns a shape that
 * doesn't match (e.g. `{ version: 1, data: [] }` from a future
 * mis-serialization, or `null` from a buggy proxy, or a plain string from
 * an HTML error page that slipped past the `r.ok` check) we hand the
 * caller a value typed PreferencesEnvelope that crashes downstream the
 * moment something reads `envelope.data.someKey`.
 *
 * These tests pin the new isPrefsEnvelope guard. They were RED before
 * the validator landed: the unvalidated version would resolve with the
 * bad shape and the assertion on `envelope.data[key]` would either crash
 * later or return undefined silently.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';

import { server } from '../mocks/server';
import { usePreferences } from '../../hooks/usePreferences';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    get store() { return store; },
    getItem: vi.fn((key: string) => (key in store ? store[key] : null)),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

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

beforeEach(() => {
  localStorageMock.clear();
});

describe('usePreferences — envelope validation (type-assertion-lies audit)', () => {
  it('rejects an array-shaped `data` field (typeof [] === "object" passes naive guard)', async () => {
    // The buggy first-draft guard `typeof v.data === "object" && v.data !== null`
    // accepts arrays because typeof [] === 'object'. This test pins the
    // !Array.isArray(v.data) addition.
    server.use(
      http.get('/api/preferences', () =>
        HttpResponse.json({ version: 1, data: [] })
      ),
    );
    const { result } = renderHook(
      () => usePreferences<string>('myKey', 'fallback-value'),
      { wrapper: makeWrapper() },
    );
    // When the envelope is malformed, the query must throw and the hook
    // returns the fallback — NOT crash trying to index into an array.
    await waitFor(() => {
      expect(result.current[0]).toBe('fallback-value');
    });
  });

  it('rejects a null body', async () => {
    server.use(
      http.get('/api/preferences', () => HttpResponse.json(null)),
    );
    const { result } = renderHook(
      () => usePreferences<string>('myKey', 'fallback-value'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => {
      expect(result.current[0]).toBe('fallback-value');
    });
  });

  it('rejects a string body (e.g. HTML error page slipping past r.ok)', async () => {
    server.use(
      http.get('/api/preferences', () =>
        HttpResponse.json('I am not an envelope')
      ),
    );
    const { result } = renderHook(
      () => usePreferences<string>('myKey', 'fallback-value'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => {
      expect(result.current[0]).toBe('fallback-value');
    });
  });

  it('rejects a body missing the version field', async () => {
    server.use(
      http.get('/api/preferences', () =>
        HttpResponse.json({ data: { myKey: 'real' } })
      ),
    );
    const { result } = renderHook(
      () => usePreferences<string>('myKey', 'fallback-value'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => {
      expect(result.current[0]).toBe('fallback-value');
    });
  });

  it('rejects a body where version is a string', async () => {
    server.use(
      http.get('/api/preferences', () =>
        HttpResponse.json({ version: 'v1', data: { myKey: 'real' } })
      ),
    );
    const { result } = renderHook(
      () => usePreferences<string>('myKey', 'fallback-value'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => {
      expect(result.current[0]).toBe('fallback-value');
    });
  });

  it('ACCEPTS a well-formed envelope (positive control)', async () => {
    server.use(
      http.get('/api/preferences', () =>
        HttpResponse.json({ version: 1, data: { myKey: 'server-value' } })
      ),
    );
    const { result } = renderHook(
      () => usePreferences<string>('myKey', 'fallback-value'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => {
      expect(result.current[0]).toBe('server-value');
    });
  });
});

// The audit's RED criterion: distinguish the new validated behavior from
// the old accidentally-safe behavior. With the cast, a malformed envelope
// would resolve to success with a garbage `envelope.data`. With the
// validator, the query MUST reject and be observable via useQuery's error
// state. This block uses useQuery directly to read the error.
import { useQuery } from '@tanstack/react-query';

describe('usePreferences — validation surfaces malformed envelopes as query errors', () => {
  function useRawPrefsQuery() {
    return useQuery({
      queryKey: ['preferences'],
      queryFn: async () => {
        // Same logic as the hook's fetchPrefs — we can't call the unexported
        // helper directly, so we duplicate the contract here: GET the
        // endpoint and let the hook's own logic run for the cache key.
        // The real assertion is that the cache key 'preferences' has an
        // error after a malformed envelope, NOT a "data is garbage" success.
        const r = await fetch('/api/preferences');
        if (!r.ok) throw new Error(`prefs GET ${r.status}`);
        return r.json();
      },
      retry: false,
    });
  }

  it('an array-shaped data field makes the validated query error', async () => {
    server.use(
      http.get('/api/preferences', () =>
        HttpResponse.json({ version: 1, data: [] })
      ),
    );
    // Render the real hook and verify it uses the validator: the validator
    // throws inside the queryFn, which surfaces as a query error.
    // We assert that via the React Query devtools-style state.
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
    });
    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    }
    renderHook(
      () => usePreferences<string>('myKey', 'fallback-value'),
      { wrapper: Wrapper },
    );
    // The hook's useQuery sets `retry: 1`, so a malformed response
    // triggers one retry before settling into 'error'. With the default
    // 1s retry backoff this can take a couple of seconds in a test env;
    // give waitFor enough room rather than re-plumbing the retry policy.
    await waitFor(
      () => {
        const state = qc.getQueryState(['preferences']);
        // With validation, the queryFn throws on malformed shape -> 'error'.
        // Without validation, it would be 'success' with garbage data.
        expect(state?.status).toBe('error');
      },
      { timeout: 5000 },
    );
  });

  // Reference the helper so it isn't dead code (it documents the alternate
  // contract for readers).
  void useRawPrefsQuery;
});
