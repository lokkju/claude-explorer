/**
 * ConversationViewerScrollControls — the sticky jump-to-top /
 * jump-to-bottom button cluster pinned to the bottom-right of the
 * conversation viewer.
 *
 * Each button only renders when its visibility flag is true:
 *   - `showTopButton`    — set by `handleScroll` when scrollTop ≥ 200 px
 *   - `showScrollButton` — set by `handleScroll` when scrollHeight -
 *                          scrollTop - clientHeight ≥ 200 px
 *
 * The wrapping div animates its `right` position so the buttons slide
 * out of the way when the SearchPanel sidebar opens (25rem panel width),
 * matching the pre-extraction inline style. We accept the
 * `isSearchPanelOpen` boolean as a prop rather than reading
 * SearchPanelContext directly — keeps the component a pure presentation
 * surface with no context subscription cost.
 *
 * Extracted from ConversationPage.tsx (2026-05-31, Commit 2 of
 * PLANS/2026.05.31-conversationpage-decomposition.md). Behavior-preserving.
 */
import { ChevronDown, ChevronUp } from 'lucide-react'

interface ConversationViewerScrollControlsProps {
  showScrollButton: boolean
  showTopButton: boolean
  scrollToTop: () => void
  scrollToBottom: () => void
  isSearchPanelOpen: boolean
}

export function ConversationViewerScrollControls({
  showScrollButton,
  showTopButton,
  scrollToTop,
  scrollToBottom,
  isSearchPanelOpen,
}: ConversationViewerScrollControlsProps) {
  return (
    <div
      className="absolute bottom-6 flex flex-col gap-2 transition-[right] duration-200"
      style={{ right: isSearchPanelOpen ? '25rem' : '1.5rem' }}
    >
      {showTopButton && (
        <button
          type="button"
          onClick={scrollToTop}
          aria-label="Jump to top"
          title="Jump to top"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-900/80 text-white shadow-lg backdrop-blur-sm transition-all hover:bg-zinc-900 dark:bg-zinc-100/80 dark:text-zinc-900 dark:hover:bg-zinc-100"
        >
          <ChevronUp className="h-5 w-5" />
        </button>
      )}
      {showScrollButton && (
        <button
          type="button"
          onClick={scrollToBottom}
          aria-label="Jump to bottom"
          title="Jump to bottom"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-900/80 text-white shadow-lg backdrop-blur-sm transition-all hover:bg-zinc-900 dark:bg-zinc-100/80 dark:text-zinc-900 dark:hover:bg-zinc-100"
        >
          <ChevronDown className="h-5 w-5" />
        </button>
      )}
    </div>
  )
}
