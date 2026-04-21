import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { SettingsProvider, useSettings } from '../../contexts/SettingsContext';
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

const wrapper = ({ children }: { children: ReactNode }) => (
  <SettingsProvider>{children}</SettingsProvider>
);

describe('SettingsContext', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  describe('theme settings', () => {
    it('defaults to system theme', () => {
      const { result } = renderHook(() => useSettings(), { wrapper });

      expect(result.current.theme).toBe('system');
    });

    it('persists theme to localStorage', () => {
      const { result } = renderHook(() => useSettings(), { wrapper });

      act(() => {
        result.current.setTheme('dark');
      });

      expect(localStorageMock.setItem).toHaveBeenCalledWith('theme', '"dark"');
      expect(result.current.theme).toBe('dark');
    });

    it('loads theme from localStorage', () => {
      localStorageMock.store['theme'] = '"dark"';

      const { result } = renderHook(() => useSettings(), { wrapper });

      expect(result.current.theme).toBe('dark');
    });

    it('computes effectiveTheme as dark when theme is dark', () => {
      const { result } = renderHook(() => useSettings(), { wrapper });

      act(() => {
        result.current.setTheme('dark');
      });

      expect(result.current.effectiveTheme).toBe('dark');
    });

    it('computes effectiveTheme as light when theme is light', () => {
      const { result } = renderHook(() => useSettings(), { wrapper });

      act(() => {
        result.current.setTheme('light');
      });

      expect(result.current.effectiveTheme).toBe('light');
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

    it('persists keyboard mode to localStorage', () => {
      const { result } = renderHook(() => useSettings(), { wrapper });

      act(() => {
        result.current.setKeyboardMode('vim');
      });

      expect(localStorageMock.setItem).toHaveBeenCalledWith('keyboardMode', '"vim"');
      expect(result.current.keyboardMode).toBe('vim');
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

    it('provides sort field and order settings', () => {
      const { result } = renderHook(() => useSettings(), { wrapper });

      expect(result.current.sortField).toBe('updated_at');
      expect(result.current.sortOrder).toBe('desc');

      act(() => {
        result.current.setSortField('name');
      });

      // Setting sortField should auto-set natural sort order
      expect(result.current.sortField).toBe('name');
      expect(result.current.sortOrder).toBe('asc');
    });
  });
});
