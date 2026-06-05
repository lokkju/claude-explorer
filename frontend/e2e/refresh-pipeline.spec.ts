import { test, expect, type Page, withNetRetry } from './fixtures';

/**
 * Build-9: One-button Refresh — capture + fetch pipeline.
 *
 * Click Refresh: if creds are missing or session expired, the UI itself
 * launches the capture flow (Playwright browser opens server-side) and
 * automatically continues with an INCREMENTAL fetch. The user never has
 * to drop to the CLI.
 *
 * Toast text transitions:
 *   "Opening browser to log in to Claude…"
 *   -> "Waiting for you to log in (Ns elapsed)…"
 *   -> "Credentials captured. Fetching…"
 *   -> "Fetched +N new conversations." (auto-dismiss 5s)
 *
 * Refresh button is disabled while the pipeline is running.
 *
 * Errors during capture (closed browser / timeout) become a sticky error
 * toast with a Retry action.
 */

async function clickRefresh(page: Page) {
  await page.locator('aside button[title="Refresh conversation list"]').click();
}

test.describe('Refresh pipeline (capture + fetch)', () => {
  test('toast walks through capture phases on missing credentials', async ({ page, mockBackend }) => {
    await mockBackend({});
    // Status reports no credentials so the pipeline starts with capture.
    await page.route('**/api/fetch/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          has_credentials: false,
          credentials_path: '/tmp/c.json',
          output_dir: '/tmp/conv',
          existing_count: 0,
          credentials_age_days: null,
        }),
      });
    });

    // The combined pipeline streams capture phases then completes.
    await page.route('**/api/fetch/refresh*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body:
          'data: {"type":"capture_start","message":"Opening browser to log in to Claude..."}\n\n' +
          'data: {"type":"capture_done","message":"Credentials captured. Fetching..."}\n\n' +
          'data: {"type":"start","message":"Fetching conversation list...","current":0,"total":0}\n\n' +
          'data: {"type":"complete","message":"Fetched 3 conversations successfully.","current":3,"total":3}\n\n',
      });
    });

    await withNetRetry(page, () => page.goto('/'));
    await clickRefresh(page);

    const toast = page.locator('[data-sonner-toast]').first();
    await expect(toast).toBeVisible({ timeout: 5000 });
    // Final state should be the success message.
    await expect(toast).toContainText(/Fetched 3 conversations/i, { timeout: 5000 });
  });

  test('refresh button is disabled while pipeline is running', async ({ page, mockBackend }) => {
    await mockBackend({});
    await page.route('**/api/fetch/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          has_credentials: true,
          credentials_path: '/tmp/c.json',
          output_dir: '/tmp/conv',
          existing_count: 0,
          credentials_age_days: 2,
        }),
      });
    });

    // Hold the SSE response open so we can inspect the disabled state.
    await page.route('**/api/fetch/refresh*', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body:
          'data: {"type":"start","message":"Fetching conversation list...","current":0,"total":0}\n\n' +
          'data: {"type":"complete","message":"Fetched 0 conversations.","current":0,"total":0}\n\n',
      });
    });

    await withNetRetry(page, () => page.goto('/'));

    const refreshButton = page.locator('aside button[title="Refresh conversation list"]');
    await refreshButton.click();

    // Immediately after clicking, the button should be disabled.
    await expect(refreshButton).toBeDisabled({ timeout: 1000 });
  });

  test('sticky error toast on capture failure exposes a Retry action', async ({ page, mockBackend }) => {
    await mockBackend({});
    await page.route('**/api/fetch/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          has_credentials: false,
          credentials_path: '/tmp/c.json',
          output_dir: '/tmp/conv',
          existing_count: 0,
          credentials_age_days: null,
        }),
      });
    });

    await page.route('**/api/fetch/refresh*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body:
          'data: {"type":"capture_start","message":"Opening browser to log in to Claude..."}\n\n' +
          'data: {"type":"error","message":"Capture failed: browser closed or login timed out"}\n\n',
      });
    });

    await withNetRetry(page, () => page.goto('/'));
    await clickRefresh(page);

    const errorToast = page.locator('[data-sonner-toast][data-type="error"]').first();
    await expect(errorToast).toBeVisible({ timeout: 5000 });
    await expect(errorToast).toContainText(/Capture failed/i);
    // Retry action present
    await expect(errorToast.getByRole('button', { name: /Retry/i })).toBeVisible();
  });
});
