import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import { AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

// Import highlight.js styles
import 'highlight.js/styles/github-dark.css'

// Placeholder text that Claude Desktop uses for tool calls. Mirrors the
// constant in `backend/export.py::TOOL_PLACEHOLDER` (and the regex in
// `filter_tool_placeholders`). Keep both in sync — see P1.3a.
export const TOOL_PLACEHOLDER = 'This block is not supported on your current device yet.'

// Strip whole lines that are nothing but the placeholder. The backend
// regex (`filter_tool_placeholders`) only catches the placeholder when
// it is wrapped in ``` fences; the viewer used to inherit that gap and
// leak the literal string when Claude Desktop emitted the placeholder
// as bare paragraph text. Matching as a full line (with optional
// leading whitespace) lets us collapse the surrounding blank lines too,
// so "Hello\n\n<placeholder>\n\nWorld" renders as "Hello\n\nWorld"
// instead of leaving a phantom blank paragraph.
const TOOL_PLACEHOLDER_LINE_RE = /^[ \t]*This block is not supported on your current device yet\.[ \t]*\r?\n?/gm

function stripToolPlaceholderText(content: string): string {
  if (!content.includes(TOOL_PLACEHOLDER)) return content
  // Drop placeholder lines, then collapse any 3+ consecutive newlines
  // the removal may have produced back down to a paragraph break.
  const stripped = content.replace(TOOL_PLACEHOLDER_LINE_RE, '')
  return stripped.replace(/\n{3,}/g, '\n\n')
}

interface MarkdownRendererProps {
  content: string
  className?: string
  showToolCalls?: boolean
}

export function MarkdownRenderer({ content, className, showToolCalls = true }: MarkdownRendererProps) {
  const cleanedContent = stripToolPlaceholderText(content)
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
          const text = String(children).trim()

          // Detect Claude Desktop's "unsupported block" placeholder
          if (text === TOOL_PLACEHOLDER) {
            // Hide completely when showToolCalls is false
            if (!showToolCalls) {
              return null
            }
            return (
              <span className="my-2 flex items-center gap-2 rounded-md border border-zinc-300 bg-zinc-100 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>Tool call or artifact not captured in export</span>
              </span>
            )
          }

          if (isInline) {
            return (
              <code
                className="rounded bg-zinc-200 px-1 py-0.5 text-sm dark:bg-zinc-700"
                {...props}
              >
                {children}
              </code>
            )
          }

          return (
            <code className={className} {...props}>
              {children}
            </code>
          )
        },
        // External links open in new tab
        a({ href, children, ...props }) {
          const isExternal = href?.startsWith('http')
          return (
            <a
              href={href}
              {...(isExternal && { target: '_blank', rel: 'noopener noreferrer' })}
              className="text-blue-600 hover:underline dark:text-blue-400"
              {...props}
            >
              {children}
            </a>
          )
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
              {children}
            </th>
          )
        },
        td({ children, ...props }) {
          return (
            <td
              className="border border-zinc-300 px-4 py-2 dark:border-zinc-700"
              {...props}
            >
              {children}
            </td>
          )
        },
      }}
    >
      {cleanedContent}
    </ReactMarkdown>
  )
}