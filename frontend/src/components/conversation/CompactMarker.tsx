import { useEffect, useState } from 'react'
import { Scissors, ChevronDown, ChevronRight } from 'lucide-react'
import { cn, formatMessageTimestamp } from '@/lib/utils'
import { MarkdownRenderer } from '@/components/message/MarkdownRenderer'
import type { CompactMarker as CompactMarkerType } from '@/lib/types'

interface CompactMarkerProps {
  marker: CompactMarkerType
  index: number
  total: number
  isActive: boolean
  onPrev: () => void
  onNext: () => void
  /** When true, force the marker panel open (e.g., because the
   *  marker is the target of a search-hit highlight). Transitions
   *  false→true open the panel; subsequent user clicks can still
   *  collapse it. */
  forceOpen?: boolean
  /** Active full-text search query, threaded into the MarkdownRenderer
   *  for the summary text so matches inside the compact summary get
   *  `<mark>` highlights (matches the behavior MessageBubble already
   *  has). Empty / undefined means "no highlighting". */
  searchQuery?: string
}

export function CompactMarker({
  marker,
  index,
  total,
  isActive,
  onPrev,
  onNext,
  forceOpen,
  searchQuery,
}: CompactMarkerProps) {
  const [isOpen, setIsOpen] = useState(forceOpen ?? false)

  // 2026-05-22 (search-hit on compact bubble fix): when a search hit
  // targets a message whose UUID matches this marker, the parent
  // (ConversationPage) flips `forceOpen` to true. Open the panel so
  // the user can see the matched summary text. We don't track
  // forceOpen with a ref because the false→true edge is the only
  // case we care about — the user can collapse the panel again
  // afterward with the pill click.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Deliberate one-way derive: the false→true edge of forceOpen (parent flips it when a search hit targets this marker's UUID) opens the panel; the user can then collapse it via the pill click. A key prop would remount the marker and lose the user's subsequent collapse state. The block comment above documents why we don't track forceOpen with a ref.
    if (forceOpen) setIsOpen(true)
  }, [forceOpen])

  const time = formatMessageTimestamp(marker.timestamp)
  const isManual = marker.kind === 'manual'

  return (
    <div
      data-compact-marker={marker.message_uuid}
      data-compact-marker-kind={marker.kind}
      // 2026-05-22: mirror the data-message-uuid attribute that
      // MessageBubble uses so the search-hit highlight effect in
      // ConversationPage (querySelector on `[data-message-uuid=...]`)
      // can locate compact markers as scroll targets the same way it
      // locates regular message bubbles.
      data-message-uuid={marker.message_uuid}
      tabIndex={-1}
      {...(isActive ? { 'data-compact-marker-active': '' } : {})}
      className="relative my-6"
    >
      {/* Dashed divider running edge-to-edge behind the centered pill */}
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 border-t border-dashed border-purple-300 dark:border-purple-700" />

      <div className="relative flex items-center justify-center">
        <button
          type="button"
          data-compact-marker-pill
          onClick={() => setIsOpen((v) => !v)}
          className={cn(
            'flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium shadow-sm transition-colors',
            'border-purple-300 bg-purple-50 text-purple-800 hover:bg-purple-100',
            'dark:border-purple-700 dark:bg-purple-950 dark:text-purple-200 dark:hover:bg-purple-900',
            isActive && 'ring-2 ring-purple-400 ring-offset-2 dark:ring-offset-zinc-950'
          )}
          title={isManual ? 'Manual /compact' : 'Automatic compact'}
          aria-expanded={isOpen}
        >
          <Scissors className="h-3 w-3" aria-hidden />
          <span>
            Compacted{isManual ? ' (manual)' : ''} - {time}
          </span>
          {isOpen ? (
            <ChevronDown className="h-3 w-3" aria-hidden />
          ) : (
            <ChevronRight className="h-3 w-3" aria-hidden />
          )}
        </button>
      </div>

      {/* Inline-on-divider user prompt for manual compacts (always visible).
       *  2026-05-24 user report: the prompt previously used a blue color
       *  family which made it feel disconnected from the purple "Summary"
       *  block. Unified to purple so the whole compaction (pill +
       *  inline prompt teaser + open panel) reads as ONE block. */}
      {isManual && marker.user_prompt && !isOpen && (
        <div className="mt-2 flex justify-center">
          <div className="max-w-[80%] truncate rounded bg-purple-50 px-3 py-1 text-xs italic text-purple-900 dark:bg-purple-950 dark:text-purple-100">
            <span className="font-semibold not-italic">You asked: </span>
            {marker.user_prompt}
          </div>
        </div>
      )}

      {isOpen && (
        <div
          data-compact-marker-panel
          className="mt-3 rounded-lg border border-purple-200 bg-white p-4 shadow-sm dark:border-purple-800 dark:bg-zinc-900"
        >
          {isManual && marker.user_prompt && (
            <div className="mb-4">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-purple-700 dark:text-purple-300">
                You asked
              </div>
              {/* Match the Summary subsection's structure (label + body)
               *  but share the purple color family so they read as
               *  parallel parts of ONE compaction block, not two
               *  disjoint sub-panels. The faint purple-50 bg keeps
               *  the visual hierarchy between label and body. */}
              <div className="rounded bg-purple-50 p-3 text-sm text-purple-900 dark:bg-purple-950 dark:text-purple-100">
                {marker.user_prompt}
              </div>
            </div>
          )}
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-purple-700 dark:text-purple-300">
              Summary
            </div>
            <div className="prose prose-sm dark:prose-invert max-w-none text-sm text-zinc-800 dark:text-zinc-200">
              <MarkdownRenderer content={marker.summary_text} query={searchQuery} />
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
            <div>
              {index + 1} of {total} compact{total === 1 ? '' : 's'}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onPrev}
                disabled={index === 0}
                className={cn(
                  'rounded border px-2 py-1 text-xs',
                  index === 0
                    ? 'cursor-not-allowed border-zinc-200 text-zinc-300 dark:border-zinc-700 dark:text-zinc-600'
                    : 'border-purple-300 text-purple-800 hover:bg-purple-50 dark:border-purple-700 dark:text-purple-200 dark:hover:bg-purple-900'
                )}
              >
                Prev
              </button>
              <button
                type="button"
                onClick={onNext}
                disabled={index === total - 1}
                className={cn(
                  'rounded border px-2 py-1 text-xs',
                  index === total - 1
                    ? 'cursor-not-allowed border-zinc-200 text-zinc-300 dark:border-zinc-700 dark:text-zinc-600'
                    : 'border-purple-300 text-purple-800 hover:bg-purple-50 dark:border-purple-700 dark:text-purple-200 dark:hover:bg-purple-900'
                )}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
