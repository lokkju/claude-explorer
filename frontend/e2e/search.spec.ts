import { test, expect, makeSummary, makeMessage, makeDetail, searchEnvelopeJson } from './fixtures'
import type { Route } from '@playwright/test'
import type { SearchResult } from '../src/lib/types'

const TLS_TITLE = 'Phase 5 fixture: TLS handshakes (long)';
const TLS_UUID = '0f415a45-9c62-8671-d4ad-53b84acb7e1a';

function tlsConversation() {
  const summary = makeSummary({
    uuid: TLS_UUID,
    name: TLS_TITLE,
    message_count: 2,
    human_message_count: 1,
  });
  const messages = [
    makeMessage({
      uuid: 'tls-m1',
      sender: 'human',
      text: "Hi! Let's talk about TLS. NEEDLE_HANDSHAKE",
    }),
    makeMessage({
      uuid: 'tls-m2',
      sender: 'assistant',
      text: 'Sure, TLS handshakes are a great topic.',
      parent_message_uuid: 'tls-m1',
    }),
  ];
  return { summary, detail: makeDetail(summary, messages) };
}

test.describe('Command Palette Full-Text Search', () => {
  test('opens command palette with Cmd+K', async ({ page, mockBackend }) => {
    const { summary, detail } = tlsConversation();
    await mockBackend({
      conversations: [summary],
      details: { [TLS_UUID]: detail },
    });
    await page.goto('/');

    // Press Cmd+K (or Ctrl+K on Windows/Linux)
    await page.keyboard.press('Meta+k');

    // Should show the command palette
    await expect(page.getByPlaceholder('Search messages...')).toBeVisible();
  });

  test('shows hint for short queries', async ({ page, mockBackend }) => {
    await mockBackend();
    await page.goto('/');

    // Open command palette
    await page.keyboard.press('Meta+k');
    await expect(page.getByPlaceholder('Search messages...')).toBeVisible();

    // Type a single character
    await page.getByPlaceholder('Search messages...').fill('a');

    // SearchPanel renders the short-query hint as a single line of text
    // alongside a magnifier icon. Match the exact phrasing used by the
    // current implementation.
    await expect(page.getByText(/Type at least 2 characters/i)).toBeVisible();
  });

  test('searches message content', async ({ page, mockBackend }) => {
    const { summary, detail } = tlsConversation();
    await mockBackend({
      conversations: [summary],
      details: { [TLS_UUID]: detail },
      // Override the default empty `/api/search` so that the query
      // 'test' surfaces no matches but does not throw.
      extraRoutes: async (p) => {
        await p.route('**/api/search**', (route: Route) => {
          route.fulfill({ contentType: 'application/json', body: searchEnvelopeJson([]) });
        });
      },
    });
    await page.goto('/');

    // Open command palette
    await page.keyboard.press('Meta+k');
    await expect(page.getByPlaceholder('Search messages...')).toBeVisible();

    // Search for something likely to be in messages
    const searchInput = page.getByPlaceholder('Search messages...');
    await searchInput.fill('test');

    // Wait for either result cards or the "No matches" empty state.
    const cards = page.locator('[data-result-card]');
    const empty = page.getByText(/No matches/i);
    await expect.poll(async () => (await cards.count()) > 0 || (await empty.isVisible()))
      .toBe(true);
  });

  test('navigates to conversation when result is clicked', async ({ page, mockBackend }) => {
    const { summary, detail } = tlsConversation();
    await mockBackend({
      conversations: [summary],
      details: { [TLS_UUID]: detail },
      // For NEEDLE_HANDSHAKE specifically, return a single matching
      // SearchResult pointing at the TLS conversation. Other queries
      // return [] so this is deterministic.
      extraRoutes: async (p) => {
        await p.route('**/api/search**', (route: Route) => {
          const url = route.request().url();
          const params = new URL(url).searchParams;
          const q = params.get('q') ?? '';
          if (q.includes('NEEDLE_HANDSHAKE')) {
            // Strictly type so any backend schema change to SearchResult
            // surfaces as a TS error instead of silent mock drift.
            const results: SearchResult[] = [
              {
                conversation_uuid: TLS_UUID,
                conversation_name: TLS_TITLE,
                conversation_updated_at: summary.updated_at,
                conversation_created_at: summary.created_at,
                project_name: null,
                matching_messages: [
                  {
                    message_uuid: 'tls-m1',
                    sender: 'human',
                    snippet: "Let's talk about TLS. NEEDLE_HANDSHAKE",
                    match_start: 23,
                    match_end: 39,
                    created_at: '2026-04-01T10:00:00Z',
                  },
                ],
              },
            ];
            route.fulfill({
              contentType: 'application/json',
              body: searchEnvelopeJson(results),
            });
            return;
          }
          route.fulfill({ contentType: 'application/json', body: searchEnvelopeJson([]) });
        });
      },
    });
    await page.goto('/');

    // The TLS conversation is in the sidebar.
    await expect(page.getByText(/Phase 5 fixture: TLS handshakes/)).toBeVisible({
      timeout: 10000,
    });

    await page.keyboard.press('Meta+k');
    await expect(page.getByPlaceholder('Search messages...')).toBeVisible();
    await page.getByPlaceholder('Search messages...').fill('NEEDLE_HANDSHAKE');

    const results = page.locator('[data-result-card]');
    await expect.poll(async () => await results.count(), { timeout: 5000 }).toBeGreaterThan(0);
    await results.first().click();

    // Should navigate to a conversation URL.
    await expect(page).toHaveURL(/\/conversations\/[a-f0-9-]+/);
  });

  test('closes command palette via keyboard (Escape)', async ({ page, mockBackend }) => {
    await mockBackend();
    await page.goto('/');

    // Open command palette.
    await page.keyboard.press('Meta+k');
    const searchAside = page.locator('aside[aria-label="Search panel"]');
    await expect(searchAside).toHaveAttribute('aria-hidden', 'false');

    // Esc closes (the SearchPanel uses CSS transform + aria-hidden, so the
    // input element stays mounted; assert via aria-hidden).
    await page.keyboard.press('Escape');
    await expect(searchAside).toHaveAttribute('aria-hidden', 'true');
  });

  test('Cmd+K toggles open and closed', async ({ page, mockBackend }) => {
    await mockBackend();
    await page.goto('/');

    const searchAside = page.locator('aside[aria-label="Search panel"]');
    await page.keyboard.press('Meta+k');
    await expect(searchAside).toHaveAttribute('aria-hidden', 'false');
    await page.keyboard.press('Meta+k');
    await expect(searchAside).toHaveAttribute('aria-hidden', 'true');
  });

  test('shows keyboard hint in sidebar', async ({ page, mockBackend }) => {
    await mockBackend();
    await page.goto('/');

    // Should show the Cmd+K hint
    await expect(page.getByText('to search messages')).toBeVisible();
  });
});
