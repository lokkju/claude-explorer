/**
 * Regression: SearchPanelContext.requestFocus must NOT trigger a
 * Provider-wide re-render when the panel is already open.
 *
 * User report (2026-05-22): Cmd+F takes ~7.5 seconds on the 16K-msg
 * conversation. Root cause: `requestFocus` ALWAYS bumps an internal
 * counter (`focusRequestSeq`), which re-renders the
 * SearchPanelProvider, which re-renders every `useSearchPanel()`
 * consumer (including ConversationPage which mounts 20K message
 * bubbles). Even with React.memo on MessageBubble, the
 * reconciliation walk through 20K children costs multiple seconds.
 *
 * The fix: when the input is ALREADY in the DOM (panel open + tab
 * is 'search'), focus it directly with no state change. Only fall
 * back to the seq-bump dance when the input isn't mounted yet
 * (panel closed, or tab needs flipping).
 *
 * User-observable contract (per CLAUDE-TESTING §5.13):
 *   - requestFocus on an open panel → input focused, NO state change
 *     in focusRequestSeq (the proxy for "did the Provider re-render")
 *   - requestFocus on a closed panel → state DOES change (panel
 *     opens, seq bumps; the slow path is preserved for the case
 *     that actually needs it).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// jsdom in this project ships a stub localStorage. Install an
// in-memory mock matching the Storage interface (same approach
// usePreferences.test.tsx uses).
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    get store() { return store },
    getItem: vi.fn((k: string) => (k in store ? store[k] : null)),
    setItem: vi.fn((k: string, v: string) => { store[k] = v }),
    removeItem: vi.fn((k: string) => { delete store[k] }),
    clear: vi.fn(() => { store = {} }),
  }
})()
Object.defineProperty(window, 'localStorage', { value: localStorageMock })
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'

import { server } from '../mocks/server'
import { SearchPanelProvider, useSearchPanel } from '@/contexts/SearchPanelContext'
import { SettingsProvider } from '@/contexts/SettingsContext'
import { SourceFilterProvider } from '@/contexts/SourceFilterContext'
import { FilterProvider } from '@/contexts/FilterContext'
import { BookmarkProvider } from '@/contexts/BookmarkContext'
import { SearchPinProvider } from '@/contexts/SearchPinContext'

function installPrefs(initial: Record<string, unknown> = {}): void {
  const store = { data: { ...initial } }
  server.use(
    http.get('/api/preferences', () =>
      HttpResponse.json({ version: 1, data: store.data }),
    ),
    http.patch('/api/preferences', async ({ request }) => {
      const json = (await request.json()) as { data?: Record<string, unknown> }
      Object.assign(store.data, json.data ?? {})
      return HttpResponse.json({ version: 1, data: store.data })
    }),
    http.get('/api/conversations', () =>
      HttpResponse.json([]),
    ),
    http.get('/api/orgs', () =>
      HttpResponse.json([]),
    ),
    http.get('/api/search', () =>
      HttpResponse.json({ results: [], total_messages_matched: 0, returned_messages: 0, truncated: false }),
    ),
  )
}

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <SettingsProvider>
            <SourceFilterProvider>
              <FilterProvider>
                <BookmarkProvider>
                  <SearchPinProvider>
                    <SearchPanelProvider>{children}</SearchPanelProvider>
                  </SearchPinProvider>
                </BookmarkProvider>
              </FilterProvider>
            </SourceFilterProvider>
          </SettingsProvider>
        </MemoryRouter>
      </QueryClientProvider>
    )
  }
  return Wrapper
}

beforeEach(() => {
  // jsdom in this project ships a stub localStorage without `.clear` —
  // remove keys we know about defensively.
  window.localStorage.clear()
  document.body.innerHTML = ''
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.useRealTimers()
  // jsdom in this project ships a stub localStorage without `.clear` —
  // remove keys we know about defensively.
  window.localStorage.clear()
})

describe('SearchPanelContext.requestFocus — perf fix (2026-05-22)', () => {
  it('open panel + input mounted → focuses directly, focusRequestSeq unchanged', async () => {
    // Pre-stage: server says panel is open, AND mount a fake input
    // with the production-matching placeholder so requestFocus can
    // find it via querySelector.
    installPrefs({ 'searchPanel.isOpen': true, rightPaneTab: 'search' })
    window.localStorage.setItem('searchPanel.isOpen', JSON.stringify(true))
    window.localStorage.setItem('rightPaneTab', JSON.stringify('search'))

    const input = document.createElement('input')
    input.placeholder = 'Search messages...'
    input.setAttribute('data-allow-shortcuts', '')
    input.setAttribute('data-search-panel-input', '')
    document.body.appendChild(input)

    const Wrapper = makeWrapper()
    const { result } = renderHook(() => useSearchPanel(), { wrapper: Wrapper })

    // Wait for the panel to be ready (isOpen reflects the preference).
    await vi.waitFor(() => expect(result.current.isOpen).toBe(true))

    const seqBefore = result.current.focusRequestSeq
    act(() => {
      result.current.requestFocus()
    })

    // Focus moved to our input — the fast path actually ran.
    expect(document.activeElement).toBe(input)
    // focusRequestSeq DID NOT bump — the fast path skipped the
    // state-change re-render that was causing the 7.5 s Cmd+F lag.
    expect(result.current.focusRequestSeq).toBe(seqBefore)
  })

  it('closed panel → opens panel AND bumps focusRequestSeq (slow path preserved)', async () => {
    // Negative pair: when the input is NOT mounted, the slow path
    // (open the panel, bump the seq so SearchPanel's effect refocuses
    // after the open paints) MUST still fire. Otherwise Cmd+F from a
    // closed-panel state would just no-op.
    installPrefs({ 'searchPanel.isOpen': false })
    // Deliberately no input in document.body — the panel isn't
    // mounted yet, so the fast path's querySelector would miss.

    const Wrapper = makeWrapper()
    const { result } = renderHook(() => useSearchPanel(), { wrapper: Wrapper })

    await vi.waitFor(() => expect(result.current.isOpen).toBe(false))

    const seqBefore = result.current.focusRequestSeq
    act(() => {
      result.current.requestFocus()
    })

    // Slow path: panel becomes open AND seq bumps.
    await vi.waitFor(() => {
      expect(result.current.isOpen).toBe(true)
      expect(result.current.focusRequestSeq).toBe(seqBefore + 1)
    })
  })
})
