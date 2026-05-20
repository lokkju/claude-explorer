import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { User, Bot, ChevronDown, ChevronRight, ChevronsUpDown, Copy, Check, Star, ImageOff } from 'lucide-react'
import { MarkdownRenderer } from './MarkdownRenderer'
import { MessageAttachments } from './MessageAttachments'
import { SlashCommandBadge } from './SlashCommandBadge'
import { Button } from '@/components/ui/button'
import { useConversationLightbox } from '@/contexts/ConversationLightboxContext'
import { useSettings } from '@/contexts/SettingsContext'
import { useBookmarks } from '@/contexts/BookmarkContext'
import { cn, formatMessageTimestamp, messageToMarkdown, messageHasVisibleContent, isExcludableMarker } from '@/lib/utils'
import { dedupeImageFiles } from '@/lib/imageFiles'
import {
  recordImageFailure,
  isImageFailureTombstoned,
  subscribeImageFailures,
} from '@/lib/imageFailureRegistry'
import type { Message, ContentBlock, ImageFile } from '@/lib/types'

/**
 * Subscribe to the image-failure registry so a component re-renders
 * the moment ANY image URL crosses the failure threshold (a sibling
 * referencing the same URL might have just tombstoned it).
 */
function useImageFailureTombstone(url: string): boolean {
  return useSyncExternalStore(
    subscribeImageFailures,
    () => isImageFailureTombstoned(url),
    () => false, // SSR / hydration: never report tombstoned on first paint
  )
}

interface MessageBubbleProps {
  message: Message
  isKeyboardSelected?: boolean
  conversationId?: string
  conversationSource?: 'CLAUDE_AI' | 'CLAUDE_CODE'
}

function MessageBubbleImpl({ message, isKeyboardSelected = false, conversationId, conversationSource }: MessageBubbleProps) {
  const isHuman = message.sender === 'human'
  const { showToolCalls, expandAllTools } = useSettings()
  const { isBookmarked, toggleBookmark } = useBookmarks()
  const [copied, setCopied] = useState(false)
  const bookmarked = conversationId ? isBookmarked(conversationId, message.uuid) : false

  // Hunt #11: ref-tracked timeout for the copy-feedback "Copied" indicator.
  // MessageBubble unmounts whenever the user switches conversations; without
  // this cleanup the 2s setTimeout fires `setCopied(false)` on a dead
  // component (React 18 silently no-ops the setState, but the timer + closure
  // leak in memory). Mount-scoped effect clears any pending timer on unmount.
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
  }, [])

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
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    copiedTimerRef.current = setTimeout(() => setCopied(false), 2000)
  }

  const hasVisibleContent = messageHasVisibleContent(message, showToolCalls)
  const imageFiles = dedupeImageFiles(message)
  const hasImages = imageFiles.length > 0
  const hasToolBlocks = message.content.some((b) => b.type === 'tool_use' || b.type === 'tool_result')
  const [bubbleToolsCollapsed, setBubbleToolsCollapsed] = useState(false)

  // V1 polish cleanup (2026-05-13): Argless command markers
  // (`is_command_marker=true`: `/exit`, `/clear`, `/compact`, prelude rows)
  // are CHROME — muted SlashCommandBadge bubbles that the viewer renders
  // for orientation but that the backend export, search, and full-conversation
  // copy all exclude via `_is_excludable_marker` / `isExcludableMarker`.
  // The per-block hover-revealed action overlay (copy + bookmark buttons
  // below) calls `messageToMarkdown(message, ...)` directly, which BYPASSES
  // the conversation-level `isExcludableMarker` filter. Without this guard,
  // hovering an argless marker bubble and clicking the per-block copy icon
  // would put `**You:**\n\nSession: /exit` on the clipboard — leaking chrome
  // into a user-content surface. Apply the same predicate AT THE OUTERMOST
  // surface (the hover overlay) so the affordance simply isn't offered.
  //
  // Argful markers (`/coding <prose>`, `/plan <prose>`,
  // `is_command_marker=false`) DO render a SlashCommandBadge but carry the
  // user's real prose, so they remain copyable AND bookmarkable — the
  // predicate is keyed on `is_command_marker === true`, not on
  // `slash_command` truthiness.
  //
  // Bookmarks are also hidden for argless chrome: a bookmark whose snippet
  // is "Session: /exit" has no information value and breaks the mental
  // model of bookmarks as a "save meaningful content" affordance.
  // The tool-collapse button is naturally guarded by `hasToolBlocks` —
  // argless markers never carry tool blocks, so no extra guard is needed.
  const isExcludable = isExcludableMarker(message)

  // Issue #1 — Claude Code images (inline base64 content blocks AND
  // `[Image: source: <abs-path>]` text markers) used to open in a new
  // browser tab via window.open(). The spec was that they should pop
  // the same shadcn Dialog lightbox the Desktop image grid uses, so
  // the user gets keyboard nav + download + open-original without
  // losing scroll position.
  //
  // Collect a per-bubble list of CC images in document order so the
  // InlineImageBlock / CcImageMarkerText renderers can all hand the
  // same flat index into a single ImageLightbox instance.
  const ccImageEntries = useMemo(() => collectCcImages(message), [message])
  // Manual finding 2026-05-04 follow-up: ←/→ in the lightbox should
  // walk the entire conversation's images, not just this bubble's.
  // Translate per-bubble click positions to a global catalog index.
  const conversationLightbox = useConversationLightbox()
  const ccImageBaseIndex = useMemo(() => {
    const offset = conversationLightbox.offsetForMessage(message.uuid)
    if (offset < 0) return offset
    // The catalog records Desktop file attachments first (if any),
    // then CC content-block images. Skip past the Desktop count so
    // localCcIdx → globalIdx works.
    return offset + imageFiles.length
  }, [conversationLightbox, message.uuid, imageFiles.length])
  const onOpenCcImage = useCallback(
    (localIdx: number) => {
      if (ccImageBaseIndex < 0) return
      conversationLightbox.openAt(ccImageBaseIndex + localIdx)
    },
    [ccImageBaseIndex, conversationLightbox],
  )

  // Don't render empty bubbles — but a message with image attachments is
  // never empty even if there's no text content.
  if (!hasVisibleContent && !hasImages) {
    return null
  }

  return (
    <div
      data-message-uuid={message.uuid}
      tabIndex={-1}
      {...(bubbleToolsCollapsed ? { 'data-collapsed': '' } : {})}
      className={cn(
        'group flex gap-3 focus:outline-none',
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
          {!isExcludable && conversationId && (
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
          {!isExcludable && (
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
          )}
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

        {/* Slash-command badge (V1 polish round 3, 2026-05-12). Rendered
            ABOVE the body so the user can see which `/foo` produced the
            bubble even when the body is the argful prompt text (e.g.
            "Double-check your plan." for a /coding marker). The truthy
            guard `if (message.slash_command)` correctly skips null,
            undefined, AND the empty string. */}
        {message.slash_command && (
          <SlashCommandBadge command={message.slash_command} />
        )}

        {/* Message content */}
        <div className="text-sm text-zinc-900 dark:text-zinc-100">
          {message.content && message.content.length > 0 ? (
            <ContentBlockList
              content={message.content}
              showToolCalls={showToolCalls && !bubbleToolsCollapsed}
              expandAll={expandAllTools}
              ccImageEntries={ccImageEntries}
              onOpenCcImage={onOpenCcImage}
            />
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

// Manual finding 2026-05-04: typing into the SearchPanel input felt
// laggy (~10s) on a 600-message conversation. Root cause: every
// keystroke updates `query` in SearchPanelContext, which re-renders
// every component that reads via useSearchPanel(). ConversationPage
// is one of them; without memo, that cascades to ALL MessageBubble
// children. Wrap the export in React.memo so a re-render of
// ConversationPage doesn't re-render every bubble unless the bubble's
// own props actually changed (message reference, selection flag,
// conversation id/source).
export const MessageBubble = memo(MessageBubbleImpl, (prev, next) => {
  return (
    prev.message === next.message &&
    prev.isKeyboardSelected === next.isKeyboardSelected &&
    prev.conversationId === next.conversationId &&
    prev.conversationSource === next.conversationSource
  )
})

interface CcImageEntries {
  files: ImageFile[]
  /** Map block index → starting CC image index for that block. Each
   *  block (text or image) contributes 0+ CC images; the renderer
   *  consumes them sequentially. */
  blockOffsets: number[]
}

/**
 * Walk the content in document order and collect every Claude Code
 * image (inline base64 OR `[Image: source: <path>]` text marker) into
 * a flat ImageFile list usable by ImageLightbox. Each entry gets a
 * synthetic file_uuid/file_name and a preview_asset.url that the
 * lightbox <img> element can resolve directly.
 */
function collectCcImages(message: Message): CcImageEntries {
  const files: ImageFile[] = []
  const blockOffsets: number[] = []
  if (!message.content) return { files, blockOffsets }
  for (let bi = 0; bi < message.content.length; bi++) {
    blockOffsets.push(files.length)
    const block = message.content[bi]
    if (block.type === 'image' && block.source) {
      const src = imageSourceUrl(block.source)
      if (src) {
        files.push({
          file_kind: 'image',
          file_uuid: `${message.uuid}:cc-inline:${bi}`,
          file_name: `inline-image-${bi + 1}.png`,
          created_at: message.created_at,
          preview_asset: { url: src, file_variant: 'preview' },
        })
      }
    } else if (block.type === 'text' && block.text) {
      const re = /\[Image: source: ([^\]]+)\]/g
      let m: RegExpExecArray | null
      while ((m = re.exec(block.text)) !== null) {
        const path = m[1].trim()
        const url = `/api/cc-image?path=${encodeURIComponent(path)}`
        const filename = path.split('/').pop() || `cc-image-${files.length + 1}`
        files.push({
          file_kind: 'image',
          file_uuid: `${message.uuid}:cc-marker:${bi}:${m.index}`,
          file_name: filename,
          created_at: message.created_at,
          preview_asset: { url, file_variant: 'preview' },
        })
      }
    }
  }
  return { files, blockOffsets }
}

function imageSourceUrl(source: NonNullable<ContentBlock['source']>): string | null {
  if (source.type === 'base64' && source.data) {
    const mt = source.media_type || 'image/png'
    return `data:${mt};base64,${source.data}`
  }
  if (source.type === 'url' && source.url) {
    return source.url
  }
  return null
}

interface ContentBlockListProps {
  content: ContentBlock[]
  showToolCalls: boolean
  expandAll?: boolean
  ccImageEntries: CcImageEntries
  onOpenCcImage: (index: number) => void
}

function ContentBlockList({
  content,
  showToolCalls,
  expandAll,
  ccImageEntries,
  onOpenCcImage,
}: ContentBlockListProps) {
  return (
    <>
      {content.map((block, index) => (
        <ContentBlockRenderer
          key={index}
          block={block}
          blockIndex={index}
          showToolCalls={showToolCalls}
          expandAll={expandAll}
          ccImageEntries={ccImageEntries}
          onOpenCcImage={onOpenCcImage}
        />
      ))}
    </>
  )
}

interface ContentBlockRendererProps {
  block: ContentBlock
  blockIndex: number
  showToolCalls: boolean
  expandAll?: boolean
  ccImageEntries: CcImageEntries
  onOpenCcImage: (index: number) => void
}

// Pattern B: Claude Code sometimes inlines image references as
// `[Image: source: <abs-path>]` markers in a plain text content block,
// with the actual bytes living on disk under
// `~/.claude/image-cache/<session-uuid>/<N>.<ext>`. Split the text on
// those markers so we render text + <img> + text + <img> ... in order.
const CC_IMAGE_MARKER_RE = /\[Image: source: ([^\]]+)\]/g

interface CcImageMarkerTextProps {
  content: string
  showToolCalls: boolean
  /** Index in the bubble's ccImageEntries.files of the FIRST marker in
   *  this text block. Subsequent markers within the same text block
   *  get sequential indices. */
  startCcIndex: number
  onOpenCcImage: (index: number) => void
}

function CcImageMarkerText({ content, showToolCalls, startCcIndex, onOpenCcImage }: CcImageMarkerTextProps) {
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
  let imageOrdinal = 0
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
        const ccIndex = startCcIndex + imageOrdinal
        imageOrdinal += 1
        const filename = seg.path.split('/').pop() || 'image'
        return (
          <CcImageMarkerTile
            key={i}
            url={url}
            filename={filename}
            path={seg.path}
            onOpen={() => onOpenCcImage(ccIndex)}
          />
        )
      })}
    </>
  )
}

function CcImageMarkerTile({
  url,
  filename,
  path,
  onOpen,
}: {
  url: string
  filename: string
  path: string
  onOpen: () => void
}) {
  const [errored, setErrored] = useState(false)
  const [retried, setRetried] = useState(false)
  // V1 polish: once a URL has failed >= 10x in this session, render
  // the fallback tile directly without issuing another <img> request.
  // The per-component errored state below resets on remount (scroll
  // out of viewport, navigate away/back, etc.); the registry persists.
  const tombstoned = useImageFailureTombstone(url)
  // P4d: on the first <img> error, swap to a cache-busted URL and let the
  // browser retry once. The backend /api/cc-image already falls back to
  // the permanent on-disk cache (see P4b, commit 4032c5a), so this also
  // catches transient network hiccups before showing the friendly
  // fallback tile.
  const finalUrl = retried ? `${url}${url.includes('?') ? '&' : '?'}retry=1` : url
  if (errored || tombstoned) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="my-2 flex items-center gap-2 rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-3 py-3 text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
        aria-label={`Image not in cache: ${filename}`}
        title="Original was rotated by Claude Code; this image was not present at fetch time, so we couldn't cache it."
        data-cc-image-marker
        data-cc-image-broken
        data-cc-image-path={path}
      >
        <ImageOff className="h-4 w-4 shrink-0" />
        <span className="truncate">
          Image not in cache: <span className="font-mono">{filename}</span>
        </span>
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      className="my-2 block overflow-hidden rounded-md border border-zinc-200 bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:border-zinc-800 dark:bg-zinc-800"
      aria-label={`Open ${filename} in lightbox`}
      data-cc-image-marker
      data-cc-image-path={path}
    >
      <img
        src={finalUrl}
        alt={filename}
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => {
          recordImageFailure(url)
          if (!retried) {
            setRetried(true)
          } else {
            setErrored(true)
          }
        }}
        className="block max-h-96 max-w-full object-contain"
      />
    </button>
  )
}

function ContentBlockRenderer({
  block,
  blockIndex,
  showToolCalls,
  expandAll,
  ccImageEntries,
  onOpenCcImage,
}: ContentBlockRendererProps) {
  switch (block.type) {
    case 'text':
      return (
        <CcImageMarkerText
          content={block.text || ''}
          showToolCalls={showToolCalls}
          startCcIndex={ccImageEntries.blockOffsets[blockIndex] ?? 0}
          onOpenCcImage={onOpenCcImage}
        />
      )
    case 'tool_use':
      return showToolCalls ? (
        <ToolUseBlock name={block.name || ''} input={block.input} forceExpanded={expandAll} />
      ) : null
    case 'tool_result':
      return showToolCalls ? (
        <ToolResultBlock content={block.content || []} forceExpanded={expandAll} />
      ) : null
    case 'image': {
      // Claude Code embeds images as inline content blocks of shape
      // { type: 'image', source: { type: 'base64', media_type: '...', data: '...' } }
      // alongside a sibling text block carrying the "[Image #N]"
      // marker. Click opens the in-page lightbox (Issue #1).
      const ccIndex = ccImageEntries.blockOffsets[blockIndex] ?? 0
      return (
        <InlineImageBlock
          source={block.source}
          onOpen={() => onOpenCcImage(ccIndex)}
        />
      )
    }
    default:
      return null
  }
}

function InlineImageBlock({
  source,
  onOpen,
}: {
  source: ContentBlock['source']
  onOpen: () => void
}) {
  const [errored, setErrored] = useState(false)
  const [retried, setRetried] = useState(false)
  if (!source) return null
  const src = imageSourceUrl(source)
  if (!src) return null
  // V1 polish: session-level tombstone after 10 failures stops the
  // browser from re-fetching this URL on every remount. Only network
  // URLs get tombstoned — data: URLs are loaded inline and can't fail
  // a network request anyway.
  const isNetworkUrl = !src.startsWith('data:')
  const tombstoned = useImageFailureTombstone(isNetworkUrl ? src : '')
  // P4d: retry once with a cache-buster on the first error, but only for
  // network URLs — base64 / data: URLs can't be cache-busted, so for
  // those we skip straight to the fallback as before.
  const finalSrc =
    retried && isNetworkUrl ? `${src}${src.includes('?') ? '&' : '?'}retry=1` : src
  if (errored || tombstoned) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="my-2 flex items-center gap-2 rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-3 py-3 text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
        aria-label="Image not in cache: inline image"
        title="Original was rotated by Claude Code; this image was not present at fetch time, so we couldn't cache it."
        data-content-image
        data-content-image-broken
      >
        <ImageOff className="h-4 w-4 shrink-0" />
        <span className="truncate">Image not in cache: inline image</span>
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      className="my-2 block overflow-hidden rounded-md border border-zinc-200 bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:border-zinc-800 dark:bg-zinc-800"
      aria-label="Open inline image in lightbox"
      data-content-image
    >
      <img
        src={finalSrc}
        alt="Inline image"
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => {
          if (isNetworkUrl) {
            recordImageFailure(src)
          }
          if (!retried && isNetworkUrl) {
            setRetried(true)
          } else {
            setErrored(true)
          }
        }}
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

  // Hunt #11: ref-tracked timeout (see MessageBubbleImpl for rationale).
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
  }, [])

  const expanded = forceExpanded || isExpanded
  const inputJson = JSON.stringify(input, null, 2)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(inputJson)
    setCopied(true)
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    copiedTimerRef.current = setTimeout(() => setCopied(false), 2000)
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
