import { test, expect, makeSummary, makeMessage, makeDetail, withNetRetry } from './fixtures'
import type { Message } from '../src/lib/types'

/**
 * Integration smoke test for keyboard navigation — exercises the four
 * surfaces (Sidebar, Detail, Search, Tools-toggle) in one happy-path walk,
 * with deterministic DOM-signal assertions for each step.
 *
 * The goal is to prevent the next static-analysis / refactor pass from
 * regressing the keyboard UX without us noticing. Per-key specs in
 * `keyboard-navigation.spec.ts` and `keyboard-shortcuts.spec.ts` cover
 * individual bindings; this spec is the integration safety net.
 *
 * History: added 2026-05-28 after an 8-hour automated Council refactor pass
 * touched `setMessagesAndPinSelection` in `KeyboardNavigationContext.tsx`.
 * The unit + per-key tests all passed, but only a live walk of the four
 * surfaces could confirm the load-bearing Issue #2 invariant (selection
 * follows message UUID across a visible-list size change) held end-to-end.
 *
 * The same live walk also surfaced a pre-existing a11y bug
 * (`KeyboardHelpModal.tsx` missing DialogDescription → Radix console warning)
 * which the per-key tests already encoded as a failure. This smoke spec
 * pins the fixed shape so a future regression on either side bites first.
 */

const C = '00000000-0000-0000-0000-0000000000s1'

const summary = makeSummary({
  uuid: C,
  name: 'Smoke-test fixture',
  source: 'CLAUDE_CODE',
  message_count: 5,
  human_message_count: 3,
  project_path: '/tmp/proj',
  project_name: 'proj',
})

// Build a conversation where tool-only messages exist so toggling
// "Show tools" actually changes the visible-list size. This is the
// Issue #2 reproducer surface; same shape as selection-stable.spec.ts
// but standalone so the smoke walk is self-contained.
const messages: Message[] = [
  makeMessage({
    uuid: 'smoke-h1',
    sender: 'human',
    text: 'Question A',
    content: [{ type: 'text', text: 'Question A' }],
  }),
  // Tool-only assistant message — visible only when Tools=on.
  makeMessage({
    uuid: 'smoke-tool',
    sender: 'assistant',
    text: '',
    content: [
      { type: 'tool_use', name: 'read_file', input: { path: '/tmp/x' } },
      { type: 'tool_result', content: [{ type: 'text', text: 'tool result body' }] },
    ],
    parent_message_uuid: 'smoke-h1',
  } as Partial<Message> & { uuid: string }),
  makeMessage({
    uuid: 'smoke-a1',
    sender: 'assistant',
    text: 'Answer A',
    content: [{ type: 'text', text: 'Answer A' }],
    parent_message_uuid: 'smoke-tool',
  }),
  makeMessage({
    uuid: 'smoke-h2',
    sender: 'human',
    text: 'Question B',
    content: [{ type: 'text', text: 'Question B' }],
    parent_message_uuid: 'smoke-a1',
  }),
  makeMessage({
    uuid: 'smoke-a2',
    sender: 'assistant',
    text: 'Answer B',
    content: [{ type: 'text', text: 'Answer B' }],
    parent_message_uuid: 'smoke-h2',
  }),
]

const detail = makeDetail(summary, messages)

/** Selection ring on a message bubble. Inner content wrapper carries
 * `ring-offset-2`; outer parent carries `data-message-uuid`. The OUTER
 * conversation pane uses `ring-blue-500/50` when focusArea === 'detail'
 * (no ring-offset-2), which we ignore here. */
async function selectedMessageUuid(
  page: import('@playwright/test').Page,
): Promise<string | null> {
  const handle = await page.evaluateHandle(() => {
    const candidates = Array.from(document.querySelectorAll('.ring-offset-2'))
    for (const el of candidates) {
      const wrapper = el.closest('[data-message-uuid]')
      if (wrapper) return wrapper.getAttribute('data-message-uuid')
    }
    return null
  })
  const value = (await handle.jsonValue()) as string | null
  await handle.dispose()
  return value
}

test.describe('Keyboard nav integration smoke (2026-05-28)', () => {
  test('all four surfaces respond to their canonical Emacs bindings without console errors or warnings', async ({
    page,
    mockBackend,
  }) => {
    // Force Emacs mode (default), but pin it so a leaked localStorage from
    // a sibling test can't flip us into Vim.
    await withNetRetry(() => page.goto('/'))
    await page.evaluate(() =>
      localStorage.setItem('keyboardMode', JSON.stringify('emacs')),
    )
    await withNetRetry(() => page.reload())

    await mockBackend({ conversations: [summary], details: { [C]: detail } })

    // ─── Surface 1: Sidebar ─────────────────────────────────────────────
    // Load the conversations index so the keyboard-selected sidebar row
    // index is 0 and no detail pane is open.
    await withNetRetry(() => page.goto('/conversations'))
    await expect(page.getByText('Smoke-test fixture')).toBeVisible()

    // Enter from the list opens the conversation and sets focusArea=detail
    // with selectedMessageIndex=0 (first message gets the bubble ring).
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(new RegExp(`/conversations/${C}`))
    await expect(page.locator('[data-message-uuid="smoke-h1"]')).toBeVisible()
    await expect.poll(() => selectedMessageUuid(page)).toBe('smoke-h1')

    // Esc returns focusArea to list; the bubble selection ring clears.
    await page.keyboard.press('Escape')
    await expect.poll(() => selectedMessageUuid(page)).toBeNull()

    // Help modal (the bug we just fixed: a11y warning on missing
    // DialogDescription). Asserting visible + closable + zero console
    // warnings (the auto-fixture handles the warning side).
    await page.keyboard.press('?')
    await expect(page.getByText('Keyboard Shortcuts')).toBeVisible()
    // Radix wires aria-describedby to a non-empty id when the
    // DialogDescription child is present.
    const describedBy = await page
      .locator('[role="dialog"]')
      .getAttribute('aria-describedby')
    expect(describedBy, 'Dialog must have aria-describedby for a11y').toBeTruthy()
    await page.keyboard.press('Escape')
    await expect(page.getByText('Keyboard Shortcuts')).not.toBeVisible()

    // ─── Surface 2: Detail pane (Emacs Ctrl+N / Ctrl+P / u / a) ─────────
    // Re-enter detail via Enter, then walk message-level navigation.
    await page.keyboard.press('Enter')
    await expect.poll(() => selectedMessageUuid(page)).toBe('smoke-h1')

    // Ctrl+N → next visible message. With Tools=off the visible list is
    // [smoke-h1, smoke-a1, smoke-h2, smoke-a2]; smoke-tool is hidden.
    await page.keyboard.press('Control+n')
    await expect.poll(() => selectedMessageUuid(page)).toBe('smoke-a1')

    await page.keyboard.press('Control+p')
    await expect.poll(() => selectedMessageUuid(page)).toBe('smoke-h1')

    // 'u' (next user) from smoke-h1 → smoke-h2.
    await page.keyboard.press('u')
    await expect.poll(() => selectedMessageUuid(page)).toBe('smoke-h2')

    // 'a' (next assistant) from smoke-h2 → smoke-a2 (smoke-a1 is BEFORE
    // smoke-h2, so the next assistant after it is smoke-a2).
    await page.keyboard.press('a')
    await expect.poll(() => selectedMessageUuid(page)).toBe('smoke-a2')

    // 'U' (prev user) from smoke-a2 → smoke-h2.
    await page.keyboard.press('Shift+U')
    await expect.poll(() => selectedMessageUuid(page)).toBe('smoke-h2')

    // 'A' (prev assistant) from smoke-h2 → smoke-a1.
    await page.keyboard.press('Shift+A')
    await expect.poll(() => selectedMessageUuid(page)).toBe('smoke-a1')

    // ─── Surface 3: Search (Cmd+K / Cmd+F / Esc) ────────────────────────
    // Open the SearchPanel with Cmd+K — input should be focused.
    await page.keyboard.press('Meta+k')
    const searchInput = page.locator('input[placeholder="Search messages..."]')
    await expect(searchInput).toBeFocused()
    const searchAside = page.locator('aside[aria-label="Search panel"]')
    await expect(searchAside).toHaveAttribute('aria-hidden', 'false')

    // Move focus out (click the detail pane) then Cmd+F brings it back —
    // the 2026-05-03 finding the article calls out.
    await page.locator('[data-message-uuid="smoke-a1"]').click()
    await expect(searchInput).not.toBeFocused()
    await page.keyboard.press('Meta+f')
    await expect(searchInput).toBeFocused()

    // Esc closes the panel (manual finding 2026-05-04).
    await page.keyboard.press('Escape')
    await expect(searchAside).toHaveAttribute('aria-hidden', 'true')

    // ─── Surface 4: Issue #2 — Tools toggle preserves selected UUID ─────
    // This is THE load-bearing scenario for the Council's refactor of
    // `setMessagesAndPinSelection` in KeyboardNavigationContext. The
    // selected message UUID must stay anchored across a visible-list
    // size change in BOTH directions. selection-stable.spec.ts has the
    // detailed per-direction test; this smoke just confirms the round
    // trip on a message the user clicked themselves (the real-world
    // path the live smoke surfaced).
    await page.locator('[data-message-uuid="smoke-a1"]').click()
    await expect.poll(() => selectedMessageUuid(page)).toBe('smoke-a1')

    // Tools ON: list grows by one (smoke-tool becomes visible between
    // smoke-h1 and smoke-a1). Ring stays on smoke-a1.
    const toolsCheckbox = page.getByTestId('header-show-tools-checkbox')
    await toolsCheckbox.check()
    await expect(page.locator('[data-message-uuid="smoke-tool"]')).toBeVisible()
    await expect.poll(() => selectedMessageUuid(page)).toBe('smoke-a1')

    // Tools OFF: list shrinks back. Ring still on smoke-a1.
    await toolsCheckbox.uncheck()
    await expect(page.locator('[data-message-uuid="smoke-tool"]')).toHaveCount(0)
    await expect.poll(() => selectedMessageUuid(page)).toBe('smoke-a1')
  })
})
