import { useCallback, useEffect } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Download, ExternalLink, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { imageAltText, previewSrc } from '@/lib/imageFiles'
import type { ImageFile } from '@/lib/types'

interface ImageLightboxProps {
  files: ImageFile[]
  /** Index of the currently-shown image; null = closed. */
  index: number | null
  onIndexChange: (next: number | null) => void
}

/**
 * Full-screen image lightbox built on shadcn Dialog (Radix under the hood,
 * so focus trap + ESC close come for free).
 *
 * Local key bindings (only fire while the dialog is open):
 *   Esc     close (also handled by Radix natively)
 *   ←  / →  prev / next image in the same message
 *   d       download the current image
 *   o       open the original (preview asset URL) in a new tab
 *
 * Per the "no zoom/pan in v1" Council ruling, fit-to-viewport via
 * object-contain handles 90% of cases; for true native-size inspection,
 * the user clicks "Open original" and the browser's native viewer takes
 * over.
 */
export function ImageLightbox({ files, index, onIndexChange }: ImageLightboxProps) {
  const open = index !== null && files.length > 0 && index >= 0 && index < files.length
  const file = open ? files[index] : null
  const url = file ? previewSrc(file) : null

  const close = useCallback(() => onIndexChange(null), [onIndexChange])
  const next = useCallback(() => {
    if (index === null) return
    onIndexChange((index + 1) % files.length)
  }, [files.length, index, onIndexChange])
  const prev = useCallback(() => {
    if (index === null) return
    onIndexChange((index - 1 + files.length) % files.length)
  }, [files.length, index, onIndexChange])

  // Keyboard handler is local to the lightbox so it never fights the
  // global Vim/Emacs bindings in useKeyboardShortcuts.ts.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        next()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        prev()
      } else if (e.key === 'd' && file) {
        e.preventDefault()
        triggerDownload(url, file.file_name)
      } else if (e.key === 'o' && url) {
        e.preventDefault()
        window.open(url, '_blank', 'noopener,noreferrer')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, next, prev, file, url])

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close() }}>
      <DialogContent
        className="h-[100vh] w-[100vw] max-w-none rounded-none border-0 bg-black/90 p-0 sm:rounded-none"
        data-testid="image-lightbox"
      >
        <DialogTitle className="sr-only">
          {file ? imageAltText(file) : 'Image viewer'}
        </DialogTitle>
        {file && (
          <>
            <header className="flex items-center justify-between gap-3 border-b border-zinc-800 bg-black/80 px-4 py-2 text-zinc-200">
              <div className="flex min-w-0 items-center gap-3 text-sm">
                <span className="truncate font-mono">{file.file_name}</span>
                {files.length > 1 && (
                  <span className="shrink-0 rounded bg-zinc-800 px-2 py-0.5 text-xs">
                    {index! + 1} / {files.length}
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-zinc-200 hover:bg-zinc-800 hover:text-white"
                  onClick={() => triggerDownload(url, file.file_name)}
                  title="Download (d)"
                  aria-label="Download image"
                  disabled={!url}
                >
                  <Download className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-zinc-200 hover:bg-zinc-800 hover:text-white"
                  onClick={() => url && window.open(url, '_blank', 'noopener,noreferrer')}
                  title="Open original in new tab (o)"
                  aria-label="Open original in new tab"
                  disabled={!url}
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-zinc-200 hover:bg-zinc-800 hover:text-white"
                  onClick={close}
                  title="Close (Esc)"
                  aria-label="Close lightbox"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </header>
            <div className="relative flex h-[calc(100vh-49px)] items-center justify-center">
              {url ? (
                <img
                  src={url}
                  alt={imageAltText(file)}
                  className="max-h-full max-w-full object-contain"
                  draggable={false}
                />
              ) : (
                <div className="text-zinc-400">Image unavailable</div>
              )}
              {files.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={prev}
                    className={cn(
                      'absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2 text-zinc-200',
                      'hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white',
                    )}
                    aria-label="Previous image"
                    title="Previous (←)"
                  >
                    <ChevronLeft className="h-6 w-6" />
                  </button>
                  <button
                    type="button"
                    onClick={next}
                    className={cn(
                      'absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2 text-zinc-200',
                      'hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white',
                    )}
                    aria-label="Next image"
                    title="Next (→)"
                  >
                    <ChevronRight className="h-6 w-6" />
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function triggerDownload(url: string | null, filename: string) {
  if (!url) return
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}
