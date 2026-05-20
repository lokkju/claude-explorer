/**
 * Null-safety regression tests for the date formatters in
 * `frontend/src/lib/utils.ts` (2026-05-18).
 *
 * Mirrors backend null-safety fixes (50b5cc5, adbe92d, f9a2fd2):
 * defensive coalescing at the boundary so a null/undefined/invalid
 * input doesn't crash the page.
 *
 * Pre-fix behavior:
 *   - `formatDate(null)`        → `new Date(null)` = epoch (1970) →
 *                                 silently renders "Jan 1" — looks like
 *                                 data corruption.
 *   - `formatDate(undefined)`   → `new Date(undefined)` = Invalid Date →
 *                                 `format(invalidDate, ...)` throws
 *                                 RangeError, crashing the page.
 *   - `formatDate('bad-string')` → same RangeError crash.
 *   - `formatFullDate(null)`     → throws RangeError immediately because
 *                                 'PPpp' formatter is strict.
 *
 * Post-fix contract:
 *   - All four formatters accept `string | Date | null | undefined`.
 *   - All four return the em-dash placeholder ('—') for any falsy /
 *     invalid input — preserves layout, surfaces absence to the user,
 *     never crashes.
 *
 * Mirrors the backend `(data.get(k) or "")` "missing is empty, don't
 * crash" invariant.
 */

import { describe, it, expect } from 'vitest'
import {
  formatDate,
  formatFullDate,
  formatMessageTimestamp,
  formatRelativeDate,
} from '../../lib/utils'

const PLACEHOLDER = '—'

describe('date formatters — null-safety (mirrors backend H1-H4)', () => {
  describe('formatDate', () => {
    it('returns placeholder for null input', () => {
      expect(formatDate(null)).toBe(PLACEHOLDER)
    })

    it('returns placeholder for undefined input', () => {
      expect(formatDate(undefined)).toBe(PLACEHOLDER)
    })

    it('returns placeholder for invalid date string', () => {
      expect(formatDate('not-a-real-date')).toBe(PLACEHOLDER)
    })

    it('returns placeholder for invalid Date object', () => {
      expect(formatDate(new Date('not-a-date'))).toBe(PLACEHOLDER)
    })

    it('formats a valid past date as MMM d', () => {
      // Far enough in the past to avoid Today/Yesterday branches.
      expect(formatDate('2024-03-15T10:00:00Z')).toMatch(/Mar 15|Mar 14/)
    })
  })

  describe('formatMessageTimestamp', () => {
    it('returns placeholder for null input', () => {
      expect(formatMessageTimestamp(null)).toBe(PLACEHOLDER)
    })

    it('returns placeholder for undefined input', () => {
      expect(formatMessageTimestamp(undefined)).toBe(PLACEHOLDER)
    })

    it('returns placeholder for invalid date string', () => {
      expect(formatMessageTimestamp('garbage')).toBe(PLACEHOLDER)
    })

    it('formats a valid past date with full timestamp', () => {
      expect(formatMessageTimestamp('2024-03-15T10:00:00Z')).toMatch(
        /Mar 1[45], 2024/,
      )
    })
  })

  describe('formatFullDate', () => {
    it('returns placeholder for null input', () => {
      expect(formatFullDate(null)).toBe(PLACEHOLDER)
    })

    it('returns placeholder for undefined input', () => {
      expect(formatFullDate(undefined)).toBe(PLACEHOLDER)
    })

    it('returns placeholder for invalid date string', () => {
      // Pre-fix: this threw RangeError because 'PPpp' is strict.
      expect(formatFullDate('definitely-not-a-date')).toBe(PLACEHOLDER)
    })

    it('formats a valid date with PPpp', () => {
      const result = formatFullDate('2024-03-15T10:00:00Z')
      expect(result).not.toBe(PLACEHOLDER)
      // PPpp is locale-aware. date-fns v3 emits the abbreviated month +
      // 12-hour time + AM/PM — e.g. "Mar 15, 2024, 3:00:00 AM" in
      // en-US. We only pin the year + day so the test stays robust
      // across CI timezone settings.
      expect(result).toMatch(/2024/)
      expect(result).toMatch(/1[45]/)
    })
  })

  describe('formatRelativeDate', () => {
    it('returns placeholder for null input', () => {
      expect(formatRelativeDate(null)).toBe(PLACEHOLDER)
    })

    it('returns placeholder for undefined input', () => {
      expect(formatRelativeDate(undefined)).toBe(PLACEHOLDER)
    })

    it('returns placeholder for invalid date string', () => {
      expect(formatRelativeDate('garbage')).toBe(PLACEHOLDER)
    })

    it('formats a valid date as a relative string', () => {
      const result = formatRelativeDate('2024-03-15T10:00:00Z')
      expect(result).not.toBe(PLACEHOLDER)
      // date-fns formatDistanceToNow with addSuffix returns strings
      // like "about 2 years ago".
      expect(result).toMatch(/ago/)
    })
  })
})

describe('regression: pre-fix would have silently rendered 1970 dates', () => {
  // This is the SPECIFIC pattern the audit found dangerous: a null
  // upstream date silently turning into the Unix epoch via `new Date(null)`.
  // Confirm the placeholder is returned instead, so users never see
  // a fabricated "Jan 1" or "Dec 31, 1969" entry in the UI.
  it('formatDate(null) does NOT render an epoch date string', () => {
    const out = formatDate(null)
    expect(out).not.toMatch(/1970|Jan 1|Dec 31/)
    expect(out).toBe(PLACEHOLDER)
  })

  it('formatMessageTimestamp(null) does NOT render an epoch date string', () => {
    const out = formatMessageTimestamp(null)
    expect(out).not.toMatch(/1970|Jan 1|Dec 31/)
    expect(out).toBe(PLACEHOLDER)
  })
})
