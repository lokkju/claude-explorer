import { Children, isValidElement, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import { AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { HighlightedText } from '@/components/HighlightedText'

// Import highlight.js styles
import 'highlight.js/styles/github-dark.css'

// Placeholder strings Claude Desktop bakes in for blocks the originating
// client couldn't render at write time (tool calls, artifacts, analysis
// REPL, mobile-only artifact preview, etc.). Mirrors the constants in
// `backend/export.py::TOOL_PLACEHOLDERS` and the regex in
// `backend/search.py::_TOOL_PLACEHOLDER_RE`. Keep all three in sync — see P1.3a.
export const TOOL_PLACEHOLDER = 'This block is not supported on your current device yet.'
export const TOOL_PLACEHOLDER_MOBILE_ARTIFACT =
  "Viewing artifacts created via the Analysis Tool web feature preview isn't yet supported on mobile."
export const TOOL_PLACEHOLDERS = [TOOL_PLACEHOLDER, TOOL_PLACEHOLDER_MOBILE_ARTIFACT] as const

// Strip placeholders OUTSIDE of fenced code blocks. Inside a fenced
// code block the `code` component below renders a friendly badge
// ("Tool call or artifact not captured in export"), so we must leave
// the placeholder text intact so ReactMarkdown can hand it to that
// component. Outside a fence we drop the placeholder wherever it
// appears (line-anchored OR mid-paragraph) — Claude Desktop emits the
// literal string both ways. We track fenced state by toggling on each
// line that opens with ``` (with optional language tag).
function stripToolPlaceholderText(content: string): string {
  if (!TOOL_PLACEHOLDERS.some((p) => content.includes(p))) return content
  const lines = content.split('\n')
  const out: string[] = []
  let inFence = false
  for (const line of lines) {
    // Fence open/close: ``` at start of line (optional indent + language).
    if (/^[ \t]*```/.test(line)) {
      inFence = !inFence
      out.push(line)
      continue
    }
    if (inFence) {
      out.push(line)
      continue
    }
    // Outside a fence: drop ALL occurrences of every placeholder anywhere on the line.
    let stripped = line
    for (const placeholder of TOOL_PLACEHOLDERS) {
      stripped = stripped.split(placeholder).join('')
    }
    // If the line was non-empty before but is whitespace-only after
    // (i.e. a placeholder was the only content on the line), drop
    // the entire line so we don't leave a phantom blank paragraph.
    if (stripped.trim() === '' && line.trim() !== '') continue
    out.push(stripped)
  }
  // Collapse 3+ consecutive newlines down to a single paragraph break.
  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}

// Recursively flatten the text content of React children. We need this
// because rehype-highlight wraps code-block contents in nested <span>
// elements (one per token) before our `code` component sees them, so a
// naive `String(children)` produces "[object Object]" rather than the
// raw source text. Walking the tree lets us still detect the
// TOOL_PLACEHOLDER string regardless of syntax-highlight wrapping.
function extractTextFromChildren(children: ReactNode): string {
  let text = ''
  Children.forEach(children, (child) => {
    if (typeof child === 'string' || typeof child === 'number') {
      text += String(child)
      return
    }
    if (isValidElement(child)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const props = (child as any).props
      if (props && props.children !== undefined) {
        text += extractTextFromChildren(props.children)
      }
    }
  })
  return text
}

interface MarkdownRendererProps {
  content: string
  className?: string
  /** Reserved for future per-bubble tool-call gating. The unsupported
   *  placeholder badge is intentionally always visible regardless of
   *  this flag — see the `code` handler below. */
  showToolCalls?: boolean
  /** Active full-text search query. When non-empty (and ≥2 chars per
   *  token), text inside inline-prose elements (p, li, strong, em, td,
   *  th, blockquote, headings, inline `code` backticks) is wrapped in
   *  <mark> for each match. FENCED block code is intentionally excluded
   *  — rehype-highlight wraps tokens in <span> children there and
   *  overlapping <mark> would break syntax token boundaries. Inline
   *  code's children are plain string leaves and compose safely. */
  query?: string
}

/** Map a list of element children through HighlightedText for the
 *  string leaves, passing element children through unchanged. Used by
 *  every inline-prose renderer override below when `query` is active.
 */
function wrapTextChildren(children: ReactNode, query: string): ReactNode {
  if (!query || query.trim().length < 2) return children
  return Children.map(children, (child, idx) => {
    if (typeof child === 'string') {
      return <HighlightedText key={idx} text={child} query={query} />
    }
    return child
  })
}

export function MarkdownRenderer({ content, className, query }: MarkdownRendererProps) {
  const cleanedContent = stripToolPlaceholderText(content)
  const wrap = (children: ReactNode) =>
    query ? wrapTextChildren(children, query) : children
  return (
    <ReactMarkdown
      className={cn('prose prose-sm dark:prose-invert max-w-none', className)}
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        // Custom code block rendering
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || '')
          const isInline = !match
          // rehype-highlight wraps tokens in spans, so String(children)
          // alone is unreliable. Recurse to gather the raw text.
          const text = extractTextFromChildren(children).trim()

          // Detect Claude Desktop's "unsupported block" placeholder.
          // The badge is informational — it tells the user a tool call
          // or artifact existed in the original session but was not
          // captured in the export. We surface it regardless of the
          // showToolCalls toggle (the toggle hides captured tool calls
          // and tool results, not breadcrumbs of missing ones).
          if (TOOL_PLACEHOLDERS.includes(text as (typeof TOOL_PLACEHOLDERS)[number])) {
            return (
              <span className="my-2 flex items-center gap-2 rounded-md border border-zinc-300 bg-zinc-100 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>Tool call or artifact not captured in export</span>
              </span>
            )
          }

          if (isInline) {
            // Issue 2 follow-up (2026-05-20, screenshot 20.png regression):
            // inline code DOES get search-hit highlighting. The original
            // Issue 1 ship excluded ALL code on rehype-highlight
            // compositional grounds, but rehype-highlight only tokenizes
            // FENCED block code — inline backticks are plain text leaves
            // that compose safely with <mark>. Real-world case: the
            // matched phrase lives inside an inline `/api/path?q=...`
            // URL fragment and was invisible inside the bubble even
            // though the SearchPanel snippet (right column) had it
            // highlighted. Block branch below stays unwrapped.
            return (
              <code
                className="rounded bg-zinc-200 px-1 py-0.5 text-sm dark:bg-zinc-700"
                {...props}
              >
                {wrap(children)}
              </code>
            )
          }

          return (
            <code className={className} {...props}>
              {children}
            </code>
          )
        },
        // External links open in new tab. Link TEXT is highlighted when
        // an active search query matches inside the visible label.
        a({ href, children, ...props }) {
          const isExternal = href?.startsWith('http')
          return (
            <a
              href={href}
              {...(isExternal && { target: '_blank', rel: 'noopener noreferrer' })}
              className="text-blue-600 hover:underline dark:text-blue-400"
              {...props}
            >
              {wrap(children)}
            </a>
          )
        },
        // Paragraphs: wrap text leaves for search-hit highlighting.
        p({ children, ...props }) {
          return <p {...props}>{wrap(children)}</p>
        },
        li({ children, ...props }) {
          return <li {...props}>{wrap(children)}</li>
        },
        strong({ children, ...props }) {
          return <strong {...props}>{wrap(children)}</strong>
        },
        em({ children, ...props }) {
          return <em {...props}>{wrap(children)}</em>
        },
        blockquote({ children, ...props }) {
          return <blockquote {...props}>{wrap(children)}</blockquote>
        },
        h1({ children, ...props }) {
          return <h1 {...props}>{wrap(children)}</h1>
        },
        h2({ children, ...props }) {
          return <h2 {...props}>{wrap(children)}</h2>
        },
        h3({ children, ...props }) {
          return <h3 {...props}>{wrap(children)}</h3>
        },
        h4({ children, ...props }) {
          return <h4 {...props}>{wrap(children)}</h4>
        },
        h5({ children, ...props }) {
          return <h5 {...props}>{wrap(children)}</h5>
        },
        h6({ children, ...props }) {
          return <h6 {...props}>{wrap(children)}</h6>
        },
        // Better pre styling
        pre({ children, ...props }) {
          return (
            <pre
              className="overflow-x-auto rounded-lg bg-zinc-900 p-4 text-sm"
              {...props}
            >
              {children}
            </pre>
          )
        },
        // Table styling
        table({ children, ...props }) {
          return (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse" {...props}>
                {children}
              </table>
            </div>
          )
        },
        th({ children, ...props }) {
          return (
            <th
              className="border border-zinc-300 bg-zinc-100 px-4 py-2 text-left dark:border-zinc-700 dark:bg-zinc-800"
              {...props}
            >
              {wrap(children)}
            </th>
          )
        },
        td({ children, ...props }) {
          return (
            <td
              className="border border-zinc-300 px-4 py-2 dark:border-zinc-700"
              {...props}
            >
              {wrap(children)}
            </td>
          )
        },
      }}
    >
      {cleanedContent}
    </ReactMarkdown>
  )
}