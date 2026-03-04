import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

// Import highlight.js styles
import 'highlight.js/styles/github-dark.css'

interface MarkdownRendererProps {
  content: string
  className?: string
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
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
      {content}
    </ReactMarkdown>
  )
}