/**
 * Phase 7 — Markdown export dialog.
 *
 * The Markdown button in the conversation header opens a dialog with
 * three modes:
 *
 *   - Inline: GET /api/conversations/<uuid>/export/markdown (no /bundle)
 *   - Bundle CommonMark: GET /api/conversations/<uuid>/export/markdown-bundle?dialect=commonmark
 *   - Bundle Obsidian:   GET /api/conversations/<uuid>/export/markdown-bundle?dialect=obsidian
 *
 * The pre-selected radio matches the value stored in the new
 * `markdownExportMode` preference (server-side via /api/preferences,
 * with the standard usePreferences dual-read fallback).
 *
 * An optional "Save as default" checkbox in the dialog persists the
 * choice via `usePreferences('markdownExportMode', ...)` when the user
 * clicks Download. The PDF button is unchanged and is NOT part of this
 * dialog.
 */

import { test, expect, makeSummary, makeMessage, makeDetail, type Page } from './fixtures'
import type { Route } from '@playwright/test'

const ME = '00000000-0000-0000-0000-0000000000d7'

const summary = makeSummary({
  uuid: ME,
  name: 'Markdown dialog fixture',
  message_count: 1,
  source: 'CLAUDE_CODE',
})
const detail = makeDetail(summary, [
  makeMessage({ uuid: 'm1', sender: 'human', text: 'Hi', content: [{ type: 'text', text: 'Hi' }] }),
])

interface ExportCall {
  url: string
}

interface PrefsState {
  data: Record<string, unknown>
}

interface PatchLog {
  bodies: Array<Record<string, unknown>>
}

async function installPrefsRoute(
  page: Page,
  initial: Record<string, unknown> = {},
): Promise<{ state: PrefsState; patches: PatchLog }> {
  const state: PrefsState = { data: { ...initial } }
  const patches: PatchLog = { bodies: [] }

  await page.route('**/api/preferences', (route: Route) => {
    const req = route.request()
    if (req.method() === 'PATCH') {
      let body: { data?: Record<string, unknown> } = {}
      try {
        body = JSON.parse(req.postData() ?? '{}')
      } catch {
        body = {}
      }
      const patchData = body.data ?? {}
      patches.bodies.push(patchData)
      Object.assign(state.data, patchData)
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ version: 1, data: state.data }),
      })
      return
    }
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ version: 1, data: state.data }),
    })
  })

  return { state, patches }
}

async function installExportRoutes(page: Page, calls: ExportCall[]) {
  await page.route('**/api/conversations/**/export/markdown-bundle**', (route: Route) => {
    calls.push({ url: route.request().url() })
    route.fulfill({
      status: 200,
      contentType: 'application/zip',
      headers: { 'content-disposition': 'attachment; filename="bundle.zip"' },
      body: Buffer.from('PK\x03\x04', 'binary'),
    })
  })
  await page.route('**/api/conversations/**/export/markdown**', (route: Route) => {
    if (route.request().url().includes('markdown-bundle')) {
      route.fallback()
      return
    }
    calls.push({ url: route.request().url() })
    route.fulfill({
      status: 200,
      contentType: 'text/markdown; charset=utf-8',
      body: '# Markdown dialog fixture\n\nHi',
    })
  })
}

test.describe('Markdown export dialog (Phase 7)', () => {
  test('clicking Markdown button opens the dialog with three radio options', async ({ page, mockBackend }) => {
    await mockBackend({ conversations: [summary], details: { [ME]: detail } })
    await installPrefsRoute(page, {})
    const calls: ExportCall[] = []
    await installExportRoutes(page, calls)

    await page.goto(`/conversations/${ME}`)
    await page.getByRole('button', { name: 'Markdown', exact: true }).click()

    const dialog = page.getByTestId('markdown-export-dialog')
    await expect(dialog).toBeVisible()

    // Three radios: Inline / Bundle CommonMark / Bundle Obsidian.
    await expect(dialog.getByLabel('Inline')).toBeVisible()
    await expect(dialog.getByLabel('Bundle CommonMark')).toBeVisible()
    await expect(dialog.getByLabel('Bundle Obsidian')).toBeVisible()
  })

  test('pre-selected radio matches stored markdownExportMode preference', async ({ page, mockBackend }) => {
    await mockBackend({ conversations: [summary], details: { [ME]: detail } })
    await installPrefsRoute(page, { markdownExportMode: 'bundle-obsidian' })
    const calls: ExportCall[] = []
    await installExportRoutes(page, calls)

    await page.goto(`/conversations/${ME}`)
    await page.getByRole('button', { name: 'Markdown', exact: true }).click()

    const dialog = page.getByTestId('markdown-export-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('Bundle Obsidian')).toBeChecked()
  })

  test('Bundle Obsidian + Download triggers the bundle endpoint with dialect=obsidian and closes dialog', async ({ page, mockBackend }) => {
    await mockBackend({ conversations: [summary], details: { [ME]: detail } })
    await installPrefsRoute(page, {})
    const calls: ExportCall[] = []
    await installExportRoutes(page, calls)

    await page.goto(`/conversations/${ME}`)
    await page.getByRole('button', { name: 'Markdown', exact: true }).click()

    const dialog = page.getByTestId('markdown-export-dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('Bundle Obsidian').check()
    await dialog.getByRole('button', { name: 'Download' }).click()

    await expect.poll(() => calls.length, { timeout: 5_000 }).toBeGreaterThan(0)
    const url = calls[calls.length - 1].url
    expect(url).toContain('/export/markdown-bundle')
    expect(url).toContain('dialect=obsidian')

    await expect(dialog).not.toBeVisible()
  })

  test('Inline + Download triggers the non-bundle markdown endpoint', async ({ page, mockBackend }) => {
    await mockBackend({ conversations: [summary], details: { [ME]: detail } })
    await installPrefsRoute(page, { markdownExportMode: 'bundle-commonmark' })
    const calls: ExportCall[] = []
    await installExportRoutes(page, calls)

    await page.goto(`/conversations/${ME}`)
    await page.getByRole('button', { name: 'Markdown', exact: true }).click()

    const dialog = page.getByTestId('markdown-export-dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('Inline').check()
    await dialog.getByRole('button', { name: 'Download' }).click()

    await expect.poll(() => calls.length, { timeout: 5_000 }).toBeGreaterThan(0)
    const url = calls[calls.length - 1].url
    expect(url).toContain('/export/markdown')
    expect(url).not.toContain('markdown-bundle')
  })

  test('Save as default checkbox PATCHes /api/preferences with markdownExportMode', async ({ page, mockBackend }) => {
    await mockBackend({ conversations: [summary], details: { [ME]: detail } })
    const { patches } = await installPrefsRoute(page, {})
    const calls: ExportCall[] = []
    await installExportRoutes(page, calls)

    await page.goto(`/conversations/${ME}`)
    await page.getByRole('button', { name: 'Markdown', exact: true }).click()

    const dialog = page.getByTestId('markdown-export-dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('Bundle CommonMark').check()
    await dialog.getByLabel('Save as default').check()
    await dialog.getByRole('button', { name: 'Download' }).click()

    await expect.poll(() => patches.bodies.length, { timeout: 5_000 }).toBeGreaterThan(0)
    const sawModePatch = patches.bodies.some(
      (b) => (b as Record<string, unknown>).markdownExportMode === 'bundle-commonmark',
    )
    expect(sawModePatch).toBe(true)
  })
})
