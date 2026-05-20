/**
 * Runtime-narrowing test for focusSearchInput helper (Hunt #2).
 *
 * useKeyboardShortcuts had two `document.querySelector('input[...]') as
 * HTMLInputElement` casts (Vim '/' and Emacs Ctrl+S). querySelector
 * returns `Element | null`, and the placeholder selector could match
 * any element type (e.g., if a future Tailwind plugin synthesizes a
 * non-input control with the same placeholder). The cast bypassed the
 * `instanceof` check and could call `.focus()` on something that
 * lacks the method, throwing TypeError at the shortcut handler.
 *
 * The fix extracts focusSearchInput(), which does an
 * `instanceof HTMLInputElement` guard before calling .focus().
 * Unknown matches are silently ignored.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { focusSearchInput } from '../../hooks/useKeyboardShortcuts'

describe('focusSearchInput (Hunt #2)', () => {
  let querySelectorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    querySelectorSpy = vi.spyOn(document, 'querySelector')
  })

  afterEach(() => {
    querySelectorSpy.mockRestore()
  })

  it('focuses the matching <input> element', () => {
    const input = document.createElement('input')
    input.placeholder = 'Search...'
    const focusSpy = vi.spyOn(input, 'focus')
    querySelectorSpy.mockReturnValue(input)

    focusSearchInput()

    expect(focusSpy).toHaveBeenCalledTimes(1)
  })

  it('does NOT throw when querySelector returns null', () => {
    querySelectorSpy.mockReturnValue(null)
    expect(() => focusSearchInput()).not.toThrow()
  })

  it('does NOT throw when querySelector returns a non-HTMLInputElement', () => {
    // Simulate a future markup change where the placeholder lands on a
    // <div contenteditable> or similar non-input element. The old
    // `as HTMLInputElement` cast would silently call .focus() on
    // something that may or may not have it; the guard makes it a no-op.
    const div = document.createElement('div')
    querySelectorSpy.mockReturnValue(div)
    expect(() => focusSearchInput()).not.toThrow()
  })

  it('does NOT focus a non-HTMLInputElement match', () => {
    const div = document.createElement('div')
    const focusSpy = vi.spyOn(div, 'focus')
    querySelectorSpy.mockReturnValue(div)

    focusSearchInput()

    expect(focusSpy).not.toHaveBeenCalled()
  })
})
