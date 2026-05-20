/**
 * HighlightedText — wraps query matches in <mark> spans.
 *
 * Shared by SearchPanel snippets (existing) and MessageBubble text
 * (new for Issue 1, 2026-05-20). Reuses computeHighlightRanges /
 * parseUserQuery from `search/highlightRanges.ts` — same parser as the
 * snippet path so the two surfaces stay in sync on what counts as a
 * phrase vs a token list and respect the 2-char per-token floor.
 */

import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'

import { HighlightedText } from '../../components/HighlightedText'

describe('HighlightedText', () => {
  it('renders raw text when query is empty', () => {
    const { container } = render(<HighlightedText text="hello world" query="" />)
    expect(container.textContent).toBe('hello world')
    expect(container.querySelectorAll('mark')).toHaveLength(0)
  })

  it('renders raw text when query is below 2-char floor', () => {
    const { container } = render(<HighlightedText text="hello world" query="h" />)
    expect(container.textContent).toBe('hello world')
    expect(container.querySelectorAll('mark')).toHaveLength(0)
  })

  it('wraps every token-mode match in <mark>', () => {
    const { container } = render(
      <HighlightedText text="The quick brown fox" query="quick fox" />,
    )
    const marks = Array.from(container.querySelectorAll('mark'))
    const markedText = marks.map((m) => m.textContent)
    expect(markedText).toContain('quick')
    expect(markedText).toContain('fox')
    // Full visible text preserved (matches + non-matches).
    expect(container.textContent).toBe('The quick brown fox')
  })

  it('matches case-insensitively', () => {
    const { container } = render(
      <HighlightedText text="Hello WORLD" query="hello world" />,
    )
    const marks = Array.from(container.querySelectorAll('mark'))
    const markedText = marks.map((m) => m.textContent)
    expect(markedText).toContain('Hello')
    expect(markedText).toContain('WORLD')
  })

  it('treats a quoted query as a single phrase', () => {
    const { container } = render(
      <HighlightedText text="this image is fine" query='"this image"' />,
    )
    const marks = Array.from(container.querySelectorAll('mark'))
    expect(marks).toHaveLength(1)
    expect(marks[0].textContent).toBe('this image')
  })

  it('does NOT wrap non-matching text (bidirectional)', () => {
    const { container } = render(
      <HighlightedText text="The quick brown fox" query="elephant" />,
    )
    expect(container.querySelectorAll('mark')).toHaveLength(0)
    expect(container.textContent).toBe('The quick brown fox')
  })

  it('applies tailwind classes for visibility in both light and dark', () => {
    const { container } = render(
      <HighlightedText text="match me" query="match" />,
    )
    const mark = container.querySelector('mark')
    expect(mark).not.toBeNull()
    expect(mark!.className).toContain('bg-yellow-200')
    expect(mark!.className).toContain('dark:bg-yellow-700')
  })
})
