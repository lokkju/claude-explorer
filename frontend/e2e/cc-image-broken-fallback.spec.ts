import { test, expect, makeSummary, makeMessage, makeDetail, type Page, type Route } from './fixtures'
import type { Message } from '../src/lib/types'

/**
 * Manual finding 2026-05-04: when a Claude Code image referenced in a
 * `[Image: source: <abs-path>]` marker no longer exists on disk
 * (eviction, session rotation, manual cleanup), the backend correctly
 * 404s but the bubble shows the browser's default broken-image glyph
 * (small gray square + filename). That looks like a bug in the app.
 *
 * Desired: render a friendly fallback (ImageOff icon + filename in a
 * dashed-border tile) the same way MessageAttachments does for missing
 * Desktop attachments. Same fix needed for InlineImageBlock (CC base64
 * inline images that fail to decode).
 *
 * RED before fix.
 */

const C = '00000000-0000-0000-0000-0000000000e0'

const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

async function mockCcImage404(page: Page) {
  await page.route('**/api/cc-image**', (route: Route) => {
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'image not found' }),
    })
  })
}

const summary = makeSummary({
  uuid: C,
  source: 'CLAUDE_CODE',
  message_count: 1,
  project_path: '/fixture/project',
  project_name: 'project',
})

test.describe('CC image broken-image fallback (manual finding 2026-05-04)', () => {
  test('CcImageMarkerText shows friendly fallback when /api/cc-image 404s', async ({ page, mockBackend }) => {
    const m = makeMessage({
      uuid: 'msg-marker',
      sender: 'human',
      text: 'has a missing image marker',
      content: [
        {
          type: 'text',
          text: 'before [Image: source: /Users/rpeck/.claude/image-cache/abc/14.png] after',
        },
      ],
    } as Partial<Message> & { uuid: string })
    const detail = makeDetail(summary, [m])
    await mockBackend({ conversations: [summary], details: { [C]: detail } })
    await mockCcImage404(page)

    await page.goto(`/conversations/${C}`)

    const tile = page.locator('[data-cc-image-marker]').first()
    await expect(tile).toBeVisible({ timeout: 5000 })

    // Wait for the <img> to error (network 404 has been mocked).
    // Friendly fallback: the same button gains data-cc-image-broken
    // and shows an ImageOff icon + filename instead of the <img>.
    const fallback = page.locator('[data-cc-image-marker][data-cc-image-broken]').first()
    await expect(fallback).toBeVisible({ timeout: 5000 })
    await expect(fallback).toContainText('14.png')

    // The broken-glyph <img> must not be visible.
    await expect(fallback.locator('img')).toHaveCount(0)
  })

  test('InlineImageBlock shows friendly fallback when image url 404s', async ({ page, mockBackend }) => {
    const m = makeMessage({
      uuid: 'msg-inline',
      sender: 'human',
      text: 'inline image with broken url',
      content: [
        { type: 'text', text: 'before' },
        // url-source pointing at a path that 404s.
        { type: 'image', source: { type: 'url', url: '/api/cc-image?path=/missing-inline.png' } },
        { type: 'text', text: 'after' },
      ],
    } as Partial<Message> & { uuid: string })
    const detail = makeDetail(summary, [m])
    await mockBackend({ conversations: [summary], details: { [C]: detail } })
    await mockCcImage404(page)

    await page.goto(`/conversations/${C}`)

    const tile = page.locator('[data-content-image]').first()
    await expect(tile).toBeVisible({ timeout: 5000 })
    const fallback = page.locator('[data-content-image][data-content-image-broken]').first()
    await expect(fallback).toBeVisible({ timeout: 5000 })
    await expect(fallback.locator('img')).toHaveCount(0)
  })

  test('<img> auto-retries once via cache-busting URL before showing fallback tile', async ({
    page,
    mockBackend,
  }) => {
    const m = makeMessage({
      uuid: 'cc-marker-retry',
      sender: 'human',
      text: 'image marker that 404s once then succeeds',
      content: [
        {
          type: 'text',
          text: 'before [Image: source: /Users/rpeck/.claude/image-cache/sess/1.png] after',
        },
      ],
    } as Partial<Message> & { uuid: string })
    const detail = makeDetail(summary, [m])
    await mockBackend({ conversations: [summary], details: { [C]: detail } })

    // First request 404s; second request (with cache-buster) returns 200
    // with valid PNG bytes. P4d spec: the tile retries silently before
    // giving up, so the user never sees the broken-image fallback.
    let calls = 0
    const tinyPng = Buffer.from(TINY_PNG_B64, 'base64')
    await page.route('**/api/cc-image**', (route: Route) => {
      calls += 1
      if (calls === 1) {
        route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'missing' }),
        })
      } else {
        route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: tinyPng,
        })
      }
    })

    await page.goto(`/conversations/${C}`)

    const tile = page.locator('[data-cc-image-marker]').first()
    await expect(tile).toBeVisible({ timeout: 5000 })
    await expect(tile.locator('img')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('[data-cc-image-marker][data-cc-image-broken]')).toHaveCount(0)
    expect(calls).toBeGreaterThanOrEqual(2)
  })
})
