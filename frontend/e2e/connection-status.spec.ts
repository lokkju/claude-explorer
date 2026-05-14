import { test, expect } from './fixtures';

// M5.5: converted to `./fixtures`. Tests 1-7 deliberately block all
// `/api/**` to exercise the offline-backend UX, so they don't need
// mockBackend at all. Test 8 ("dialog closes automatically") needs the
// mocked backend to be reachable AFTER the initial block lifts —
// previously it used `route.continue()`, which would leak to the live
// backend on :8765. With mockBackend installed first, the per-test
// `/api` route can use `route.fallback()` to delegate to the fixture
// mocks once `blockRequests=false`.
//
// V1 polish (2026-05-09): the dialog now opens only once retryCount≥2
// (suppresses dialog flash on a single transient blip) and the first
// retry waits 4s instead of 2s (lets a healthy backend's --reload
// cold-start finish). Schedule: 4s, 8s, 10s, 10s, 10s = 42s to terminal.

test.describe('Connection Status', () => {
  test('shows connecting dialog when backend is unavailable', async ({ page }) => {
    // Block all API requests to simulate backend down
    await page.route('**/api/**', (route) => {
      route.abort('connectionrefused');
    });

    await page.goto('/');

    // Dialog opens at retry 2 (4s + initial check). 15s timeout > the 12s
    // worst case (4s first retry + check timeout slack).
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Connecting to Backend')).toBeVisible();
    await expect(page.getByText(/Attempt \d+ of \d+/)).toBeVisible();
  });

  test('shows retry counter incrementing', async ({ page }) => {
    // Block API requests
    await page.route('**/api/**', (route) => {
      route.abort('connectionrefused');
    });

    await page.goto('/');

    // Wait for dialog (opens at retry 2 — see V1 polish note above).
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15000 });

    // Dialog opens showing "Attempt 2" (the first attempt visible to user
    // under the V1 dialog-suppression policy).
    await expect(page.getByText('Attempt 2 of 5')).toBeVisible();

    // Wait for retry 3 (8s after retry 2).
    await expect(page.getByText('Attempt 3 of 5')).toBeVisible({ timeout: 10000 });
  });

  test('Retry Now button triggers immediate retry', async ({ page }) => {
    let requestCount = 0;

    // Block API requests and count them
    await page.route('**/api/config', (route) => {
      requestCount++;
      route.abort('connectionrefused');
    });

    await page.goto('/');

    // Wait for dialog (opens at retry 2 — V1 polish).
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15000 });

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

    // Wait for dialog (opens at retry 2 — V1 polish).
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15000 });

    // Wait for all 5 retries to exhaust. Schedule: 4 + 8 + 10 + 10 + 10 = 42s.
    // Plus initial check + 5x 5s API timeout slack. Use 60s timeout.
    await expect(page.getByText('Connection Failed')).toBeVisible({ timeout: 60000 });

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

    // Wait for Connection Failed (V1 polish: 60s for 4+8+10+10+10 = 42s schedule).
    await expect(page.getByText('Connection Failed')).toBeVisible({ timeout: 60000 });

    // Click Try Again. handleReconnect() clears showDialog, so the
    // dialog closes briefly and re-opens when retryCount reaches 2 again
    // (V1 polish: dialog suppressed until retry≥2). Wait up to 15s for
    // the re-open (initial check + 4s first retry).
    await page.getByRole('button', { name: 'Try Again' }).click();
    await expect(page.getByText('Connecting to Backend')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Attempt [23] of 5/)).toBeVisible();
  });

  test('Dismiss button closes the dialog', async ({ page }) => {
    // Block API requests
    await page.route('**/api/**', (route) => {
      route.abort('connectionrefused');
    });

    await page.goto('/');

    // Wait for Connection Failed (V1 polish: 60s for the 42s retry schedule).
    await expect(page.getByText('Connection Failed')).toBeVisible({ timeout: 60000 });

    // Click Dismiss
    await page.getByRole('button', { name: 'Dismiss' }).click();

    // Dialog should close
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('dialog closes automatically when backend becomes available', async ({ page, mockBackend }) => {
    // Install the mocked backend FIRST so its routes exist when we lift
    // the per-test block. Once `blockRequests=false`, the per-test
    // `**/api/**` handler falls through (via `route.fallback()`) to the
    // mockBackend defaults — never to the live :8765 backend.
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

    // Wait for dialog to appear (V1 polish: opens at retry 2, 4s+ wait).
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15000 });
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

    // Wait for dialog (V1 polish: opens at retry 2, 4s+ wait).
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15000 });

    // Should show spinning refresh icon (has animate-spin class)
    const spinningIcon = page.locator('.animate-spin');
    await expect(spinningIcon).toBeVisible();
  });

  // V1 polish (2026-05-09): the three new behaviors get explicit
  // regression tests so a future refactor can't quietly drop them.

  test('does NOT show "Last error" while still connecting (V1 polish)', async ({ page }) => {
    // Block API to force `connecting` state with a recorded lastError.
    await page.route('**/api/**', (route) => {
      route.abort('connectionrefused');
    });

    await page.goto('/');

    // Dialog opens at retry 2 — by then lastError is set ("Failed to fetch")
    // but we should NOT render the red "Last error: …" line; the spinner
    // already conveys "we're trying", so a red error line on top of an
    // active retry is the user's UGH.
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Connecting to Backend')).toBeVisible();
    await expect(page.getByText(/Last error/)).toHaveCount(0);
  });

  test('first retry waits ~4 seconds (V1 polish)', async ({ page }) => {
    const requestTimes: number[] = [];
    await page.route('**/api/config', (route) => {
      requestTimes.push(Date.now());
      route.abort('connectionrefused');
    });

    await page.goto('/');

    // React StrictMode in the Vite dev build double-mounts the
    // ConnectionStatus, producing two near-simultaneous initial fetches.
    // Wait until we have at least 4 timestamps (≥2 from the doubled
    // initial mount + ≥2 from the first scheduled retry round) so we
    // can measure the actual retry-delay gap regardless.
    await expect.poll(() => requestTimes.length, { timeout: 15000 }).toBeGreaterThanOrEqual(3);

    // Find the largest gap between consecutive timestamps. Under the
    // 2s baseline this is ~2000ms; under the 4s V1-polish schedule it
    // should be ~4000ms. Reject sub-3000ms as a regression.
    const gaps = requestTimes.slice(1).map((t, i) => t - requestTimes[i]);
    const maxGap = Math.max(...gaps);
    expect(maxGap).toBeGreaterThanOrEqual(3000);
  });

  test('does NOT flash dialog after a single transient (V1 polish)', async ({ page, mockBackend }) => {
    // mockBackend installed first so the app loads.
    await mockBackend({});

    let failuresRemaining = 1;
    await page.route('**/api/config', async (route) => {
      if (failuresRemaining > 0) {
        failuresRemaining -= 1;
        await route.abort('connectionrefused');
        return;
      }
      await route.fallback();
    });

    await page.goto('/');

    // The first /api/config 404s, but the second succeeds before retry 2
    // would open the dialog. The dialog must NEVER become visible.
    // Wait 6s (longer than the 4s first-retry) and assert no dialog.
    await page.waitForTimeout(6000);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
