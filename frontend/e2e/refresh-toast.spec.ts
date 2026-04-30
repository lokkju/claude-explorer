import { test, expect, Page } from '@playwright/test';
import { waitForConnection } from './test-utils';

/**
 * Build-1: Refresh-button toast notifications + credentials-expired handling.
 *
 * The Refresh button in the sidebar should fire toast notifications directly.
 * Success: auto-dismiss after 5s. Error: sticky (no auto-dismiss). The full
 * progress modal remains accessible via "Details" link inside the toast.
 */

async function clickRefresh(page: Page) {
  await page.getByRole('button', { name: /Fetch Claude Desktop conversations/i }).click();
}

test.describe('Refresh toast', () => {
  test('shows in-progress toast immediately on click', async ({ page }) => {
    await page.route('**/api/fetch/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          has_credentials: true,
          credentials_path: '/tmp/c.json',
          output_dir: '/tmp/conv',
          existing_count: 5,
          credentials_age_days: 3,
        }),
      });
    });

    let sseClosed = false;
    await page.route('**/api/fetch/start*', async (route) => {
      sseClosed = true;
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body:
          'data: {"type":"start","message":"Fetching conversation list...","current":0,"total":0}\n\n' +
          'data: {"type":"complete","message":"Fetched 0 conversations successfully.","current":0,"total":0}\n\n',
      });
    });

    await page.goto('/');
    await waitForConnection(page, { waitForConversations: false });
    await clickRefresh(page);

    await expect(page.locator('[data-sonner-toast]').first()).toBeVisible({ timeout: 5000 });
    expect(sseClosed).toBe(true);
  });

  test('shows sticky error toast on session-expired SSE event', async ({ page }) => {
    await page.route('**/api/fetch/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          has_credentials: true,
          credentials_path: '/tmp/c.json',
          output_dir: '/tmp/conv',
          existing_count: 5,
          credentials_age_days: 60,
        }),
      });
    });

    await page.route('**/api/fetch/start*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body:
          'data: {"type":"error","message":"Session expired or Cloudflare-blocked. Re-run claude-explorer capture to refresh credentials."}\n\n',
      });
    });

    await page.goto('/');
    await waitForConnection(page, { waitForConversations: false });
    await clickRefresh(page);

    const errorToast = page.locator('[data-sonner-toast][data-type="error"]').first();
    await expect(errorToast).toBeVisible({ timeout: 5000 });
    await expect(errorToast).toContainText(/Session expired|Cloudflare/i);

    await page.waitForTimeout(6000);
    await expect(errorToast).toBeVisible();
  });

  test('toast Details link opens full progress dialog', async ({ page }) => {
    await page.route('**/api/fetch/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          has_credentials: true,
          credentials_path: '/tmp/c.json',
          output_dir: '/tmp/conv',
          existing_count: 5,
          credentials_age_days: 3,
        }),
      });
    });

    await page.route('**/api/fetch/start*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body:
          'data: {"type":"start","message":"Fetching conversation list...","current":0,"total":3}\n\n' +
          'data: {"type":"progress","message":"Fetching: alpha","current":1,"total":3}\n\n',
      });
    });

    await page.goto('/');
    await waitForConnection(page, { waitForConversations: false });
    await clickRefresh(page);

    const toast = page.locator('[data-sonner-toast]').first();
    await expect(toast).toBeVisible({ timeout: 5000 });

    await toast.getByRole('button', { name: /Details/i }).click();

    await expect(page.getByRole('heading', { name: /Fetch Claude Desktop Conversations/i })).toBeVisible();
  });
});
