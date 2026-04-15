import { useState } from 'react'
import { User, Bot, ChevronDown, ChevronRight, Copy, Check } from 'lucide-react'
import { MarkdownRenderer } from './MarkdownRenderer'
import { Button } from '@/components/ui/button'
import { useSettings } from '@/contexts/SettingsContext'
import { cn, formatMessageTimestamp, messageToMarkdown, messageHasVisibleContent } from '@/lib/utils'
import type { Message, ContentBlock } from '@/lib/types'

interface MessageBubbleProps {
  message: Message
  isKeyboardSelected?: boolean
}

export function MessageBubble({ message, isKeyboardSelected = false }: MessageBubbleProps) {
  const isHuman = message.sender === 'human'
  const { showToolCalls, expandAllTools } = useSettings()
  const [copied, setCopied] = useState(false)

  const handleCopyMessage = async () => {
    const markdown = messageToMarkdown(message, showToolCalls)
    await navigator.clipboard.writeText(markdown)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const hasVisibleContent = messageHasVisibleContent(message, showToolCalls)

  // Don't render empty bubbles
  if (!hasVisibleContent) {
    return null
  }

  return (
    <div
      data-message-uuid={message.uuid}
      className={cn(
        'group flex gap-3',
        isHuman ? 'flex-row-reverse' : 'flex-row'
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
          isHuman
            ? 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300'
            : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
        )}
      >
        {isHuman ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>

      {/* Content */}
      <div
        className={cn(
          'relative flex max-w-[80%] flex-col gap-2 rounded-lg px-4 py-3 transition-all duration-150',
          isHuman
            ? 'bg-blue-50 dark:bg-blue-950'
            : 'bg-zinc-100 dark:bg-zinc-800',
          isKeyboardSelected && 'ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-zinc-900'
        )}
      >
        {/* Copy button - appears on hover */}
        <Button
          variant="ghost"
          size="icon"
          className="absolute -right-2 -top-2 h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100 bg-white dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 shadow-sm"
          onClick={handleCopyMessage}
          title="Copy message as Markdown"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </Button>

        {/* Header */}
        <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <span className="font-medium">
            {isHuman ? 'You' : 'Claude'}
          </span>
          <span>{formatMessageTimestamp(message.created_at)}</span>
          {message.truncated && (
            <span className="text-amber-600 dark:text-amber-400">
              (truncated)
            </span>
          )}
        </div>

        {/* Message content */}
        <div className="text-sm text-zinc-900 dark:text-zinc-100">
          {message.content && message.content.length > 0 ? (
            message.content.map((block, index) => (
              <ContentBlockRenderer
                key={index}
                block={block}
                showToolCalls={showToolCalls}
                expandAll={expandAllTools}
              />
            ))
          ) : (
            <MarkdownRenderer content={message.text} showToolCalls={showToolCalls} />
          )}
        </div>
      </div>
    </div>
  )
}

interface ContentBlockRendererProps {
  block: ContentBlock
  showToolCalls: boolean
  expandAll?: boolean
}

function ContentBlockRenderer({ block, showToolCalls, expandAll }: ContentBlockRendererProps) {
  switch (block.type) {
    case 'text':
      return <MarkdownRenderer content={block.text || ''} showToolCalls={showToolCalls} />
    case 'tool_use':
      return showToolCalls ? (
        <ToolUseBlock name={block.name || ''} input={block.input} forceExpanded={expandAll} />
      ) : null
    case 'tool_result':
      return showToolCalls ? (
        <ToolResultBlock content={block.content || []} forceExpanded={expandAll} />
      ) : null
    default:
      return null
  }
}

interface ToolUseBlockProps {
  name: string
  input: unknown
  forceExpanded?: boolean
}

function ToolUseBlock({ name, input, forceExpanded }: ToolUseBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  const expanded = forceExpanded || isExpanded
  const inputJson = JSON.stringify(input, null, 2)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(inputJson)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="my-2 rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-amber-800 dark:text-amber-200"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
        <span>Tool: {name}</span>
      </button>
      {expanded && (
        <div className="relative border-t border-amber-200 dark:border-amber-800">
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-2 top-2 h-6 w-6"
            onClick={handleCopy}
          >
            {copied ? (
              <Check className="h-3 w-3 text-green-500" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </Button>
          <pre className="overflow-x-auto p-3 text-xs text-amber-900 dark:text-amber-100">
            {inputJson}
          </pre>
        </div>
      )}
    </div>
  )
}

interface ToolResultBlockProps {
  content: ContentBlock[]
  forceExpanded?: boolean
}

function ToolResultBlock({ content, forceExpanded }: ToolResultBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const expanded = forceExpanded || isExpanded

  // Extract text content for preview
  const textContent = content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')

  const previewLength = 200
  const needsTruncation = textContent.length > previewLength

  return (
    <div className="my-2 rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-zinc-700 dark:text-zinc-300"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
        <span>Tool Result</span>
        {!expanded && needsTruncation && (
          <span className="text-xs text-zinc-500">
            ({textContent.length} chars)
          </span>
        )}
      </button>
      {expanded && (
        <div className="border-t border-zinc-200 p-3 dark:border-zinc-700">
          <pre className="overflow-x-auto whitespace-pre-wrap text-xs text-zinc-700 dark:text-zinc-300">
            {textContent}
          </pre>
        </div>
      )}
    </div>
  )
}
