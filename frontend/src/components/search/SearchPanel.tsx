import { useEffect, useMemo, useRef } from 'react'
import { Search, X, User, Bot, FileText, ArrowUpDown, Bookmark as BookmarkIcon, Loader2 } from 'lucide-react'
import { useSearchPanel, type SearchMatch } from '@/contexts/SearchPanelContext'
import { useNavigateToMatch } from '@/components/search/navigateToMatch'
import { useSettings } from '@/contexts/SettingsContext'
import { BookmarksPanel } from '@/components/bookmarks/BookmarksPanel'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn, formatDate } from '@/lib/utils'
import type { SortField } from '@/lib/types'

const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: 'updated_at', label: 'Last Activity' },
  { value: 'created_at', label: 'Start Time' },
  { value: 'name', label: 'Title' },
  { value: 'project', label: 'Project' },
]

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
    sortField,
    sortOrder,
    activeMatchIndex,
    flatMatches,
    isLoading,
    isSearching,
    close,
    setQuery,
    setContextSize,
    setSortField,
    setSortOrder,
    setActiveMatchIndex,
    focusRequestSeq,
  } = useSearchPanel()

  const navigateToMatch = useNavigateToMatch()
  const { rightPaneTab, setRightPaneTab } = useSettings()

  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const activeCardRef = useRef<HTMLButtonElement | null>(null)

  // Auto-focus the input whenever the panel opens, AND whenever a Cmd+F
  // focus-request comes in (focusRequestSeq bumped). The latter handles
  // the case where the panel is already open but the user pressed Cmd+F
  // from elsewhere on the page expecting "find" muscle memory to put
  // them in the search box.
  useEffect(() => {
    if (!isOpen) return
    const id = window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
    return () => window.clearTimeout(id)
  }, [isOpen, focusRequestSeq])

  // Scroll the active match card into view whenever activeMatchIndex
  // changes, AND auto-navigate to the active match. Article line 109:
  // "If match #7 is in one conversation and match #8 is in another,
  // ⌘+G takes you there anyway; you keep your hands on the keyboard
  // and you keep moving forward." Cmd+G / Cmd+Shift+G change
  // activeMatchIndex; this effect makes them actually navigate to the
  // newly-active match, both in-conversation and cross-conversation.
  useEffect(() => {
    if (activeMatchIndex < 0) return
    const el = activeCardRef.current
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
    const match = flatMatches[activeMatchIndex]
    if (match) {
      navigateToMatch(match)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMatchIndex])

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

  // Bug B (2026-05-03): use the unified `isSearching` flag (covers
  // first-load + refetch + debounce window) so we never show "No
  // matches" while a request is actually in flight or about to fire.
  const showEmptyTooShort = query.length < 2
  const showEmptyNoResults =
    query.length >= 2 && !isSearching && flatMatches.length === 0
  const showSkeleton = query.length >= 2 && isSearching && flatMatches.length === 0
  const showResults = query.length >= 2 && flatMatches.length > 0
  // Silence unused-var when isLoading falls out of any branch above.
  void isLoading

  return (
    <aside
      role="complementary"
      aria-label="Search panel"
      aria-hidden={!isOpen}
      className={cn(
        'fixed right-0 top-0 z-40 flex h-full w-96 flex-col border-l border-zinc-200 bg-white shadow-xl transition-transform duration-200 dark:border-zinc-800 dark:bg-zinc-900',
        !isOpen && 'translate-x-full'
      )}
    >
      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-zinc-200 px-2 pt-2 dark:border-zinc-800" role="tablist" aria-label="Right pane tabs">
        <button
          type="button"
          role="tab"
          aria-selected={rightPaneTab === 'search'}
          onClick={() => setRightPaneTab('search')}
          className={cn(
            'flex items-center gap-1 rounded-t-md border border-b-0 px-3 py-1 text-xs',
            rightPaneTab === 'search'
              ? 'border-zinc-200 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100'
              : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
          )}
        >
          <Search className="h-3 w-3" />
          Search
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={rightPaneTab === 'bookmarks'}
          onClick={() => setRightPaneTab('bookmarks')}
          className={cn(
            'flex items-center gap-1 rounded-t-md border border-b-0 px-3 py-1 text-xs',
            rightPaneTab === 'bookmarks'
              ? 'border-zinc-200 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100'
              : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
          )}
        >
          <BookmarkIcon className="h-3 w-3" />
          Bookmarks
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={close}
          className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          aria-label="Close panel"
          title="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {rightPaneTab === 'bookmarks' && <BookmarksPanel />}

      {rightPaneTab === 'search' && (
      <>
      {/* Header: input + context toggle */}
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
        </div>

        {/* Sort controls — mirror left sidebar; default updated_at + desc. */}
        <div className="mt-3 flex items-center gap-1">
          <Select
            value={sortField}
            onValueChange={(v: string) => {
              setSortField(v as SortField)
              // Restore focus so Enter still navigates after changing sort.
              window.setTimeout(() => inputRef.current?.focus(), 0)
            }}
          >
            <SelectTrigger className="flex-1 h-7 text-xs">
              <ArrowUpDown className="h-3 w-3 mr-1 text-zinc-400" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            type="button"
            onClick={() => {
              setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
              inputRef.current?.focus()
            }}
            title={sortOrder === 'asc' ? 'Ascending' : 'Descending'}
            className="h-7 rounded-md px-2 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {sortOrder === 'asc' ? '↑' : '↓'}
          </button>
        </div>

        {/* Context size toggle (segmented control) */}
        <div
          role="radiogroup"
          aria-label="Search context size"
          className="mt-2 inline-flex rounded-md border border-zinc-200 bg-zinc-50 p-0.5 text-xs dark:border-zinc-800 dark:bg-zinc-950"
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
          <div data-search-loading className="space-y-3">
            {/* Explicit "Searching…" copy + spinner so the user knows
                the request is in flight, not that there are zero
                results. (Bug B 2026-05-03 — was only skeletons before;
                e2e relied on visible text.) */}
            <div className="flex items-center justify-center gap-2 py-3 text-sm text-zinc-500 dark:text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Searching…</span>
            </div>
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
          <div className="space-y-1.5">
            {flatMatches.map((match, idx) => {
              const isActive = idx === activeMatchIndex
              const key = `${match.conversationUuid}:${match.messageUuid}:${match.matchStart}`
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
        )}
      </div>
      </>
      )}
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
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span
          className="flex-1 truncate text-xs font-semibold text-zinc-700 dark:text-zinc-200"
          title={match.conversationName}
        >
          {match.conversationName}
        </span>
        {match.createdAt && (
          <span className="shrink-0 text-[11px] text-zinc-400 dark:text-zinc-500">
            {formatDate(match.createdAt)}
          </span>
        )}
      </div>
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
