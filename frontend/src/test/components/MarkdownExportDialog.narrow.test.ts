/**
 * Runtime-narrowing test for isMarkdownExportMode (Hunt #2).
 *
 * MarkdownExportDialog used `setMode(v as MarkdownExportMode)` on the
 * Radix RadioGroup.onValueChange callback. Radix hands callers a plain
 * `string`, so the cast was a runtime lie — a corrupted persisted
 * mode or a stray RadioGroupItem value would coerce garbage into the
 * typed setter and propagate downstream (the export branch reads `mode`
 * to decide blob shape; a bad value would silently take the default).
 *
 * Replaced with an exported `isMarkdownExportMode` runtime predicate;
 * this test pins the predicate's contract.
 */

import { describe, it, expect } from 'vitest'
import { isMarkdownExportMode } from '../../components/conversation/MarkdownExportDialog'

describe('isMarkdownExportMode (Hunt #2)', () => {
  it('accepts every value in the MarkdownExportMode union', () => {
    expect(isMarkdownExportMode('inline')).toBe(true)
    expect(isMarkdownExportMode('bundle-commonmark')).toBe(true)
    expect(isMarkdownExportMode('bundle-obsidian')).toBe(true)
  })

  it('rejects unknown strings', () => {
    expect(isMarkdownExportMode('bundle')).toBe(false)
    expect(isMarkdownExportMode('Inline')).toBe(false)
    expect(isMarkdownExportMode('')).toBe(false)
  })

  it('rejects non-string values', () => {
    expect(isMarkdownExportMode(null)).toBe(false)
    expect(isMarkdownExportMode(undefined)).toBe(false)
    expect(isMarkdownExportMode(0)).toBe(false)
    expect(isMarkdownExportMode({})).toBe(false)
  })
})
