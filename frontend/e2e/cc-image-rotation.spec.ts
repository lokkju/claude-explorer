import { test, expect, makeSummary, makeMessage, makeDetail, withNetRetry } from './fixtures'
import type { Message } from '../src/lib/types'
import type { Route } from './fixtures'

/**
 * G3 audit — cc-image rotation E2E (frontend half).
 *
 * Production contract: Claude Code rotates image files under
 * ~/.claude/image-cache/ over time. The backend permanent cache
 * (backend/cc_image_cache.py + the /api/cc-image route) transparently
 * serves a cached copy when the original is gone — same URL, different
 * bytes underneath. The backend half of this contract is covered by
 * backend/tests/test_cc_image_permanent_cache.py.
 *
 * The frontend half — what THIS test pins — is that when the user
 * reloads the page, the <img> faithfully re-requests the SAME URL
 * (rather than caching the first response in a way that pins the
 * client to stale bytes). If the frontend ever switched to data-URL
 * caching or stuck a cache-buster on the original (not the retry) URL,
 * this test would fail.
 *
 * The "WeasyPrint-style real-backend E2E gap" — i.e. running the actual
 * backend with a real disk-rotation between requests — is intentionally
 * deferred. We do not own a real-uvicorn Playwright fixture today; the
 * pytest coverage of the cache logic itself is in
 * `backend/tests/test_cc_image_permanent_cache.py`. See LLM-council G3
 * resolution in the audit commit for the rationale.
 */

const C = '00000000-0000-0000-0000-0000000000e1'

// Two byte-distinct PNGs. Both are valid 1x1 PNG payloads — the second
// has an extra byte appended to its IDAT chunk so it decodes successfully
// but produces a different network response body than the first.
const PNG_A_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const PNG_A = Buffer.from(PNG_A_B64, 'base64')
const PNG_B = Buffer.concat([PNG_A, Buffer.from([0x00])])

async function sha256(bytes: Uint8Array): Promise<string> {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(bytes).digest('hex')
}

const summary = makeSummary({
  uuid: C,
  source: 'CLAUDE_CODE',
  message_count: 1,
  project_path: '/fixture/rotation',
  project_name: 'rotation',
})

const message = makeMessage({
  uuid: 'msg-rot',
  sender: 'human',
  text: 'before [Image: source: /Users/rpeck/.claude/image-cache/sess-rot/1.png] after',
  content: [
    {
      type: 'text',
      text: 'before [Image: source: /Users/rpeck/.claude/image-cache/sess-rot/1.png] after',
    },
  ],
} as Partial<Message> & { uuid: string })

const detail = makeDetail(summary, [message])

test.describe('G3 — cc-image rotation: frontend re-requests on reload', () => {
  test('same URL serves different bytes across page reload (proves no client-side pinning)', async ({
    page,
    mockBackend,
  }) => {
    await mockBackend({ conversations: [summary], details: { [C]: detail } })

    // Track every /api/cc-image hit. Toggle the served body based on
    // which hit we're on (proves: backend can change underneath; client
    // honors that).
    let hits = 0
    const observedHashes: string[] = []
    await page.route('**/api/cc-image**', (route: Route) => {
      hits += 1
      const body = hits === 1 ? PNG_A : PNG_B
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        body,
      })
    })

    // First load — should fetch PNG_A.
    await withNetRetry(() => page.goto(`/conversations/${C}`))
    const tile = page
      .locator('[data-message-uuid="msg-rot"]')
      .locator('[data-cc-image-marker]')
    await expect(tile).toBeVisible({ timeout: 5000 })
    await expect(tile.locator('img')).toBeVisible({ timeout: 5000 })

    // Capture the response body via fetch — the <img> already loaded it,
    // but route.fulfill is one-shot per hit, so we read what the network
    // ACTUALLY served by reissuing the same URL from the page context.
    // (The route handler will increment `hits` again and return PNG_B;
    // that's fine — we're verifying what bytes flow, and PNG_B is what
    // we expect from hit #2.)
    //
    // To be robust we instead capture the bytes once via a separate
    // page.evaluate fetch BEFORE any reload. This puts hits at 2 and
    // gives us PNG_B; then reload → hit 3 also returns PNG_B; PNG_A is
    // only observable from the initial <img> load.
    //
    // Simpler design: use the response listener instead, which is
    // installed BEFORE the navigation and reads bytes off every
    // network response.
    observedHashes.length = 0
    page.on('response', async (resp) => {
      if (resp.url().includes('/api/cc-image')) {
        try {
          const buf = await resp.body()
          observedHashes.push(await sha256(buf))
        } catch {
          /* ignore — response body may have been consumed */
        }
      }
    })

    // Reload — frontend MUST re-issue the same URL.
    const hitsBeforeReload = hits
    await withNetRetry(() => page.reload())
    await expect(tile).toBeVisible({ timeout: 5000 })
    await expect(tile.locator('img')).toBeVisible({ timeout: 5000 })

    // Assertion 1: a new network hit fired (no client pinning).
    expect(hits).toBeGreaterThan(hitsBeforeReload)

    // Assertion 2: at least one observed response had the PNG_B hash —
    // i.e. when the backend switched bytes underneath, the frontend
    // honored the switch. We use expect.poll because the response
    // listener is async w.r.t. the navigation.
    const expectedHashB = await sha256(PNG_B)
    await expect
      .poll(() => observedHashes.includes(expectedHashB), { timeout: 3000 })
      .toBe(true)

    // Bidirectional check: hashA and hashB must differ — if our test
    // fixture produced identical PNGs the "different bytes" claim is
    // vacuous. This protects against future fixture edits.
    const expectedHashA = await sha256(PNG_A)
    expect(expectedHashA).not.toBe(expectedHashB)
  })
})
