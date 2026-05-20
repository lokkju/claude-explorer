import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { FileText, FileType, GitBranch, Copy, Check, Wrench, Terminal, MessageSquare, FolderCode, ChevronsUpDown, ChevronDown, ChevronUp, Scissors, Download } from 'lucide-react'
import { toast } from 'sonner'
import { errorToast } from '@/lib/errorToast'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/queryClient'
import { useConversation } from '@/hooks/useConversations'
import { useSettings } from '@/contexts/SettingsContext'
import { useKeyboardNavigation, type MessageInfo } from '@/contexts/KeyboardNavigationContext'
import { useSearchPanel } from '@/contexts/SearchPanelContext'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { MessageBubble } from '@/components/message/MessageBubble'
import { ConversationLightboxProvider } from '@/contexts/ConversationLightboxContext'
import { CompactMarker } from '@/components/conversation/CompactMarker'
import { useBookmarks } from '@/contexts/BookmarkContext'
import { TreeViewModal } from '@/components/branch/TreeViewModal'
import { PinScopeButton } from '@/components/search/PinScopeButton'
import { MarkdownExportDialog } from '@/components/conversation/MarkdownExportDialog'
import { SessionPreludeAffordance } from '@/components/conversation/SessionPreludeAffordance'
import { cn, formatFullDate, sanitizeFilename, downloadBlob, conversationToMarkdown, messageHasVisibleContent } from '@/lib/utils'
import { api } from '@/lib/api'
import { ApiError } from '@/lib/types'
import { useUnmountSafeTimer } from '@/hooks/useUnmountSafeTimer'

export function ConversationPage() {
  const { uuid } = useParams<{ uuid: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const highlightMessageId = searchParams.get('highlight') || searchParams.get('m')
  const branchLeaf = searchParams.get('leaf') || undefined
  const { data: conversation, isLoading, error } = useConversation(uuid || '', branchLeaf)
  const {
    showToolCalls,
    setShowToolCalls,
    expandAllTools,
    setExpandAllTools,
    hideCompactMarkers,
    setHideCompactMarkers,
  } = useSettings()
  const { toggleBookmark } = useBookmarks()
  const queryClient = useQueryClient()
  const [isRefetching, setIsRefetching] = useState(false)
  const { isOpen: isSearchPanelOpen } = useSearchPanel()
  const {
    setMessages,
    setMessagesAndPinSelection,
    messages,
    selectedMessageIndex,
    setSelectedMessageIndex,
    getSelectedMessageId,
    getSelectedId,
    focusArea,
    setFocusArea,
  } = useKeyboardNavigation()
  const [isTreeOpen, setIsTreeOpen] = useState(false)
  const [markdownDialogOpen, setMarkdownDialogOpen] = useState(false)
  const [copiedAll, setCopiedAll] = useState(false)
  const [copiedUuid, setCopiedUuid] = useState(false)
  const [copiedPath, setCopiedPath] = useState(false)
  // S5 T2d (2026-05-20): unmount-safe scheduling for the 2s copy-feedback
  // flag clears. Bare setTimeout left orphan timers when the user clicked
  // Copy then navigated away before the 2s elapsed; React 18 silently
  // no-op'd the setState, but the warning surfaced in dev and React 19's
  // stricter semantics would surface it harder.
  const scheduleCopiedAllClear = useUnmountSafeTimer()
  const scheduleCopiedUuidClear = useUnmountSafeTimer()
  const scheduleCopiedPathClear = useUnmountSafeTimer()
  // The highlight-clear timer (sets the URL parameter after the
  // ring-flash animation completes) is scheduled from inside the
  // highlight useEffect — see below.
  const scheduleHighlightClear = useUnmountSafeTimer()
  const [showScrollButton, setShowScrollButton] = useState(false)
  const [showTopButton, setShowTopButton] = useState(false)
  const [activeCompactIdx, setActiveCompactIdx] = useState<number | null>(null)
  // V1 polish (2026-05-12, council round 2): CC sessions that opened with
  // one or more /exit runs have a "prelude" of synthetic markers BEFORE
  // the first real user turn (each marker absorbs its canned-response
  // assistant via `assistant_canned_response_consumed`). We hide them by
  // default so scroll-to-top lands on the real conversation start, and
  // surface a click-to-reveal affordance above the stream.
  const [showPrelude, setShowPrelude] = useState(false)
  // Reset the toggle when navigating between conversations so the next
  // CC session also opens with the prelude hidden.
  useEffect(() => {
    setShowPrelude(false)
  }, [uuid])
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  // Task A5 — PDF export spinner toast state.
  // `isExportingPdf` drives the `disabled` attribute on the button (needs
  // to trigger re-render). `isExportingPdfRef` is a synchronous re-entry
  // guard against rapid double-clicks before React commits the state.
  // `exportPdfAbortRef` lets us cancel the in-flight fetch on unmount —
  // otherwise the browser holds the connection slot and the backend
  // continues spending CPU on WeasyPrint for up to 30s after the user
  // navigates away. See PLANS/2026.05.18-perf-polish.md task A5.
  const [isExportingPdf, setIsExportingPdf] = useState(false)
  const isExportingPdfRef = useRef(false)
  const exportPdfAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => {
      exportPdfAbortRef.current?.abort()
    }
  }, [])

  const compactMarkers = useMemo(
    () => (hideCompactMarkers ? [] : conversation?.compact_markers ?? []),
    [conversation?.compact_markers, hideCompactMarkers]
  )

  const compactMarkerByUuid = useMemo(() => {
    const map = new Map<string, { marker: typeof compactMarkers[number]; index: number }>()
    compactMarkers.forEach((marker, index) => {
      map.set(marker.message_uuid, { marker, index })
    })
    return map
  }, [compactMarkers])

  const isCC = conversation?.source === 'CLAUDE_CODE'
  const hasCompactMarkers = (conversation?.compact_markers ?? []).length > 0

  // V1 polish (2026-05-12, council round 2): prelude markers (leading
  // `is_prelude: true` rows on CC sessions that opened with /exit) are
  // hidden by default. The `SessionPreludeAffordance` button above the
  // stream toggles `showPrelude`, which un-filters them.
  //
  // We filter at the LIST level (not inside MessageBubble) so the keyboard
  // navigation registration and the scrollTop landing position both ignore
  // the hidden messages — otherwise scroll-to-top would land on a hidden
  // bubble and the user would still see the prelude dominate.
  const preludeHiddenCount = conversation?.prelude_hidden_count ?? 0
  const visibleMessages = useMemo(() => {
    if (!conversation?.messages) return []
    if (showPrelude || preludeHiddenCount === 0) return conversation.messages
    return conversation.messages.filter((m) => !m.is_prelude)
  }, [conversation?.messages, showPrelude, preludeHiddenCount])

  const focusCompactMarker = useCallback((index: number) => {
    if (compactMarkers.length === 0) return
    const clamped = Math.max(0, Math.min(index, compactMarkers.length - 1))
    setActiveCompactIdx(clamped)
    const target = compactMarkers[clamped]
    if (!target) return
    const el = document.querySelector(`[data-compact-marker="${target.message_uuid}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [compactMarkers])

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    // Hunt #2: use currentTarget, which React types as the element the
    // handler is attached to (HTMLDivElement). e.target is the actual
    // event target (could be a descendant during bubbling) and was
    // previously cast with `as HTMLDivElement` — a runtime lie for any
    // scroll bubbled from a descendant.
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget
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

  // Register visible messages with keyboard navigation context.
  // Issue #2: when the list size changes (e.g. the user toggled the
  // Tools button so tool-only messages appear/disappear), we use the
  // pin-selection variant so the selected message UUID stays the
  // same across the resize instead of drifting to a different
  // message at the same numeric index.
  useEffect(() => {
    if (conversation?.messages) {
      // V1 polish (2026-05-12, council round 2): also exclude `is_prelude`
      // messages when the prelude is collapsed, so arrow-key navigation
      // doesn't try to focus a hidden bubble. When the user clicks "show"
      // the affordance, showPrelude flips and this re-runs, re-including
      // the prelude rows.
      const messageInfos: MessageInfo[] = conversation.messages
        .filter((msg) => {
          if (!showPrelude && msg.is_prelude) return false
          return messageHasVisibleContent(msg, showToolCalls)
        })
        .map((msg) => ({
          uuid: msg.uuid,
          sender: msg.sender,
        }))
      setMessagesAndPinSelection(messageInfos)
    }
    return () => {
      setMessages([])
    }
  }, [conversation?.messages, showToolCalls, showPrelude, setMessages, setMessagesAndPinSelection])

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

  // Keyboard: 'b' toggles bookmark on the focused message.
  useEffect(() => {
    if (!conversation) return
    const handler = (e: KeyboardEvent) => {
      // Hunt #2: e.target is EventTarget; reading .tagName /
      // .isContentEditable needs an HTMLElement narrowing.
      if (
        e.target instanceof HTMLElement &&
        (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)
      ) {
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key !== 'b' && e.key !== 'B') return
      const selectedId = getSelectedMessageId()
      if (!selectedId) return
      const msg = conversation.messages.find((m) => m.uuid === selectedId)
      if (!msg) return
      e.preventDefault()
      toggleBookmark({
        conversation_id: conversation.uuid,
        message_uuid: msg.uuid,
        source: conversation.source === 'CLAUDE_AI' ? 'claude_desktop' : 'claude_code',
        note: '',
        snippet: (msg.text || '').slice(0, 140),
      })
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [conversation, getSelectedMessageId, toggleBookmark])

  // Keyboard: '[' / ']' navigate compact markers within the open conversation.
  useEffect(() => {
    if (compactMarkers.length === 0) return
    const handler = (e: KeyboardEvent) => {
      // Hunt #2: see [/] handler above.
      if (
        e.target instanceof HTMLElement &&
        (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)
      ) {
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === ']') {
        e.preventDefault()
        focusCompactMarker(activeCompactIdx === null ? 0 : activeCompactIdx + 1)
      } else if (e.key === '[') {
        e.preventDefault()
        focusCompactMarker(activeCompactIdx === null ? compactMarkers.length - 1 : activeCompactIdx - 1)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [compactMarkers, activeCompactIdx, focusCompactMarker])

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
          // Cross-conversation Enter: SearchPanel.openActiveMatch can't reliably
          // call .focus() on the target bubble because the new conversation's
          // bubbles aren't mounted yet at the time of its requestAnimationFrame
          // callback. The visible scroll/highlight worked but DOM focus silently
          // didn't move (council soft concern on commit 113da97). The highlight
          // effect runs after the new ConversationPage mounts, so this is the
          // safe place to move keyboard focus too. Bubbles have tabIndex={-1}.
          if (element instanceof HTMLElement) {
            element.focus()
          }
          scheduleHighlightClear(() => {
            element.classList.remove('ring-2', 'ring-yellow-400', 'ring-offset-2')
            // Clear highlight/m params from URL but preserve everything else.
            setSearchParams((prev) => {
              const next = new URLSearchParams(prev)
              next.delete('highlight')
              next.delete('m')
              return next
            }, { replace: true })
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

  const handleExportPdf = async () => {
    // Task A5 — spinner toast UX during PDF export.
    //
    // Why all the moving parts:
    //   * `isExportingPdfRef` is a synchronous re-entry guard. The
    //     button is `disabled` on `isExportingPdf` state, but rapid
    //     double-clicks can fire before React commits the state.
    //   * `toastId` from `toast.loading()` is sonner's auto-generated
    //     unique id — passing it back into subsequent `toast.loading()`
    //     calls replaces the toast in place, and avoids collisions if
    //     the user has two browser tabs of the same conversation open.
    //   * The JSX body wraps the elapsed-seconds counter in
    //     `aria-hidden="true"` so screen readers only announce
    //     "Generating PDF…" once, not every tick.
    //   * `lastSec` throttles `toast.loading()` to once per visible
    //     change; the 250 ms interval ticks faster only to catch the
    //     second boundary promptly when the user clicks mid-second.
    //   * `AbortController` cancels the in-flight fetch on unmount.
    if (isExportingPdfRef.current) return
    isExportingPdfRef.current = true
    setIsExportingPdf(true)

    const controller = new AbortController()
    exportPdfAbortRef.current = controller

    const toastId = toast.loading(
      <span>
        Generating PDF… <span aria-hidden="true">0s</span>
      </span>,
      { duration: Infinity },
    )

    const startedAt = Date.now()
    let lastSec = 0
    const interval = window.setInterval(() => {
      const sec = Math.floor((Date.now() - startedAt) / 1000)
      if (sec === lastSec) return
      lastSec = sec
      toast.loading(
        <span>
          Generating PDF… <span aria-hidden="true">{sec}s</span>
        </span>,
        { id: toastId, duration: Infinity },
      )
    }, 250)

    try {
      const response = await api.exportPdf(
        conversation.uuid,
        showToolCalls,
        controller.signal,
      )
      clearInterval(interval)
      if (!response.ok) {
        toast.dismiss(toastId)
        if (response.status === 504) {
          // Backend wraps WeasyPrint in `asyncio.to_thread(...)` with a
          // 30-second timeout (commit 0be9395) and returns 504 on
          // overrun. Surface a user-readable workaround (Markdown
          // export still works for huge conversations).
          errorToast(
            'PDF generation timed out (>30s). The conversation may be too large to render. Try exporting Markdown instead.',
          )
        } else {
          errorToast(`PDF export failed (${response.status}).`)
        }
        return
      }
      const blob = await response.blob()
      toast.dismiss(toastId)
      downloadBlob(blob, `${sanitizeFilename(conversation.name)}.pdf`)
    } catch (err) {
      clearInterval(interval)
      toast.dismiss(toastId)
      // AbortError surfaces here when the component unmounts (cleanup
      // effect calls controller.abort()). That's intentional — no toast.
      if (err instanceof DOMException && err.name === 'AbortError') {
        return
      }
      errorToast('PDF export failed: network error.')
    } finally {
      clearInterval(interval)
      isExportingPdfRef.current = false
      setIsExportingPdf(false)
      if (exportPdfAbortRef.current === controller) {
        exportPdfAbortRef.current = null
      }
    }
  }

  const handleForceRefetch = async () => {
    if (!conversation) return
    setIsRefetching(true)
    try {
      await api.forceRefetchConversation(conversation.uuid)
      await queryClient.invalidateQueries({ queryKey: queryKeys.conversations.detail(conversation.uuid) })
      await queryClient.invalidateQueries({ queryKey: queryKeys.conversations.all })
      toast.success('Conversation re-downloaded.')
    } catch (e) {
      // Build-9 Bug 3: the backend returns FRIENDLY user copy in `detail`
      // for 404 / 401 / 503 (see backend/routers/fetch.py). The api layer
      // surfaces that as ApiError.message, so we can show it verbatim
      // instead of "Re-fetch failed: {\"detail\":\"...\"}".
      //
      // Hunt #2: narrow with `instanceof ApiError` instead of the prior
      // `as Error & { status?: number }` cast — the cast was a runtime
      // lie because catch sees `unknown`, and a non-Error throw (e.g.,
      // a thrown string from a future caller) would have crashed at
      // `.message` read. ApiError is the only typed throw site in
      // api.ts, so this also tightens the contract.
      const isApiErr = e instanceof ApiError
      const message = isApiErr
        ? e.message
        : (e instanceof Error ? e.message : 'Re-download failed.')
      // 404/401/503 messages are already actionable; don't offer Retry on
      // 404 (the conversation isn't coming back) or 401 (user must run
      // capture). Retry only on 5xx-ish unknown failures.
      const status = isApiErr ? e.status : undefined
      const allowRetry = status === undefined || (status >= 500 && status !== 503)
      errorToast(message, {
        retry: allowRetry ? handleForceRefetch : undefined,
      })
    } finally {
      setIsRefetching(false)
    }
  }

  const handleCopyAll = async () => {
    const markdown = conversationToMarkdown(
      conversation.name,
      conversation.messages,
      showToolCalls
    )
    await navigator.clipboard.writeText(markdown)
    setCopiedAll(true)
    scheduleCopiedAllClear(() => setCopiedAll(false), 2000)
  }

  return (
    <div
      onClick={() => setFocusArea('detail')}
      className={cn(
        'flex h-full flex-col',
        focusArea === 'detail' && 'ring-2 ring-inset ring-blue-500/50'
      )}
    >
      {/* Header
          Layout note: at narrow widths (≤1366px) the right-side action
          cluster (Tools, Expand, Re-download, Hide compact markers,
          Copy as Markdown, Markdown, PDF) was tall enough that it
          collided with the conversation metadata row underneath the
          title. Stack the rows vertically (`flex-col gap-3`) so the
          title + metadata block can never share horizontal space with
          the action buttons; the buttons get their own row that
          `flex-wrap`s to a second line if it still overflows. */}
      <header className="flex flex-col gap-3 border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-xl font-semibold text-zinc-900 dark:text-zinc-100">
              {conversation.name || 'Untitled'}
            </h1>
            <PinScopeButton
              conversationUuid={conversation.uuid}
              conversationName={conversation.name || 'Untitled'}
              projectPath={conversation.project_path}
              projectName={conversation.project_path?.split('/').filter(Boolean).pop() || null}
            />
          </div>
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
          <details open className="group mt-1 grid grid-cols-[auto_1fr] items-start gap-x-3">
            <summary
              className="flex cursor-pointer list-none items-center gap-1 text-xs text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300 [&::-webkit-details-marker]:hidden"
              title="Show conversation details"
            >
              <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-0 -rotate-90" />
              <span>Details</span>
            </summary>
            <div className="space-y-0.5">
              {conversation.source === 'CLAUDE_CODE' && conversation.project_path && (
                <div className="flex items-center gap-1 text-xs text-zinc-400 dark:text-zinc-500">
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
                  scheduleCopiedUuidClear(() => setCopiedUuid(false), 2000)
                }}
                className="flex items-center gap-1 font-mono text-xs text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
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
                    // Hunt #2: the surrounding `conversation.file_path &&`
                    // gates rendering, but the closure captures
                    // `conversation` not the narrowed value, so TS
                    // doesn't carry the narrowing into the async
                    // callback. Capture an explicit local instead of
                    // the old `conversation.file_path!`.
                    const filePath = conversation.file_path
                    if (!filePath) return
                    await navigator.clipboard.writeText(filePath)
                    setCopiedPath(true)
                    scheduleCopiedPathClear(() => setCopiedPath(false), 2000)
                  }}
                  className="flex items-center gap-1 font-mono text-xs text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
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
          </details>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
          {conversation.source === 'CLAUDE_AI' && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              onClick={handleForceRefetch}
              disabled={isRefetching}
              title="Re-download this conversation from Anthropic"
              aria-label="Re-download this conversation"
            >
              <Download className={cn('h-4 w-4', isRefetching && 'animate-pulse')} />
            </Button>
          )}
          {isCC && hasCompactMarkers && (
            <Button
              variant={hideCompactMarkers ? 'default' : 'outline'}
              size="sm"
              onClick={() => setHideCompactMarkers(!hideCompactMarkers)}
              title={hideCompactMarkers ? 'Show compact markers' : 'Hide compact markers'}
              aria-label={hideCompactMarkers ? 'Show compact markers' : 'Hide compact markers'}
            >
              <Scissors className="h-4 w-4" />
              <span className="ml-2">{hideCompactMarkers ? 'Show compact markers' : 'Hide compact markers'}</span>
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
          <Button variant="outline" size="sm" onClick={() => setMarkdownDialogOpen(true)}>
            <FileText className="h-4 w-4" />
            <span className="ml-2">Markdown</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportPdf}
            disabled={isExportingPdf}
            aria-busy={isExportingPdf}
          >
            <FileType className="h-4 w-4" />
            <span className="ml-2">PDF</span>
          </Button>
        </div>
      </header>

      {/* Messages */}
      <ConversationLightboxProvider messages={conversation.messages}>
      <div className="relative flex-1 overflow-hidden">
        <div
          ref={scrollAreaRef}
          data-testid="message-stream"
          className="h-full overflow-y-auto p-6"
          onScroll={handleScroll}
        >
          <div className="mx-auto max-w-3xl space-y-6">
            <SessionPreludeAffordance
              hiddenCount={preludeHiddenCount}
              expanded={showPrelude}
              onToggle={() => setShowPrelude((v) => !v)}
            />
            {visibleMessages.map((message) => {
              const selectedId = getSelectedMessageId()
              const isSelected = focusArea === 'detail' && message.uuid === selectedId
              const compactEntry = compactMarkerByUuid.get(message.uuid)
              if (compactEntry) {
                const { marker, index } = compactEntry
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
                    <CompactMarker
                      marker={marker}
                      index={index}
                      total={compactMarkers.length}
                      isActive={activeCompactIdx === index}
                      onPrev={() => focusCompactMarker(index - 1)}
                      onNext={() => focusCompactMarker(index + 1)}
                    />
                  </div>
                )
              }
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
                  onClick={() => {
                    const idx = messages.findIndex((m) => m.uuid === message.uuid)
                    if (idx !== -1) setSelectedMessageIndex(idx)
                  }}
                >
                  <MessageBubble
                    message={message}
                    isKeyboardSelected={isSelected}
                    conversationId={conversation.uuid}
                    conversationSource={conversation.source}
                  />
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
      </ConversationLightboxProvider>

      <MarkdownExportDialog
        open={markdownDialogOpen}
        onOpenChange={setMarkdownDialogOpen}
        conversationUuid={conversation.uuid}
        conversationName={conversation.name || 'conversation'}
      />

      {/* Tree View Modal */}
      {conversation.has_branches && (
        <TreeViewModal
          uuid={conversation.uuid}
          isOpen={isTreeOpen}
          onClose={() => setIsTreeOpen(false)}
          onSelectPath={(path) => {
            const leaf = path[path.length - 1]
            if (!leaf) return
            setSearchParams((prev) => {
              const next = new URLSearchParams(prev)
              next.set('leaf', leaf)
              return next
            })
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