import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { FileText, FileType, GitBranch, Copy, Check, Wrench, Terminal, MessageSquare, FolderCode, ChevronsUpDown, ChevronDown, ChevronUp } from 'lucide-react'
import { useConversation } from '@/hooks/useConversations'
import { useSettings } from '@/contexts/SettingsContext'
import { useKeyboardNavigation, type MessageInfo } from '@/contexts/KeyboardNavigationContext'
import { useSearchPanel } from '@/contexts/SearchPanelContext'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { MessageBubble } from '@/components/message/MessageBubble'
import { TreeViewModal } from '@/components/branch/TreeViewModal'
import { cn, formatFullDate, sanitizeFilename, downloadBlob, conversationToMarkdown, messageHasVisibleContent } from '@/lib/utils'
import { api } from '@/lib/api'

export function ConversationPage() {
  const { uuid } = useParams<{ uuid: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const highlightMessageId = searchParams.get('highlight')
  const { data: conversation, isLoading, error } = useConversation(uuid || '')
  const { showToolCalls, setShowToolCalls, expandAllTools, setExpandAllTools } = useSettings()
  const { isOpen: isSearchPanelOpen } = useSearchPanel()
  const {
    setMessages,
    messages,
    selectedMessageIndex,
    setSelectedMessageIndex,
    getSelectedMessageId,
    getSelectedId,
    focusArea,
    setFocusArea,
  } = useKeyboardNavigation()
  const [isTreeOpen, setIsTreeOpen] = useState(false)
  const [copiedAll, setCopiedAll] = useState(false)
  const [copiedUuid, setCopiedUuid] = useState(false)
  const [copiedPath, setCopiedPath] = useState(false)
  const [showScrollButton, setShowScrollButton] = useState(false)
  const [showTopButton, setShowTopButton] = useState(false)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement
    const { scrollTop, scrollHeight, clientHeight } = target
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 200
    const isNearTop = scrollTop < 200
    setShowScrollButton(!isNearBottom)
    setShowTopButton(!isNearTop)
  }, [])

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  const scrollToTop = useCallback(() => {
    scrollAreaRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  // Reset message index when a new conversation is opened
  const prevUuidRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (uuid && uuid !== prevUuidRef.current) {
      prevUuidRef.current = uuid
      setSelectedMessageIndex(0)
    }
  }, [uuid, setSelectedMessageIndex])

  // Register visible messages with keyboard navigation context
  useEffect(() => {
    if (conversation?.messages) {
      const messageInfos: MessageInfo[] = conversation.messages
        .filter((msg) => messageHasVisibleContent(msg, showToolCalls))
        .map((msg) => ({
          uuid: msg.uuid,
          sender: msg.sender,
        }))
      setMessages(messageInfos)
    }
    return () => {
      setMessages([])
    }
  }, [conversation?.messages, showToolCalls, setMessages])

  // Auto-scroll to selected message
  useEffect(() => {
    if (focusArea === 'detail' && conversation?.messages) {
      const selectedId = getSelectedMessageId()
      if (selectedId) {
        const element = messageRefs.current.get(selectedId)
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }
    }
  }, [selectedMessageIndex, focusArea, conversation?.messages, getSelectedMessageId])

  // Scroll to highlighted message, select it, and focus detail pane
  useEffect(() => {
    if (highlightMessageId && conversation && !isLoading) {
      // Focus the detail pane and select the highlighted message
      setFocusArea('detail')
      const msgIdx = messages.findIndex((m) => m.uuid === highlightMessageId)
      if (msgIdx !== -1) {
        setSelectedMessageIndex(msgIdx)
      }

      // Small delay to ensure DOM is rendered
      const timer = setTimeout(() => {
        const element = document.querySelector(
          `[data-message-uuid="${highlightMessageId}"]`
        )
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' })
          // Flash highlight effect
          element.classList.add('ring-2', 'ring-yellow-400', 'ring-offset-2')
          setTimeout(() => {
            element.classList.remove('ring-2', 'ring-yellow-400', 'ring-offset-2')
            // Clear the highlight param from URL
            setSearchParams({}, { replace: true })
          }, 2000)
        }
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [highlightMessageId, conversation, isLoading, setSearchParams, setFocusArea, messages, setSelectedMessageIndex])

  // When sidebar has focus and keyboard selection differs from displayed conversation,
  // show a hint instead of the (stale) conversation content
  const sidebarSelectedId = getSelectedId()
  const sidebarSelectionDiffers = focusArea === 'list' && sidebarSelectedId && sidebarSelectedId !== uuid

  if (!uuid || sidebarSelectionDiffers) {
    return <HintState />
  }

  if (isLoading) {
    return <LoadingState />
  }

  if (error || !conversation) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Conversation not found
          </h2>
          <p className="text-sm text-zinc-500">
            The conversation you're looking for doesn't exist.
          </p>
        </div>
      </div>
    )
  }

  const handleExportMarkdown = async () => {
    const response = await api.exportMarkdown(conversation.uuid, showToolCalls)
    const blob = await response.blob()
    downloadBlob(blob, `${sanitizeFilename(conversation.name)}.md`)
  }

  const handleExportPdf = async () => {
    const response = await api.exportPdf(conversation.uuid, showToolCalls)
    const blob = await response.blob()
    downloadBlob(blob, `${sanitizeFilename(conversation.name)}.pdf`)
  }

  const handleCopyAll = async () => {
    const markdown = conversationToMarkdown(
      conversation.name,
      conversation.messages,
      showToolCalls
    )
    await navigator.clipboard.writeText(markdown)
    setCopiedAll(true)
    setTimeout(() => setCopiedAll(false), 2000)
  }

  return (
    <div
      onClick={() => setFocusArea('detail')}
      className={cn(
        'flex h-full flex-col',
        focusArea === 'detail' && 'ring-2 ring-inset ring-blue-500/50'
      )}
    >
      {/* Header */}
      <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <div className="flex-1 min-w-0">
          <h1 className="truncate text-xl font-semibold text-zinc-900 dark:text-zinc-100">
            {conversation.name || 'Untitled'}
          </h1>
          <div className="mt-1 flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
            {conversation.source === 'CLAUDE_CODE' ? (
              <Badge variant="secondary" className="flex items-center gap-1 bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                <Terminal className="h-3 w-3" />
                Code
              </Badge>
            ) : (
              <Badge variant="secondary" className="flex items-center gap-1 bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                <MessageSquare className="h-3 w-3" />
                Desktop
              </Badge>
            )}
            <Badge variant="secondary">{conversation.model}</Badge>
            <span>{formatFullDate(conversation.created_at)}</span>
            <span>{conversation.message_count} messages</span>
            {conversation.has_branches && (
              <button
                onClick={() => setIsTreeOpen(true)}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950"
              >
                <GitBranch className="h-3 w-3" />
                View branches
              </button>
            )}
          </div>
          {conversation.source === 'CLAUDE_CODE' && conversation.project_path && (
            <div className="mt-1 flex items-center gap-1 text-xs text-zinc-400 dark:text-zinc-500">
              <FolderCode className="h-3 w-3" />
              <span className="font-mono">{conversation.project_path}</span>
              {conversation.git_branch && (
                <>
                  <GitBranch className="ml-2 h-3 w-3" />
                  <span className="font-mono">{conversation.git_branch}</span>
                </>
              )}
            </div>
          )}
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(conversation.uuid)
              setCopiedUuid(true)
              setTimeout(() => setCopiedUuid(false), 2000)
            }}
            className="mt-1 flex items-center gap-1 font-mono text-xs text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
            title="Click to copy UUID"
          >
            {copiedUuid ? (
              <Check className="h-3 w-3 text-green-500" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
            <span>{conversation.uuid}</span>
          </button>
          {conversation.file_path && (
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(conversation.file_path!)
                setCopiedPath(true)
                setTimeout(() => setCopiedPath(false), 2000)
              }}
              className="mt-0.5 flex items-center gap-1 font-mono text-xs text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
              title="Click to copy file path"
            >
              {copiedPath ? (
                <Check className="h-3 w-3 text-green-500" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
              <span className="truncate max-w-lg">{conversation.file_path}</span>
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={showToolCalls ? 'default' : 'outline'}
            size="sm"
            onClick={() => setShowToolCalls(!showToolCalls)}
            title={showToolCalls ? 'Hide tool calls' : 'Show tool calls'}
          >
            <Wrench className="h-4 w-4" />
            <span className="ml-2">Tools</span>
          </Button>
          {showToolCalls && (
            <Button
              variant={expandAllTools ? 'default' : 'outline'}
              size="sm"
              onClick={() => setExpandAllTools(!expandAllTools)}
              title={expandAllTools ? 'Collapse all tools' : 'Expand all tools'}
            >
              <ChevronsUpDown className="h-4 w-4" />
              <span className="ml-2">{expandAllTools ? 'Collapse' : 'Expand'}</span>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyAll}
            title="Copy conversation as Markdown"
            aria-label="Copy as Markdown"
          >
            {copiedAll ? (
              <Check className="h-4 w-4 text-green-500" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            <span className="ml-2">Copy as Markdown</span>
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportMarkdown}>
            <FileText className="h-4 w-4" />
            <span className="ml-2">Markdown</span>
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportPdf}>
            <FileType className="h-4 w-4" />
            <span className="ml-2">PDF</span>
          </Button>
        </div>
      </header>

      {/* Messages */}
      <div className="relative flex-1 overflow-hidden">
        <div
          ref={scrollAreaRef}
          data-testid="message-stream"
          className="h-full overflow-y-auto p-6"
          onScroll={handleScroll}
        >
          <div className="mx-auto max-w-3xl space-y-6">
            {conversation.messages.map((message) => {
              const selectedId = getSelectedMessageId()
              const isSelected = focusArea === 'detail' && message.uuid === selectedId
              return (
                <div
                  key={message.uuid}
                  ref={(el) => {
                    if (el) {
                      messageRefs.current.set(message.uuid, el)
                    } else {
                      messageRefs.current.delete(message.uuid)
                    }
                  }}
                >
                  <MessageBubble message={message} isKeyboardSelected={isSelected} />
                </div>
              )
            })}
            <div ref={messagesEndRef} />
          </div>
        </div>

        <div
          className="absolute bottom-6 flex flex-col gap-2 transition-[right] duration-200"
          style={{ right: isSearchPanelOpen ? '25rem' : '1.5rem' }}
        >
          {showTopButton && (
            <button
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
              onClick={scrollToBottom}
              aria-label="Jump to bottom"
              title="Jump to bottom"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-900/80 text-white shadow-lg backdrop-blur-sm transition-all hover:bg-zinc-900 dark:bg-zinc-100/80 dark:text-zinc-900 dark:hover:bg-zinc-100"
            >
              <ChevronDown className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      {/* Tree View Modal */}
      {conversation.has_branches && (
        <TreeViewModal
          uuid={conversation.uuid}
          isOpen={isTreeOpen}
          onClose={() => setIsTreeOpen(false)}
          onSelectPath={(path) => {
            // TODO: Implement branch switching by updating the view
            // For now, just close the modal
            console.log('Selected path:', path)
          }}
        />
      )}
    </div>
  )
}

function HintState() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <p className="text-sm text-zinc-500">
          Press <kbd className="mx-1 rounded border border-zinc-300 bg-zinc-100 px-1.5 py-0.5 font-mono text-xs dark:border-zinc-600 dark:bg-zinc-800">Enter</kbd> to open this conversation.
        </p>
      </div>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <div className="flex-1">
          <div className="h-6 w-48 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="mt-2 h-4 w-32 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        </div>
      </header>
      <div className="flex-1 p-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className={`flex ${i % 2 === 0 ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`h-24 w-2/3 animate-pulse rounded-lg ${
                  i % 2 === 0 ? 'bg-blue-100 dark:bg-blue-900' : 'bg-zinc-100 dark:bg-zinc-800'
                }`}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}