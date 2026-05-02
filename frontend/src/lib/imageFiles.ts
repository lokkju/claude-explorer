import type { ImageFile, Message } from './types'

/**
 * Merge Message.files and Message.files_v2 and dedup by file_uuid.
 * When duplicates exist, prefer the entry with preview_asset.url present
 * (the v2 array sometimes has richer metadata than v1).
 */
export function dedupeImageFiles(message: Pick<Message, 'files' | 'files_v2'>): ImageFile[] {
  const merged = [...(message.files ?? []), ...(message.files_v2 ?? [])]
  const byUuid = new Map<string, ImageFile>()
  for (const file of merged) {
    if (file.file_kind !== 'image') continue
    const existing = byUuid.get(file.file_uuid)
    if (!existing) {
      byUuid.set(file.file_uuid, file)
      continue
    }
    // Prefer the entry with a preview_asset.url; otherwise keep first.
    if (!existing.preview_asset?.url && file.preview_asset?.url) {
      byUuid.set(file.file_uuid, file)
    }
  }
  return Array.from(byUuid.values())
}

/**
 * Best-effort URL for the inline thumbnail. Falls back through:
 *   thumbnail_asset.url -> thumbnail_url -> preview_asset.url
 */
export function thumbnailSrc(file: ImageFile): string | null {
  return file.thumbnail_asset?.url ?? file.thumbnail_url ?? file.preview_asset?.url ?? null
}

/**
 * Best-effort URL for the lightbox display.
 */
export function previewSrc(file: ImageFile): string | null {
  return file.preview_asset?.url ?? file.thumbnail_url ?? file.thumbnail_asset?.url ?? null
}

/**
 * "Image attachment: filename" — used as alt text and aria-label.
 * Filenames like "1771181774649_image.png" are common; keep them as-is
 * (better than empty alt) but add the descriptive prefix for screen
 * readers.
 */
export function imageAltText(file: ImageFile): string {
  return `Image attachment: ${file.file_name || 'unnamed'}`
}
