import { useState } from 'react'
import { ImageOff } from 'lucide-react'
import { MarkdownRenderer } from '../MarkdownRenderer'
import { recordImageFailure } from '@/lib/imageFailureRegistry'
import type { ContentBlock } from '@/lib/types'
import { imageSourceUrl } from './imageCollection'
import { useImageFailureTombstone } from './useImageFailureTombstone'

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
  searchQuery?: string
}

export function CcImageMarkerText({
  content,
  showToolCalls,
  startCcIndex,
  onOpenCcImage,
  searchQuery,
}: CcImageMarkerTextProps) {
  // Use `matchAll` so we don't mutate `CC_IMAGE_MARKER_RE.lastIndex` during
  // render. The React 19 compiler flags module-scoped mutation as a render-
  // purity violation (and rightly so — two concurrent renders sharing the
  // regex's lastIndex would produce torn output). `matchAll` creates a fresh
  // iterator per call.
  const segments: Array<{ kind: 'text'; value: string } | { kind: 'image'; path: string }> = []
  let lastIndex = 0
  for (const match of content.matchAll(CC_IMAGE_MARKER_RE)) {
    const matchIndex = match.index ?? 0
    if (matchIndex > lastIndex) {
      segments.push({ kind: 'text', value: content.slice(lastIndex, matchIndex) })
    }
    segments.push({ kind: 'image', path: match[1].trim() })
    lastIndex = matchIndex + match[0].length
  }
  if (lastIndex < content.length) {
    segments.push({ kind: 'text', value: content.slice(lastIndex) })
  }
  if (segments.length === 0 || (segments.length === 1 && segments[0].kind === 'text')) {
    // Fast path: no markers, fall through to standard markdown rendering.
    return <MarkdownRenderer content={content} showToolCalls={showToolCalls} query={searchQuery} />
  }
  let imageOrdinal = 0
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.kind === 'text') {
          // Skip empty / whitespace-only text segments (common when a
          // marker is the entire message body).
          if (!seg.value.trim()) return null
          return <MarkdownRenderer key={i} content={seg.value} showToolCalls={showToolCalls} query={searchQuery} />
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

export function CcImageMarkerTile({
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

export function InlineImageBlock({
  source,
  onOpen,
}: {
  source: ContentBlock['source']
  onOpen: () => void
}) {
  // Hook order: ALL hooks must run on every render, even when we end up
  // returning null. Rules-of-hooks violation pre-Task-D: the tombstone
  // hook was called AFTER the `if (!src) return null` early return. If
  // a re-render switched `src` between null and non-null (props change),
  // React would change the hook count and throw / corrupt hook state.
  // Compute `src` first, then call ALL hooks, then conditionally render.
  const src = source ? imageSourceUrl(source) : null
  // V1 polish: session-level tombstone after 10 failures stops the
  // browser from re-fetching this URL on every remount. Only network
  // URLs get tombstoned — data: URLs are loaded inline and can't fail
  // a network request anyway. Pass empty string for missing/data: URLs
  // so the hook still runs unconditionally.
  const isNetworkUrl = src ? !src.startsWith('data:') : false
  const tombstoned = useImageFailureTombstone(isNetworkUrl && src ? src : '')
  const [errored, setErrored] = useState(false)
  const [retried, setRetried] = useState(false)
  if (!source) return null
  if (!src) return null
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
