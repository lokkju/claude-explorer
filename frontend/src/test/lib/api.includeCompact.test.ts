/**
 * V1 polish 2026-05-24 — pin the `includeCompact` URL plumbing.
 *
 * The frontend derives `includeCompact` from the
 * `useSettings().hideCompactMarkers` pref (mapping:
 * `includeCompact = !hideCompactMarkers`) and threads the value
 * through `api.exportMarkdown` / `api.exportMarkdownBundle` /
 * `api.exportPdf` / `api.exportAllMarkdown`. The conversation
 * header's "Show Compactions" checkbox drives both viewer visibility
 * AND export inclusion — single source of truth.
 *
 * (Pre-2026-05-24 history: the boolean used to come from a separate
 * Settings pref `export.includeCompactContent`. That pref was removed
 * in the unified-toggle refactor; the `includeCompact` parameter on
 * the api helpers is unchanged, only the SOURCE of the value moved.)
 *
 * Bidirectional contract pinned here:
 *   * Default (false): URL carries `include_compact=false`.
 *   * Explicit true:   URL carries `include_compact=true`.
 *   * The query param appears on ALL four export endpoints.
 *
 * Why this matters: the backend route's default IS false, so a missing
 * param works. But the e2e contract is "the boolean the frontend
 * derives reaches the export"; the only way to verify that without a
 * Playwright run is to inspect the URL the api helper builds.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { api } from '../../lib/api'

describe('api export helpers — include_compact plumbing', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // Spy on global.fetch; return a minimal Response so callers don't crash.
    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 200 }))
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('exportMarkdown defaults include_compact=false in the URL', async () => {
    await api.exportMarkdown('conv-1', true)
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('include_compact=false'),
    )
  })

  it('exportMarkdown forwards include_compact=true when set', async () => {
    await api.exportMarkdown('conv-1', true, true)
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('include_compact=true'),
    )
  })

  it('exportMarkdownBundle defaults include_compact=false', async () => {
    await api.exportMarkdownBundle('conv-1', true, 'commonmark')
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('include_compact=false'),
    )
  })

  it('exportMarkdownBundle forwards include_compact=true', async () => {
    await api.exportMarkdownBundle('conv-1', true, 'obsidian', true)
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('include_compact=true'),
    )
  })

  it('exportPdf defaults include_compact=false', async () => {
    await api.exportPdf('conv-1', true)
    const url = fetchSpy.mock.calls[0]?.[0] as string
    expect(url).toContain('include_compact=false')
  })

  it('exportPdf forwards include_compact=true (5th positional arg)', async () => {
    await api.exportPdf('conv-1', true, undefined, true)
    const url = fetchSpy.mock.calls[0]?.[0] as string
    expect(url).toContain('include_compact=true')
  })

  it('exportAllMarkdown defaults include_compact=false', async () => {
    await api.exportAllMarkdown()
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('include_compact=false'),
    )
  })

  it('exportAllMarkdown forwards include_compact=true', async () => {
    await api.exportAllMarkdown(true)
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('include_compact=true'),
    )
  })
})
