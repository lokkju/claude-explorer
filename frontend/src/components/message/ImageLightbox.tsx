import { useCallback, useEffect, useEffectEvent } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
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

  // Keyboard handler is local to the lightbox. Uses capture phase +
  // stopPropagation so the lightbox always wins over the global
  // Vim/Emacs bindings in useKeyboardShortcuts.ts (which also has a
  // [role="dialog"] guard, but capture phase is defense in depth so a
  // future global handler regression doesn't immediately break the
  // lightbox keys).
  //
  // Phase 2 perf (React Doctor prefer-use-effect-event): the inner
  // callbacks (next/prev/close) and the latest file/url all change
  // identity on every parent render. Prior shape listed them as deps
  // and re-subscribed the window keydown listener on every render.
  // useEffectEvent (React 19 stable) captures the latest values
  // without forcing re-subscription; the effect now depends only on
  // `open`, which is the real lifecycle gate.
  const onKeydown = useEffectEvent((e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    let handled = false
    if (e.key === 'ArrowRight') {
      next()
      handled = true
    } else if (e.key === 'ArrowLeft') {
      prev()
      handled = true
    } else if (e.key === 'Escape') {
      close()
      handled = true
    } else if (e.key === 'd' && file) {
      triggerDownload(url, file.file_name)
      handled = true
    } else if (e.key === 'o' && url) {
      openOriginalInNewTab(url, file?.file_name ?? 'image')
      handled = true
    }
    if (handled) {
      e.preventDefault()
      e.stopPropagation()
    }
  })
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => onKeydown(e)
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close() }}>
      <DialogContent
        className="h-[100vh] w-[100vw] max-w-none rounded-none border-0 bg-black/90 p-0 sm:rounded-none"
        data-testid="image-lightbox"
      >
        <DialogTitle className="sr-only">
          {file ? imageAltText(file) : 'Image viewer'}
        </DialogTitle>
        {/* Phase 2 a11y: Radix Dialog requires either DialogDescription
            OR aria-describedby={undefined} explicitly. Without one, dev
            mode emits a warning that fails our e2e console-assertion
            (caught by the same fixtures protocol the article documents). */}
        <DialogDescription className="sr-only">
          Full-screen image viewer. Press Esc to close, arrow keys to navigate, d to download, o to open the original in a new tab.
        </DialogDescription>
        {file && (
          <>
            <header className="flex items-center justify-between gap-3 border-b border-zinc-800 bg-black/80 px-4 py-2 text-zinc-200">
              <div className="flex min-w-0 items-center gap-3 text-sm">
                <span className="truncate font-mono">{file.file_name}</span>
                {files.length > 1 && (
                  <span className="shrink-0 rounded bg-zinc-800 px-2 py-0.5 text-xs">
                    {(index ?? 0) + 1} / {files.length}
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
                  onClick={() => url && openOriginalInNewTab(url, file.file_name)}
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

/**
 * Manual finding 2026-05-04: clicking "Open original in new tab" for a
 * Claude Code inline base64 image opened an empty tab. Chrome (and
 * other major browsers) block top-frame navigation to data: URLs as a
 * phishing-mitigation since 2017 — `window.open('data:...', '_blank')`
 * silently produces about:blank.
 *
 * Fix: convert any data: URI to a blob: URL before passing to
 * `window.open()`. Real http(s) and `/api/...` URLs pass through as-is.
 */
function openOriginalInNewTab(url: string, filename: string) {
  let target = url
  if (url.startsWith('data:')) {
    try {
      const [meta, b64] = url.split(',', 2)
      const mime = meta.replace(/^data:/, '').replace(/;base64$/, '') || 'application/octet-stream'
      const bytes = atob(b64 || '')
      const buf = new Uint8Array(bytes.length)
      for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i)
      const blob = new Blob([buf], { type: mime })
      target = URL.createObjectURL(blob)
      // Revoke after 60s so the tab has time to load + cache; we don't
      // need long-term retention because this is a one-shot view.
      setTimeout(() => URL.revokeObjectURL(target), 60_000)
    } catch {
      // Fall through to original URL — at worst the tab's still empty,
      // not a regression.
    }
  }
  void filename
  window.open(target, '_blank', 'noopener,noreferrer')
}
