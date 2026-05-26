import type { Message, ContentBlock, ImageFile } from '@/lib/types'

/**
 * CC-image catalog for one message bubble.
 *
 * `files` is the ordered list of synthetic `ImageFile` entries used by
 * `ImageLightbox` (and `ConversationLightboxContext.openAt`).
 *
 * `blockOffsets[i]` is the starting index in `files` for content block
 * `i`. A block contributes 0+ image entries (text blocks may contain
 * multiple `[Image: source: <path>]` markers, image blocks contribute
 * 1, all others contribute 0). The renderer slices into `files`
 * starting at `blockOffsets[i]` to lay out each block's images.
 */
export interface CcImageEntries {
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
 *
 * Pure function — no React state, no hooks. Safe to memoize at the
 * caller level via `useMemo(() => collectCcImages(message), [message])`.
 */
export function collectCcImages(message: Message): CcImageEntries {
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

/**
 * Resolve a `ContentBlock.source` (Anthropic-style inline image source)
 * to a browser-loadable URL. Returns `null` for unrecognized source
 * shapes so the caller can fall through to a fallback render.
 */
export function imageSourceUrl(source: NonNullable<ContentBlock['source']>): string | null {
  if (source.type === 'base64' && source.data) {
    const mt = source.media_type || 'image/png'
    return `data:${mt};base64,${source.data}`
  }
  if (source.type === 'url' && source.url) {
    return source.url
  }
  return null
}
