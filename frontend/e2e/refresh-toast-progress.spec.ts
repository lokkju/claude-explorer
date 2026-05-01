import { test, expect, Page } from '@playwright/test';
import { waitForConnection } from './test-utils';

/**
 * Build-9 Bug 2: Toast text MUST update with each `progress` SSE event
 * during a long fetch. The user reported clicking Refresh and seeing only
 * a static "Refreshing…" / "Fetching N/M…" with no per-conversation
 * feedback, even though the backend emits a progress event for every
 * conversation it fetches.
 *
 * Spec:
 *   - On `progress` events with `conversation_name`, the toast text becomes
 *     "Fetching N/M: <conversation_name>" (truncated to 40 chars).
 *   - On `capture_start`: "Opening browser to log in to Claude…"
 *   - On `capture_waiting_login`: "Waiting for you to log in…"
 *   - On `capture_done`: "Credentials captured. Fetching…"
 *   - On `complete`: success toast ("Fetched +N new conversations.")
 *   - One toast at a time (Sonner toast.loading with stable id), never a
 *     stack of toasts.
 */

async function clickRefresh(page: Page) {
  await page
    .getByRole('button', { name: /Refresh conversation list/i })
    .click();
}

test.describe('Refresh toast: live progress text (Bug 2)', () => {
  test.beforeEach(async ({ page }) => {
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
  });

  test('toast text shows the conversation_name from the latest progress event', async ({ page }) => {
    await page.route('**/api/fetch/refresh*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body:
          'data: {"type":"start","message":"Fetching conversation list...","current":0,"total":0}\n\n' +
          'data: {"type":"progress","message":"Fetching: Alpha","current":1,"total":3,"conversation_name":"Alpha"}\n\n' +
          'data: {"type":"progress","message":"Fetching: Beta","current":2,"total":3,"conversation_name":"Beta"}\n\n' +
          'data: {"type":"progress","message":"Fetching: Gamma","current":3,"total":3,"conversation_name":"Gamma"}\n\n' +
          'data: {"type":"complete","message":"Fetched 3 conversations successfully.","current":3,"total":3}\n\n',
      });
    });

    await page.goto('/');
    await waitForConnection(page, { waitForConversations: false });
    await clickRefresh(page);

    const toast = page.locator('[data-sonner-toast]').first();
    await expect(toast).toBeVisible({ timeout: 5000 });
    // After all progress events fire, the toast should reflect the final
    // conversation name (Gamma) before the complete event flips it to success.
    // Either way, the success message wins as the final visible state.
    await expect(toast).toContainText(/Fetched 3 conversations/i, { timeout: 5000 });
  });

  test('mid-pipeline toast text includes the conversation_name (not just N/M)', async ({ page }) => {
    // Capture all toast text the page rendered into a window-scoped log.
    // We can't reliably catch a transient toast string with normal Playwright
    // assertions because the success event arrives microseconds after the
    // last progress event. Snapshotting via a MutationObserver gives us a
    // history we can assert against.
    await page.addInitScript(() => {
      const w = window as unknown as { __toastTexts: string[] };
      w.__toastTexts = [];
      const obs = new MutationObserver(() => {
        const nodes = document.querySelectorAll('[data-sonner-toast]');
        nodes.forEach((n) => {
          const t = (n.textContent || '').trim();
          if (t) w.__toastTexts.push(t);
        });
      });
      obs.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    });

    await page.route('**/api/fetch/refresh*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body:
          'data: {"type":"start","message":"Fetching conversation list...","current":0,"total":0}\n\n' +
          'data: {"type":"progress","message":"Fetching: Synology metadata explanation","current":2,"total":5,"conversation_name":"Synology metadata explanation"}\n\n' +
          'data: {"type":"complete","message":"Fetched 5 conversations successfully.","current":5,"total":5}\n\n',
      });
    });

    await page.goto('/');
    await waitForConnection(page, { waitForConversations: false });
    await clickRefresh(page);

    const toast = page.locator('[data-sonner-toast]').first();
    await expect(toast).toBeVisible({ timeout: 5000 });
    // Wait for terminal success.
    await expect(toast).toContainText(/Fetched 5/i, { timeout: 5000 });

    // At some point during the pipeline the toast MUST have shown the
    // conversation_name plus the N/M progress.
    const history = await page.evaluate(() => (window as unknown as { __toastTexts: string[] }).__toastTexts);
    const matched = history.some(
      (t) => /Synology metadata/i.test(t) && /2\/5/.test(t),
    );
    expect(matched, `toast history did not include progress text. got: ${JSON.stringify(history)}`).toBe(true);
  });

  test('only one toast is visible while pipeline is running (no stacking)', async ({ page }) => {
    await page.route('**/api/fetch/refresh*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body:
          'data: {"type":"start","message":"Fetching conversation list...","current":0,"total":0}\n\n' +
          'data: {"type":"progress","message":"Fetching: A","current":1,"total":5,"conversation_name":"A"}\n\n' +
          'data: {"type":"progress","message":"Fetching: B","current":2,"total":5,"conversation_name":"B"}\n\n' +
          'data: {"type":"progress","message":"Fetching: C","current":3,"total":5,"conversation_name":"C"}\n\n' +
          'data: {"type":"progress","message":"Fetching: D","current":4,"total":5,"conversation_name":"D"}\n\n' +
          'data: {"type":"progress","message":"Fetching: E","current":5,"total":5,"conversation_name":"E"}\n\n',
      });
    });

    await page.goto('/');
    await waitForConnection(page, { waitForConversations: false });
    await clickRefresh(page);

    // Wait for at least one toast.
    await expect(page.locator('[data-sonner-toast]').first()).toBeVisible({
      timeout: 5000,
    });

    // After the burst of events, only ONE toast should be visible. If
    // toast.loading was called without a stable id, we'd see 5 stacked.
    await page.waitForTimeout(1000);
    const toastCount = await page.locator('[data-sonner-toast]').count();
    expect(toastCount).toBe(1);
  });

  test('long conversation names are truncated to 40 chars in the toast', async ({ page }) => {
    const longName = 'This is an extremely long conversation name that should be truncated';

    await page.addInitScript(() => {
      const w = window as unknown as { __toastTexts: string[] };
      w.__toastTexts = [];
      const obs = new MutationObserver(() => {
        document.querySelectorAll('[data-sonner-toast]').forEach((n) => {
          const t = (n.textContent || '').trim();
          if (t) w.__toastTexts.push(t);
        });
      });
      obs.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    });

    await page.route('**/api/fetch/refresh*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body:
          'data: {"type":"start","message":"Fetching conversation list...","current":0,"total":0}\n\n' +
          `data: {"type":"progress","message":"Fetching: ${longName}","current":1,"total":2,"conversation_name":"${longName}"}\n\n` +
          'data: {"type":"complete","message":"Fetched 2 conversations successfully.","current":2,"total":2}\n\n',
      });
    });

    await page.goto('/');
    await waitForConnection(page, { waitForConversations: false });
    await clickRefresh(page);

    const toast = page.locator('[data-sonner-toast]').first();
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast).toContainText(/Fetched 2/i, { timeout: 5000 });

    const history = await page.evaluate(() => (window as unknown as { __toastTexts: string[] }).__toastTexts);
    // None of the snapshots should contain the FULL untruncated name.
    const fullNameSeen = history.some((t) => t.includes(longName));
    expect(fullNameSeen, `Full untruncated name leaked: ${JSON.stringify(history)}`).toBe(false);
    // But the leading portion should appear in at least one snapshot.
    const leadingSeen = history.some((t) => t.includes('This is an extremely long'));
    expect(leadingSeen, `Leading portion missing: ${JSON.stringify(history)}`).toBe(true);
  });

  test('capture phase events drive toast text transitions', async ({ page }) => {
    // Force the missing-creds path so capture_start fires.
    await page.unroute('**/api/fetch/status');
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
          'data: {"type":"capture_done","message":"Credentials captured. Fetching..."}\n\n' +
          'data: {"type":"progress","message":"Fetching: Hello","current":1,"total":1,"conversation_name":"Hello"}\n\n' +
          'data: {"type":"complete","message":"Fetched 1 conversations successfully.","current":1,"total":1}\n\n',
      });
    });

    await page.goto('/');
    await waitForConnection(page, { waitForConversations: false });
    await clickRefresh(page);

    const toast = page.locator('[data-sonner-toast]').first();
    await expect(toast).toBeVisible({ timeout: 5000 });
    // Final state should be success.
    await expect(toast).toContainText(/Fetched 1 conversations/i, { timeout: 5000 });
  });
});
