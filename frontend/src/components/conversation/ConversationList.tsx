import { useNavigate, useParams } from 'react-router'
import { Star, GitBranch } from 'lucide-react'
import { useConversations } from '@/hooks/useConversations'
import { Badge } from '@/components/ui/badge'
import { cn, formatDate } from '@/lib/utils'
import type { ConversationSummary } from '@/lib/types'

interface ConversationListProps {
  searchQuery?: string
}

export function ConversationList({ searchQuery }: ConversationListProps) {
  const { uuid: selectedUuid } = useParams()
  const navigate = useNavigate()
  const { data: conversations, isLoading, error } = useConversations(
    searchQuery ? { search: searchQuery } : undefined
  )

  if (isLoading) {
    return <ConversationListSkeleton />
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-red-500">
        Failed to load conversations
      </div>
    )
  }

  if (!conversations || conversations.length === 0) {
    return (
      <div className="p-4 text-sm text-zinc-500">
        {searchQuery ? 'No conversations found' : 'No conversations yet'}
      </div>
    )
  }

  // Separate starred and unstarred
  const starred = conversations.filter((c) => c.is_starred)
  const unstarred = conversations.filter((c) => !c.is_starred)

  return (
    <div className="flex flex-col">
      {starred.length > 0 && (
        <>
          <div className="px-4 py-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Starred
          </div>
          {starred.map((conv) => (
            <ConversationListItem
              key={conv.uuid}
              conversation={conv}
              isSelected={conv.uuid === selectedUuid}
              onClick={() => navigate(`/conversations/${conv.uuid}`)}
            />
          ))}
          <div className="mx-4 my-2 border-t border-zinc-200 dark:border-zinc-800" />
        </>
      )}
      {unstarred.map((conv) => (
        <ConversationListItem
          key={conv.uuid}
          conversation={conv}
          isSelected={conv.uuid === selectedUuid}
          onClick={() => navigate(`/conversations/${conv.uuid}`)}
        />
      ))}
    </div>
  )
}

interface ConversationListItemProps {
  conversation: ConversationSummary
  isSelected: boolean
  onClick: () => void
}

function ConversationListItem({
  conversation,
  isSelected,
  onClick,
}: ConversationListItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800',
        isSelected && 'bg-zinc-100 dark:bg-zinc-800'
      )}
    >
      <div className="flex items-start gap-2">
        {conversation.is_starred && (
          <Star className="mt-0.5 h-4 w-4 fill-yellow-400 text-yellow-400" />
        )}
        <span className="flex-1 truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {conversation.name || 'Untitled'}
        </span>
        {conversation.has_branches && (
          <GitBranch className="h-4 w-4 text-zinc-400" />
        )}
      </div>
      <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
          {conversation.model}
        </Badge>
        <span>{formatDate(conversation.updated_at)}</span>
        <span>{conversation.message_count} msgs</span>
      </div>
    </button>
  )
}

function ConversationListSkeleton() {
  return (
    <div className="flex flex-col gap-1 p-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2 px-4 py-3">
          <div className="h-4 w-3/4 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        </div>
      ))}
    </div>
  )
}