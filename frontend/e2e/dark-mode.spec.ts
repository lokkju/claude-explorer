import { test, expect, withNetRetry } from './fixtures'

/**
 * Dark-mode runtime application (Build-8 #7).
 *
 * Beyond the .dark class being on <html>, verify that Tailwind's dark variant
 * actually changes a representative element's background color in the rendered
 * page. Catches "dark class set but CSS not applying" regressions (Tailwind v4
 * config drift).
 */

test.describe('Dark mode runtime', () => {
  test.beforeEach(async ({ page, mockBackend }) => {
    await mockBackend();
    await withNetRetry(page, () => page.goto('/'));
    await page.evaluate(() => localStorage.clear());
    await withNetRetry(page, () => page.reload());
  });

  test('toggling to dark theme applies .dark to <html> and dark-mode CSS to the body', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await withNetRetry(page, () => page.goto('/settings'));

    // Light mode first: capture body bg.
    await page.click('label:has-text("Light")');
    // Sample the root layout's main wrapper which carries dark:bg-zinc-950.
    const sampler = '#root > div';
    const lightBg = await page.evaluate((sel) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      return el ? getComputedStyle(el).backgroundColor : '';
    }, sampler);
    await expect(page.locator('html')).not.toHaveClass(/dark/);

    // Switch to dark.
    await page.click('label:has-text("Dark")');

    await expect(page.locator('html')).toHaveClass(/dark/);
    const darkBg = await page.evaluate((sel) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      return el ? getComputedStyle(el).backgroundColor : '';
    }, sampler);

    // Dark mode must produce a different background than light mode.
    expect(lightBg).not.toBe('');
    expect(darkBg).not.toBe('');
    expect(darkBg).not.toBe(lightBg);
  });
});
