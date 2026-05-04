import { test, expect, makeSummary } from './fixtures'

/**
 * Manual finding 2026-05-03 (Bug A): on FE reload against a real
 * backend (~2.3s /api/config response on a 660-conversation archive),
 * the ConnectionStatus modal cycles through several "retry attempts"
 * before settling, even when the backend is healthy.
 *
 * These tests reproduce by mocking /api/config with a moderate
 * delay, then asserting the retry-attempt UI never appears.
 */

test.describe('ConnectionStatus on reload (Bug A)', () => {
  test('does not show "Attempt N of 5" retry text when backend responds within reasonable time', async ({ page, mockBackend }) => {
    // Mock the backend with a 2.5s /api/config delay — matches the
    // user's actual production latency on a 660-conversation archive.
    // Well under the 5s AbortSignal.timeout. The retry counter must
    // never appear.
    await page.route('**/api/config', async (route) => {
      await new Promise((r) => setTimeout(r, 2500))
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ data_dir: '/tmp', conversation_count: 660 }),
      })
    })
    await mockBackend({ conversations: [makeSummary({ uuid: 'a', name: 'Conv A' })] })

    await page.goto('/')

    // The modal copy "Attempt N of 5" must never become visible.
    // Poll for 6 seconds (slightly past the 2.5s mock delay × 2 to
    // catch StrictMode double-fire); if it pops up at any point during
    // connect, this assertion fails.
    const retryText = page.getByText(/Attempt \d+ of \d+/i)
    const start = Date.now()
    while (Date.now() - start < 6000) {
      const count = await retryText.count()
      expect(count, `retry text was visible at +${Date.now() - start}ms`).toBe(0)
      await page.waitForTimeout(200)
    }

    // App content actually rendered.
    await expect(page.getByText('Claude Explorer')).toBeVisible()
  })

  test('app does not double-fire /api/config on initial mount (StrictMode safe)', async ({ page, mockBackend }) => {
    let configCalls = 0
    await page.route('**/api/config', async (route) => {
      configCalls += 1
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ data_dir: '/tmp', conversation_count: 0 }),
      })
    })
    await mockBackend({ conversations: [] })

    await page.goto('/')
    // Wait long enough for StrictMode double-mount + ConnectionStatus
    // initial check + at least one retry-window to elapse.
    await page.waitForTimeout(3000)

    // Strict mode in dev double-mounts; one /api/config from
    // ConnectionStatus + one from useConfig = at most 2 calls per mount,
    // so 4 total. A runaway retry loop would push this far higher.
    expect(configCalls).toBeLessThanOrEqual(4)
  })

  test('reproduces the cycling-retry bug when /api/config exceeds the 5s timeout', async ({ page, mockBackend }) => {
    // The original bug surfaced because ConnectionStatus's checkConnection
    // uses AbortSignal.timeout(5000), and the live backend's /api/config
    // endpoint walked the entire conversation directory (~2.2s per call).
    // With React StrictMode firing the effect twice and a parallel call
    // from useConfig, four sequential walks could blow past 5s and
    // trigger the retry counter even though the server is healthy.
    //
    // We reproduce by holding /api/config for 6 seconds (just past the
    // timeout). The retry counter MUST NOT appear — once the backend is
    // fixed to respond fast, this scenario doesn't happen, but the
    // ConnectionStatus + AbortSignal timing still needs to be tolerant
    // of any single slow call.
    await page.route('**/api/config', async (route) => {
      await new Promise((r) => setTimeout(r, 6000))
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ data_dir: '/tmp', conversation_count: 660 }),
      })
    })
    await mockBackend({ conversations: [] })

    await page.goto('/')
    // Watch for 7 seconds for any "Attempt N of 5" copy.
    const retryText = page.getByText(/Attempt \d+ of \d+/i)
    const start = Date.now()
    while (Date.now() - start < 7000) {
      const count = await retryText.count()
      expect(count, `retry text appeared at +${Date.now() - start}ms`).toBe(0)
      await page.waitForTimeout(250)
    }
  })
})
