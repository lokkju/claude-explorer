/**
 * Runtime-narrowing tests for SettingsContext type guards (Hunt #2).
 *
 * The Radix `RadioGroup.onValueChange` callback hands back a `string`,
 * not the constrained union. The old code did `setTheme(value as Theme)`,
 * which was a runtime lie — a corrupted persisted value or a future Radix
 * change emitting a wrong string would coerce garbage into the typed
 * setter and propagate downstream (e.g. `effectiveTheme` would return a
 * non-`'light'|'dark'` value, breaking the CSS class toggle).
 *
 * The fix exposes `isTheme`, `isKeyboardMode`, and `isMarkdownExportMode`
 * runtime predicates; SettingsPage uses them to guard each onValueChange
 * call. These tests pin the predicates' contract.
 *
 * Written RED-first: with the predicates absent (the old `as Theme` cast
 * version), the wrong-value branch crashes the import. With the
 * predicates present, every wrong value is rejected.
 *
 * Note (2026-05-29 unification): `isMarkdownDialect` was retired when the
 * Settings Export section and Markdown dialog were unified on a single
 * `markdownExportMode` key. The dialect was a subset of the mode and is
 * no longer a standalone setting.
 */

import { describe, it, expect } from 'vitest'
import {
  isTheme,
  isKeyboardMode,
  isMarkdownExportMode,
} from '../../contexts/SettingsContext'

describe('SettingsContext runtime predicates (Hunt #2)', () => {
  describe('isTheme', () => {
    it('accepts every value in the Theme union', () => {
      expect(isTheme('light')).toBe(true)
      expect(isTheme('dark')).toBe(true)
      expect(isTheme('system')).toBe(true)
    })

    it('rejects unknown strings', () => {
      expect(isTheme('lightt')).toBe(false)
      expect(isTheme('DARK')).toBe(false)
      expect(isTheme('')).toBe(false)
    })

    it('rejects non-string values', () => {
      expect(isTheme(null)).toBe(false)
      expect(isTheme(undefined)).toBe(false)
      expect(isTheme(0)).toBe(false)
      expect(isTheme({})).toBe(false)
    })
  })

  describe('isKeyboardMode', () => {
    it('accepts every value in the KeyboardMode union', () => {
      expect(isKeyboardMode('emacs')).toBe(true)
      expect(isKeyboardMode('vim')).toBe(true)
    })

    it('rejects unknown strings', () => {
      expect(isKeyboardMode('nano')).toBe(false)
      expect(isKeyboardMode('VIM')).toBe(false)
      expect(isKeyboardMode('')).toBe(false)
    })

    it('rejects non-string values', () => {
      expect(isKeyboardMode(null)).toBe(false)
      expect(isKeyboardMode(undefined)).toBe(false)
      expect(isKeyboardMode(0)).toBe(false)
    })
  })

  describe('isMarkdownExportMode', () => {
    it('accepts every value in the MarkdownExportMode union', () => {
      expect(isMarkdownExportMode('inline')).toBe(true)
      expect(isMarkdownExportMode('bundle-commonmark')).toBe(true)
      expect(isMarkdownExportMode('bundle-obsidian')).toBe(true)
    })

    it('rejects unknown strings', () => {
      expect(isMarkdownExportMode('bundle')).toBe(false)
      expect(isMarkdownExportMode('commonmark')).toBe(false)
      expect(isMarkdownExportMode('obsidian')).toBe(false)
      expect(isMarkdownExportMode('Inline')).toBe(false)
      expect(isMarkdownExportMode('')).toBe(false)
    })

    it('rejects non-string values', () => {
      expect(isMarkdownExportMode(null)).toBe(false)
      expect(isMarkdownExportMode(undefined)).toBe(false)
      expect(isMarkdownExportMode([])).toBe(false)
    })
  })
})
