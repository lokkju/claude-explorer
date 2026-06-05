// Keyboard activation parity for TreeView nodes (Phase 1 a11y).
//
// The branch picker in the TreeViewModal is a list of clickable rows.
// Before the a11y pass each row was a `<div onClick>` — pointer-only.
// React Doctor's `click-events-have-key-events` and
// `no-static-element-interactions` flagged TreeView.tsx:76. The Council
// (Gemini-2.5-Pro + GPT-5.2) converged on FIX-via-real-`<button>`
// rather than role+tabIndex+onKeyDown polyfill.
//
// This spec pins keyboard activation parity: pressing Enter (and Space)
// on a tree row triggers the same branch switch as clicking it.

import { test, expect, makeSummary, makeMessage, makeDetail, withNetRetry } from './fixtures';
import type { ConversationTree } from '../src/lib/types';

const FAKE_UUID = '00000000-0000-0000-0000-0000000000c7';

const summary = makeSummary({
  uuid: FAKE_UUID,
  name: 'TreeView keyboard fixture',
  message_count: 5,
  human_message_count: 2,
  has_branches: true,
});

const ROOT = makeMessage({ uuid: 'm-root', sender: 'human', text: 'common root', content: [{ type: 'text', text: 'common root' }] });
const A1 = makeMessage({ uuid: 'm-a-1', sender: 'assistant', text: 'BRANCH-A reply 1', content: [{ type: 'text', text: 'BRANCH-A reply 1' }], parent_message_uuid: 'm-root' });
const A2 = makeMessage({ uuid: 'm-a-2', sender: 'human', text: 'BRANCH-A follow-up', content: [{ type: 'text', text: 'BRANCH-A follow-up' }], parent_message_uuid: 'm-a-1' });
const B1 = makeMessage({ uuid: 'm-b-1', sender: 'assistant', text: 'BRANCH-B reply 1', content: [{ type: 'text', text: 'BRANCH-B reply 1' }], parent_message_uuid: 'm-root' });
const B2 = makeMessage({ uuid: 'm-b-2', sender: 'human', text: 'BRANCH-B follow-up', content: [{ type: 'text', text: 'BRANCH-B follow-up' }], parent_message_uuid: 'm-b-1' });

const detailA = makeDetail(summary, [ROOT, A1, A2]);
const detailB = makeDetail(summary, [ROOT, B1, B2]);

const tree: ConversationTree = {
  uuid: FAKE_UUID,
  active_path: ['m-root', 'm-a-1', 'm-a-2'],
  root_messages: [
    {
      message: ROOT,
      children: [
        { message: A1, children: [{ message: A2, children: [] }] },
        { message: B1, children: [{ message: B2, children: [] }] },
      ],
    },
  ],
};

test.describe('TreeView keyboard activation (Phase 1 a11y)', () => {
  test.use({ viewport: { width: 1600, height: 900 } });

  test('pressing Enter on a branch node triggers the same switch as clicking', async ({ page, mockBackend }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // extraRoutes registers higher-priority handlers BEFORE the
    // fixture defaults, so we can intercept the leaf-specific detail
    // request and return BRANCH-B's message stream.
    await mockBackend({
      conversations: [summary],
      details: { [FAKE_UUID]: detailA },
      trees: { [FAKE_UUID]: tree },
      extraRoutes: async (p) => {
        await p.route('**/api/conversations/**', async (route) => {
          const u = new URL(route.request().url());
          if (u.pathname.endsWith(`/conversations/${FAKE_UUID}`) && u.searchParams.get('leaf') === 'm-b-2') {
            await route.fulfill({ contentType: 'application/json', body: JSON.stringify(detailB) });
            return;
          }
          await route.fallback();
        });
      },
    });

    await withNetRetry(page, () => page.goto(`/conversations/${FAKE_UUID}`));
    await expect(page.getByText('BRANCH-A reply 1')).toBeVisible();

    await page.getByRole('button', { name: /view branches/i }).click();
    await expect(page.getByText(/Conversation Tree/i)).toBeVisible();

    // Real `<button>` semantics: queryable by role, focusable via .focus(),
    // and activatable with Enter. This proves the React Doctor fix really
    // landed (vs. a role=button polyfill, which getByRole would also match,
    // but which wouldn't match a plain `<div onClick>`).
    const branchBRow = page.getByRole('button', { name: /BRANCH-B follow-up/i });
    await expect(branchBRow).toBeVisible();
    await branchBRow.focus();
    await expect(branchBRow).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/leaf=m-b-2/);
    await expect(page.getByText('BRANCH-B reply 1')).toBeVisible();
    await expect(page.getByText('BRANCH-A reply 1')).toHaveCount(0);

    expect(consoleErrors, `Unexpected console errors: ${consoleErrors.join('\n')}`).toEqual([]);
  });

  test('pressing Space on a branch node also triggers the switch (native <button> activation)', async ({ page, mockBackend }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await mockBackend({
      conversations: [summary],
      details: { [FAKE_UUID]: detailA },
      trees: { [FAKE_UUID]: tree },
      extraRoutes: async (p) => {
        await p.route('**/api/conversations/**', async (route) => {
          const u = new URL(route.request().url());
          if (u.pathname.endsWith(`/conversations/${FAKE_UUID}`) && u.searchParams.get('leaf') === 'm-b-2') {
            await route.fulfill({ contentType: 'application/json', body: JSON.stringify(detailB) });
            return;
          }
          await route.fallback();
        });
      },
    });

    await withNetRetry(page, () => page.goto(`/conversations/${FAKE_UUID}`));
    await expect(page.getByText('BRANCH-A reply 1')).toBeVisible();

    await page.getByRole('button', { name: /view branches/i }).click();
    await expect(page.getByText(/Conversation Tree/i)).toBeVisible();

    const branchBRow = page.getByRole('button', { name: /BRANCH-B follow-up/i });
    await branchBRow.focus();
    await page.keyboard.press(' ');

    await expect(page).toHaveURL(/leaf=m-b-2/);
    await expect(page.getByText('BRANCH-B reply 1')).toBeVisible();

    expect(consoleErrors, `Unexpected console errors: ${consoleErrors.join('\n')}`).toEqual([]);
  });
});
