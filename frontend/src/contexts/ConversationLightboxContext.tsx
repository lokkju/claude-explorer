import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { ImageLightbox } from '@/components/message/ImageLightbox'
import { dedupeImageFiles } from '@/lib/imageFiles'
import type { ImageFile, Message } from '@/lib/types'

/**
 * Conversation-level image catalog.
 *
 * Manual finding 2026-05-04: arrow-key nav in the lightbox should jump
 * across messages, not just within the bubble that owns it. People
 * remember conversations as one timeline of images, not a per-bubble
 * stack.
 *
 * Implementation: ConversationPage wraps its message stream with
 * `<ConversationLightboxProvider messages={...}>`. The provider builds
 * one flat ImageFile[] in document order:
 *   - For each message in order:
 *     - Desktop attachments (`message.files[]` deduped, image_kind only)
 *     - Then CC inline image content blocks (base64 source)
 *     - Then CC `[Image: source: <abs-path>]` text-marker images
 *
 * Each MessageBubble / MessageAttachments / inline renderer asks the
 * provider for its starting offset and calls `openAt(globalIdx)` when
 * the user clicks a tile. The provider mounts ONE <ImageLightbox> on
 * the conversation root, so ←/→ walk the whole catalog.
 */

export interface CatalogEntry {
  file: ImageFile
  /** UUID of the message this image came from. Used by openByUuid. */
  messageUuid: string
}

interface ConversationLightboxContextValue {
  files: ImageFile[]
  /** Global index for the first image of the given message UUID, or
   *  -1 if that message has no images in the catalog. */
  offsetForMessage: (messageUuid: string) => number
  openAt: (globalIdx: number) => void
  close: () => void
}

const ConversationLightboxContext = createContext<ConversationLightboxContextValue | null>(null)

export function ConversationLightboxProvider({
  messages,
  children,
}: {
  messages: Message[]
  children: ReactNode
}) {
  const [openIdx, setOpenIdx] = useState<number | null>(null)

  const catalog = useMemo(() => {
    const entries: CatalogEntry[] = []
    const offsetByMsg = new Map<string, number>()
    for (const m of messages) {
      const startIdx = entries.length
      let recorded = false
      // 1. Desktop file attachments (claude.ai-relative URLs).
      for (const file of dedupeImageFiles(m)) {
        entries.push({ file, messageUuid: m.uuid })
        recorded = true
      }
      // 2. CC content blocks: inline base64 + path-marker scans.
      if (m.content) {
        for (let bi = 0; bi < m.content.length; bi++) {
          const block = m.content[bi]
          if (block.type === 'image' && block.source) {
            const src = imageSourceUrl(block.source)
            if (src) {
              entries.push({
                file: {
                  file_kind: 'image',
                  file_uuid: `${m.uuid}:cc-inline:${bi}`,
                  file_name: `inline-image-${entries.length + 1}.png`,
                  created_at: m.created_at,
                  preview_asset: { url: src, file_variant: 'preview' },
                },
                messageUuid: m.uuid,
              })
              recorded = true
            }
          } else if (block.type === 'text' && block.text) {
            const re = /\[Image: source: ([^\]]+)\]/g
            let mm: RegExpExecArray | null
            while ((mm = re.exec(block.text)) !== null) {
              const path = mm[1].trim()
              const url = `/api/cc-image?path=${encodeURIComponent(path)}`
              const filename = path.split('/').pop() || `cc-image-${entries.length + 1}`
              entries.push({
                file: {
                  file_kind: 'image',
                  file_uuid: `${m.uuid}:cc-marker:${bi}:${mm.index}`,
                  file_name: filename,
                  created_at: m.created_at,
                  preview_asset: { url, file_variant: 'preview' },
                },
                messageUuid: m.uuid,
              })
              recorded = true
            }
          }
        }
      }
      if (recorded) offsetByMsg.set(m.uuid, startIdx)
    }
    return {
      files: entries.map((e) => e.file),
      offsetByMsg,
    }
  }, [messages])

  const offsetForMessage = useCallback(
    (uuid: string) => catalog.offsetByMsg.get(uuid) ?? -1,
    [catalog.offsetByMsg],
  )

  const openAt = useCallback((idx: number) => setOpenIdx(idx), [])
  const close = useCallback(() => setOpenIdx(null), [])

  const value = useMemo<ConversationLightboxContextValue>(
    () => ({ files: catalog.files, offsetForMessage, openAt, close }),
    [catalog.files, offsetForMessage, openAt, close],
  )

  return (
    <ConversationLightboxContext.Provider value={value}>
      {children}
      {/* Mounted once per conversation. ImageLightbox renders nothing
          when index is null. */}
      <ImageLightbox files={catalog.files} index={openIdx} onIndexChange={setOpenIdx} />
    </ConversationLightboxContext.Provider>
  )
}

export function useConversationLightbox(): ConversationLightboxContextValue {
  const ctx = useContext(ConversationLightboxContext)
  if (!ctx) {
    // Used outside a provider — return a no-op so callers that aren't
    // mounted under ConversationPage (rare) don't crash. Tile clicks
    // will silently no-op.
    return {
      files: [],
      offsetForMessage: () => -1,
      openAt: () => {},
      close: () => {},
    }
  }
  return ctx
}

function imageSourceUrl(source: NonNullable<import('@/lib/types').ContentBlock['source']>): string | null {
  if (source.type === 'base64' && source.data) {
    const mt = source.media_type || 'image/png'
    return `data:${mt};base64,${source.data}`
  }
  if (source.type === 'url' && source.url) {
    return source.url
  }
  return null
}
