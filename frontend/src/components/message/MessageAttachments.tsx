import { useState } from 'react'
import { ImageOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { dedupeImageFiles, imageAltText, thumbnailSrc } from '@/lib/imageFiles'
import { useConversationLightbox } from '@/contexts/ConversationLightboxContext'
import type { ImageFile, Message } from '@/lib/types'

interface MessageAttachmentsProps {
  message: Pick<Message, 'files' | 'files_v2'> & { uuid?: string }
  /** Attached id used by parent (e.g. MessageBubble) so external code
   *  can route 'open first image' actions here. Not required. */
  bubbleUuid?: string
}

/**
 * Renders the image attachments on a message as an adaptive grid:
 *   - 1 image  → single tile, aspect preserved, max-h-64
 *   - 2-4      → 2-column grid of square (object-cover) tiles
 *   - 5+       → 4 square tiles + a "+N" overflow tile (still opens
 *                lightbox to image #5 on click)
 *
 * Tiles are <button> elements (not bare <img>) for keyboard + screen
 * reader access. Lazy-load the inline thumbnails to avoid network
 * hammering on long conversations with many images.
 */
export function MessageAttachments({ message, bubbleUuid }: MessageAttachmentsProps) {
  const files = dedupeImageFiles(message)
  // Manual finding 2026-05-04 follow-up: open the conversation-level
  // lightbox at the right global index so ←/→ walk all conversation
  // images, not just this bubble's files.
  const conversationLightbox = useConversationLightbox()
  const messageUuid = bubbleUuid ?? message.uuid ?? ''
  const baseIdx = messageUuid ? conversationLightbox.offsetForMessage(messageUuid) : -1
  const open = (localIdx: number) => {
    if (baseIdx < 0) return
    conversationLightbox.openAt(baseIdx + localIdx)
  }

  if (files.length === 0) return null

  const isSingle = files.length === 1
  const overflow = files.length > 5
  const tilesShown = overflow ? files.slice(0, 4) : files
  const overflowCount = overflow ? files.length - 4 : 0

  return (
    <div
      className="mt-2"
      data-message-attachments
      data-attachment-count={files.length}
      data-bubble-uuid={bubbleUuid}
    >
      {isSingle ? (
        <ImageTile file={files[0]} onOpen={() => open(0)} variant="single" />
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {tilesShown.map((file, i) => (
            <ImageTile
              key={file.file_uuid}
              file={file}
              onOpen={() => open(i)}
            />
          ))}
          {overflow && (
            <button
              type="button"
              onClick={() => open(4)}
              className={cn(
                'relative flex aspect-square items-center justify-center overflow-hidden rounded-md',
                'border border-zinc-200 bg-zinc-100 text-sm font-medium text-zinc-700',
                'hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400',
                'dark:border-zinc-800 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700',
              )}
              aria-label={`Show ${overflowCount} more attachments`}
            >
              +{overflowCount}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function ImageTile({
  file,
  onOpen,
  variant = 'multi',
}: {
  file: ImageFile
  onOpen: () => void
  variant?: 'single' | 'multi'
}) {
  const [loaded, setLoaded] = useState(false)
  const [errored, setErrored] = useState(false)
  const src = thumbnailSrc(file)
  const bg = file.preview_asset?.primary_color ?? file.thumbnail_asset?.primary_color

  if (errored || !src) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'flex items-center justify-center gap-2 rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-3 py-4 text-xs text-zinc-500',
          'dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400',
          variant === 'multi' && 'aspect-square',
        )}
        aria-label={`${imageAltText(file)} (unavailable)`}
        title="Image unavailable"
      >
        <ImageOff className="h-4 w-4 shrink-0" />
        <span className="truncate font-mono">{file.file_name || 'image'}</span>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      style={bg ? { backgroundColor: `#${bg}` } : undefined}
      className={cn(
        'group relative overflow-hidden rounded-md border border-zinc-200 bg-zinc-100',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400',
        'dark:border-zinc-800 dark:bg-zinc-800',
        variant === 'multi' && 'aspect-square',
      )}
      aria-label={imageAltText(file)}
      title={file.file_name}
    >
      <img
        src={src}
        alt={imageAltText(file)}
        loading="lazy"
        decoding="async"
        draggable={false}
        onLoad={() => setLoaded(true)}
        onError={() => setErrored(true)}
        className={cn(
          'block h-full w-full transition-opacity duration-200',
          variant === 'single' ? 'max-h-64 object-contain' : 'object-cover',
          loaded ? 'opacity-100' : 'opacity-0',
        )}
        data-loaded={loaded ? 'true' : 'false'}
        data-image-uuid={file.file_uuid}
      />
    </button>
  )
}
