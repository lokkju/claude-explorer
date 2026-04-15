import { useCallback, useEffect, useState, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router'
import { Command } from 'cmdk'
import { Search, FileText, MessageSquare, X } from 'lucide-react'
import { useSearch } from '@/hooks/useConversations'
import { useSourceFilter } from '@/contexts/SourceFilterContext'
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
  const navigate = useNavigate()
  const { sourceFilter } = useSourceFilter()
  const matchIndexRef = useRef(-1)
  const lastQueryRef = useRef('')

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
        // Title-only match — navigate to conversation without message highlight
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

  // Navigate to a match — ConversationPage handles focus + message selection via highlight param
  const navigateToMatch = useCallback(
    (match: SearchMatch) => {
      navigate(
        `/conversations/${match.conversationUuid}${match.messageUuid ? `?highlight=${match.messageUuid}` : ''}`
      )
    },
    [navigate]
  )

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
  }, [flatMatches, navigateToMatch])

  const handleSelect = useCallback(
    (conversationUuid: string, messageUuid?: string) => {
      // Find this match's index so Cmd+G continues from here
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

  if (!open) return null

  return (
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

  // Get the first message match to use when clicking on the header
  const firstMessageUuid = messageMatches[0]?.message_uuid

  return (
    <Command.Item
      value={result.conversation_uuid}
      onSelect={() => onSelect(result.conversation_uuid, firstMessageUuid)}
      className="flex cursor-pointer flex-col gap-2 rounded-md px-3 py-2 hover:bg-zinc-100 aria-selected:bg-zinc-100 dark:hover:bg-zinc-800 dark:aria-selected:bg-zinc-800"
    >
      {/* Conversation header */}
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

      {/* Message snippets */}
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
