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
  // V1 polish: this test mutates a shared preferences blob via PATCH
  // /api/preferences. Under parallel workers other preference-touching
  // tests (filter migration, sidebar dim, etc.) can race the reload.
  // Force serial to absorb the cross-test bleed; --repeat-each=3 with
  // workers=2 was 0/3 green before this directive.
  test.describe.configure({ mode: 'serial' })

  test('Settings choices persist across reloads', async ({ page, mockBackend }) => {
    await mockBackend({ conversations: [summary], details: { [ME]: detail } })

    await page.goto('/settings')
    // Wait for the settings page to fully mount (the toggle exists +
    // is enabled) before interacting. Under parallel load, jumping
    // straight into .check() could race React hydration.
    const toggleLocator = page.getByTestId('settings-markdown-bundle-images')
    await expect(toggleLocator).toBeVisible()
    await expect(toggleLocator).toBeEnabled()

    // Toggle each control and wait for the PATCH /api/preferences round-trip
    // AND the React-state settle before reloading. Without these waits the
    // reload races the persistence layer and reads back stale values.
    // Use .click() rather than .check() because under parallel-worker load
    // .check()'s "did the state change" verification can race React's
    // re-render — .click() doesn't pre-verify, and we assert the state
    // explicitly after waitForResponse.
    const togglePatch = page.waitForResponse(
      (r) => r.url().endsWith('/api/preferences') && r.request().method() === 'PATCH',
    )
    await toggleLocator.click()
    await togglePatch
    await expect(toggleLocator).toBeChecked()

    const radioPatch = page.waitForResponse(
      (r) => r.url().endsWith('/api/preferences') && r.request().method() === 'PATCH',
    )
    // Radix UI radios are buttons with role="radio"+aria-checked, not native
    // <input type="radio">. Playwright's .check() looks for `checked`
    // property which Radix doesn't expose; .click() works regardless.
    await page.getByLabel('Obsidian').click()
    await radioPatch
    await expect(page.getByLabel('Obsidian')).toBeChecked()

    // Reload the settings page; the toggle + radio must still be set.
    await page.reload()
    await expect(page.getByTestId('settings-markdown-bundle-images')).toBeChecked()
    await expect(page.getByLabel('Obsidian')).toBeChecked()
  })
})
