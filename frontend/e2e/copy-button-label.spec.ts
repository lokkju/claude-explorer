import { test, expect, makeSummary, makeMessage, makeDetail, withNetRetry } from './fixtures'

/**
 * Build-8 #10: the conversation-toolbar Copy button should be labeled
 * "Copy as Markdown" so users can tell at a glance what format they get.
 */

test('conversation Copy button is labeled "Copy as Markdown"', async ({ page, mockBackend }) => {
  const uuid = '11111111-1111-1111-1111-111111111111';
  const summary = makeSummary({
    uuid,
    name: 'Sample conversation',
    message_count: 2,
    human_message_count: 1,
  });
  const messages = [
    makeMessage({ uuid: 'm1', sender: 'human', text: 'Hello' }),
    makeMessage({
      uuid: 'm2',
      sender: 'assistant',
      text: 'Hi there!',
      parent_message_uuid: 'm1',
    }),
  ];
  await mockBackend({
    conversations: [summary],
    details: { [uuid]: makeDetail(summary, messages) },
  });

  await withNetRetry(() => page.goto('/'));

  const firstConv = page.getByRole('button', { name: /\d+ msgs/ }).first();
  await firstConv.click();

  await expect(
    page.getByRole('button', { name: /Copy as Markdown/i })
  ).toBeVisible({ timeout: 10000 });
});
