import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { SettingsProvider, useSettings } from '../../contexts/SettingsContext';
import { server } from '../mocks/server';
import type { ReactNode } from 'react';

// Mock localStorage
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

// Mock matchMedia
const matchMediaMock = vi.fn().mockImplementation((query: string) => ({
  matches: query === '(prefers-color-scheme: dark)' ? false : false,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

Object.defineProperty(window, 'matchMedia', { value: matchMediaMock });

// SettingsContext now reads/writes via usePreferences (P3c), which uses
// TanStack Query and hits /api/preferences. Each test installs an MSW
// handler pair for /api/preferences (called from beforeEach) and uses
// a fresh QueryClient. The handlers + QueryClient are created once per
// test (NOT per render!) so re-renders inside the same test see the
// same in-memory prefs store and the same query cache.
let prefsStore: { data: Record<string, unknown> };
let testQueryClient: QueryClient;

function installPrefs(initialData: Record<string, unknown> = {}) {
  prefsStore = { data: { ...initialData } };
  server.use(
    http.get('/api/preferences', () =>
      HttpResponse.json({ version: 1, data: prefsStore.data })
    ),
    http.patch('/api/preferences', async ({ request }) => {
      const body = (await request.json()) as { data?: Record<string, unknown> };
      Object.assign(prefsStore.data, body.data ?? {});
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

describe('SettingsContext', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
    testQueryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 0, gcTime: 0 },
        mutations: { retry: false },
      },
    });
    installPrefs();
  });

  describe('theme settings', () => {
    it('defaults to system theme', () => {
      const { result } = renderHook(() => useSettings(), { wrapper });

      expect(result.current.theme).toBe('system');
    });

    it('persists theme to localStorage', async () => {
      const { result } = renderHook(() => useSettings(), { wrapper });

      await act(async () => {
        result.current.setTheme('dark');
      });

      expect(localStorageMock.setItem).toHaveBeenCalledWith('theme', '"dark"');
      await waitFor(() => expect(result.current.theme).toBe('dark'));
    });

    it('loads theme from localStorage', () => {
      localStorageMock.store['theme'] = '"dark"';

      const { result } = renderHook(() => useSettings(), { wrapper });

      expect(result.current.theme).toBe('dark');
    });

    it('computes effectiveTheme as dark when theme is dark', async () => {
      const { result } = renderHook(() => useSettings(), { wrapper });

      await act(async () => {
        result.current.setTheme('dark');
      });

      await waitFor(() => expect(result.current.effectiveTheme).toBe('dark'));
    });

    it('computes effectiveTheme as light when theme is light', async () => {
      const { result } = renderHook(() => useSettings(), { wrapper });

      await act(async () => {
        result.current.setTheme('light');
      });

      await waitFor(() => expect(result.current.effectiveTheme).toBe('light'));
    });

    it('computes effectiveTheme based on system preference when theme is system', () => {
      // System prefers light
      matchMediaMock.mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      const { result } = renderHook(() => useSettings(), { wrapper });

      expect(result.current.theme).toBe('system');
      expect(result.current.effectiveTheme).toBe('light');
    });
  });

  describe('keyboard mode settings', () => {
    it('defaults to emacs mode', () => {
      const { result } = renderHook(() => useSettings(), { wrapper });

      expect(result.current.keyboardMode).toBe('emacs');
    });

    it('persists keyboard mode to localStorage', async () => {
      const { result } = renderHook(() => useSettings(), { wrapper });

      await act(async () => {
        result.current.setKeyboardMode('vim');
      });

      expect(localStorageMock.setItem).toHaveBeenCalledWith('keyboardMode', '"vim"');
      await waitFor(() => expect(result.current.keyboardMode).toBe('vim'));
    });

    it('loads keyboard mode from localStorage', () => {
      localStorageMock.store['keyboardMode'] = '"vim"';

      const { result } = renderHook(() => useSettings(), { wrapper });

      expect(result.current.keyboardMode).toBe('vim');
    });
  });

  describe('other settings', () => {
    it('provides showToolCalls setting', () => {
      const { result } = renderHook(() => useSettings(), { wrapper });

      expect(result.current.showToolCalls).toBe(false);

      act(() => {
        result.current.setShowToolCalls(true);
      });

      expect(result.current.showToolCalls).toBe(true);
    });

    it('provides sort field and order settings', async () => {
      const { result } = renderHook(() => useSettings(), { wrapper });

      expect(result.current.sortField).toBe('updated_at');
      expect(result.current.sortOrder).toBe('desc');

      await act(async () => {
        result.current.setSortField('name');
      });

      // Setting sortField should auto-set natural sort order
      await waitFor(() => {
        expect(result.current.sortField).toBe('name');
        expect(result.current.sortOrder).toBe('asc');
      });
    });
  });
});
