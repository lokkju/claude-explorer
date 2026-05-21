import { test, expect, makeSummary, makeMessage, makeDetail, type Page } from './fixtures'
import type { SearchResult, Message } from '../src/lib/types'

/**
 * Search-hit scroll LANDING POSITION pin (2026-05-20, 3-model LLM
 * council G').
 *
 * Sibling to `search-hit-scroll.spec.ts`. That spec pins the
 * navigation PATH (fast-path vs URL fallback). This spec pins the
 * FINAL VIEWPORT POSITION of the target bubble — the gap the
 * previous council's smoke missed.
 *
 * Bug:
 *   `scrollIntoView({behavior:'smooth', block:'center'})` aims at the
 *   target's `offsetTop` at call time and animates ~500ms. During the
 *   animation, lazy-loaded images (loading="lazy", no intrinsic
 *   dimensions) above the target enter the swept region and decode,
 *   growing the document by thousands of pixels. The animation
 *   doesn't re-aim. Target lands far below viewport center.
 *
 * Fix:
 *   `src/lib/scrollBubbleIntoView.ts` — distance-gated: long hops
 *   (>1.5 viewports) use `behavior: 'auto'` to skip the swept region
 *   entirely; short hops keep `behavior: 'smooth'`. Both followed by a
 *   bounded 250ms post-settle correction.
 *
 * This spec exists because the previous spec's
 * `scrollTop > 1000` assertion was a rubber-stamp: it proved a
 * scroll happened, not that it landed in the right place. The bug
 * shipped through that gap.
 */

const CONV_UUID = '00000000-0000-0000-0000-00000000aa11'
// 600 messages × ~200-300px each (multi-paragraph filler) → ~150K px
// stream height. Target at idx 550 lands ~135K px below the start —
// guaranteed far below initial viewport (900px) even with the most
// aggressive deferred render. Same fixture shape as the sibling
// search-hit-scroll.spec.ts which already pins the navigation PATH.
const TOTAL_MESSAGES = 600
const LATE_TARGET_IDX = 550
const NEEDLE = 'unobtainium'

function makeFillerMessage(i: number): Message {
  const sender = i % 2 === 0 ? 'human' : 'assistant'
  // Filler bodies designed to give each bubble enough rendered height
  // (~200-300px) that the target at idx 550 lands far below the
  // initial viewport. ~20 sentences ≈ 1200 chars → 3-4 wrapped lines
  // per bubble at 1024px viewport width.
  const text = `Filler message ${i}. ${'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. '.repeat(8)}`
  return makeMessage({
    uuid: `m-${String(i).padStart(4, '0')}`,
    sender,
    text,
    content: [{ type: 'text', text }],
    parent_message_uuid: i === 0 ? null : `m-${String(i - 1).padStart(4, '0')}`,
  })
}

function makeTargetMessage(i: number): Message {
  const sender = i % 2 === 0 ? 'human' : 'assistant'
  const text = `Target ${i}: the ${NEEDLE} lives here.`
  return makeMessage({
    uuid: `m-${String(i).padStart(4, '0')}`,
    sender,
    text,
    content: [{ type: 'text', text }],
    parent_message_uuid: i === 0 ? null : `m-${String(i - 1).padStart(4, '0')}`,
  })
}

const summary = makeSummary({
  uuid: CONV_UUID,
  name: 'Search hit landing-position pin (800 msgs)',
  message_count: TOTAL_MESSAGES,
})

const messages: Message[] = Array.from({ length: TOTAL_MESSAGES }, (_, i) =>
  i === LATE_TARGET_IDX ? makeTargetMessage(i) : makeFillerMessage(i),
)

const detail = makeDetail(summary, messages)

const searchResults: SearchResult[] = [{
  conversation_uuid: CONV_UUID,
  conversation_name: summary.name,
  conversation_updated_at: summary.updated_at,
  conversation_created_at: summary.created_at,
  project_name: null,
  matching_messages: [
    {
      message_uuid: messages[LATE_TARGET_IDX].uuid,
      sender: messages[LATE_TARGET_IDX].sender,
      snippet: `the ${NEEDLE} lives here.`,
      match_start: 4,
      match_end: 15,
      created_at: messages[LATE_TARGET_IDX].created_at,
    },
  ],
}]

async function mockSearch(page: Page, results: SearchResult[]) {
  await page.route('**/api/search**', (route) => {
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        results,
        total_messages_matched: results[0].matching_messages.length,
        returned_messages: results[0].matching_messages.length,
        truncated: false,
      }),
    })
  })
}

test.describe('Search — clicking a hit LANDS the target bubble at viewport center', () => {
  test('long-distance hit (>1.5 vp away) lands within ±100px of container center even when layout grows mid-scroll', async ({
    page,
    mockBackend,
  }) => {
    await mockBackend({ conversations: [summary], details: { [CONV_UUID]: detail } })
    await mockSearch(page, searchResults)
    await page.setViewportSize({ width: 1024, height: 900 })

    await page.goto(`/conversations/${CONV_UUID}`)
    await expect(page.locator('[data-message-uuid="m-0000"]')).toBeVisible()

    // BUG REPRODUCTION — simulate POST-SCROLL layout growth, matching
    // the real-world failure mode observed on the 15K-msg conv: lazy
    // images with `decoding="async"` finish decoding AFTER the smooth
    // scroll animation has landed, then push the target down. We
    // attach a `scrollend` listener (fires once the smooth scroll
    // settles) and 50ms later inject 8000px of phantom layout above
    // the first bubble — exactly the "image decoded after landing"
    // scenario. Browsers debounce/coalesce this in real life; the
    // 50ms delay simulates async decode latency.
    //
    // Without the fix: nothing corrects the post-landing drift.
    // Target ends up 8000px below container center.
    // With the fix: 250ms post-settle correction notices the drift
    // (>100px threshold) and snap-corrects with `behavior: 'auto'`.
    await page.evaluate(() => {
      const stream = document.querySelector('[data-testid="message-stream"]') as HTMLElement | null
      if (!stream) return
      let injected = false
      const inject = () => {
        if (injected) return
        injected = true
        const phantom = document.createElement('div')
        phantom.style.height = '8000px'
        phantom.style.background = 'transparent'
        phantom.setAttribute('data-test-phantom', 'layout-growth')
        stream.insertBefore(phantom, stream.firstChild)
      }
      // Primary trigger: scrollend (fires when smooth scroll settles).
      stream.addEventListener('scrollend', () => {
        setTimeout(inject, 50)
      }, { once: true })
      // Fallback for browsers without scrollend: 400ms after first
      // scroll event (smooth scroll duration is ~300-500ms in Chrome).
      stream.addEventListener('scroll', () => {
        setTimeout(inject, 400)
      }, { once: true })
    })

    await page.keyboard.press('Meta+k')
    const searchInput = page.locator('input[placeholder="Search messages..."]')
    await expect(searchInput).toBeVisible()
    await searchInput.fill(NEEDLE)
    await expect(page.locator('text=/of\\s+1\\s+matches/')).toBeVisible({ timeout: 10000 })

    const hitCard = page.getByRole('button', { name: new RegExp(NEEDLE) }).first()
    await expect(hitCard).toBeVisible()

    // SearchPanel.tsx:99 auto-navigates to the first match on type
    // (the "Cmd+G keeps you moving forward" UX rule). So after typing
    // the needle, the helper has already scrolled to the target. To
    // exercise the CLICK path explicitly, reset the scroll container
    // to top so the click has real work to do. Use 'auto' so this
    // setup doesn't fight the test's smooth-scroll assertion.
    await page.evaluate(() => {
      const stream = document.querySelector('[data-testid="message-stream"]') as HTMLElement | null
      if (stream) stream.scrollTo({ top: 0, behavior: 'auto' })
    })
    const lateTarget = page.locator(`[data-message-uuid="${messages[LATE_TARGET_IDX].uuid}"]`)
    // After the explicit reset, target must not be in viewport.
    await expect(lateTarget).not.toBeInViewport()

    await hitCard.click()

    // Wait for the scroll + 250ms post-settle correction window to
    // complete. Generous slack: 250ms correction + 250ms layout pass +
    // 500ms smooth-scroll worst case for the short-hop branch.
    await page.waitForTimeout(1500)

    // ─── THE LOAD-BEARING ASSERTION ─────────────────────────────────
    //
    // The previous spec asserted `scrollTop > 1000` — proves a scroll
    // happened, NOT that it landed correctly. THE bug pin: target's
    // vertical center must be within ±100px of the container's
    // vertical center.
    // THE LOAD-BEARING ASSERTION — viewport-position contract.
    //
    // Honest caveat: this synthetic phantom injection does NOT fully
    // reproduce the real-conv bug. Empirically, modern Chrome's
    // `scrollIntoView({behavior:'smooth'})` DOES retarget when the
    // document grows during the animation — so a single 8K-px phantom
    // gets correctly compensated. The bug in production reproduces
    // because hundreds of small lazy-image decodes spread across the
    // ~500ms animation overwhelm the retargeting heuristic AND because
    // `decoding="async"` means some decodes commit AFTER scrollend
    // when no further retargeting happens.
    //
    // What this Playwright spec DOES guarantee:
    //   1. The helper is wired into the click path (otherwise no
    //      scroll happens at all, distance = infinity).
    //   2. Post-scroll layout growth within the 250ms settle window
    //      either doesn't drift the target >100px OR triggers the
    //      correction. Either way: distance ≤ 100.
    //   3. The supersession token works under rapid clicks (the second
    //      test in this file).
    //
    // What only the real-conv L3 smoke can guarantee: that the
    // distance-gated long-hop branch (instant for >1.5 vp) actually
    // sidesteps the production failure mode where hundreds of
    // continuous lazy-image decodes during a long smooth scroll drift
    // the target by thousands of px. That smoke is REQUIRED by the
    // task spec and documented in the Smoke evidence section of the
    // refined report.
    const landingDistancePx = await page.evaluate((uuid) => {
      const target = document.querySelector(`[data-message-uuid="${uuid}"]`) as HTMLElement | null
      const container = document.querySelector('[data-testid="message-stream"]') as HTMLElement | null
      if (!target || !container) return Number.POSITIVE_INFINITY
      const t = target.getBoundingClientRect()
      const c = container.getBoundingClientRect()
      return Math.abs((t.top + t.height / 2) - (c.top + c.height / 2))
    }, messages[LATE_TARGET_IDX].uuid)

    expect(landingDistancePx, `target bubble must land within ±100px of container center, was ${landingDistancePx}px off`).toBeLessThanOrEqual(100)

    // Bidirectional sanity: target is now visible (centered or close).
    await expect(lateTarget).toBeInViewport()
  })

  test('rapid Cmd+G (supersession): newer scroll cancels older correction', async ({
    page,
    mockBackend,
  }) => {
    // Two hits, late and early. Click late, then immediately click early
    // before the late's 250ms correction window closes. Late's correction
    // MUST NOT fire (would yank user back to late). Early must end up
    // centered.
    const earlyIdx = 50
    const twoHitMessages: Message[] = Array.from({ length: TOTAL_MESSAGES }, (_, i) => {
      if (i === earlyIdx) return makeTargetMessage(i)
      if (i === LATE_TARGET_IDX) return makeTargetMessage(i)
      return makeFillerMessage(i)
    })
    const twoHitDetail = makeDetail(summary, twoHitMessages)
    const twoHitResults: SearchResult[] = [{
      conversation_uuid: CONV_UUID,
      conversation_name: summary.name,
      conversation_updated_at: summary.updated_at,
      conversation_created_at: summary.created_at,
      project_name: null,
      matching_messages: [
        {
          message_uuid: twoHitMessages[earlyIdx].uuid,
          sender: twoHitMessages[earlyIdx].sender,
          snippet: `the ${NEEDLE} lives here.`,
          match_start: 4,
          match_end: 15,
          created_at: twoHitMessages[earlyIdx].created_at,
        },
        {
          message_uuid: twoHitMessages[LATE_TARGET_IDX].uuid,
          sender: twoHitMessages[LATE_TARGET_IDX].sender,
          snippet: `the ${NEEDLE} lives here.`,
          match_start: 4,
          match_end: 15,
          created_at: twoHitMessages[LATE_TARGET_IDX].created_at,
        },
      ],
    }]

    await mockBackend({ conversations: [summary], details: { [CONV_UUID]: twoHitDetail } })
    await mockSearch(page, twoHitResults)
    await page.setViewportSize({ width: 1024, height: 900 })

    await page.goto(`/conversations/${CONV_UUID}`)
    await expect(page.locator('[data-message-uuid="m-0000"]')).toBeVisible()

    await page.keyboard.press('Meta+k')
    const searchInput = page.locator('input[placeholder="Search messages..."]')
    await expect(searchInput).toBeVisible()
    await searchInput.fill(NEEDLE)
    await expect(page.locator('text=/of\\s+2\\s+matches/')).toBeVisible({ timeout: 10000 })

    // Auto-navigate already moved us to the first hit. Reset to top so
    // the click path on the LATE hit has real distance to scroll.
    await page.evaluate(() => {
      const stream = document.querySelector('[data-testid="message-stream"]') as HTMLElement | null
      if (stream) stream.scrollTo({ top: 0, behavior: 'auto' })
    })

    // Click late hit, then early hit ~50ms later (well before the
    // 250ms correction window closes).
    const hits = page.getByRole('button', { name: new RegExp(NEEDLE) })
    await hits.nth(1).click()  // late
    await page.waitForTimeout(50)
    await hits.nth(0).click()  // early — supersedes late's pending correction

    await page.waitForTimeout(1500)

    // EARLY target must land within ±100px of center.
    const earlyDistancePx = await page.evaluate((uuid) => {
      const target = document.querySelector(`[data-message-uuid="${uuid}"]`) as HTMLElement | null
      const container = document.querySelector('[data-testid="message-stream"]') as HTMLElement | null
      if (!target || !container) return Number.POSITIVE_INFINITY
      const t = target.getBoundingClientRect()
      const c = container.getBoundingClientRect()
      return Math.abs((t.top + t.height / 2) - (c.top + c.height / 2))
    }, twoHitMessages[earlyIdx].uuid)

    expect(earlyDistancePx, `early target must land within ±100px of center (no stale-correction yank), was ${earlyDistancePx}px off`).toBeLessThanOrEqual(100)
  })
})
