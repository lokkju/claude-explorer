import { test, expect, makeSummary, makeMessage, makeDetail, withNetRetry } from './fixtures'

/**
 * Build-3: Jump-to-top + Jump-to-bottom buttons that don't get obscured
 * by the right-side search panel.
 *
 * Targets a long conversation (30 messages) so there's always enough
 * vertical scroll to trigger both buttons.
 */

const LONG_TITLE = 'Phase 5 fixture: TLS handshakes (long)';
const LONG_UUID = '0f415a45-9c62-8671-d4ad-53b84acb7e1a';

function buildLongConversation() {
  const summary = makeSummary({
    uuid: LONG_UUID,
    name: LONG_TITLE,
    message_count: 30,
    human_message_count: 15,
  });

  // 30 alternating human/assistant messages with enough text per message
  // to guarantee the stream overflows vertically (so jump buttons appear).
  const filler =
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(15);
  const messages = [];
  let prev: string | null = null;
  for (let i = 0; i < 30; i++) {
    const uuid = `msg-${i.toString().padStart(2, '0')}`;
    const sender = i % 2 === 0 ? 'human' : 'assistant';
    messages.push(
      makeMessage({
        uuid,
        sender,
        text: `Message ${i}: ${filler}`,
        parent_message_uuid: prev,
      }),
    );
    prev = uuid;
  }
  return { summary, detail: makeDetail(summary, messages) };
}

async function openLongConversation(page: import('@playwright/test').Page) {
  await withNetRetry(() => page.goto('/'));
  const row = page.getByText(LONG_TITLE);
  await expect(row).toBeVisible({ timeout: 10_000 });
  await row.click();

  const messageStream = page.locator('[data-testid="message-stream"]').first();
  await messageStream.waitFor({ state: 'visible', timeout: 10_000 });
  return messageStream;
}

test.describe('Jump buttons', () => {
  test.beforeEach(async ({ mockBackend }) => {
    const { summary, detail } = buildLongConversation();
    await mockBackend({
      conversations: [summary],
      details: { [LONG_UUID]: detail },
    });
  });

  test('shows both jump-to-top and jump-to-bottom buttons when scrolled', async ({ page }) => {
    const messageStream = await openLongConversation(page);
    // Scroll to mid — both buttons should appear (not at top, not at bottom).
    await messageStream.evaluate((el) => {
      el.scrollTop = el.scrollHeight / 2;
    });

    const jumpTop = page.getByRole('button', { name: /Jump to top/i });
    const jumpBottom = page.getByRole('button', { name: /Jump to bottom/i });
    await expect(jumpTop).toBeVisible({ timeout: 3000 });
    await expect(jumpBottom).toBeVisible({ timeout: 3000 });
  });

  test('jump-to-top scrolls the stream to the top', async ({ page }) => {
    const messageStream = await openLongConversation(page);
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
    const messageStream = await openLongConversation(page);
    await messageStream.evaluate((el) => {
      el.scrollTop = el.scrollHeight / 2;
    });

    const jumpBottom = page.getByRole('button', { name: /Jump to bottom/i });
    await expect(jumpBottom).toBeVisible({ timeout: 3000 });

    const closedBox = await jumpBottom.boundingBox();
    expect(closedBox).not.toBeNull();
    const closedRight = closedBox!.x;

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
    await expect(page.locator('aside[aria-label="Search panel"]')).toHaveAttribute(
      'aria-hidden',
      'false',
    );

    // The button container has a 200ms CSS transition on `right`. Poll the
    // bounding box until it has actually moved leftward by at least 200px
    // (the panel is 25rem = 400px wide, so the buttons reposition ~376px).
    await expect
      .poll(
        async () => {
          const box = await jumpBottom.boundingBox();
          return box ? box.x : closedRight;
        },
        { timeout: 5_000 },
      )
      .toBeLessThan(closedRight - 200);
  });
});
