/**
 * Regression: SearchPanel must bound the number of result cards
 * rendered in Full mode, even when the backend returns 1000+ matches.
 *
 * User report (2026-05-22): "Flipping between Snippet and Full is
 * still quite slow for long conversations." Profiling showed:
 *   - Click → setContextSize → PATCH /api/preferences
 *   - PATCH RTT: <100ms server-side, but ~1.5s client-side (the
 *     React re-render after setQueryData blocks the fetch microtask)
 *   - Then GET /api/search?context_size=full fires (~0.4s server)
 *   - Then the SearchPanel renders 1000 full-mode cards. Each card
 *     contains a full message body (often 10KB+). Total: ~10MB of
 *     text + thousands of <mark> nodes from HighlightedSnippet.
 *     The render blocks the main thread for ~10s on a 16K-msg conv.
 *
 * User-observable contract (per CLAUDE-TESTING §5.13):
 *   - When contextSize='full' AND the result set is large, the
 *     SearchPanel MUST NOT render all cards at once. Cap at a
 *     bounded number (50) so the toggle feels responsive.
 *   - Snippet mode (which has short ~200-char snippets per card)
 *     is NOT capped — its render is already fast.
 *   - The cap must be visible to the user (a footer / count).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'

import { server } from '../mocks/server'
import { SearchPanel } from '@/components/search/SearchPanel'
import { SearchPanelProvider } from '@/contexts/SearchPanelContext'
import { SettingsProvider } from '@/contexts/SettingsContext'
import { SourceFilterProvider } from '@/contexts/SourceFilterContext'
import { FilterProvider } from '@/contexts/FilterContext'
import { BookmarkProvider } from '@/contexts/BookmarkContext'
import { SearchPinProvider } from '@/contexts/SearchPinContext'
import { KeyboardNavigationProvider } from '@/contexts/KeyboardNavigationContext'

const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((k: string) => (k in store ? store[k] : null)),
    setItem: vi.fn((k: string, v: string) => { store[k] = v }),
    removeItem: vi.fn((k: string) => { delete store[k] }),
    clear: vi.fn(() => { store = {} }),
  }
})()
Object.defineProperty(window, 'localStorage', { value: localStorageMock })

function makeMatches(n: number, contextSize: 'snippet' | 'full') {
  return Array.from({ length: n }).map((_, i) => ({
    conversation_uuid: `conv-${i}`,
    conversation_name: `Conversation ${i}`,
    conversation_source: 'CLAUDE_CODE',
    conversation_created_at: '2026-01-01T00:00:00Z',
    conversation_updated_at: '2026-01-01T00:00:00Z',
    project_path: null,
    matching_messages: [
      {
        message_uuid: `msg-${i}`,
        sender: 'human',
        snippet:
          contextSize === 'full'
            // simulate the user's reported pain: large body per card.
            ? 'NEEDLE ' + 'x '.repeat(5000)
            : 'NEEDLE short snippet',
        match_start: 0,
        match_end: 6,
        created_at: '2026-01-01T00:00:00Z',
        fragments: null,
      },
    ],
  }))
}

function installHandlers(initial: Record<string, unknown>, n: number, contextSize: 'snippet' | 'full') {
  const prefs = { data: { ...initial } }
  server.use(
    http.get('/api/preferences', () =>
      HttpResponse.json({ version: 1, data: prefs.data }),
    ),
    http.patch('/api/preferences', async ({ request }) => {
      const json = (await request.json()) as { data?: Record<string, unknown> }
      Object.assign(prefs.data, json.data ?? {})
      return HttpResponse.json({ version: 1, data: prefs.data })
    }),
    http.get('/api/conversations', () => HttpResponse.json([])),
    http.get('/api/orgs', () => HttpResponse.json([])),
    http.get('/api/search', () =>
      HttpResponse.json({
        results: makeMatches(n, contextSize),
        total_messages_matched: n,
        returned_messages: n,
        truncated: false,
      }),
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
                  <KeyboardNavigationProvider>
                    <SearchPinProvider>
                      <SearchPanelProvider>{children}</SearchPanelProvider>
                    </SearchPinProvider>
                  </KeyboardNavigationProvider>
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
  localStorageMock.clear()
  document.body.innerHTML = ''
})

afterEach(() => {
  document.body.innerHTML = ''
  localStorageMock.clear()
})

const FULL_MODE_CARD_CAP = 50
const SNIPPET_MODE_CARD_CAP = 100

describe('SearchPanel — Full-mode card cap (perf fix 2026-05-22)', () => {
  it('Full mode: rendered card count is bounded even with 500 matches', async () => {
    // Server returns 500 full-mode matches. The SearchPanel must NOT
    // render all 500 — that's the 10s main-thread-block bug. Cap to
    // FULL_MODE_CARD_CAP. Pin via a data-testid attribute on each
    // rendered ResultCard so the count is unambiguous.
    installHandlers(
      { 'searchPanel.contextSize': 'full', 'searchPanel.isOpen': true },
      500,
      'full',
    )
    localStorageMock.setItem('searchPanel.contextSize', JSON.stringify('full'))
    localStorageMock.setItem('searchPanel.isOpen', JSON.stringify(true))

    const Wrapper = makeWrapper()
    render(<SearchPanel />, { wrapper: Wrapper })

    // Type a query so the panel actually fetches.
    const input = screen.getByPlaceholderText('Search messages...')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, 'NEEDLE')
    input.dispatchEvent(new Event('input', { bubbles: true }))

    // Wait for results to render.
    await vi.waitFor(() => {
      const cards = document.querySelectorAll('[data-testid="search-result-card"]')
      expect(cards.length).toBeGreaterThan(0)
    }, { timeout: 3000 })

    const cards = document.querySelectorAll('[data-testid="search-result-card"]')
    expect(
      cards.length,
      `Full mode must cap rendered cards at ${FULL_MODE_CARD_CAP}. Got ${cards.length}.`,
    ).toBeLessThanOrEqual(FULL_MODE_CARD_CAP)
  })

  it('Snippet mode: rendered card count capped at SNIPPET_MODE_CARD_CAP (higher than Full)', async () => {
    // Snippet cards are ~50× smaller than Full cards, so the cap is
    // higher (100 vs 50). But it IS bounded — 500 cards of any size
    // still chains 500 HighlightedSnippet regex passes on a single
    // render and the toggle pause was visible on the user's corpus.
    installHandlers(
      { 'searchPanel.contextSize': 'snippet', 'searchPanel.isOpen': true },
      500,
      'snippet',
    )
    localStorageMock.setItem('searchPanel.contextSize', JSON.stringify('snippet'))
    localStorageMock.setItem('searchPanel.isOpen', JSON.stringify(true))

    const Wrapper = makeWrapper()
    render(<SearchPanel />, { wrapper: Wrapper })

    const input = screen.getByPlaceholderText('Search messages...')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, 'NEEDLE')
    input.dispatchEvent(new Event('input', { bubbles: true }))

    await vi.waitFor(() => {
      const cards = document.querySelectorAll('[data-testid="search-result-card"]')
      expect(cards.length).toBeGreaterThan(0)
    }, { timeout: 3000 })

    const cards = document.querySelectorAll('[data-testid="search-result-card"]')
    // Asymmetric pair: Snippet's cap is HIGHER than Full's. Pin both
    // sides so a refactor that collapses to one cap accidentally fails.
    expect(cards.length).toBeLessThanOrEqual(SNIPPET_MODE_CARD_CAP)
    expect(cards.length).toBeGreaterThan(FULL_MODE_CARD_CAP)
  })
})
