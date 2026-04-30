import { useState } from 'react'
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
}

export function CompactMarker({ marker, index, total, isActive, onPrev, onNext }: CompactMarkerProps) {
  const [isOpen, setIsOpen] = useState(false)

  const time = formatMessageTimestamp(marker.timestamp)
  const isManual = marker.kind === 'manual'

  return (
    <div
      data-compact-marker={marker.message_uuid}
      data-compact-marker-kind={marker.kind}
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

      {/* Inline-on-divider user prompt for manual compacts (always visible) */}
      {isManual && marker.user_prompt && !isOpen && (
        <div className="mt-2 flex justify-center">
          <div className="max-w-[80%] truncate rounded bg-blue-50 px-3 py-1 text-xs italic text-blue-900 dark:bg-blue-950 dark:text-blue-100">
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
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">
                You asked
              </div>
              <div className="rounded bg-blue-50 p-3 text-sm text-blue-900 dark:bg-blue-950 dark:text-blue-100">
                {marker.user_prompt}
              </div>
            </div>
          )}
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-purple-700 dark:text-purple-300">
              Summary
            </div>
            <div className="prose prose-sm dark:prose-invert max-w-none text-sm text-zinc-800 dark:text-zinc-200">
              <MarkdownRenderer content={marker.summary_text} showToolCalls={false} />
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
