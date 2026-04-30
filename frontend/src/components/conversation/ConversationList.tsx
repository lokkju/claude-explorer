import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Star, GitBranch, Terminal, MessageSquare, ChevronRight, Bot, FolderCode, ChevronDown } from 'lucide-react'
import { useConversations } from '@/hooks/useConversations'
import { useKeyboardNavigation } from '@/contexts/KeyboardNavigationContext'
import { Badge } from '@/components/ui/badge'
import { cn, formatDate } from '@/lib/utils'
import { patternMatches, type FilterMode } from '@/lib/filterEngine'
import type { ConversationSummary, SubagentSummary, SourceFilter, SortField, SortOrder } from '@/lib/types'

interface ConversationListProps {
  searchQuery?: string
  sourceFilter?: SourceFilter
  includePhantom?: boolean
  sortField?: SortField
  sortOrder?: SortOrder
  groupByProject?: boolean
  projectSlug?: string
  titleFilter?: string
  titleFilterMode?: FilterMode
}

export function ConversationList({
  searchQuery,
  sourceFilter,
  includePhantom,
  sortField = 'updated_at',
  sortOrder = 'desc',
  groupByProject = false,
  projectSlug,
  titleFilter,
  titleFilterMode = 'glob',
}: ConversationListProps) {
  const { uuid: selectedUuid } = useParams()
  const navigate = useNavigate()
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const { selectedIndex, setSelectedIndex, setConversationIds, focusArea, setNavSource } = useKeyboardNavigation()
  const filters = {
    ...(searchQuery && { search: searchQuery }),
    ...(sourceFilter && sourceFilter !== 'all' && { source: sourceFilter }),
    ...(includePhantom && { includePhantom: true }),
    sort: sortField,
    sortOrder: sortOrder,
  }
  const { data: rawConversations, isLoading, error } = useConversations(filters)

  const conversations = useMemo(() => {
    if (!rawConversations) return rawConversations
    let list = rawConversations
    if (projectSlug) {
      list = list.filter((c) => (c.project_name ?? '').toLowerCase() === projectSlug.toLowerCase())
    }
    if (titleFilter) {
      list = list.filter((c) => patternMatches(c.name, titleFilter, titleFilterMode))
    }
    return list
  }, [rawConversations, projectSlug, titleFilter, titleFilterMode])

  // Register conversation IDs with navigation context (in display order: starred first)
  useEffect(() => {
    if (conversations) {
      // Order IDs to match display: starred first, then unstarred
      const starred = conversations.filter((c) => c.is_starred)
      const unstarred = conversations.filter((c) => !c.is_starred)
      const orderedConversations = [...starred, ...unstarred]
      const ids = orderedConversations.map((c) => c.uuid)
      setConversationIds(ids)
    }
  }, [conversations, setConversationIds])

  // Sync selectedIndex with the currently viewed conversation (from URL)
  // Only runs when the URL or conversation list changes, NOT when selectedIndex changes
  // (otherwise it would override keyboard navigation)
  useEffect(() => {
    if (selectedUuid && conversations) {
      const starred = conversations.filter((c) => c.is_starred)
      const unstarred = conversations.filter((c) => !c.is_starred)
      const orderedConversations = [...starred, ...unstarred]
      const index = orderedConversations.findIndex((c) => c.uuid === selectedUuid)
      if (index !== -1) {
        setSelectedIndex(index)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUuid, conversations, setSelectedIndex])

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

  // Toggle group collapse
  const toggleGroup = (groupName: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupName)) {
        next.delete(groupName)
      } else {
        next.add(groupName)
      }
      return next
    })
  }

  // Separate starred and unstarred (display order: starred first)
  const starred = conversations.filter((c) => c.is_starred)
  const unstarred = conversations.filter((c) => !c.is_starred)
  const orderedConversations = [...starred, ...unstarred]

  // Helper to check if a conversation is keyboard-selected (uses display order)
  const isKeyboardSelected = (uuid: string) => {
    if (focusArea !== 'list') return false
    const displayIndex = orderedConversations.findIndex((c) => c.uuid === uuid)
    return displayIndex === selectedIndex
  }

  // Group by project if enabled
  if (groupByProject) {
    // Group all conversations by project
    const groups = new Map<string, ConversationSummary[]>()

    for (const conv of conversations) {
      const groupKey =
        conv.source === 'CLAUDE_CODE'
          ? conv.project_name || 'Unknown Project'
          : 'Claude Desktop'
      if (!groups.has(groupKey)) {
        groups.set(groupKey, [])
      }
      groups.get(groupKey)!.push(conv)
    }

    // Groups inherit sort order from their first member (conversations is already sorted by sortField/sortOrder)
    const sortedGroups = Array.from(groups.entries())

    return (
      <div className="flex flex-col">
        {sortedGroups.map(([groupName, groupConvs]) => {
          const isCollapsed = collapsedGroups.has(groupName)
          const starredInGroup = groupConvs.filter((c) => c.is_starred)
          const unstarredInGroup = groupConvs.filter((c) => !c.is_starred)

          return (
            <div key={groupName}>
              <button
                onClick={() => toggleGroup(groupName)}
                className="flex w-full items-center gap-2 px-4 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                <ChevronDown
                  className={cn(
                    'h-3 w-3 transition-transform',
                    isCollapsed && '-rotate-90'
                  )}
                />
                {groupName === 'Claude Desktop' ? (
                  <MessageSquare className="h-3 w-3 text-blue-500" />
                ) : (
                  <FolderCode className="h-3 w-3 text-amber-500" />
                )}
                <span className="flex-1 truncate text-left">{groupName}</span>
                <span className="text-zinc-400">({groupConvs.length})</span>
              </button>
              {!isCollapsed && (
                <div className="ml-2 border-l border-zinc-200 dark:border-zinc-700">
                  {starredInGroup.map((conv) => (
                    <ConversationListItem
                      key={conv.uuid}
                      conversation={conv}
                      isSelected={conv.uuid === selectedUuid}
                      isKeyboardSelected={isKeyboardSelected(conv.uuid)}
                      onClick={() => { setNavSource('list'); navigate(`/conversations/${conv.uuid}`) }}
                      showProject={false}
                    />
                  ))}
                  {unstarredInGroup.map((conv) => (
                    <ConversationListItem
                      key={conv.uuid}
                      conversation={conv}
                      isSelected={conv.uuid === selectedUuid}
                      isKeyboardSelected={isKeyboardSelected(conv.uuid)}
                      onClick={() => { setNavSource('list'); navigate(`/conversations/${conv.uuid}`) }}
                      showProject={false}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  // Flat view (no grouping)
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
              isKeyboardSelected={isKeyboardSelected(conv.uuid)}
              onClick={() => { setNavSource('list'); navigate(`/conversations/${conv.uuid}`) }}
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
          isKeyboardSelected={isKeyboardSelected(conv.uuid)}
          onClick={() => { setNavSource('list'); navigate(`/conversations/${conv.uuid}`) }}
        />
      ))}
    </div>
  )
}

interface ConversationListItemProps {
  conversation: ConversationSummary
  isSelected: boolean
  isKeyboardSelected: boolean
  onClick: () => void
  showProject?: boolean
}

function ConversationListItem({
  conversation,
  isSelected,
  isKeyboardSelected,
  onClick,
  showProject = true,
}: ConversationListItemProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const itemRef = useRef<HTMLDivElement>(null)
  const subagents = conversation.subagents || []
  const hasSubagents = subagents.length > 0

  // Scroll keyboard-selected item into view
  useEffect(() => {
    if (isKeyboardSelected && itemRef.current) {
      itemRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [isKeyboardSelected])

  // Also scroll URL-selected item into view (e.g., when Cmd+G navigates
  // cross-conversation and focusArea is still 'search')
  useEffect(() => {
    if (isSelected && itemRef.current) {
      itemRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [isSelected])

  return (
    <div>
      <div
        ref={itemRef}
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onClick()
          }
        }}
        className={cn(
          'flex w-full cursor-pointer flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800',
          isSelected && 'bg-zinc-100 dark:bg-zinc-800',
          isKeyboardSelected && 'ring-2 ring-inset ring-blue-400 dark:ring-blue-500'
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
        {/* Project name for Claude Code sessions (hide when grouped by project) */}
        {showProject && conversation.source === 'CLAUDE_CODE' && conversation.project_name && (
          <div className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
            <FolderCode className="h-3 w-3 text-amber-500" />
            <span className="truncate">{conversation.project_name}</span>
          </div>
        )}
        <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          {conversation.source === 'CLAUDE_CODE' ? (
            <span title="Claude Code"><Terminal className="h-3 w-3 text-green-500" /></span>
          ) : (
            <span title="Claude Desktop"><MessageSquare className="h-3 w-3 text-blue-500" /></span>
          )}
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            {conversation.model}
          </Badge>
          <span>{formatDate(conversation.updated_at)}</span>
          <span>{conversation.message_count} msgs</span>
          {hasSubagents && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                setIsExpanded(!isExpanded)
              }}
              className="flex items-center gap-1 rounded px-1 py-0.5 text-purple-600 hover:bg-purple-50 dark:text-purple-400 dark:hover:bg-purple-950"
            >
              <ChevronRight className={cn("h-3 w-3 transition-transform", isExpanded && "rotate-90")} />
              <Bot className="h-3 w-3" />
              <span>{subagents.length}</span>
            </button>
          )}
        </div>
        <div className="truncate font-mono text-[10px] text-zinc-400 dark:text-zinc-600">
          {conversation.uuid}
        </div>
      </div>
      {isExpanded && hasSubagents && (
        <div className="ml-6 border-l-2 border-purple-200 dark:border-purple-800">
          {subagents.map((agent) => (
            <SubagentListItem key={agent.uuid} agent={agent} />
          ))}
        </div>
      )}
    </div>
  )
}

interface SubagentListItemProps {
  agent: SubagentSummary
}

function SubagentListItem({ agent }: SubagentListItemProps) {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-2 text-left">
      <div className="flex items-center gap-2">
        <Bot className="h-3 w-3 text-purple-500" />
        <span className="flex-1 truncate text-xs font-medium text-zinc-700 dark:text-zinc-300">
          {agent.name}
        </span>
      </div>
      <div className="flex items-center gap-2 text-[10px] text-zinc-400 dark:text-zinc-500">
        <span>{agent.message_count} msgs</span>
        <span>{formatDate(agent.updated_at)}</span>
      </div>
    </div>
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