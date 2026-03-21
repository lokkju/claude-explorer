import type { Page } from '@playwright/test';

/**
 * Wait for backend connection and dismiss any connection dialog.
 * Also waits for conversations to load.
 */
export async function waitForConnection(page: Page, options?: { waitForConversations?: boolean }) {
  const timeout = 15000;
  const startTime = Date.now();

  // Keep trying until timeout
  while (Date.now() - startTime < timeout) {
    // Try to dismiss the connection dialog if it's present
    const closeBtn = page.getByRole('button', { name: 'Close' });
    const dismissBtn = page.getByRole('button', { name: 'Dismiss' });
    const retryNowBtn = page.getByRole('button', { name: 'Retry Now' });

    try {
      if (await closeBtn.isVisible().catch(() => false)) {
        await closeBtn.click({ timeout: 1000 });
        await page.waitForTimeout(300);
        continue;
      }
    } catch {
      // Button disappeared before we could click it
    }
    try {
      if (await dismissBtn.isVisible().catch(() => false)) {
        await dismissBtn.click({ timeout: 1000 });
        await page.waitForTimeout(300);
        continue;
      }
    } catch {
      // Button disappeared before we could click it
    }
    try {
      if (await retryNowBtn.isVisible().catch(() => false)) {
        await retryNowBtn.click({ timeout: 1000 });
        await page.waitForTimeout(500);
        continue;
      }
    } catch {
      // Button disappeared before we could click it
    }

    // Check if connection dialog is no longer visible
    const connectingDialog = page.locator('text=Connecting to Backend');
    const failedDialog = page.locator('text=Connection Failed');
    const dialogVisible = await connectingDialog.isVisible().catch(() => false) ||
                          await failedDialog.isVisible().catch(() => false);

    if (!dialogVisible) {
      // No dialog - wait for conversations if needed
      if (options?.waitForConversations !== false) {
        const hasConversations = await page.getByRole('button', { name: /\d+ msgs/ }).first()
          .isVisible().catch(() => false);
        if (hasConversations) {
          return; // Success!
        }
      } else {
        return; // Success without waiting for conversations
      }
    }

    await page.waitForTimeout(300);
  }

  // Timeout reached - one last attempt to dismiss
  const closeBtn = page.getByRole('button', { name: 'Close' });
  if (await closeBtn.isVisible().catch(() => false)) {
    await closeBtn.click();
  }
}
