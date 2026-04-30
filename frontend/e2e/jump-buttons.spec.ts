import { test, expect } from '@playwright/test';
import { waitForConnection } from './test-utils';

/**
 * Build-3: Jump-to-top + Jump-to-bottom buttons that don't get obscured
 * by the right-side search panel.
 */

test.describe('Jump buttons', () => {
  test('shows both jump-to-top and jump-to-bottom buttons when scrolled', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);

    const firstConv = page.getByRole('button', { name: /\d+ msgs/ }).first();
    await firstConv.click();

    const messageStream = page.locator('[data-testid="message-stream"]').first();
    await messageStream.waitFor({ state: 'visible', timeout: 10000 });

    await messageStream.evaluate((el) => {
      el.scrollTop = el.scrollHeight / 2;
    });

    const jumpTop = page.getByRole('button', { name: /Jump to top/i });
    const jumpBottom = page.getByRole('button', { name: /Jump to bottom/i });

    await expect(jumpTop).toBeVisible({ timeout: 3000 });
    await expect(jumpBottom).toBeVisible({ timeout: 3000 });
  });

  test('jump-to-top scrolls the stream to the top', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);

    const firstConv = page.getByRole('button', { name: /\d+ msgs/ }).first();
    await firstConv.click();

    const messageStream = page.locator('[data-testid="message-stream"]').first();
    await messageStream.waitFor({ state: 'visible', timeout: 10000 });

    await messageStream.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });

    const jumpTop = page.getByRole('button', { name: /Jump to top/i });
    await expect(jumpTop).toBeVisible({ timeout: 3000 });
    await jumpTop.click();

    await expect
      .poll(async () => messageStream.evaluate((el) => el.scrollTop), {
        timeout: 5000,
      })
      .toBeLessThan(50);
  });

  test('button stack repositions when search panel opens', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);

    const firstConv = page.getByRole('button', { name: /\d+ msgs/ }).first();
    await firstConv.click();

    const messageStream = page.locator('[data-testid="message-stream"]').first();
    await messageStream.waitFor({ state: 'visible', timeout: 10000 });
    await messageStream.evaluate((el) => {
      el.scrollTop = el.scrollHeight / 2;
    });

    const jumpBottom = page.getByRole('button', { name: /Jump to bottom/i });
    await expect(jumpBottom).toBeVisible({ timeout: 3000 });

    const closedBox = await jumpBottom.boundingBox();
    expect(closedBox).not.toBeNull();
    const closedRight = closedBox!.x;

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
    await page.waitForTimeout(400);

    const openBox = await jumpBottom.boundingBox();
    expect(openBox).not.toBeNull();
    expect(openBox!.x).toBeLessThan(closedRight - 200);
  });
});
