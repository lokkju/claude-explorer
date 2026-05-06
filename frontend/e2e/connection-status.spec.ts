import { test, expect } from './fixtures';

// M5.5: converted to `./fixtures`. Tests 1-7 deliberately block all
// `/api/**` to exercise the offline-backend UX, so they don't need
// mockBackend at all. Test 8 ("dialog closes automatically") needs the
// mocked backend to be reachable AFTER the initial block lifts —
// previously it used `route.continue()`, which would leak to the live
// backend on :8000. With mockBackend installed first, the per-test
// `/api` route can use `route.fallback()` to delegate to the fixture
// mocks once `blockRequests=false`.

test.describe('Connection Status', () => {
  test('shows connecting dialog when backend is unavailable', async ({ page }) => {
    // Block all API requests to simulate backend down
    await page.route('**/api/**', (route) => {
      route.abort('connectionrefused');
    });

    await page.goto('/');

    // Should show the connecting dialog
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Connecting to Backend')).toBeVisible();
    await expect(page.getByText(/Attempt \d+ of \d+/)).toBeVisible();
  });

  test('shows retry counter incrementing', async ({ page }) => {
    // Block API requests
    await page.route('**/api/**', (route) => {
      route.abort('connectionrefused');
    });

    await page.goto('/');

    // Wait for dialog
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });

    // Check initial attempt
    await expect(page.getByText('Attempt 1 of 5')).toBeVisible();

    // Wait for retry and check increment (exponential backoff: 1s, 2s, 4s...)
    await expect(page.getByText('Attempt 2 of 5')).toBeVisible({ timeout: 3000 });
  });

  test('Retry Now button triggers immediate retry', async ({ page }) => {
    let requestCount = 0;

    // Block API requests and count them
    await page.route('**/api/config', (route) => {
      requestCount++;
      route.abort('connectionrefused');
    });

    await page.goto('/');

    // Wait for dialog
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });

    // Get current request count
    const initialCount = requestCount;

    // Click Retry Now
    await page.getByRole('button', { name: 'Retry Now' }).click();

    // Should trigger a new request immediately
    await page.waitForTimeout(500);
    expect(requestCount).toBeGreaterThan(initialCount);
  });

  test('shows Connection Failed dialog after max retries', async ({ page }) => {
    // Block API requests
    await page.route('**/api/**', (route) => {
      route.abort('connectionrefused');
    });

    await page.goto('/');

    // Wait for dialog
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });

    // Wait for all retries to complete (5 attempts with exponential backoff)
    // Max wait: 1s + 2s + 4s + 8s + 10s = 25s, but we use timeout of 35s
    await expect(page.getByText('Connection Failed')).toBeVisible({ timeout: 35000 });

    // Should show the failure message
    await expect(page.getByText(/Unable to connect.*after 5 attempts/)).toBeVisible();

    // Should show the help text
    await expect(page.getByText('claude-explorer serve')).toBeVisible();

    // Should have both Dismiss and Try Again buttons
    await expect(page.getByRole('button', { name: 'Dismiss' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try Again' })).toBeVisible();
  });

  test('Try Again button restarts retry process', async ({ page }) => {
    // Block API requests
    await page.route('**/api/**', (route) => {
      route.abort('connectionrefused');
    });

    await page.goto('/');

    // Wait for Connection Failed
    await expect(page.getByText('Connection Failed')).toBeVisible({ timeout: 35000 });

    // Click Try Again
    await page.getByRole('button', { name: 'Try Again' }).click();

    // Should restart with "Connecting to Backend" and Attempt 1
    await expect(page.getByText('Connecting to Backend')).toBeVisible({ timeout: 3000 });
    await expect(page.getByText('Attempt 1 of 5')).toBeVisible();
  });

  test('Dismiss button closes the dialog', async ({ page }) => {
    // Block API requests
    await page.route('**/api/**', (route) => {
      route.abort('connectionrefused');
    });

    await page.goto('/');

    // Wait for Connection Failed
    await expect(page.getByText('Connection Failed')).toBeVisible({ timeout: 35000 });

    // Click Dismiss
    await page.getByRole('button', { name: 'Dismiss' }).click();

    // Dialog should close
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('dialog closes automatically when backend becomes available', async ({ page, mockBackend }) => {
    // Install the mocked backend FIRST so its routes exist when we lift
    // the per-test block. Once `blockRequests=false`, the per-test
    // `**/api/**` handler falls through (via `route.fallback()`) to the
    // mockBackend defaults — never to the live :8000 backend.
    await mockBackend({});

    let blockRequests = true;

    // Initially block API requests. Registered AFTER mockBackend so this
    // handler runs first (LIFO); when unblocked, falls through.
    await page.route('**/api/**', async (route) => {
      if (blockRequests) {
        await route.abort('connectionrefused');
      } else {
        await route.fallback();
      }
    });

    await page.goto('/');

    // Wait for dialog to appear
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Connecting to Backend')).toBeVisible();

    // Unblock requests (simulate backend coming up)
    blockRequests = false;

    // Click Retry Now to trigger reconnection
    await page.getByRole('button', { name: 'Retry Now' }).click();

    // Dialog should close when connection succeeds
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10000 });

    // App should load normally
    await expect(page.getByText('Claude Explorer')).toBeVisible();
  });

  test('shows spinning icon during connection attempts', async ({ page }) => {
    // Block API requests
    await page.route('**/api/**', (route) => {
      route.abort('connectionrefused');
    });

    await page.goto('/');

    // Wait for dialog
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });

    // Should show spinning refresh icon (has animate-spin class)
    const spinningIcon = page.locator('.animate-spin');
    await expect(spinningIcon).toBeVisible();
  });
});
