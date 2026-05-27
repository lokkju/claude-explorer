import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, useTransition, useDeferredValue } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { useVirtualizer } from '@tanstack/react-virtual'
import { FileText, FileType, GitBranch, Copy, Check, Wrench, Terminal, MessageSquare, FolderCode, ChevronsUpDown, ChevronDown, ChevronUp, Scissors, Download } from 'lucide-react'
import { toast } from 'sonner'
import { errorToast } from '@/lib/errorToast'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/queryClient'
import { useConversation } from '@/hooks/useConversations'
import { useSettings } from '@/contexts/SettingsContext'
import { useKeyboardNavigation, type MessageInfo, type FocusArea } from '@/contexts/KeyboardNavigationContext'
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
import { cn, formatFullDate, sanitizeFilename, downloadBlob, conversationToMarkdown, messageHasVisibleContent, computeVisibleMessages } from '@/lib/utils'
import { api } from '@/lib/api'
import { ApiError } from '@/lib/types'
import type { Message, ConversationDetail, CompactMarker as CompactMarkerType } from '@/lib/types'
import { scrollBubbleIntoView } from '@/lib/scrollBubbleIntoView'
import { useUnmountSafeTimer } from '@/hooks/useUnmountSafeTimer'
import {
  expandAllToolsButtonLabel,
  computeScrollAnchorAdjustment,
} from '@/components/conversation/expandAllToolsLabel'

export function ConversationPage() {
  const { uuid } = useParams<{ uuid: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const highlightMessageId = searchParams.get('highlight') || searchParams.get('m')
  // 2026-05-23: when `?focus=0` is present, navigate + scroll + ring
  // but DO NOT move DOM focus to the bubble. This is how the search
  // auto-promote effect (live-preview UX while the user is typing)
  // opts out of focus-steal. Default behavior (no param OR `focus=1`)
  // preserves the pre-existing always-focus behavior for deep-link
  // URLs and user-initiated Cmd+G / Enter / click-on-card navigation.
  const shouldFocusOnHighlight = searchParams.get('focus') !== '0'
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
  // V1 polish 2026-05-24 (Bug 2) — unified toggle: the conversation
  // header's "Show Compactions" checkbox (whose underlying pref is
  // `hideCompactMarkers`) drives BOTH viewer visibility AND export
  // inclusion. The previous separate `export.includeCompactContent`
  // pref is removed. Mapping: includeCompact = !hideCompactMarkers.
  const includeCompactInExports = !hideCompactMarkers
  const { toggleBookmark } = useBookmarks()
  const queryClient = useQueryClient()
  const [isRefetching, setIsRefetching] = useState(false)
  const {
    isOpen: isSearchPanelOpen,
    query: searchPanelQuery,
    activeMatchIndex,
    flatMatches,
  } = useSearchPanel()
  // 2026-05-24 search-highlight fix: the active-match UUID is the
  // sidebar's currently-selected match (Cmd+G / card-click / auto-
  // promote). It's STABLE while the user is reading — it only changes
  // on the next search navigation. We use it (not `highlightMessageId`,
  // which is the ephemeral `?highlight=` URL param cleared after 2 s)
  // to gate which bubble gets the live `searchQuery` for inline `<mark>`
  // decoration. Result: matching tokens stay yellow inside the bubble
  // the user just scrolled to, even after the URL cleanup fires.
  //
  // Perf preservation: only ONE bubble (the active match) gets non-
  // empty searchQuery; every other bubble gets '' (referentially
  // stable empty string → React.memo bailout still works → no all-
  // bubbles-rerender storm per keystroke).
  const activeMatchUuid =
    activeMatchIndex >= 0 && activeMatchIndex < flatMatches.length
      ? flatMatches[activeMatchIndex]?.messageUuid ?? null
      : null
  // Issue 3 fix (2026-05-20): an earlier iteration (c6c31b7) had every
  // MessageBubble subscribe to SearchPanelContext directly via
  // `useSearchPanelOptional()` so it could highlight the live query
  // inline. On a 15K-message conversation, the resulting
  // ALL-bubbles-re-render-per-keystroke storm locked the main thread
  // for multiple seconds and starved the smooth-scroll animation that
  // search-hit navigation depends on. Read `query` once HERE (one
  // context subscription), defer it (lets React deprioritize the bulk
  // re-render), and thread it down as a prop. MessageBubble's memo
  // comparator now includes `searchQuery` so the deferred-value flip
  // actually short-circuits unchanged subtrees, and scrollIntoView
  // wins its animation frame.
  const deferredSearchQuery = useDeferredValue(searchPanelQuery)
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

  // P11.A11.1 cached-per-id ref-setter factory (2026-05-23). The previous
  // shape used inline arrow callbacks at the bubble-list .map() sites:
  //   ref={(el) => { if (el) messageRefs.current.set(uuid, el); else
  //                  messageRefs.current.delete(uuid) }}
  // React invokes the OLD ref callback with `null` and the NEW one with
  // the element whenever the ref callback's function IDENTITY changes,
  // and inline arrows change identity every parent render. At 4051
  // visible bubbles, one parent re-render fires 2N = 8102 ref-callback
  // invocations — and ConversationPage re-renders on every Settings /
  // SearchPanel / Keyboard context churn. The cached factory below
  // returns the SAME function per uuid across renders, so React's ref
  // reconciler treats unchanged-identity as a no-op.
  //
  // Cleanup contract: when the element detaches (`el === null`), we
  // delete BOTH the DOM ref entry AND the cached factory entry so the
  // cache doesn't grow unboundedly. This matters under virtualization
  // where rows mount/unmount during scroll and under hide-toggles
  // (Tools, prelude) that drop entries from `visibleMessages`.
  const refSettersRef = useRef<
    Map<string, (el: HTMLDivElement | null) => void>
  >(new Map())
  const getSetRef = useCallback((uuid: string) => {
    const existing = refSettersRef.current.get(uuid)
    if (existing) return existing
    const fn = (el: HTMLDivElement | null) => {
      if (el) {
        messageRefs.current.set(uuid, el)
      } else {
        messageRefs.current.delete(uuid)
        // Prevent unbounded cache growth for filterable / removable
        // lists. The next time this uuid appears (e.g. user toggles
        // Tools back on), getSetRef will lazily re-create the callback.
        refSettersRef.current.delete(uuid)
      }
    }
    refSettersRef.current.set(uuid, fn)
    return fn
  }, [])

  // Issue 2 + 3 (2026-05-20) — "Expand/Collapse all tools" UX.
  //
  // Issue 2: setExpandAllTools cascades a synchronous re-render through
  // every ToolUseBlock / ToolResultBlock. On a long conversation that
  // takes hundreds of ms with no feedback — the click feels broken.
  // useTransition marks the update as non-blocking; isExpandPending
  // drives a button-label swap to "Expanding…" / "Collapsing…" so the
  // user sees instant acknowledgement.
  //
  // Issue 3: when a message has focus from a search hit (URL
  // `?highlight=<uuid>` scrolled it to viewport center), expanding the
  // tool bubbles ABOVE it pushes the focused message down off-screen —
  // and collapse pulls it up. Capture the focused element's viewport
  // top in handleToggleExpandAll BEFORE the transition fires; restore
  // scrollTop by the delta in a useLayoutEffect after the new layout
  // commits.
  const [isExpandPending, startExpandTransition] = useTransition()
  const expandAnchorBeforeRef = useRef<{ uuid: string; top: number } | null>(null)
  const handleToggleExpandAll = useCallback(() => {
    // Capture anchor position synchronously BEFORE the transition queues
    // the state change. Prefer the keyboard-selected message (the one
    // the user actually has focus on); fall back to first message whose
    // top is >= scroll container's top (i.e., first fully visible row).
    const selectedId = getSelectedMessageId()
    let anchorUuid: string | null = selectedId ?? null
    if (!anchorUuid && scrollAreaRef.current) {
      const containerTop = scrollAreaRef.current.getBoundingClientRect().top
      for (const [uuid, el] of messageRefs.current.entries()) {
        if (el.getBoundingClientRect().top >= containerTop) {
          anchorUuid = uuid
          break
        }
      }
    }
    if (anchorUuid) {
      const el = messageRefs.current.get(anchorUuid)
      if (el) {
        expandAnchorBeforeRef.current = { uuid: anchorUuid, top: el.getBoundingClientRect().top }
      }
    }
    startExpandTransition(() => {
      setExpandAllTools(!expandAllTools)
    })
  }, [expandAllTools, setExpandAllTools, getSelectedMessageId])

  // Restore the captured anchor's viewport top after the transition
  // commits the new layout. useLayoutEffect runs synchronously after
  // DOM mutations and BEFORE the browser paints, so the user never
  // sees the intermediate (drifted) scroll position.
  useLayoutEffect(() => {
    const before = expandAnchorBeforeRef.current
    if (!before || !scrollAreaRef.current) return
    const el = messageRefs.current.get(before.uuid)
    if (!el) {
      expandAnchorBeforeRef.current = null
      return
    }
    const newTop = el.getBoundingClientRect().top
    const delta = computeScrollAnchorAdjustment(before.top, newTop)
    if (delta !== 0) {
      scrollAreaRef.current.scrollTop += delta
    }
    expandAnchorBeforeRef.current = null
  }, [expandAllTools])

  // Header-toggle scroll-pin (Show Tools / Show Compactions,
  // 2026-05-25). Defense-in-depth: under Chromium's CSS scroll-
  // anchoring + TanStack Virtual's spacer tracking, the browser usually
  // keeps the focused bubble centered across a toggle on its own.
  // Safari has weaker scroll-anchoring, and absolutely-positioned +
  // transform:translateY virtualizer rows defeat the heuristic in
  // some lazy-image cases. The user-observable bug: focused bubble
  // visibly jumps off-screen after toggling Show Compactions on a deep
  // search hit. See toggle-preserves-focus-scroll.spec.ts for the pin.
  //
  // Contract:
  //   - If a focused message exists (activeMatchUuid > highlightMessageId
  //     > keyboard-selected uuid) at toggle time, capture its uuid into
  //     pendingRecenterRef BEFORE the state flip.
  //   - One rAF after the next commit (the useEffect on the toggle
  //     props), look up the element by uuid and call
  //     scrollBubbleIntoView(el, forceInstant=true) if it's still
  //     mounted AND drift is > ±100 px.
  //   - If the bubble is GONE (compact-summary that just got hidden, or
  //     unmounted by overscan eviction): silent no-op. The user accepts
  //     the page settles where it lands; the focus ring disappears with
  //     the bubble, which is itself the user feedback.
  //
  // Why rAF instead of useLayoutEffect: TanStack Virtual's
  // useFlushSync:false means measurement updates happen via async
  // ResizeObserver microtasks AFTER the layout effect would fire. rAF
  // yields to that pipeline; the multi-shot correction in
  // scrollBubbleIntoView absorbs subsequent measurement settles.
  //
  // Why guard on the 100px threshold: when Chromium scroll-anchoring
  // already kept the bubble in place, an unconditional scrollIntoView
  // would cause a visible flicker.
  const pendingRecenterRef = useRef<string | null>(null)
  const markPendingRecenter = useCallback(() => {
    const target =
      activeMatchUuid ?? highlightMessageId ?? getSelectedMessageId()
    if (target) pendingRecenterRef.current = target
  }, [activeMatchUuid, highlightMessageId, getSelectedMessageId])

  useEffect(() => {
    const uuid = pendingRecenterRef.current
    if (!uuid) return
    pendingRecenterRef.current = null
    const rafId = requestAnimationFrame(() => {
      const el =
        messageRefs.current.get(uuid) ??
        document.querySelector<HTMLElement>(
          `[data-message-uuid="${CSS.escape(uuid)}"]`,
        )
      if (!el) return // vanished focus target (compact-summary hidden / evicted)
      const container = scrollAreaRef.current
      if (!container) return
      const targetRect = el.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()
      const drift = Math.abs(
        targetRect.top + targetRect.height / 2 -
          (containerRect.top + containerRect.height / 2),
      )
      if (drift <= 100) return // already pinned by browser scroll-anchoring
      scrollBubbleIntoView(el, true)
    })
    return () => cancelAnimationFrame(rafId)
  }, [hideCompactMarkers, showToolCalls])

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
  // NIT-1 + keyboard-nav alignment (council follow-up, 2026-05-22):
  // delegate to the pure `computeVisibleMessages` helper in lib/utils
  // so the predicate is unit-testable AND keyboard-nav registration
  // (at L298-302 below) can share the exact same shape. Previously
  // this filter dropped only `is_prelude` messages, leaving empty
  // `<div onClick>` wrappers for tool-only messages when
  // `showToolCalls=false` — a clickable dead zone that no-op'd
  // because `messages.findIndex` returned -1.
  // 2026-05-24: build the UUID set from the CONVERSATION's full
  // compact_markers list (not the user-controlled `compactMarkers` which
  // collapses to [] when hideCompactMarkers=true). When the user toggles
  // "Show Compactions" OFF, computeVisibleMessages needs the full set
  // to know which messages to DROP entirely (otherwise the LLM summary
  // body falls through to messageHasVisibleContent and renders as a
  // raw user-prompt-styled bubble — the bug the user reported on
  // 2026-05-24).
  const allCompactMarkerUuidSet = useMemo(
    () =>
      new Set(
        (conversation?.compact_markers ?? []).map((m) => m.message_uuid),
      ),
    [conversation?.compact_markers],
  )
  const visibleMessages = useMemo(() => {
    if (!conversation?.messages) return []
    return computeVisibleMessages(conversation.messages, {
      showPrelude,
      showToolCalls,
      compactMarkerUuids: allCompactMarkerUuidSet,
      hideCompactSummaries: hideCompactMarkers,
    })
  }, [conversation?.messages, showPrelude, showToolCalls, allCompactMarkerUuidSet, hideCompactMarkers])

  // Virtualization (2026-05-23, the load-bearing perf fix) — see
  // PLANS/PERFORMANCE_BASELINE_2026-05-23.md. Pre-fix shape
  // `visibleMessages.map(<MessageBubble />)` rendered all 4051 bubbles
  // for the real-corpus conversation, costing ~8.5s of synchronous React
  // commit work per warm-switch and ~141K DOM nodes. We now render only
  // the visible window (~20 rows) via `@tanstack/react-virtual`. Same
  // library precedent: `components/conversation/ConversationList.tsx`
  // (sidebar).
  //
  // Variable-height handling: bubble heights vary ~50-5000px (1-line
  // text vs huge code/tool blocks). `estimateSize` provides the initial
  // total scroll height; `virtualizer.measureElement` (ResizeObserver
  // under the hood) corrects each row's measured size post-mount. The
  // estimate is a coarse average of observed bubble heights on the real
  // corpus; misses are absorbed by post-mount measurement + the
  // distance-gated `scrollBubbleIntoView` correction for highlight
  // targets.
  //
  // jsdom fallback: vitest renders ConversationPage in jsdom which has
  // no layout (getBoundingClientRect returns zeros, ResizeObserver is
  // a polyfill stub). The virtualizer would render 0 items there,
  // breaking the ~50 existing vitest tests that mount this page. Same
  // UA-sniff fallback as `ConversationList.tsx` (`isJsdom` early-render
  // path below); production is unaffected.
  //
  // Estimate value choice: 240px is the observed median bubble height
  // across the real-corpus a70251a5 conversation (sampled via
  // `getBoundingClientRect()` over 100 mounted bubbles in DevTools).
  // The virtualizer corrects after first mount via measureElement, so
  // the cost of estimate error is bounded to "scrollbar thumb jiggles
  // until you've scrolled past everything once" — not a correctness
  // issue.
  //
  // React 19 / React-Compiler note: same `react-hooks/incompatible-library`
  // opt-out as ConversationList. TanStack Virtual's API is not React
  // Compiler compatible at the time of writing; library-level constraint.
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual API is not React Compiler compatible; same opt-out as ConversationList.tsx.
  const virtualizer = useVirtualizer({
    count: visibleMessages.length,
    getScrollElement: () => scrollAreaRef.current,
    estimateSize: () => 240,
    // Overscan 5 keeps a small mount buffer above + below the viewport
    // so smooth scrolling doesn't reveal blank gaps mid-frame. The
    // sidebar uses 8 because rows are 83px each (~1 viewport of safety
    // at 8 rows). Bubble rows are ~240px each, so 5 ≈ 1.3 viewports of
    // buffer at default 900px viewport — same safety budget for less
    // mount work.
    overscan: 5,
    // 2026-05-23: bubble uuids are stable across renders; using them
    // as React keys avoids the "duplicate stale row" cascade documented
    // in ConversationList.tsx (vi.key alignment). The virtualizer also
    // uses the same key internally for stable measurement caching.
    getItemKey: (index) => visibleMessages[index]?.uuid ?? index,
    // 2026-05-24: React 19 escalated `flushSync was called from inside
    // a lifecycle method` from a warning to a throw. TanStack Virtual's
    // default `useFlushSync: true` fires flushSync inside its onChange
    // callback (which runs from a ResizeObserver during render), which
    // throws under React 19 and triggers a route-transition rollback
    // (symptom: navigating to /settings flashes the page on then
    // bounces back to /conversations). The async-rerender path is the
    // React 19 compatible fix per TanStack's migration guide. Tradeoff
    // is a one-frame delay between measurement and re-render during
    // rapid scrolls — acceptable for a measurement-driven re-layout
    // that the user can't perceive at 60fps.
    useFlushSync: false,
  })

  // jsdom (vitest) doesn't run layout, so the virtualizer can't measure
  // rows and would render zero items — breaking every existing vitest
  // test that mounts ConversationPage. Detect jsdom by user-agent and
  // fall back to non-virtualized rendering. Real browsers don't match.
  // ResizeObserver-presence isn't reliable as a detector because
  // src/test/setup.ts polyfills it for cmdk's sake. Same pattern as
  // ConversationList.tsx.
  const isJsdom =
    typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)

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

  // 2026-05-23 — virtualization landing: smooth `scrollTo` and
  // `scrollIntoView` are intercepted by the virtualizer's measurement-
  // driven scroll-height updates. Each ResizeObserver fire that grows
  // the total height during the animation cancels the in-flight smooth
  // scroll (observed: jump-to-top on a 30-msg conv froze ~280 px in
  // because the virtualizer was still settling rows mid-animation),
  // and the virtualizer's own smooth `scrollToIndex` has the same
  // single-pass issue — it computes the destination ONCE on call,
  // then doesn't re-aim when measurement adjusts the estimate.
  //
  // Trade smooth-scroll motion for correctness: do instant scroll-to-
  // index, then a follow-up correction tick once rows have mounted +
  // measured. The instant snap is acceptable for a "Jump" affordance
  // (the user explicitly asked for a hop, not a tour) and matches the
  // distance-gated branch in `scrollBubbleIntoView`. Fallback to the
  // pre-virt path on the empty-list case (no visible messages).
  const scrollToBottom = useCallback(() => {
    if (visibleMessages.length > 0) {
      virtualizer.scrollToIndex(visibleMessages.length - 1, { align: 'end' })
      // Post-mount re-aim: measureElement may grow the row beyond the
      // initial estimate, leaving us a few hundred px short of the
      // true bottom. A microtask + rAF tick gives the virtualizer one
      // chance to settle then snaps again. Bounded; not a chain.
      requestAnimationFrame(() => {
        if (scrollAreaRef.current) {
          scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight
        }
      })
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' })
    }
  }, [virtualizer, visibleMessages.length])

  const scrollToTop = useCallback(() => {
    if (visibleMessages.length > 0) {
      virtualizer.scrollToIndex(0, { align: 'start' })
      requestAnimationFrame(() => {
        if (scrollAreaRef.current) scrollAreaRef.current.scrollTop = 0
      })
    } else {
      scrollAreaRef.current?.scrollTo({ top: 0, behavior: 'auto' })
    }
  }, [virtualizer, visibleMessages.length])

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

  // Scroll to highlighted message, select it, and focus detail pane.
  //
  // 2026-05-23 virtualization landing: target bubbles deep in the
  // conversation (e.g. idx 550/600 of the search-hit-scroll fixture)
  // are NOT mounted on initial page load. Pre-virt, all bubbles were
  // mounted eagerly, so the 100 ms setTimeout was enough for React to
  // commit and `querySelector` to find them. Post-virt, the target
  // exists only as virtualizer state until we tell it to bring the row
  // into view.
  //
  // New flow:
  //   1. Locate the target's index in `visibleMessages`.
  //   2. Call `virtualizer.scrollToIndex(idx, { align: 'center' })` to
  //      mount the row at viewport center. This is the same
  //      virtualizer used by the Jump buttons; instant (no 'smooth')
  //      so measureElement adjustments don't fight a smooth animation.
  //   3. rAF-poll up to ~600 ms (40 frames @ 16 ms) for `querySelector`
  //      to find the freshly-mounted bubble.
  //   4. Once mounted, run the EXISTING logic: scrollBubbleIntoView for
  //      lazy-image-aware post-settle correction, ring-flash, focus,
  //      URL cleanup on a 2 s timer.
  //
  // Why polling instead of a component mount-effect (Option A "pure"
  // from the council): the cleanup callback (URL `setSearchParams`)
  // belongs to the parent's URL state, and the highlight target may be
  // either MessageBubble OR CompactMarker — threading symmetric props
  // + cleanup callbacks through both component types is broader-diff
  // than the polling approach with no functional benefit. The polling
  // window is bounded (600 ms ≪ the 2 s ring-flash duration) and only
  // runs when `highlightMessageId` is truthy (Cmd+G hits and deep-link
  // navigation; not the typing hot path).
  useEffect(() => {
    if (!highlightMessageId || !conversation || isLoading) return
    // Focus the detail pane and select the highlighted message
    setFocusArea('detail')
    const msgIdx = messages.findIndex((m) => m.uuid === highlightMessageId)
    if (msgIdx !== -1) {
      setSelectedMessageIndex(msgIdx)
    }

    // Step 1: tell the virtualizer to mount the target's row. If the
    // target isn't in visibleMessages (e.g. filtered by Tools toggle),
    // we still try the querySelector path below — it'll just no-op.
    const visIdx = visibleMessages.findIndex((m) => m.uuid === highlightMessageId)
    if (visIdx !== -1 && !isJsdom) {
      virtualizer.scrollToIndex(visIdx, { align: 'center' })
    }

    // Step 2-4: poll for mount, then apply the existing highlight UX.
    // Cancelable via the cleanup return so a fast subsequent
    // navigation supersedes this one.
    let cancelled = false
    let rafId = 0
    const startedAt = performance.now()
    const POLL_BUDGET_MS = 600
    const tryFindAndApply = () => {
      if (cancelled) return
      const element = document.querySelector<HTMLElement>(
        `[data-message-uuid="${highlightMessageId}"]`,
      )
      if (element) {
        // Distance-gated scroll + post-settle correction. See
        // `scrollBubbleIntoView` docstring for the 15K-msg lazy-image
        // layout-shift bug this fixes. Still runs post-virtualization
        // because virtualizer.scrollToIndex doesn't compensate for
        // images decoding into the swept region post-scroll.
        scrollBubbleIntoView(element)
        element.classList.add('ring-2', 'ring-yellow-400', 'ring-offset-2')
        // Cross-conversation Enter: see commit 113da97 council note.
        // The highlight effect runs after the new ConversationPage
        // mounts, so this is the safe place to move keyboard focus
        // too. Bubbles have tabIndex={-1}.
        //
        // 2026-05-23: gated on `?focus=0` opt-out. The search auto-
        // promote effect (live-preview UX) uses `&focus=0` so the
        // user can keep typing in the search input without focus
        // being stolen. User-initiated nav (Cmd+G / Enter / card-
        // click) omits the param and still focuses the bubble.
        if (shouldFocusOnHighlight) {
          element.focus()
        }
        scheduleHighlightClear(() => {
          element.classList.remove('ring-2', 'ring-yellow-400', 'ring-offset-2')
          // Clear highlight/m/focus params from URL but preserve
          // everything else. 2026-05-23 race guard (council Q4):
          // if a newer navigation already replaced the highlight
          // target while our 2s timer was pending, only clean up
          // the params if the CURRENT URL still references the
          // bubble we just flashed. Otherwise the cleanup would
          // wipe the newer navigation's `highlight=` and the next
          // navigation's ConversationPage effect would never fire.
          setSearchParams((prev) => {
            const stillOurs =
              prev.get('highlight') === highlightMessageId ||
              prev.get('m') === highlightMessageId
            if (!stillOurs) {
              return prev
            }
            const next = new URLSearchParams(prev)
            next.delete('highlight')
            next.delete('m')
            next.delete('focus')
            return next
          }, { replace: true })
        }, 2000)
        return
      }
      if (performance.now() - startedAt > POLL_BUDGET_MS) {
        // Bounded polling — give up rather than spin. Dev-only warn
        // would be noisy; the URL cleanup will still fire on the next
        // navigation. Silent no-op matches the pre-virt behavior when
        // the bubble wasn't findable.
        return
      }
      rafId = requestAnimationFrame(tryFindAndApply)
    }
    rafId = requestAnimationFrame(tryFindAndApply)

    return () => {
      cancelled = true
      cancelAnimationFrame(rafId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scheduleHighlightClear is the return value of useUnmountSafeTimer(), which is a fresh closure each render (no useCallback). Including it would re-fire this whole highlight/scroll/focus effect on every render while highlightMessageId is truthy, causing repeated scrollBubbleIntoView calls + URL mutations. The timer callback closes over `element` (DOM ref) and `setSearchParams` (already a dep); the schedule call itself is fire-and-forget. Same pattern as FilterContext.tsx:291, ManageFiltersModal.tsx:603, SearchPanel.tsx:109.
  }, [highlightMessageId, conversation, isLoading, setSearchParams, setFocusArea, messages, setSelectedMessageIndex, visibleMessages, virtualizer, isJsdom, shouldFocusOnHighlight])

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
        includeCompactInExports,
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
    // LOW-1 (council follow-up): see MessageBubble.handleCopyMessage.
    // Flip the success affordance only on a resolved promise.
    try {
      await navigator.clipboard.writeText(markdown)
      setCopiedAll(true)
      scheduleCopiedAllClear(() => setCopiedAll(false), 2000)
    } catch {
      errorToast('Failed to copy conversation to clipboard.')
    }
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
              {/* D10 (Cowork): label cwd as "Sandbox path" — it's
                  typically /sessions/<vm>, not a host filesystem path,
                  so don't render as a clickable link. */}
              {conversation.source === 'CLAUDE_COWORK' && conversation.sandbox_path && (
                <div
                  className="flex items-center gap-1 text-xs text-zinc-400 dark:text-zinc-500"
                  data-testid="cowork-sandbox-path"
                >
                  <FolderCode className="h-3 w-3" />
                  <span className="text-zinc-500">Sandbox path:</span>
                  <span className="font-mono">{conversation.sandbox_path}</span>
                </div>
              )}
              <button
                onClick={async () => {
                  // LOW-1 (council follow-up): see MessageBubble.handleCopyMessage.
                  try {
                    await navigator.clipboard.writeText(conversation.uuid)
                    setCopiedUuid(true)
                    scheduleCopiedUuidClear(() => setCopiedUuid(false), 2000)
                  } catch {
                    errorToast('Failed to copy UUID to clipboard.')
                  }
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
                    // LOW-1 (council follow-up): see MessageBubble.handleCopyMessage.
                    try {
                      await navigator.clipboard.writeText(filePath)
                      setCopiedPath(true)
                      scheduleCopiedPathClear(() => setCopiedPath(false), 2000)
                    } catch {
                      errorToast('Failed to copy file path to clipboard.')
                    }
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
        <div className="flex flex-wrap items-center gap-3">
          {/* 2026-05-24 UX fix: the Tools toggle used to be a Button with
              `variant={showToolCalls ? 'default' : 'outline'}`. The
              variant difference is too subtle for users to tell whether
              the toggle is ON or OFF at a glance. Native checkbox with
              an inline label removes the ambiguity. */}
          <label
            className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200"
            title={showToolCalls ? 'Hide tool calls' : 'Show tool calls'}
            data-testid="header-show-tools-control"
          >
            <input
              type="checkbox"
              checked={showToolCalls}
              onChange={(e) => {
                markPendingRecenter()
                setShowToolCalls(e.target.checked)
              }}
              className="h-4 w-4 cursor-pointer rounded border-zinc-300 text-zinc-900 focus:ring-zinc-500 dark:border-zinc-600"
              data-testid="header-show-tools-checkbox"
            />
            <Wrench className="h-4 w-4" />
            <span>Show Tools</span>
          </label>
          {showToolCalls && (
            <Button
              variant={expandAllTools ? 'default' : 'outline'}
              size="sm"
              onClick={handleToggleExpandAll}
              title={expandAllTools ? 'Collapse all tools' : 'Expand all tools'}
              disabled={isExpandPending}
            >
              <ChevronsUpDown className={cn('h-4 w-4', isExpandPending && 'animate-pulse')} />
              <span className="ml-2">{expandAllToolsButtonLabel(expandAllTools, isExpandPending)}</span>
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
          {hasCompactMarkers && (
            // 2026-05-24 UX fix: same rationale as Show Tools — the
            // variant-toggle Button hid the enabled state and the
            // semantic inversion ("Show compact markers" label appearing
            // when `hideCompactMarkers=true`) compounded the confusion.
            // The checkbox reads as plain English: checked = compactions
            // are visible.
            <label
              className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200"
              title={hideCompactMarkers ? 'Show compact markers' : 'Hide compact markers'}
            >
              <input
                type="checkbox"
                checked={!hideCompactMarkers}
                onChange={(e) => {
                  markPendingRecenter()
                  setHideCompactMarkers(!e.target.checked)
                }}
                className="h-4 w-4 cursor-pointer rounded border-zinc-300 text-zinc-900 focus:ring-zinc-500 dark:border-zinc-600"
                data-testid="header-show-compactions-checkbox"
              />
              <Scissors className="h-4 w-4" />
              <span>Show Compactions</span>
            </label>
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

      {/* D9 (Cowork): session-error banner. Cowork's audit log can
          end with a session-level fault recorded in sidecar.error
          (e.g. "The session ended unexpectedly."). Render once
          above the message stream so the reader knows the
          transcript is incomplete. */}
      {conversation.error && (
        <div
          data-testid="cowork-error-banner"
          role="alert"
          className="border-b border-amber-300 bg-amber-50 px-6 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
        >
          <span className="font-medium">Session ended with an error:</span>{' '}
          <span>{conversation.error}</span>
        </div>
      )}

      {/* Messages */}
      <ConversationLightboxProvider messages={conversation.messages}>
      <div className="relative flex-1 overflow-hidden">
        <div
          ref={scrollAreaRef}
          data-testid="message-stream"
          className="h-full overflow-y-auto p-6"
          onScroll={handleScroll}
        >
          <div className="mx-auto max-w-3xl">
            <SessionPreludeAffordance
              hiddenCount={preludeHiddenCount}
              expanded={showPrelude}
              onToggle={() => setShowPrelude((v) => !v)}
            />
            {isJsdom ? (
              // jsdom fallback path (vitest only): render all bubbles
              // non-virtualized so the existing 386 vitest tests that
              // mount ConversationPage still work. The `space-y-6`
              // visual gap that the pre-virt code relied on is supplied
              // back here. Real browsers take the virtualized branch
              // below.
              <div className="space-y-6">
                {visibleMessages.map((message) =>
                  renderBubbleRow(message, {
                    getSetRef,
                    getSelectedMessageId,
                    focusArea,
                    compactMarkerByUuid,
                    compactMarkers,
                    activeCompactIdx,
                    focusCompactMarker,
                    highlightMessageId,
                    activeMatchUuid,
                    deferredSearchQuery,
                    conversation,
                    showToolCalls,
                    expandAllTools,
                    messages,
                    setSelectedMessageIndex,
                  }),
                )}
              </div>
            ) : (
              // Virtualized path (production / Playwright). Each rendered
              // row gets a combined ref that runs BOTH
              // `virtualizer.measureElement` (ResizeObserver-driven
              // height correction) AND our cached-per-id `getSetRef`
              // (anchor capture in Expand/Collapse all tools). Row
              // wrappers are absolutely positioned inside the total-size
              // spacer at the virtualizer-computed `translateY`.
              //
              // `space-y-6` is dropped because absolute-positioned
              // siblings ignore margin collapsing; each row's bottom
              // padding (`pb-6`) carries the 24 px gap into its measured
              // height instead — measureElement picks that up correctly.
              <div
                style={{
                  height: `${virtualizer.getTotalSize()}px`,
                  width: '100%',
                  position: 'relative',
                }}
              >
                {virtualizer.getVirtualItems().map((vi) => {
                  const message = visibleMessages[vi.index]
                  if (!message) return null
                  // Combined ref: forward the DOM node to BOTH the
                  // virtualizer (so it measures the row) and getSetRef
                  // (so anchor capture / Expand-all-tools still has the
                  // wrapper ref).
                  const cachedSetRef = getSetRef(message.uuid)
                  const combinedRef = (el: HTMLDivElement | null) => {
                    virtualizer.measureElement(el)
                    cachedSetRef(el)
                  }
                  return (
                    <div
                      key={vi.key}
                      data-index={vi.index}
                      ref={combinedRef}
                      className="pb-6"
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${vi.start}px)`,
                      }}
                    >
                      {renderBubbleRow(message, {
                        getSetRef: null, // already attached on wrapper above
                        getSelectedMessageId,
                        focusArea,
                        compactMarkerByUuid,
                        compactMarkers,
                        activeCompactIdx,
                        focusCompactMarker,
                        highlightMessageId,
                        activeMatchUuid,
                        deferredSearchQuery,
                        conversation,
                        showToolCalls,
                        expandAllTools,
                        messages,
                        setSelectedMessageIndex,
                        unwrapped: true, // suppress the inner ref-wrapper div
                      })}
                    </div>
                  )
                })}
              </div>
            )}
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

// Shared renderer for a single bubble row. Used by both the virtualized
// path (production / Playwright) and the jsdom fallback path (vitest).
// Keeping a single source of truth for the row JSX prevents the two
// paths from drifting in subtle ways (search-hit gate, selection click
// handler, compact-marker prop wiring).
//
// `unwrapped: true` skips the inner ref-wrapper div because the
// virtualized path already wraps each row in an absolute-positioned
// translateY container. `getSetRef` is set to `null` in that case
// because the cached ref is attached on the outer wrapper.
interface RenderBubbleRowDeps {
  getSetRef: ((uuid: string) => (el: HTMLDivElement | null) => void) | null
  getSelectedMessageId: () => string | null
  focusArea: FocusArea
  compactMarkerByUuid: Map<string, { marker: CompactMarkerType; index: number }>
  compactMarkers: readonly CompactMarkerType[]
  activeCompactIdx: number | null
  focusCompactMarker: (index: number) => void
  highlightMessageId: string | null
  /** UUID of the message owning the search-panel's active match
   *  (Cmd+G / card-click / auto-promote target). Stable while the
   *  user is reading; only the bubble matching this UUID gets the
   *  live searchQuery for inline <mark> decoration. See the
   *  activeMatchUuid comment on the consumer side for full rationale. */
  activeMatchUuid: string | null
  deferredSearchQuery: string
  conversation: ConversationDetail
  showToolCalls: boolean
  expandAllTools: boolean
  messages: { uuid: string; sender: string }[]
  setSelectedMessageIndex: (i: number) => void
  unwrapped?: boolean
}

function renderBubbleRow(message: Message, deps: RenderBubbleRowDeps) {
  const {
    getSetRef,
    getSelectedMessageId,
    focusArea,
    compactMarkerByUuid,
    compactMarkers,
    activeCompactIdx,
    focusCompactMarker,
    highlightMessageId,
    activeMatchUuid,
    deferredSearchQuery,
    conversation,
    showToolCalls,
    expandAllTools,
    messages,
    setSelectedMessageIndex,
    unwrapped,
  } = deps

  const selectedId = getSelectedMessageId()
  const isSelected = focusArea === 'detail' && message.uuid === selectedId
  const compactEntry = compactMarkerByUuid.get(message.uuid)

  if (compactEntry) {
    const { marker, index } = compactEntry
    const child = (
      <CompactMarker
        marker={marker}
        index={index}
        total={compactMarkers.length}
        isActive={activeCompactIdx === index}
        onPrev={() => focusCompactMarker(index - 1)}
        onNext={() => focusCompactMarker(index + 1)}
        // 2026-05-22: auto-expand when a search-hit highlight is
        // targeting this marker. Users who clicked through to a search
        // match inside a compact bubble's summary text would otherwise
        // land on the collapsed pill and see nothing. Survives
        // virtualization because the `useEffect([forceOpen])` inside
        // CompactMarker fires on mount when `forceOpen=true`.
        forceOpen={highlightMessageId === marker.message_uuid}
        // 2026-05-24 highlight-gate fix: pass the search query ONLY
        // to the active-match marker. Keyed on activeMatchUuid (the
        // sidebar's currently-selected match, stable while the user
        // reads) rather than highlightMessageId (ephemeral URL param
        // cleared after 2 s — would drop highlights mid-read).
        searchQuery={
          marker.message_uuid === activeMatchUuid ? deferredSearchQuery : ''
        }
      />
    )
    if (unwrapped) return child
    return (
      <div key={message.uuid} ref={getSetRef ? getSetRef(message.uuid) : undefined}>
        {child}
      </div>
    )
  }

  const bubble = (
    <MessageBubble
      message={message}
      isKeyboardSelected={isSelected}
      conversationId={conversation.uuid}
      conversationSource={conversation.source}
      showToolCalls={showToolCalls}
      expandAllTools={expandAllTools}
      // 2026-05-24 highlight-gate fix: pass the search query ONLY to
      // the active-match bubble (the one Cmd+G / card-click landed
      // on). Keyed on `activeMatchUuid` (the sidebar's currently-
      // selected match — stable while the user reads) rather than
      // `highlightMessageId` (ephemeral URL `?highlight=` param,
      // cleared after the highlight-effect's 2 s timer fires —
      // which used to drop yellow `<mark>`s mid-read). All other
      // bubbles get '' so their React.memo comparator returns true
      // on every debounce settle (preserves the 2026-05-23 perf fix:
      // without this gate, every keystroke flipped searchQuery for
      // 4014 bubbles → 8-9 s long task). The SearchPanel sidebar
      // still shows every match with its own highlights; this gate
      // controls only the in-conversation-pane `<mark>` decoration.
      searchQuery={message.uuid === activeMatchUuid ? deferredSearchQuery : ''}
    />
  )

  const onClickRow = () => {
    const idx = messages.findIndex((m) => m.uuid === message.uuid)
    if (idx !== -1) setSelectedMessageIndex(idx)
  }

  if (unwrapped) {
    // Caller already wrapped us in a virtualized div with a ref; we only
    // need an inner click target. Use a fragment-equivalent: a small
    // wrapper carrying the click handler, no ref.
    return <div onClick={onClickRow}>{bubble}</div>
  }
  return (
    <div
      key={message.uuid}
      ref={getSetRef ? getSetRef(message.uuid) : undefined}
      onClick={onClickRow}
    >
      {bubble}
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