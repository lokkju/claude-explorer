import { useState } from 'react'
import { User, Bot, ChevronDown, ChevronRight, ChevronsUpDown, Copy, Check, Star } from 'lucide-react'
import { MarkdownRenderer } from './MarkdownRenderer'
import { MessageAttachments } from './MessageAttachments'
import { Button } from '@/components/ui/button'
import { useSettings } from '@/contexts/SettingsContext'
import { useBookmarks } from '@/contexts/BookmarkContext'
import { cn, formatMessageTimestamp, messageToMarkdown, messageHasVisibleContent } from '@/lib/utils'
import { dedupeImageFiles } from '@/lib/imageFiles'
import type { Message, ContentBlock } from '@/lib/types'

interface MessageBubbleProps {
  message: Message
  isKeyboardSelected?: boolean
  conversationId?: string
  conversationSource?: 'CLAUDE_AI' | 'CLAUDE_CODE'
}

export function MessageBubble({ message, isKeyboardSelected = false, conversationId, conversationSource }: MessageBubbleProps) {
  const isHuman = message.sender === 'human'
  const { showToolCalls, expandAllTools } = useSettings()
  const { isBookmarked, toggleBookmark } = useBookmarks()
  const [copied, setCopied] = useState(false)
  const bookmarked = conversationId ? isBookmarked(conversationId, message.uuid) : false

  const handleToggleBookmark = async () => {
    if (!conversationId) return
    await toggleBookmark({
      conversation_id: conversationId,
      message_uuid: message.uuid,
      source: conversationSource === 'CLAUDE_AI' ? 'claude_desktop' : 'claude_code',
      note: '',
      snippet: (message.text || '').slice(0, 140),
    })
  }

  const handleCopyMessage = async () => {
    const markdown = messageToMarkdown(message, showToolCalls)
    await navigator.clipboard.writeText(markdown)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const hasVisibleContent = messageHasVisibleContent(message, showToolCalls)
  const imageFiles = dedupeImageFiles(message)
  const hasImages = imageFiles.length > 0
  const hasToolBlocks = message.content.some((b) => b.type === 'tool_use' || b.type === 'tool_result')
  const [bubbleToolsCollapsed, setBubbleToolsCollapsed] = useState(false)

  // Don't render empty bubbles — but a message with image attachments is
  // never empty even if there's no text content.
  if (!hasVisibleContent && !hasImages) {
    return null
  }

  return (
    <div
      data-message-uuid={message.uuid}
      {...(bubbleToolsCollapsed ? { 'data-collapsed': '' } : {})}
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
        <div className="absolute -right-2 -top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {hasToolBlocks && showToolCalls && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 bg-white dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 shadow-sm"
              onClick={() => setBubbleToolsCollapsed((v) => !v)}
              title={bubbleToolsCollapsed ? 'Expand tool blocks' : 'Collapse tool blocks'}
              aria-label={bubbleToolsCollapsed ? 'Expand tools' : 'Collapse tools'}
            >
              <ChevronsUpDown className="h-3.5 w-3.5" />
            </Button>
          )}
          {conversationId && (
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'h-7 w-7 border bg-white shadow-sm dark:bg-zinc-700',
                bookmarked
                  ? 'border-amber-300 text-amber-500 dark:border-amber-700'
                  : 'border-zinc-200 dark:border-zinc-600'
              )}
              onClick={handleToggleBookmark}
              title={bookmarked ? 'Remove bookmark' : 'Bookmark this message'}
              aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark message'}
            >
              <Star className={cn('h-3.5 w-3.5', bookmarked && 'fill-amber-500')} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 bg-white dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 shadow-sm"
            onClick={handleCopyMessage}
            title="Copy message as Markdown"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-green-500" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
        {bookmarked && <span data-bookmarked aria-hidden className="hidden" />}

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
                showToolCalls={showToolCalls && !bubbleToolsCollapsed}
                expandAll={expandAllTools}
              />
            ))
          ) : (
            <MarkdownRenderer content={message.text} showToolCalls={showToolCalls && !bubbleToolsCollapsed} />
          )}
        </div>

        {/* Image attachments — always rendered (never gated by tool toggle). */}
        {hasImages && <MessageAttachments message={message} bubbleUuid={message.uuid} />}
      </div>
    </div>
  )
}

interface ContentBlockRendererProps {
  block: ContentBlock
  showToolCalls: boolean
  expandAll?: boolean
}

// Pattern B: Claude Code sometimes inlines image references as
// `[Image: source: <abs-path>]` markers in a plain text content block,
// with the actual bytes living on disk under
// `~/.claude/image-cache/<session-uuid>/<N>.<ext>`. Split the text on
// those markers so we render text + <img> + text + <img> ... in order.
const CC_IMAGE_MARKER_RE = /\[Image: source: ([^\]]+)\]/g

function CcImageMarkerText({ content, showToolCalls }: { content: string; showToolCalls: boolean }) {
  CC_IMAGE_MARKER_RE.lastIndex = 0
  const segments: Array<{ kind: 'text'; value: string } | { kind: 'image'; path: string }> = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = CC_IMAGE_MARKER_RE.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: 'text', value: content.slice(lastIndex, match.index) })
    }
    segments.push({ kind: 'image', path: match[1].trim() })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < content.length) {
    segments.push({ kind: 'text', value: content.slice(lastIndex) })
  }
  if (segments.length === 0 || (segments.length === 1 && segments[0].kind === 'text')) {
    // Fast path: no markers, fall through to standard markdown rendering.
    return <MarkdownRenderer content={content} showToolCalls={showToolCalls} />
  }
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.kind === 'text') {
          // Skip empty / whitespace-only text segments (common when a
          // marker is the entire message body).
          if (!seg.value.trim()) return null
          return <MarkdownRenderer key={i} content={seg.value} showToolCalls={showToolCalls} />
        }
        // Backend route validates the path is under ~/.claude/image-cache/
        // and serves the bytes. Encode the absolute path as a query
        // param.
        const url = `/api/cc-image?path=${encodeURIComponent(seg.path)}`
        return (
          <button
            key={i}
            type="button"
            onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
            className="my-2 block overflow-hidden rounded-md border border-zinc-200 bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:border-zinc-800 dark:bg-zinc-800"
            aria-label={`Open ${seg.path.split('/').pop() || 'image'} at native size in new tab`}
            data-cc-image-marker
            data-cc-image-path={seg.path}
          >
            <img
              src={url}
              alt={seg.path.split('/').pop() || 'Image'}
              loading="lazy"
              decoding="async"
              draggable={false}
              className="block max-h-96 max-w-full object-contain"
            />
          </button>
        )
      })}
    </>
  )
}

function ContentBlockRenderer({ block, showToolCalls, expandAll }: ContentBlockRendererProps) {
  switch (block.type) {
    case 'text':
      return <CcImageMarkerText content={block.text || ''} showToolCalls={showToolCalls} />
    case 'tool_use':
      return showToolCalls ? (
        <ToolUseBlock name={block.name || ''} input={block.input} forceExpanded={expandAll} />
      ) : null
    case 'tool_result':
      return showToolCalls ? (
        <ToolResultBlock content={block.content || []} forceExpanded={expandAll} />
      ) : null
    case 'image':
      // Claude Code embeds images as inline content blocks of shape
      // { type: 'image', source: { type: 'base64', media_type: '...', data: '...' } }
      // alongside a sibling text block carrying the "[Image #N]"
      // marker. Render the bytes inline; click to open at native size in
      // a new tab (the data URI gets the browser's native image viewer).
      return <InlineImageBlock source={block.source} />
    default:
      return null
  }
}

function InlineImageBlock({ source }: { source: ContentBlock['source'] }) {
  if (!source) return null
  let src: string | null = null
  if (source.type === 'base64' && source.data) {
    const mt = source.media_type || 'image/png'
    src = `data:${mt};base64,${source.data}`
  } else if (source.type === 'url' && source.url) {
    src = source.url
  }
  if (!src) return null
  return (
    <button
      type="button"
      onClick={() => window.open(src, '_blank', 'noopener,noreferrer')}
      className="my-2 block overflow-hidden rounded-md border border-zinc-200 bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:border-zinc-800 dark:bg-zinc-800"
      aria-label="Open image at native size in new tab"
      data-content-image
    >
      <img
        src={src}
        alt="Inline image"
        loading="lazy"
        decoding="async"
        draggable={false}
        className="block max-h-96 max-w-full object-contain"
      />
    </button>
  )
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
