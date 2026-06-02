import { test, expect, makeSummary, makeMessage, makeDetail, withNetRetry } from './fixtures'
import type { Message } from '../src/lib/types'

/**
 * P2 (manual finding 2026-05-04): user pinned a real conversation,
 * opened SearchPanel, but the chip was not visible. The existing
 * `search-pin-scope.spec.ts` test passes — but it doesn't exercise the
 * URL-only / pre-loaded pin path AND it doesn't exercise the
 * persisted-rightPaneTab path. Both surface real-mode regressions.
 *
 * We deliberately do NOT mock the SearchPinContext. The conversation
 * list is mocked so the page loads quickly, but the pin state itself
 * comes from the real `SearchPinProvider` reading the URL.
 */

const PINNED = '00000000-0000-0000-0000-0000abcdef01'
const OTHER = '00000000-0000-0000-0000-0000abcdef02'

const summaries = [
  makeSummary({
    uuid: PINNED,
    name: 'Pinned conversation for chip test',
    source: 'CLAUDE_CODE',
    project_path: '/work/realmode',
    project_name: 'realmode',
  }),
  makeSummary({
    uuid: OTHER,
    name: 'Other conversation',
    source: 'CLAUDE_CODE',
    project_path: '/work/realmode',
    project_name: 'realmode',
  }),
]

function detailFor(uuid: string, name: string, projectPath: string) {
  const m = makeMessage({
    uuid: `${uuid}-m1`,
    sender: 'human',
    text: 'hello world',
    content: [{ type: 'text', text: 'hello world' }],
  } as Partial<Message> & { uuid: string })
  return makeDetail(
    makeSummary({
      uuid,
      name,
      source: 'CLAUDE_CODE',
      project_path: projectPath,
      project_name: projectPath.split('/').pop(),
    }),
    [m],
  )
}

const details = {
  [PINNED]: detailFor(PINNED, 'Pinned conversation for chip test', '/work/realmode'),
  [OTHER]: detailFor(OTHER, 'Other conversation', '/work/realmode'),
}

// Wait for the SearchPanel slide-in CSS transition to finish so the
// chip's bounding box reflects its final on-screen position rather
// than a mid-animation snapshot.
//
// F6 audit: the previous implementation slept 350ms unconditionally.
// Replace with a deterministic `transitionend` listener — fires the
// moment the slide-in commits, never races a slow CI tick, and never
// sleeps longer than the actual transition. A hard timeout absorbs the
// edge case where the browser elides transitionend (e.g. panel was
// already at final position when we attached).
async function waitForPanelSettled(page: import('@playwright/test').Page) {
  const aside = page.locator('aside[aria-label="Search panel"]')
  await aside.waitFor({ state: 'visible' })
  await aside.evaluate((el) => {
    const target = el as HTMLElement
    const style = window.getComputedStyle(target)
    const duration = parseFloat(style.transitionDuration) || 0
    if (duration === 0) {
      return new Promise<void>((r) => requestAnimationFrame(() => r()))
    }
    return new Promise<void>((resolve) => {
      let done = false
      const settle = () => {
        if (done) return
        done = true
        target.removeEventListener('transitionend', settle)
        resolve()
      }
      target.addEventListener('transitionend', settle, { once: true })
      // Hard fallback: max of either 350ms (the previous floor) or the
      // computed transition duration + a small grace.
      setTimeout(settle, Math.max(350, duration * 1000 + 50))
    })
  })
  // rAF flush so layout commits before callers measure boundingBox.
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => r())),
  )
}

test.describe('Search pin scope chip — real-mode provider tree (P2 2026-05-04)', () => {
  test('Scope chip visible in real provider tree', async ({ page, mockBackend }) => {
    await mockBackend({ conversations: summaries, details })

    // Pre-load URL with ?pin=conv:<uuid>. The real SearchPinProvider
    // reads this synchronously via useState(() => readScopeFromUrl()).
    await withNetRetry(() => page.goto(`/conversations/${PINNED}?pin=conv:${PINNED}`))

    // Wait for the conversation page to settle. The pin button is a
    // good proxy because it depends on the same provider tree.
    await expect(page.getByTestId('pin-scope-button')).toBeVisible({ timeout: 5000 })

    // Open SearchPanel via Cmd+F (macOS) / Ctrl+F (other).
    const isMac = process.platform === 'darwin'
    await page.keyboard.press(isMac ? 'Meta+f' : 'Control+f')
    await waitForPanelSettled(page)

    const chip = page.getByTestId('search-scope-chip')
    await expect(chip).toBeVisible({ timeout: 3000 })

    // Bounding box must be non-zero AND on-screen — `toBeVisible` only
    // checks visibility CSS + non-empty content, not actual rendered
    // size or position.
    const box = await chip.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.width).toBeGreaterThan(0)
    expect(box!.height).toBeGreaterThan(0)
  })

  test('Scope chip visible at narrow viewport', async ({ page, mockBackend }) => {
    await mockBackend({ conversations: summaries, details })

    // Set narrow viewport BEFORE navigating, so the layout commits at
    // the narrow size from the first paint.
    await page.setViewportSize({ width: 600, height: 800 })

    await withNetRetry(() => page.goto(`/conversations/${PINNED}?pin=conv:${PINNED}`))

    await expect(page.getByTestId('pin-scope-button')).toBeVisible({ timeout: 5000 })

    const isMac = process.platform === 'darwin'
    await page.keyboard.press(isMac ? 'Meta+f' : 'Control+f')
    await waitForPanelSettled(page)

    const chip = page.getByTestId('search-scope-chip')
    await expect(chip).toBeVisible({ timeout: 3000 })

    const box = await chip.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.width).toBeGreaterThan(0)
    expect(box!.height).toBeGreaterThan(0)

    // Chip must lie fully inside the viewport.
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(600)
  })

  test('Scope chip visible even when right pane defaults to Bookmarks tab', async ({ page, mockBackend }) => {
    await mockBackend({ conversations: summaries, details })

    // Persisted user preference: last-used right-pane tab was Bookmarks.
    // This is the actual real-mode regression — the chip lives inside
    // the `{rightPaneTab === 'search' && (...)}` block, so it never
    // renders for users whose persisted tab is bookmarks. The chip
    // represents pin state (a global concern) and should be visible
    // whichever tab is active.
    await page.addInitScript(() => {
      localStorage.setItem('rightPaneTab', JSON.stringify('bookmarks'))
    })

    await withNetRetry(() => page.goto(`/conversations/${PINNED}?pin=conv:${PINNED}`))
    await expect(page.getByTestId('pin-scope-button')).toBeVisible({ timeout: 5000 })

    const isMac = process.platform === 'darwin'
    await page.keyboard.press(isMac ? 'Meta+f' : 'Control+f')
    await waitForPanelSettled(page)

    const chip = page.getByTestId('search-scope-chip')
    await expect(chip).toBeVisible({ timeout: 3000 })

    const box = await chip.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.width).toBeGreaterThan(0)
    expect(box!.height).toBeGreaterThan(0)
  })
})
