import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react'

export type FocusArea = 'list' | 'detail' | 'search' | 'none'

// Which pane initiated the most recent navigation into the detail view.
// Used by the Escape handler to return focus to the correct sidebar.
export type NavSource = 'list' | 'search'

export interface MessageInfo {
  uuid: string
  sender: 'human' | 'assistant'
}

interface KeyboardNavigationContextType {
  // Selected item in conversation list
  selectedIndex: number
  setSelectedIndex: (index: number) => void
  // List of conversation UUIDs for navigation
  conversationIds: string[]
  setConversationIds: (ids: string[]) => void
  // Like setMessages, but also pins the current selection by UUID so
  // that when the visible-messages list shrinks/grows (e.g. the user
  // toggles "Show tool calls"), the selected message UUID is preserved
  // and the index is re-anchored. Issue #2: previously the index was
  // a flat int into the visible list, so a list-size change drifted
  // the selection to a different message. (Mar 2026.)
  setMessagesAndPinSelection: (messages: MessageInfo[]) => void
  // Which area has focus
  focusArea: FocusArea
  setFocusArea: (area: FocusArea) => void
  // Source of the most recent navigation to the detail pane
  navSource: NavSource
  setNavSource: (source: NavSource) => void
  // Help modal visibility
  isHelpOpen: boolean
  setIsHelpOpen: (open: boolean) => void
  // Conversation list navigation helpers
  selectNext: () => void
  selectPrevious: () => void
  selectFirst: () => void
  selectLast: () => void
  getSelectedId: () => string | null

  // Message navigation (detail pane)
  selectedMessageIndex: number
  setSelectedMessageIndex: (index: number) => void
  messages: MessageInfo[]
  setMessages: (messages: MessageInfo[]) => void
  // Message navigation helpers
  selectNextMessage: () => void
  selectPreviousMessage: () => void
  selectFirstMessage: () => void
  selectLastMessage: () => void
  getSelectedMessageId: () => string | null
  // Role-based navigation
  selectNextUserMessage: () => void
  selectPreviousUserMessage: () => void
  selectNextAssistantMessage: () => void
  selectPreviousAssistantMessage: () => void
  // Paging
  pageDown: () => void
  pageUp: () => void
}

const KeyboardNavigationContext = createContext<KeyboardNavigationContextType | null>(null)

const PAGE_SIZE = 10 // Number of messages to jump when paging

export function KeyboardNavigationProvider({ children }: { children: ReactNode }) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [conversationIds, setConversationIds] = useState<string[]>([])
  const [focusArea, setFocusArea] = useState<FocusArea>('list')
  const [navSource, setNavSource] = useState<NavSource>('list')
  const [isHelpOpen, setIsHelpOpen] = useState(false)

  // Message navigation state
  const [selectedMessageIndex, setSelectedMessageIndex] = useState(0)
  const [messages, setMessages] = useState<MessageInfo[]>([])

  // Issue #2: pin selection by message UUID across list resizes.
  // The detail page calls setMessagesAndPinSelection on every change
  // to the visible message set; we look up the previously-selected
  // UUID in the new list and re-anchor selectedMessageIndex to its
  // new position. If the previously-selected UUID dropped out of the
  // visible list (e.g. it was a tool-only message and the user just
  // hid tools), keep the closest neighbor by clamping the old index.
  //
  // Read prev state through refs so the callback identity is stable
  // (no re-creation on every selectedMessageIndex change), which
  // prevents the consumer's useEffect from firing extra times.
  // Refs are written in a layout-equivalent effect so the React 19
  // compiler does not flag a render-time ref mutation. Effect timing:
  // the writes complete BEFORE the consumer's useEffect reads them
  // because setMessagesAndPinSelection is only invoked from user-event
  // callbacks (Enter/Esc/Arrow), never during the same render pass.
  const messagesRef = useRef<MessageInfo[]>([])
  const selectedMessageIndexRef = useRef(0)
  useEffect(() => {
    messagesRef.current = messages
    selectedMessageIndexRef.current = selectedMessageIndex
  }, [messages, selectedMessageIndex])

  const setMessagesAndPinSelection = useCallback((next: MessageInfo[]) => {
    const prev = messagesRef.current
    const prevIdx = selectedMessageIndexRef.current
    const prevSelectedUuid =
      prevIdx >= 0 && prevIdx < prev.length ? prev[prevIdx]?.uuid : null

    setMessages(next)

    if (next.length === 0) {
      setSelectedMessageIndex(0)
      return
    }

    if (prevSelectedUuid) {
      const newIdx = next.findIndex((m) => m.uuid === prevSelectedUuid)
      if (newIdx !== -1) {
        setSelectedMessageIndex(newIdx)
        return
      }
      // Previously-selected UUID dropped out (e.g. it was a tool-only
      // message and Tools just got hidden). Fall back to the same
      // numeric position, clamped to the new bounds.
      setSelectedMessageIndex(Math.min(prevIdx, next.length - 1))
    }
  }, [])

  // Conversation list navigation
  const selectNext = useCallback(() => {
    setSelectedIndex((prev) => Math.min(prev + 1, conversationIds.length - 1))
  }, [conversationIds.length])

  const selectPrevious = useCallback(() => {
    setSelectedIndex((prev) => Math.max(prev - 1, 0))
  }, [])

  const selectFirst = useCallback(() => {
    setSelectedIndex(0)
  }, [])

  const selectLast = useCallback(() => {
    setSelectedIndex(Math.max(0, conversationIds.length - 1))
  }, [conversationIds.length])

  const getSelectedId = useCallback(() => {
    if (selectedIndex >= 0 && selectedIndex < conversationIds.length) {
      return conversationIds[selectedIndex]
    }
    return null
  }, [selectedIndex, conversationIds])

  // Message navigation
  const selectNextMessage = useCallback(() => {
    setSelectedMessageIndex((prev) => Math.min(prev + 1, messages.length - 1))
  }, [messages.length])

  const selectPreviousMessage = useCallback(() => {
    setSelectedMessageIndex((prev) => Math.max(prev - 1, 0))
  }, [])

  const selectFirstMessage = useCallback(() => {
    setSelectedMessageIndex(0)
  }, [])

  const selectLastMessage = useCallback(() => {
    setSelectedMessageIndex(Math.max(0, messages.length - 1))
  }, [messages.length])

  const getSelectedMessageId = useCallback(() => {
    if (selectedMessageIndex >= 0 && selectedMessageIndex < messages.length) {
      return messages[selectedMessageIndex].uuid
    }
    return null
  }, [selectedMessageIndex, messages])

  // Role-based navigation
  const selectNextUserMessage = useCallback(() => {
    const nextIndex = messages.findIndex(
      (msg, idx) => idx > selectedMessageIndex && msg.sender === 'human'
    )
    if (nextIndex !== -1) {
      setSelectedMessageIndex(nextIndex)
    }
  }, [messages, selectedMessageIndex])

  const selectPreviousUserMessage = useCallback(() => {
    // Search backwards from current position
    for (let i = selectedMessageIndex - 1; i >= 0; i--) {
      if (messages[i].sender === 'human') {
        setSelectedMessageIndex(i)
        return
      }
    }
  }, [messages, selectedMessageIndex])

  const selectNextAssistantMessage = useCallback(() => {
    const nextIndex = messages.findIndex(
      (msg, idx) => idx > selectedMessageIndex && msg.sender === 'assistant'
    )
    if (nextIndex !== -1) {
      setSelectedMessageIndex(nextIndex)
    }
  }, [messages, selectedMessageIndex])

  const selectPreviousAssistantMessage = useCallback(() => {
    // Search backwards from current position
    for (let i = selectedMessageIndex - 1; i >= 0; i--) {
      if (messages[i].sender === 'assistant') {
        setSelectedMessageIndex(i)
        return
      }
    }
  }, [messages, selectedMessageIndex])

  // Paging
  const pageDown = useCallback(() => {
    setSelectedMessageIndex((prev) => Math.min(prev + PAGE_SIZE, messages.length - 1))
  }, [messages.length])

  const pageUp = useCallback(() => {
    setSelectedMessageIndex((prev) => Math.max(prev - PAGE_SIZE, 0))
  }, [])

  return (
    <KeyboardNavigationContext.Provider
      value={{
        selectedIndex,
        setSelectedIndex,
        conversationIds,
        setConversationIds,
        focusArea,
        setFocusArea,
        navSource,
        setNavSource,
        isHelpOpen,
        setIsHelpOpen,
        selectNext,
        selectPrevious,
        selectFirst,
        selectLast,
        getSelectedId,
        // Message navigation
        selectedMessageIndex,
        setSelectedMessageIndex,
        messages,
        setMessages,
        setMessagesAndPinSelection,
        selectNextMessage,
        selectPreviousMessage,
        selectFirstMessage,
        selectLastMessage,
        getSelectedMessageId,
        selectNextUserMessage,
        selectPreviousUserMessage,
        selectNextAssistantMessage,
        selectPreviousAssistantMessage,
        pageDown,
        pageUp,
      }}
    >
      {children}
    </KeyboardNavigationContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- safe: context Provider + hook co-located by convention. HMR fast refresh falls back to full reload for this file; no runtime impact.
export function useKeyboardNavigation() {
  const context = useContext(KeyboardNavigationContext)
  if (!context) {
    throw new Error('useKeyboardNavigation must be used within a KeyboardNavigationProvider')
  }
  return context
}
