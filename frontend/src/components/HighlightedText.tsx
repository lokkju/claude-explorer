import { Fragment } from 'react'

import { computeHighlightRanges } from './search/highlightRanges'

interface HighlightedTextProps {
  text: string
  query: string
  className?: string
}

/**
 * Wrap every occurrence of the search query inside `text` with a yellow
 * <mark> span. When the query is empty / below the 2-char per-token
 * floor / no matches, returns the raw text unchanged.
 *
 * Shared between SearchPanel snippets and MessageBubble in-bubble
 * highlighting (Issue 1, 2026-05-20). Both surfaces parse the same
 * query, so highlights line up: a token visible in the snippet is the
 * same token highlighted inside the bubble.
 *
 * The (-1, -1) backend-range pair tells `computeHighlightRanges` we
 * have no FTS5-seeded position to honor — bubbles render the FULL
 * message text, not a snippet, so the seed concept doesn't apply.
 * The sanitizer drops the seed cleanly and the function falls back
 * to its substring scan over `parseUserQuery(query)`.
 */
export function HighlightedText({ text, query, className }: HighlightedTextProps) {
  const ranges = computeHighlightRanges(text, query, -1, -1)
  if (ranges.length === 0) {
    return className ? <span className={className}>{text}</span> : <>{text}</>
  }

  const parts: React.ReactNode[] = []
  let cursor = 0
  ranges.forEach((range, idx) => {
    if (cursor < range.start) {
      parts.push(<Fragment key={`t${idx}`}>{text.slice(cursor, range.start)}</Fragment>)
    }
    parts.push(
      <mark
        key={`m${idx}`}
        className="rounded-sm bg-yellow-200 px-0.5 text-yellow-900 dark:bg-yellow-700 dark:text-yellow-50"
      >
        {text.slice(range.start, range.end)}
      </mark>,
    )
    cursor = range.end
  })
  if (cursor < text.length) {
    parts.push(<Fragment key="tail">{text.slice(cursor)}</Fragment>)
  }

  return className ? <span className={className}>{parts}</span> : <>{parts}</>
}
