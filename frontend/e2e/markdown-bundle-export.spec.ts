import { test, expect, makeSummary, makeMessage, makeDetail } from './fixtures'

/**
 * Issue #4 — Markdown export bundle (legacy Settings-page persistence).
 *
 * The Settings page exposes two controls — "Bundle images as a zip"
 * toggle and "Markdown dialect" radio — that originally drove which
 * endpoint the conversation header's Markdown button hit.
 *
 * Phase 7 moved the actual export-mode choice into a dialog
 * (`MarkdownExportDialog`); the Markdown button now opens that dialog
 * rather than reading these Settings values. The button → URL flow
 * is covered by `markdown-export-dialog.spec.ts`.
 *
 * The Settings-page controls themselves still exist (and persist via
 * `usePreferences`) so we keep this persistence-only smoke test as a
 * regression guard until the dead Settings UI is cleaned up.
 */

const ME = '00000000-0000-0000-0000-0000000000e7'

const summary = makeSummary({
  uuid: ME,
  name: 'Bundle export fixture',
  message_count: 1,
  source: 'CLAUDE_CODE',
})
const detail = makeDetail(summary, [
  makeMessage({ uuid: 'm1', sender: 'human', text: 'Hi', content: [{ type: 'text', text: 'Hi' }] }),
])

test.describe('Markdown bundle Settings persistence (Issue #4 legacy controls)', () => {
  test('Settings choices persist across reloads', async ({ page, mockBackend }) => {
    await mockBackend({ conversations: [summary], details: { [ME]: detail } })

    await page.goto('/settings')
    await page.getByTestId('settings-markdown-bundle-images').check()
    await page.getByLabel('Obsidian').check()

    // Reload the settings page; the toggle + radio must still be set.
    await page.reload()
    await expect(page.getByTestId('settings-markdown-bundle-images')).toBeChecked()
    await expect(page.getByLabel('Obsidian')).toBeChecked()
  })
})
