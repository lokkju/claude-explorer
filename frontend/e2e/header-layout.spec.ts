import { test, expect, makeSummary, makeMessage, makeDetail, withNetRetry } from './fixtures'

/**
 * Header layout regression: at narrow-but-realistic widths (≤ 1366px,
 * the common 13" laptop), the cluster of action buttons on the right
 * (Tools, Expand, Re-download, Hide/Show compact markers, Copy as
 * Markdown, Markdown, PDF) must not overlap the conversation
 * metadata block on the left (UUID copy button, file_path copy
 * button).
 *
 * Manual repro 2026-05-01: at ~1366px the buttons wrap underneath the
 * metadata, occluding the UUID and file_path copy buttons (see
 * /Users/rpeck/.claude/image-cache/.../18.png).
 *
 * Pass condition: the bounding box of the rightmost button cluster
 * must not intersect the bounding box of the UUID copy button or
 * the file_path copy button at any of the tested widths.
 */

const HL = '00000000-0000-0000-0000-0000000000c3'

const summary = makeSummary({
  uuid: HL,
  name: 'Claude Desktop header layout fixture conversation with a long enough title to crowd the header',
  model: 'claude-opus-4-5-20251101',
  message_count: 1,
  human_message_count: 1,
  source: 'CLAUDE_CODE',
  project_path: '/Users/rpeck/Source/claude-desktop-message-exporter',
  project_name: 'claude-desktop-message-exporter',
})

const messages = [
  makeMessage({
    uuid: 'hl-m1',
    sender: 'human',
    text: 'Anything',
    content: [{ type: 'text', text: 'Anything' }],
  }),
]

const detail = makeDetail(summary, messages, {
  file_path: '/Users/rpeck/.claude/projects/-Users-rpeck-Source-claude-desktop-message-exporter/00000000-0000-0000-0000-0000000000c3.jsonl',
  compact_markers: [
    {
      message_uuid: 'hl-m1',
      summary_text: 'Tiny compact summary',
      timestamp: '2026-04-01T10:00:00Z',
      kind: 'auto',
      user_prompt: null,
    },
  ],
})

test.describe('Header layout — actions must not occlude metadata (Issue #3)', () => {
  // 1280, 1366, 1440 are the most common laptop widths. The bug shows
  // up clearly at 1280–1366; 1920 had no overlap, so we keep that as
  // a control case.
  for (const width of [1280, 1366, 1440] as const) {
    test(`buttons do not overlap UUID/file-path metadata at ${width}px`, async ({ page, mockBackend }) => {
      await page.setViewportSize({ width, height: 900 })
      await mockBackend({ conversations: [summary], details: { [HL]: detail } })
      await withNetRetry(() => page.goto(`/conversations/${HL}`))

      // Wait for the header to render. Scope to <header> from the
      // start: the sidebar ships its own <h1>Claude Explorer</h1>, so
      // an unscoped getByRole('heading', { level: 1 }) is a strict-mode
      // violation that blows up before any geometry assertion.
      const header = page.locator('header').first()
      await expect(header.getByRole('heading', { level: 1 })).toBeVisible()

      const uuidButton = page.getByTitle('Click to copy UUID')
      const filePathButton = page.getByTitle('Click to copy file path')
      await expect(uuidButton).toBeVisible()
      await expect(filePathButton).toBeVisible()

      // Metadata row that sits directly under the title: "Code" badge,
      // model badge, full date, message count, "View branches".
      // Scope to <header> so the sidebar's mini-card doesn't shadow.
      const codeBadge = header.getByText('Code', { exact: true })
      const modelBadge = header.getByText('claude-opus-4-5-20251101')
      const messageCount = header.getByText(/1 messages?/)
      await expect(codeBadge).toBeVisible()
      await expect(modelBadge).toBeVisible()

      // Pick a stable representative control from the right cluster.
      // 2026-05-25: Tools control converted from Button to
      // <label><input type="checkbox"></label>. The label wraps the icon
      // + visible "Show Tools" text and is the layout-meaningful unit,
      // so we boundingBox the label, not the 16×16 input.
      const toolsControl = page.getByTestId('header-show-tools-control')
      const markdownExportButton = page.getByRole('button', { name: 'Markdown', exact: true })
      const pdfExportButton = page.getByRole('button', { name: 'PDF', exact: true })
      await expect(toolsControl).toBeVisible()
      await expect(markdownExportButton).toBeVisible()
      await expect(pdfExportButton).toBeVisible()

      // Helper: rectangles A and B must not overlap.
      function intersects(
        a: { x: number; y: number; width: number; height: number },
        b: { x: number; y: number; width: number; height: number },
      ): boolean {
        return !(
          a.x + a.width <= b.x ||
          b.x + b.width <= a.x ||
          a.y + a.height <= b.y ||
          b.y + b.height <= a.y
        )
      }

      const metaBoxes = await Promise.all([
        codeBadge.boundingBox(),
        modelBadge.boundingBox(),
        messageCount.boundingBox(),
        uuidButton.boundingBox(),
        filePathButton.boundingBox(),
      ])
      const buttonBoxes = await Promise.all([
        toolsControl.boundingBox(),
        markdownExportButton.boundingBox(),
        pdfExportButton.boundingBox(),
      ])

      for (const m of metaBoxes) {
        if (!m) continue
        for (const btn of buttonBoxes) {
          if (!btn) continue
          expect(
            intersects(m, btn),
            `metadata box ${JSON.stringify(m)} overlaps button box ${JSON.stringify(btn)} at ${width}px`,
          ).toBe(false)
        }
      }
    })
  }
})
