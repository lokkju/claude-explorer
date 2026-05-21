/**
 * Issue 1 (2026-05-20) — MarkdownRenderer wraps query matches inside
 * inline-prose elements (p, li, strong, em, td, th, blockquote, h1-h6,
 * a label) with <mark>. Code blocks are excluded.
 *
 * Pinned at the renderer level (not via SearchPanelProvider) so the
 * test fixture stays small. MessageBubble forwards useSearchPanel().query
 * into this prop in production; that wiring is verified by manual smoke
 * + the existing MessageBubble tests staying green.
 */

import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'

import { MarkdownRenderer } from '../../components/message/MarkdownRenderer'

describe('MarkdownRenderer — search-hit highlighting (Issue 1)', () => {
  it('wraps paragraph text matching the query', () => {
    const { container } = render(
      <MarkdownRenderer content="The quick brown fox jumps over the lazy dog." query="quick fox" />,
    )
    const marks = Array.from(container.querySelectorAll('mark'))
    const markedText = marks.map((m) => m.textContent)
    expect(markedText).toContain('quick')
    expect(markedText).toContain('fox')
  })

  it('wraps list item text matching the query', () => {
    const { container } = render(
      <MarkdownRenderer content={'- alpha\n- beta\n- gamma'} query="beta" />,
    )
    const marks = Array.from(container.querySelectorAll('mark'))
    expect(marks).toHaveLength(1)
    expect(marks[0].textContent).toBe('beta')
  })

  it('wraps strong + em emphasized text matching the query', () => {
    const { container } = render(
      <MarkdownRenderer content="*emphasis* on **bold** matter." query="emphasis bold" />,
    )
    const marks = Array.from(container.querySelectorAll('mark'))
    const markedText = marks.map((m) => m.textContent)
    expect(markedText).toContain('emphasis')
    expect(markedText).toContain('bold')
  })

  it('wraps link text matching the query', () => {
    const { container } = render(
      <MarkdownRenderer content="[click here](https://example.com) for details" query="click" />,
    )
    const marks = Array.from(container.querySelectorAll('mark'))
    expect(marks).toHaveLength(1)
    expect(marks[0].textContent).toBe('click')
  })

  it('does NOT wrap text inside fenced code blocks (preserves syntax highlighting)', () => {
    const { container } = render(
      <MarkdownRenderer
        content={'Talking about quick stuff:\n```python\nquick = "literal"\n```'}
        query="quick"
      />,
    )
    const marks = Array.from(container.querySelectorAll('mark'))
    // The "quick" inside the paragraph IS wrapped...
    expect(marks.some((m) => m.textContent === 'quick' && !m.closest('pre'))).toBe(true)
    // ...the "quick" inside the <pre><code> block is NOT wrapped.
    const codeBlock = container.querySelector('pre')
    expect(codeBlock).not.toBeNull()
    expect(codeBlock!.querySelectorAll('mark')).toHaveLength(0)
  })

  it('renders without highlights when no query is provided', () => {
    const { container } = render(
      <MarkdownRenderer content="The quick brown fox." query="" />,
    )
    expect(container.querySelectorAll('mark')).toHaveLength(0)
  })

  it('omitting the query prop entirely behaves the same as empty query', () => {
    const { container } = render(<MarkdownRenderer content="The quick brown fox." />)
    expect(container.querySelectorAll('mark')).toHaveLength(0)
  })

  it('treats a quoted query as a single phrase', () => {
    const { container } = render(
      <MarkdownRenderer content="The phrase this image appears once." query='"this image"' />,
    )
    const marks = Array.from(container.querySelectorAll('mark'))
    expect(marks).toHaveLength(1)
    expect(marks[0].textContent).toBe('this image')
  })

  // V1 polish 2026-05-20 (regression fix): a real-world bubble contained
  // "this image" inside markdown inline backticks (e.g.
  // `/api/search?q=this image`). The original Issue 1 ship excluded ALL
  // code (block AND inline) from highlighting on rehype-highlight
  // compositional grounds, but rehype-highlight only tokenizes FENCED
  // blocks — inline code is plain text and composes safely with <mark>.
  // The user's bug report (screenshot 20.png) showed the snippet on the
  // right HAD a yellow mark inside inline-code, but the bubble on the
  // left didn't. Pin: inline code DOES get highlighted; block code does NOT.
  it('wraps query matches inside inline code (`backticks`)', () => {
    const { container } = render(
      <MarkdownRenderer
        content="See `/api/search?q=this image` against the index."
        query='"this image"'
      />,
    )
    const inlineCode = container.querySelector('code')
    expect(inlineCode).not.toBeNull()
    // The inline <code> element must contain a <mark> wrapping the
    // matching substring.
    const codeMark = inlineCode!.querySelector('mark')
    expect(codeMark).not.toBeNull()
    expect(codeMark!.textContent).toBe('this image')
  })

  it('does NOT highlight inside fenced code blocks even when query matches', () => {
    const { container } = render(
      <MarkdownRenderer
        content={'Prose with this image word.\n```js\nconst x = "this image"\n```'}
        query='"this image"'
      />,
    )
    // Prose <mark> present.
    expect(
      Array.from(container.querySelectorAll('mark')).some(
        (m) => m.textContent === 'this image' && !m.closest('pre'),
      ),
    ).toBe(true)
    // No <mark> inside the fenced block.
    const fenced = container.querySelector('pre')
    expect(fenced).not.toBeNull()
    expect(fenced!.querySelectorAll('mark')).toHaveLength(0)
  })
})
