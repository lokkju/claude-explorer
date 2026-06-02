import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { SettingsProvider, useSettings } from '../../contexts/SettingsContext';
import { server } from '../mocks/server';
import type { ReactNode } from 'react';

/**
 * P1.1 — One-shot migration for orphan markdown preference keys.
 *
 * The 2026-05-29 MarkdownExportMode unification deleted
 * `markdownBundleImages` and `markdownDialect` from SettingsContext,
 * SettingsPage, and MarkdownExportDialog. The new code never writes or
 * reads them — but existing users still have those keys living in
 * `~/.claude-explorer/preferences.json`. This test pins the contract
 * that we tombstone them on first load of the new code, gated by a
 * `_migratedOrphanKeysV1` sentinel (mirroring the
 * `FilterContext._migratedV1` pattern).
 *
 * Bidirectional pair: with the sentinel already set, NO PATCH fires.
 */

const localStorageMock = {
  store: {} as Record<string, string>,
  getItem: vi.fn((key: string) => localStorageMock.store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    localStorageMock.store[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete localStorageMock.store[key];
  }),
  clear: vi.fn(() => {
    localStorageMock.store = {};
  }),
};

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

const matchMediaMock = vi.fn().mockImplementation((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

Object.defineProperty(window, 'matchMedia', { value: matchMediaMock });

let prefsStore: { data: Record<string, unknown> };
let testQueryClient: QueryClient;
let patchPayloads: Array<Record<string, unknown>>;

function installPrefs(initialData: Record<string, unknown> = {}) {
  prefsStore = { data: { ...initialData } };
  patchPayloads = [];
  server.use(
    http.get('/api/preferences', () =>
      HttpResponse.json({ version: 1, data: prefsStore.data })
    ),
    http.patch('/api/preferences', async ({ request }) => {
      const body = (await request.json()) as { data?: Record<string, unknown> };
      const payload = body.data ?? {};
      patchPayloads.push(payload);
      Object.assign(prefsStore.data, payload);
      return HttpResponse.json({ version: 1, data: prefsStore.data });
    })
  );
}

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={testQueryClient}>
      <SettingsProvider>{children}</SettingsProvider>
    </QueryClientProvider>
  );
}
const wrapper = Wrapper;

describe('SettingsContext orphan-key migration (P1.1)', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
    testQueryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 0, gcTime: 0 },
        mutations: { retry: false },
      },
    });
  });

  it('tombstones orphan markdown keys on first load when sentinel is unset', async () => {
    installPrefs({
      markdownBundleImages: true,
      markdownDialect: 'obsidian',
      // sentinel deliberately absent — simulates pre-migration user
    });

    renderHook(() => useSettings(), { wrapper });

    // Wait for the migration PATCH to fire.
    await waitFor(() => {
      const migrationPatch = patchPayloads.find(
        (p) => '_migratedOrphanKeysV1' in p
      );
      expect(migrationPatch).toBeDefined();
      expect(migrationPatch).toMatchObject({
        markdownBundleImages: null,
        markdownDialect: null,
        _migratedOrphanKeysV1: true,
      });
    });

    // After PATCH, the server-side store should reflect the tombstones.
    expect(prefsStore.data.markdownBundleImages).toBeNull();
    expect(prefsStore.data.markdownDialect).toBeNull();
    expect(prefsStore.data._migratedOrphanKeysV1).toBe(true);
  });

  it('does NOT fire the migration when sentinel is already true', async () => {
    installPrefs({
      markdownBundleImages: true,
      markdownDialect: 'obsidian',
      _migratedOrphanKeysV1: true,
    });

    renderHook(() => useSettings(), { wrapper });

    // Give React a chance to mount + run effects. We can't `waitFor`
    // an event that should never happen, so we settle a microtask cycle
    // (inside act so the post-fetch rerender is collected) and then
    // assert the negative.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const migrationPatch = patchPayloads.find(
      (p) => '_migratedOrphanKeysV1' in p
    );
    expect(migrationPatch).toBeUndefined();
  });

  it('does NOT fire when sentinel is unset but no orphan keys present', async () => {
    installPrefs({
      // fresh install — neither sentinel nor orphan keys on disk
    });

    renderHook(() => useSettings(), { wrapper });

    await new Promise((r) => setTimeout(r, 50));

    const migrationPatch = patchPayloads.find(
      (p) => '_migratedOrphanKeysV1' in p
    );
    expect(migrationPatch).toBeUndefined();
  });
});
