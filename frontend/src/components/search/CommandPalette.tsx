import { useCallback, useEffect, useState, useRef, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Command } from 'cmdk'
import { Search, FileText, MessageSquare, X, Loader2 } from 'lucide-react'
import { useSearch } from '@/hooks/useConversations'
import { useSourceFilter } from '@/contexts/SourceFilterContext'
import { useKeyboardNavigation } from '@/contexts/KeyboardNavigationContext'
import { queryKeys } from '@/lib/queryClient'
import { api } from '@/lib/api'
import { cn, formatDate } from '@/lib/utils'
import type { SearchResult, MessageSnippet } from '@/lib/types'

interface SearchMatch {
  conversationUuid: string
  messageUuid?: string
  conversationName: string
  snippet?: string
  sender?: string
}

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [matchCounterVisible, setMatchCounterVisible] = useState(false)
  const [isNavigating, setIsNavigating] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { sourceFilter } = useSourceFilter()
  const { setFocusArea, setSelectedMessageIndex, messages } = useKeyboardNavigation()
  const matchIndexRef = useRef(-1)
  const lastQueryRef = useRef('')
  const counterTimerRef = useRef<ReturnType<typeof setTimeout>>()

  const currentUuid = useMemo(() => {
    const match = location.pathname.match(/\/conversations\/(.+)/)
    return match?.[1]
  }, [location.pathname])

  const { data: results, isLoading } = useSearch(query, sourceFilter)

  // Flatten results into navigable matches (message-level)
  const flatMatches = useMemo<SearchMatch[]>(() => {
    if (!results) return []
    const matches: SearchMatch[] = []
    for (const result of results) {
      const messageMatches = result.matching_messages.filter(
        (m) => m.message_uuid !== 'title'
      )
      if (messageMatches.length > 0) {
        for (const msg of messageMatches) {
          matches.push({
            conversationUuid: result.conversation_uuid,
            messageUuid: msg.message_uuid,
            conversationName: result.conversation_name,
            snippet: msg.snippet,
            sender: msg.sender,
          })
        }
      } else {
        matches.push({
          conversationUuid: result.conversation_uuid,
          conversationName: result.conversation_name,
        })
      }
    }
    return matches
  }, [results])

  // Save query for Cmd+G reuse
  useEffect(() => {
    if (query.length >= 2) {
      lastQueryRef.current = query
    }
  }, [query])

  // Prefetch first 5 unique conversations when search results arrive
  useEffect(() => {
    if (!results) return
    const seen = new Set<string>()
    for (const result of results.slice(0, 5)) {
      if (seen.has(result.conversation_uuid)) continue
      seen.add(result.conversation_uuid)
      queryClient.prefetchQuery({
        queryKey: queryKeys.conversations.detail(result.conversation_uuid),
        queryFn: () => api.getConversation(result.conversation_uuid),
        staleTime: Infinity,
      })
    }
  }, [results, queryClient])

  // Prefetch conversations near the current match position
  const prefetchNearby = useCallback(
    (currentIdx: number) => {
      for (let offset = 1; offset <= 2; offset++) {
        for (const idx of [currentIdx + offset, currentIdx - offset]) {
          if (idx >= 0 && idx < flatMatches.length) {
            const uuid = flatMatches[idx].conversationUuid
            if (!queryClient.getQueryData(queryKeys.conversations.detail(uuid))) {
              queryClient.prefetchQuery({
                queryKey: queryKeys.conversations.detail(uuid),
                queryFn: () => api.getConversation(uuid),
                staleTime: Infinity,
              })
            }
          }
        }
      }
    },
    [flatMatches, queryClient]
  )

  // Show match counter briefly
  const flashMatchCounter = useCallback(() => {
    setMatchCounterVisible(true)
    if (counterTimerRef.current) clearTimeout(counterTimerRef.current)
    counterTimerRef.current = setTimeout(() => setMatchCounterVisible(false), 3000)
  }, [])

  // Navigate to a match — fast path for same-conversation, full navigate for cross-conversation
  const navigateToMatch = useCallback(
    (match: SearchMatch) => {
      const isSameConversation = match.conversationUuid === currentUuid

      if (isSameConversation && match.messageUuid) {
        // Fast path: just scroll to the message, no URL navigation needed
        const msgIdx = messages.findIndex((m) => m.uuid === match.messageUuid)
        if (msgIdx !== -1) {
          setSelectedMessageIndex(msgIdx)
          setFocusArea('detail')
          // Scroll the message into view
          const element = document.querySelector(
            `[data-message-uuid="${match.messageUuid}"]`
          )
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' })
            // Flash highlight
            element.classList.add('ring-2', 'ring-yellow-400', 'ring-offset-2')
            setTimeout(() => {
              element.classList.remove('ring-2', 'ring-yellow-400', 'ring-offset-2')
            }, 2000)
          }
          return
        }
      }

      // Cross-conversation: check if cached
      const isCached = !!queryClient.getQueryData(
        queryKeys.conversations.detail(match.conversationUuid)
      )
      if (!isCached) {
        setIsNavigating(true)
      }

      navigate(
        `/conversations/${match.conversationUuid}${match.messageUuid ? `?highlight=${match.messageUuid}` : ''}`
      )
    },
    [currentUuid, messages, setSelectedMessageIndex, setFocusArea, queryClient, navigate]
  )

  // Clear navigating state when conversation loads
  useEffect(() => {
    if (isNavigating) {
      const cached = queryClient.getQueryData(
        queryKeys.conversations.detail(currentUuid || '')
      )
      if (cached) {
        setIsNavigating(false)
      }
    }
  }, [isNavigating, currentUuid, queryClient])

  // Cmd+K or Cmd+F to open, Cmd+G / Cmd+Shift+G to navigate matches
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const cmdOrCtrl = e.metaKey || e.ctrlKey

      // Cmd+K or Cmd+F: toggle palette
      if ((e.key === 'k' || e.key === 'f') && cmdOrCtrl) {
        e.preventDefault()
        setOpen((o) => !o)
        return
      }

      // Cmd+G: next match
      if (e.key === 'g' && cmdOrCtrl && !e.shiftKey) {
        e.preventDefault()
        if (flatMatches.length > 0) {
          matchIndexRef.current = (matchIndexRef.current + 1) % flatMatches.length
          navigateToMatch(flatMatches[matchIndexRef.current])
          prefetchNearby(matchIndexRef.current)
          flashMatchCounter()
          setOpen(false)
        } else if (lastQueryRef.current) {
          setQuery(lastQueryRef.current)
          setOpen(true)
        }
        return
      }

      // Cmd+Shift+G: previous match
      if (e.key === 'g' && cmdOrCtrl && e.shiftKey) {
        e.preventDefault()
        if (flatMatches.length > 0) {
          matchIndexRef.current =
            (matchIndexRef.current - 1 + flatMatches.length) % flatMatches.length
          navigateToMatch(flatMatches[matchIndexRef.current])
          prefetchNearby(matchIndexRef.current)
          flashMatchCounter()
          setOpen(false)
        } else if (lastQueryRef.current) {
          setQuery(lastQueryRef.current)
          setOpen(true)
        }
        return
      }
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [flatMatches, navigateToMatch, prefetchNearby, flashMatchCounter])

  const handleSelect = useCallback(
    (conversationUuid: string, messageUuid?: string) => {
      const idx = flatMatches.findIndex(
        (m) =>
          m.conversationUuid === conversationUuid &&
          m.messageUuid === messageUuid
      )
      if (idx !== -1) matchIndexRef.current = idx

      navigateToMatch({ conversationUuid, messageUuid, conversationName: '' })
      setOpen(false)
    },
    [navigateToMatch, flatMatches]
  )

  const handleClose = useCallback(() => {
    setOpen(false)
  }, [])

  // Match counter overlay (shown briefly after Cmd+G even when palette is closed)
  const matchCounter =
    !open && matchCounterVisible && flatMatches.length > 0 ? (
      <div className="fixed right-4 top-4 z-50 flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
        {isNavigating && (
          <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
        )}
        <span className="text-zinc-600 dark:text-zinc-300">
          Match {matchIndexRef.current + 1} of {flatMatches.length}
        </span>
        <span className="text-xs text-zinc-400">
          ⌘G / ⌘⇧G
        </span>
      </div>
    ) : null

  if (!open) return matchCounter

  return (
    <>
      {matchCounter}
      <div className="fixed inset-0 z-50">
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black/50"
          onClick={handleClose}
          aria-hidden="true"
        />

        {/* Dialog */}
        <div className="fixed left-1/2 top-[20%] w-full max-w-2xl -translate-x-1/2">
          <Command
            className="rounded-lg border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
            shouldFilter={false}
          >
            <div className="flex items-center border-b border-zinc-200 px-3 dark:border-zinc-800">
              <Search className="mr-2 h-4 w-4 shrink-0 text-zinc-500" />
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder="Search messages..."
                className="flex h-12 w-full bg-transparent py-3 text-sm outline-none placeholder:text-zinc-500 dark:placeholder:text-zinc-400"
                autoFocus
              />
              <button
                onClick={handleClose}
                className="ml-2 rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <X className="h-4 w-4 text-zinc-500" />
              </button>
            </div>

            <Command.List className="max-h-[400px] overflow-y-auto p-2">
              {query.length < 2 && (
                <Command.Empty className="py-6 text-center text-sm text-zinc-500">
                  Type at least 2 characters to search...
                </Command.Empty>
              )}

              {query.length >= 2 && isLoading && (
                <div className="py-6 text-center text-sm text-zinc-500">
                  Searching...
                </div>
              )}

              {query.length >= 2 && !isLoading && results?.length === 0 && (
                <Command.Empty className="py-6 text-center text-sm text-zinc-500">
                  No results found.
                </Command.Empty>
              )}

              {results?.map((result) => (
                <SearchResultItem
                  key={result.conversation_uuid}
                  result={result}
                  query={query}
                  onSelect={handleSelect}
                />
              ))}
            </Command.List>

            <div className="border-t border-zinc-200 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-800">
              <kbd className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono dark:bg-zinc-800">
                Enter
              </kbd>{' '}
              to select{' · '}
              <kbd className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono dark:bg-zinc-800">
                ⌘G
              </kbd>{' '}
              next match{' · '}
              <kbd className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono dark:bg-zinc-800">
                ⌘⇧G
              </kbd>{' '}
              prev{' · '}
              <kbd className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono dark:bg-zinc-800">
                Esc
              </kbd>{' '}
              to close
            </div>
          </Command>
        </div>
      </div>
    </>
  )
}

interface SearchResultItemProps {
  result: SearchResult
  query: string
  onSelect: (uuid: string, messageUuid?: string) => void
}

function SearchResultItem({ result, query, onSelect }: SearchResultItemProps) {
  const isTitleMatch = result.matching_messages.some(
    (m) => m.message_uuid === 'title'
  )
  const messageMatches = result.matching_messages.filter(
    (m) => m.message_uuid !== 'title'
  )

  const firstMessageUuid = messageMatches[0]?.message_uuid

  return (
    <Command.Item
      value={result.conversation_uuid}
      onSelect={() => onSelect(result.conversation_uuid, firstMessageUuid)}
      className="flex cursor-pointer flex-col gap-2 rounded-md px-3 py-2 hover:bg-zinc-100 aria-selected:bg-zinc-100 dark:hover:bg-zinc-800 dark:aria-selected:bg-zinc-800"
    >
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-zinc-400" />
        <span className="flex-1 truncate font-medium text-zinc-900 dark:text-zinc-100">
          {isTitleMatch ? (
            <HighlightedText text={result.conversation_name} query={query} />
          ) : (
            result.conversation_name
          )}
        </span>
        <span className="text-xs text-zinc-500">
          {formatDate(result.conversation_updated_at)}
        </span>
      </div>

      {messageMatches.slice(0, 3).map((snippet, idx) => (
        <SnippetPreview
          key={idx}
          snippet={snippet}
          query={query}
          onClick={(e) => {
            e.stopPropagation()
            onSelect(result.conversation_uuid, snippet.message_uuid)
          }}
        />
      ))}

      {messageMatches.length > 3 && (
        <div className="text-xs text-zinc-500">
          +{messageMatches.length - 3} more matches
        </div>
      )}
    </Command.Item>
  )
}

interface SnippetPreviewProps {
  snippet: MessageSnippet
  query: string
  onClick?: (e: React.MouseEvent) => void
}

function SnippetPreview({ snippet, query, onClick }: SnippetPreviewProps) {
  return (
    <div
      className="ml-6 flex items-start gap-2 text-sm rounded p-1 -m-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 cursor-pointer"
      onClick={onClick}
    >
      <MessageSquare className="mt-0.5 h-3 w-3 shrink-0 text-zinc-400" />
      <div className="min-w-0 flex-1">
        <span
          className={cn(
            'mr-2 text-xs font-medium',
            snippet.sender === 'human'
              ? 'text-blue-600 dark:text-blue-400'
              : 'text-emerald-600 dark:text-emerald-400'
          )}
        >
          {snippet.sender === 'human' ? 'You' : 'Claude'}:
        </span>
        <span className="text-zinc-600 dark:text-zinc-300">
          <HighlightedText text={snippet.snippet} query={query} />
        </span>
      </div>
    </div>
  )
}

interface HighlightedTextProps {
  text: string
  query: string
}

function HighlightedText({ text, query }: HighlightedTextProps) {
  if (!query) return <>{text}</>

  const regex = new RegExp(`(${escapeRegex(query)})`, 'gi')
  const parts = text.split(regex)

  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark
            key={i}
            className="rounded bg-yellow-200 px-0.5 dark:bg-yellow-800"
          >
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  )
}

function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
