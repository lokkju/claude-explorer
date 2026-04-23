import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

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

export function useKeyboardNavigation() {
  const context = useContext(KeyboardNavigationContext)
  if (!context) {
    throw new Error('useKeyboardNavigation must be used within a KeyboardNavigationProvider')
  }
  return context
}
