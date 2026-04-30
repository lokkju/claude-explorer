import { test, expect } from '@playwright/test';
import { waitForConnection } from './test-utils';

/**
 * Compact-marker UX tests (Build-7).
 *
 * Strategy: load the conversation list, pick the first Claude Code conversation
 * with at least one compact marker (queried via the backend API), open it, and
 * verify the marker UI renders, expands, and supports keyboard navigation.
 *
 * Skips gracefully if no compact-marker-bearing conversation is present in the
 * test environment.
 */
async function findConversationWithCompactMarkers(page: import('@playwright/test').Page): Promise<string | null> {
  const list = await page.evaluate(async () => {
    const r = await fetch('/api/conversations?source=CLAUDE_CODE');
    return r.json() as Promise<Array<{ uuid: string }>>;
  });

  for (const conv of list.slice(0, 50)) {
    const detail = await page.evaluate(async (uuid) => {
      const r = await fetch(`/api/conversations/${uuid}`);
      return r.json() as Promise<{ compact_markers?: Array<{ kind: string }> }>;
    }, conv.uuid);
    if (detail.compact_markers && detail.compact_markers.length > 0) {
      return conv.uuid;
    }
  }
  return null;
}

test.describe('Compact markers', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);
  });

  test('renders inline compact-marker pill on a CC conversation', async ({ page }) => {
    const uuid = await findConversationWithCompactMarkers(page);
    test.skip(!uuid, 'No compact-marker-bearing conversation in this environment');

    await page.goto(`/conversations/${uuid}`);

    const marker = page.locator('[data-compact-marker]').first();
    await expect(marker).toBeVisible({ timeout: 10000 });
    await expect(marker).toContainText(/Compacted/i);
  });

  test('clicking the pill toggles the summary panel', async ({ page }) => {
    const uuid = await findConversationWithCompactMarkers(page);
    test.skip(!uuid, 'No compact-marker-bearing conversation in this environment');

    await page.goto(`/conversations/${uuid}`);
    const pill = page.locator('[data-compact-marker-pill]').first();
    await expect(pill).toBeVisible();

    const panel = page.locator('[data-compact-marker-panel]').first();
    await expect(panel).toHaveCount(0);

    await pill.click();
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(/Summary/i);
  });

  test('] navigates to next compact marker', async ({ page }) => {
    const uuid = await findConversationWithCompactMarkers(page);
    test.skip(!uuid, 'No compact-marker-bearing conversation in this environment');

    await page.goto(`/conversations/${uuid}`);
    await expect(page.locator('[data-compact-marker]').first()).toBeVisible();

    // Need at least 2 markers for ] to navigate visibly
    const count = await page.locator('[data-compact-marker]').count();
    test.skip(count < 2, 'Need >=2 compact markers to test next-navigation');

    // Press ] - should scroll the second marker into view
    await page.keyboard.press(']');
    // Active marker should have data-compact-marker-active
    await expect(page.locator('[data-compact-marker-active]')).toBeVisible();
  });

  test('hide-compact-markers toggle removes markers from the stream', async ({ page }) => {
    const uuid = await findConversationWithCompactMarkers(page);
    test.skip(!uuid, 'No compact-marker-bearing conversation in this environment');

    await page.goto(`/conversations/${uuid}`);
    await expect(page.locator('[data-compact-marker]').first()).toBeVisible();

    // Click the View toggle
    const toggle = page.getByRole('button', { name: /compact markers/i });
    await expect(toggle).toBeVisible();
    await toggle.click();

    await expect(page.locator('[data-compact-marker]')).toHaveCount(0);
  });
});
