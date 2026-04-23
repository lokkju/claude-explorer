import { useEffect, useMemo, useRef } from 'react'
import { Search, X, User, Bot, FileText } from 'lucide-react'
import { useSearchPanel, type SearchMatch } from '@/contexts/SearchPanelContext'
import { useNavigateToMatch } from '@/components/search/navigateToMatch'
import { cn, formatDate } from '@/lib/utils'

/**
 * Right-side search overlay panel. Always mounted; slides off-screen via
 * `translate-x-full` when closed so React Query state and input focus are
 * preserved across open/close cycles.
 *
 * This component does NOT register its own keyboard shortcuts — Task D's
 * centralized handler owns Cmd+K / Cmd+G / Escape.
 */
export function SearchPanel() {
  const {
    isOpen,
    query,
    contextSize,
    activeMatchIndex,
    flatMatches,
    results,
    isLoading,
    close,
    setQuery,
    setContextSize,
    setActiveMatchIndex,
  } = useSearchPanel()

  const navigateToMatch = useNavigateToMatch()

  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const activeCardRef = useRef<HTMLButtonElement | null>(null)

  // Auto-focus the input when the panel opens
  useEffect(() => {
    if (isOpen) {
      // Small delay so the focus happens after the slide-in transition settles
      const id = window.setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 0)
      return () => window.clearTimeout(id)
    }
  }, [isOpen])

  // Scroll the active match card into view whenever activeMatchIndex changes
  useEffect(() => {
    if (activeMatchIndex < 0) return
    const el = activeCardRef.current
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [activeMatchIndex])

  // Group flatMatches by conversationUuid while preserving order. We only need
  // this for indexing back into the global flat position when clicking a card.
  const flatIndexByKey = useMemo(() => {
    const map = new Map<string, number>()
    flatMatches.forEach((m, i) => {
      map.set(`${m.conversationUuid}:${m.messageUuid}:${m.matchStart}`, i)
    })
    return map
  }, [flatMatches])

  const handleCardClick = (match: SearchMatch) => {
    const key = `${match.conversationUuid}:${match.messageUuid}:${match.matchStart}`
    const idx = flatIndexByKey.get(key) ?? -1
    if (idx !== -1) setActiveMatchIndex(idx)
    navigateToMatch(match)
  }

  // Opens the currently active match (or the first one if none is active).
  // Used by Enter both in the input and anywhere else inside the panel.
  const openActiveMatch = () => {
    if (flatMatches.length === 0) return
    const idx = activeMatchIndex >= 0 ? activeMatchIndex : 0
    const match = flatMatches[idx]
    if (match) {
      setActiveMatchIndex(idx)
      handleCardClick(match)
    }
  }

  const showEmptyTooShort = query.length < 2
  const showEmptyNoResults =
    query.length >= 2 && !isLoading && flatMatches.length === 0
  const showSkeleton = query.length >= 2 && isLoading
  const showResults =
    query.length >= 2 && !isLoading && flatMatches.length > 0

  return (
    <aside
      role="complementary"
      aria-label="Search panel"
      aria-hidden={!isOpen}
      onKeyDownCapture={(e) => {
        // Make Enter navigate to the active match from ANY focusable element
        // inside the panel (input, toggle buttons, result cards). We intercept
        // in the capture phase so toggle buttons don't re-activate themselves
        // when they happen to hold focus.
        if (e.key === 'Enter' && !e.defaultPrevented) {
          const target = e.target as HTMLElement | null
          // Result cards should open themselves via their own click handler
          // (fired when focused + Enter pressed). Skip here to avoid double-fire.
          if (target?.closest('[data-result-card]')) return
          if (flatMatches.length > 0) {
            e.preventDefault()
            e.stopPropagation()
            openActiveMatch()
          }
        }
      }}
      className={cn(
        'fixed right-0 top-0 z-40 flex h-full w-96 flex-col border-l border-zinc-200 bg-white shadow-xl transition-transform duration-200 dark:border-zinc-800 dark:bg-zinc-900',
        !isOpen && 'translate-x-full'
      )}
    >
      {/* Header: input + close + context toggle */}
      <div className="border-b border-zinc-200 p-3 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  openActiveMatch()
                }
              }}
              placeholder="Search messages..."
              className="flex h-9 w-full rounded-md border border-zinc-200 bg-transparent pl-9 pr-3 py-1 text-sm shadow-sm transition-colors placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400 dark:border-zinc-800 dark:placeholder:text-zinc-400"
              aria-label="Search query"
              data-allow-shortcuts
            />
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label="Close search panel"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Context size toggle (segmented control) */}
        <div
          role="radiogroup"
          aria-label="Search context size"
          className="mt-3 inline-flex rounded-md border border-zinc-200 bg-zinc-50 p-0.5 text-xs dark:border-zinc-800 dark:bg-zinc-950"
        >
          <button
            type="button"
            role="radio"
            aria-checked={contextSize === 'snippet'}
            onClick={() => {
              setContextSize('snippet')
              // Return focus to the input so subsequent Enter navigates
              inputRef.current?.focus()
            }}
            className={cn(
              'rounded px-3 py-1 font-medium transition-colors',
              contextSize === 'snippet'
                ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
            )}
          >
            Snippet
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={contextSize === 'full'}
            onClick={() => {
              setContextSize('full')
              inputRef.current?.focus()
            }}
            className={cn(
              'rounded px-3 py-1 font-medium transition-colors',
              contextSize === 'full'
                ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
            )}
          >
            Full
          </button>
        </div>
      </div>

      {/* Match counter */}
      {flatMatches.length > 0 && (
        <div className="border-b border-zinc-200 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            {activeMatchIndex >= 0 ? activeMatchIndex + 1 : '—'}
          </span>{' '}
          of{' '}
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            {flatMatches.length}
          </span>{' '}
          matches
        </div>
      )}

      {/* Results area */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto p-3"
      >
        {showEmptyTooShort && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-zinc-500 dark:text-zinc-400">
            <Search className="h-8 w-8 text-zinc-300 dark:text-zinc-700" />
            <p>Type at least 2 characters to search</p>
          </div>
        )}

        {showSkeleton && (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="animate-pulse space-y-2 rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="h-3 w-2/3 rounded bg-zinc-200 dark:bg-zinc-800" />
                <div className="h-3 w-full rounded bg-zinc-200 dark:bg-zinc-800" />
                <div className="h-3 w-5/6 rounded bg-zinc-200 dark:bg-zinc-800" />
              </div>
            ))}
          </div>
        )}

        {showEmptyNoResults && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-zinc-500 dark:text-zinc-400">
            <Search className="h-8 w-8 text-zinc-300 dark:text-zinc-700" />
            <p>
              No matches for{' '}
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                &ldquo;{query}&rdquo;
              </span>
            </p>
          </div>
        )}

        {showResults && (
          <div className="space-y-4">
            {results.map((result) => {
              // Determine which flat matches correspond to this conversation.
              // Use the same flattening semantics as the context: if there are
              // message matches, list them; otherwise synthesize a title-only
              // match.
              const messageMatches = result.matching_messages.filter(
                (m) => m.message_uuid !== 'title'
              )
              const titleOnly =
                messageMatches.length === 0
                  ? result.matching_messages.find(
                      (m) => m.message_uuid === 'title'
                    )
                  : null

              const cardMatches: SearchMatch[] = (
                messageMatches.length > 0
                  ? messageMatches.map((msg) => ({
                      conversationUuid: result.conversation_uuid,
                      messageUuid: msg.message_uuid,
                      conversationName: result.conversation_name,
                      snippet: msg.snippet,
                      matchStart: msg.match_start,
                      matchEnd: msg.match_end,
                      sender: msg.sender,
                    }))
                  : [
                      {
                        conversationUuid: result.conversation_uuid,
                        messageUuid: 'title',
                        conversationName: result.conversation_name,
                        snippet: titleOnly?.snippet ?? result.conversation_name,
                        matchStart: titleOnly?.match_start ?? 0,
                        matchEnd: titleOnly?.match_end ?? 0,
                        sender: titleOnly?.sender ?? '',
                      },
                    ]
              )

              return (
                <section
                  key={result.conversation_uuid}
                  className="space-y-1.5"
                >
                  {/* Section header */}
                  <div className="flex items-baseline justify-between gap-2 px-1">
                    <h3
                      className="flex-1 truncate text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
                      title={result.conversation_name}
                    >
                      {result.conversation_name}
                    </h3>
                    <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500">
                      {formatDate(result.conversation_updated_at)}
                    </span>
                  </div>

                  {/* Cards for this conversation */}
                  <div className="space-y-1.5">
                    {cardMatches.map((match) => {
                      const key = `${match.conversationUuid}:${match.messageUuid}:${match.matchStart}`
                      const flatIdx = flatIndexByKey.get(key) ?? -1
                      const isActive =
                        flatIdx !== -1 && flatIdx === activeMatchIndex
                      return (
                        <ResultCard
                          key={key}
                          ref={isActive ? activeCardRef : undefined}
                          match={match}
                          isActive={isActive}
                          contextSize={contextSize}
                          onClick={() => handleCardClick(match)}
                        />
                      )
                    })}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </div>
    </aside>
  )
}

interface ResultCardProps {
  match: SearchMatch
  isActive: boolean
  contextSize: 'snippet' | 'full'
  onClick: () => void
}

const ResultCard = ({
  ref,
  match,
  isActive,
  contextSize,
  onClick,
}: ResultCardProps & { ref?: React.Ref<HTMLButtonElement> }) => {
  const isTitleMatch = match.messageUuid === 'title'
  const isHuman = match.sender === 'human'
  const Icon = isTitleMatch ? FileText : isHuman ? User : Bot
  const senderLabel = isTitleMatch
    ? 'title'
    : isHuman
      ? 'human'
      : 'assistant'

  return (
    <button
      ref={ref}
      type="button"
      data-result-card
      onClick={onClick}
      className={cn(
        'group block w-full rounded-md border border-zinc-200 bg-white p-2.5 text-left text-sm shadow-sm transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800',
        isActive && 'ring-2 ring-inset ring-blue-500'
      )}
    >
      <div className="mb-1 flex items-center gap-1.5 text-xs">
        <Icon
          className={cn(
            'h-3.5 w-3.5 shrink-0',
            isTitleMatch
              ? 'text-zinc-400'
              : isHuman
                ? 'text-blue-500 dark:text-blue-400'
                : 'text-emerald-500 dark:text-emerald-400'
          )}
        />
        <span
          className={cn(
            'font-medium',
            isTitleMatch
              ? 'text-zinc-500 dark:text-zinc-400'
              : isHuman
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-emerald-600 dark:text-emerald-400'
          )}
        >
          {senderLabel}
        </span>
      </div>
      <div
        className={cn(
          'whitespace-pre-wrap break-words text-sm leading-snug text-zinc-700 dark:text-zinc-200',
          contextSize === 'full' && 'max-h-48 overflow-y-auto'
        )}
      >
        <HighlightedSnippet
          text={match.snippet}
          start={match.matchStart}
          end={match.matchEnd}
        />
      </div>
    </button>
  )
}

interface HighlightedSnippetProps {
  text: string
  start: number
  end: number
}

/**
 * Renders a snippet with the range [start, end) wrapped in <mark>. Falls back
 * to plain text if the indices look bogus (out of bounds or inverted).
 */
function HighlightedSnippet({ text, start, end }: HighlightedSnippetProps) {
  if (
    start < 0 ||
    end <= start ||
    start >= text.length ||
    end > text.length
  ) {
    return <>{text}</>
  }
  const before = text.slice(0, start)
  const match = text.slice(start, end)
  const after = text.slice(end)
  return (
    <>
      {before}
      <mark className="rounded bg-yellow-200 px-0.5 font-medium dark:bg-yellow-800 dark:text-yellow-50">
        {match}
      </mark>
      {after}
    </>
  )
}
