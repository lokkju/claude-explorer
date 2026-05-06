/**
 * Tests for usePreferences (P3b).
 *
 * Contract:
 *   const [value, setValue] = usePreferences<T>(key, fallback)
 *
 *   - Dual-read: prefer server value; if absent (or 5xx) fall back to
 *     localStorage; otherwise the supplied fallback.
 *   - Dual-write: setValue PATCHes the server *and* mirrors to localStorage.
 *   - Migration marker: setValue must set 'prefs_migrated_v1=true' in
 *     localStorage so other tabs / contexts skip their own migration.
 *
 * These tests are written BEFORE the implementation exists (RED), per
 * the strict-TDD policy.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';

import { server } from '../test/mocks/server';
import { usePreferences } from './usePreferences';

// jsdom in this project does not ship a usable localStorage, so swap in a
// minimal in-memory mock matching the Storage interface.
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

// --- Helpers --------------------------------------------------------------

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
  return { Wrapper, qc };
}

interface CapturedPatch {
  body: Record<string, unknown> | null;
  count: number;
}

/**
 * Install MSW handlers for /api/preferences with a mutable in-memory store.
 * Returns helpers for asserting on PATCH bodies and inspecting state.
 */
function installPrefsHandlers(initial: Record<string, unknown> = {}): {
  store: { data: Record<string, unknown> };
  patches: CapturedPatch;
} {
  const store = { data: { ...initial } };
  const patches: CapturedPatch = { body: null, count: 0 };

  server.use(
    http.get('/api/preferences', () =>
      HttpResponse.json({ version: 1, data: store.data }),
    ),
    http.patch('/api/preferences', async ({ request }) => {
      patches.count += 1;
      const json = (await request.json()) as { data?: Record<string, unknown> };
      patches.body = json.data ?? null;
      Object.assign(store.data, json.data ?? {});
      return HttpResponse.json({ version: 1, data: store.data });
    }),
  );

  return { store, patches };
}

function install500Handler(): void {
  server.use(
    http.get('/api/preferences', () =>
      HttpResponse.json({ detail: 'boom' }, { status: 500 }),
    ),
    http.patch('/api/preferences', () =>
      HttpResponse.json({ detail: 'boom' }, { status: 500 }),
    ),
  );
}

// --- Lifecycle ------------------------------------------------------------

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

// --- Tests ---------------------------------------------------------------

describe('usePreferences (P3b)', () => {
  it('returns the fallback when neither server nor localStorage have a value', async () => {
    installPrefsHandlers({});
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(
      () => usePreferences<string>('theme', 'light'),
      { wrapper: Wrapper },
    );

    // Initial render — no data yet, fallback wins.
    expect(result.current[0]).toBe('light');

    // After the GET resolves, server has nothing → still fallback.
    await waitFor(() => {
      expect(result.current[0]).toBe('light');
    });
  });

  it('dual-read: prefers the server value over localStorage', async () => {
    installPrefsHandlers({ theme: 'dark' });
    window.localStorage.setItem('theme', JSON.stringify('sepia'));
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(
      () => usePreferences<string>('theme', 'light'),
      { wrapper: Wrapper },
    );

    await waitFor(() => {
      expect(result.current[0]).toBe('dark');
    });
  });

  it('dual-read: falls back to localStorage when server lacks the key', async () => {
    installPrefsHandlers({}); // server has no theme key
    window.localStorage.setItem('theme', JSON.stringify('sepia'));
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(
      () => usePreferences<string>('theme', 'light'),
      { wrapper: Wrapper },
    );

    await waitFor(() => {
      expect(result.current[0]).toBe('sepia');
    });
  });

  it('falls back to localStorage when the server returns 500', async () => {
    install500Handler();
    window.localStorage.setItem('theme', JSON.stringify('sepia'));
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(
      () => usePreferences<string>('theme', 'light'),
      { wrapper: Wrapper },
    );

    // The hook MUST NOT throw. Eventually the query settles into an
    // error state and the localStorage value is what we render.
    await waitFor(() => {
      expect(result.current[0]).toBe('sepia');
    });
  });

  it('dual-write: setValue PATCHes the server with the new key/value', async () => {
    const { patches } = installPrefsHandlers({});
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(
      () => usePreferences<string>('theme', 'light'),
      { wrapper: Wrapper },
    );

    // Wait for the initial GET so the query is settled.
    await waitFor(() => {
      expect(result.current[0]).toBe('light');
    });

    await act(async () => {
      result.current[1]('dark');
    });

    await waitFor(() => {
      expect(patches.count).toBe(1);
    });
    expect(patches.body).toEqual({ theme: 'dark' });
  });

  it('dual-write: setValue mirrors the value to localStorage synchronously', async () => {
    installPrefsHandlers({});
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(
      () => usePreferences<string>('theme', 'light'),
      { wrapper: Wrapper },
    );

    await waitFor(() => {
      expect(result.current[0]).toBe('light');
    });

    act(() => {
      result.current[1]('dark');
    });

    // localStorage write must be synchronous — the PATCH may still be
    // in flight, but the mirror is already on disk.
    expect(window.localStorage.getItem('theme')).toBe(JSON.stringify('dark'));
  });

  it('dual-write: sets the prefs_migrated_v1 marker on first setValue', async () => {
    installPrefsHandlers({});
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(
      () => usePreferences<string>('theme', 'light'),
      { wrapper: Wrapper },
    );

    await waitFor(() => {
      expect(result.current[0]).toBe('light');
    });

    expect(window.localStorage.getItem('prefs_migrated_v1')).toBeNull();

    act(() => {
      result.current[1]('dark');
    });

    expect(window.localStorage.getItem('prefs_migrated_v1')).toBe('true');
  });

  it('reflects server value on subsequent reads after a successful PATCH', async () => {
    installPrefsHandlers({});
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(
      () => usePreferences<string>('theme', 'light'),
      { wrapper: Wrapper },
    );

    await waitFor(() => {
      expect(result.current[0]).toBe('light');
    });

    await act(async () => {
      result.current[1]('dark');
    });

    await waitFor(() => {
      expect(result.current[0]).toBe('dark');
    });
  });
});
