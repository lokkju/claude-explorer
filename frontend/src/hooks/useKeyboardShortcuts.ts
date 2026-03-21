import { useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useSettings } from '@/contexts/SettingsContext'
import { useKeyboardNavigation } from '@/contexts/KeyboardNavigationContext'

function isInputElement(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false
  const tagName = target.tagName.toLowerCase()
  return (
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select' ||
    target.isContentEditable
  )
}

export function useKeyboardShortcuts() {
  const navigate = useNavigate()
  const { uuid: currentUuid } = useParams<{ uuid: string }>()
  const { keyboardMode } = useSettings()
  const {
    // Conversation list navigation
    selectNext,
    selectPrevious,
    selectFirst,
    selectLast,
    getSelectedId,
    setIsHelpOpen,
    focusArea,
    setFocusArea,
    // Message navigation
    selectNextMessage,
    selectPreviousMessage,
    selectFirstMessage,
    selectLastMessage,
    selectNextUserMessage,
    selectPreviousUserMessage,
    selectNextAssistantMessage,
    selectPreviousAssistantMessage,
    pageDown,
    pageUp,
    setSelectedMessageIndex,
  } = useKeyboardNavigation()

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Always allow ? for help modal
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!isInputElement(e.target)) {
          e.preventDefault()
          setIsHelpOpen(true)
          return
        }
      }

      // Tab switches between panes (universal)
      if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!isInputElement(e.target) && currentUuid) {
          e.preventDefault()
          if (focusArea === 'list') {
            setFocusArea('detail')
          } else {
            setFocusArea('list')
          }
          return
        }
      }

      // Ignore events in input fields (except for specific shortcuts)
      if (isInputElement(e.target)) return

      // Universal keys (both modes)
      if (handleUniversalKey(e)) return

      if (keyboardMode === 'vim') {
        handleVimKey(e)
      } else {
        handleEmacsKey(e)
      }
    },
    [keyboardMode, focusArea, currentUuid, selectNext, selectPrevious, selectFirst, selectLast, getSelectedId, navigate, setFocusArea, setIsHelpOpen, selectNextMessage, selectPreviousMessage, selectFirstMessage, selectLastMessage, selectNextUserMessage, selectPreviousUserMessage, selectNextAssistantMessage, selectPreviousAssistantMessage, pageDown, pageUp, setSelectedMessageIndex]
  )

  // Universal keys that work in both Vim and Emacs modes
  const handleUniversalKey = useCallback(
    (e: KeyboardEvent): boolean => {
      // Arrow keys for navigation (universal)
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (focusArea === 'detail') {
          selectNextMessage()
        } else {
          selectNext()
        }
        return true
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (focusArea === 'detail') {
          selectPreviousMessage()
        } else {
          selectPrevious()
        }
        return true
      }
      // Right arrow: open conversation (from list)
      if (e.key === 'ArrowRight' && focusArea === 'list') {
        e.preventDefault()
        const idToOpen = getSelectedId()
        if (idToOpen) {
          navigate(`/conversations/${idToOpen}`)
          setFocusArea('detail')
          setSelectedMessageIndex(0)
        }
        return true
      }
      // Left arrow: back to sidebar (from detail)
      if (e.key === 'ArrowLeft' && focusArea === 'detail') {
        e.preventDefault()
        setFocusArea('list')
        return true
      }

      // Enter: Open conversation and focus detail (from list only)
      if (e.key === 'Enter' && focusArea === 'list') {
        e.preventDefault()
        const idToOpen = getSelectedId()
        if (idToOpen) {
          navigate(`/conversations/${idToOpen}`)
          setFocusArea('detail')
          setSelectedMessageIndex(0)
        }
        return true
      }

      // Escape: Return to sidebar (from detail only)
      if (e.key === 'Escape' && focusArea === 'detail') {
        e.preventDefault()
        setFocusArea('list')
        return true
      }

      // Role-based navigation (u/a/U/A) - only in detail pane
      if (focusArea === 'detail') {
        switch (e.key) {
          case 'u':
            e.preventDefault()
            selectNextUserMessage()
            return true
          case 'U':
            e.preventDefault()
            selectPreviousUserMessage()
            return true
          case 'a':
            e.preventDefault()
            selectNextAssistantMessage()
            return true
          case 'A':
            e.preventDefault()
            selectPreviousAssistantMessage()
            return true
        }
      }

      return false
    },
    [focusArea, getSelectedId, navigate, setFocusArea, setSelectedMessageIndex, selectNext, selectPrevious, selectNextMessage, selectPreviousMessage, selectNextUserMessage, selectPreviousUserMessage, selectNextAssistantMessage, selectPreviousAssistantMessage]
  )

  const handleVimKey = useCallback(
    (e: KeyboardEvent) => {
      // Navigation depends on focus area
      if (focusArea === 'detail') {
        // Detail pane navigation
        switch (e.key) {
          case 'j':
            e.preventDefault()
            selectNextMessage()
            break
          case 'k':
            e.preventDefault()
            selectPreviousMessage()
            break
          case 'g':
            if (!e.ctrlKey && !e.metaKey) {
              e.preventDefault()
              selectFirstMessage()
            }
            break
          case 'G':
            e.preventDefault()
            selectLastMessage()
            break
        }
        // Paging: Ctrl+D / Ctrl+U
        if (e.ctrlKey) {
          switch (e.key) {
            case 'd':
              e.preventDefault()
              pageDown()
              break
            case 'u':
              e.preventDefault()
              pageUp()
              break
          }
        }
      } else {
        // List pane navigation
        switch (e.key) {
          case 'j':
            e.preventDefault()
            selectNext()
            break
          case 'k':
            e.preventDefault()
            selectPrevious()
            break
          case 'g':
            if (!e.ctrlKey && !e.metaKey) {
              e.preventDefault()
              selectFirst()
            }
            break
          case 'G':
            e.preventDefault()
            selectLast()
            break
          case '/':
            e.preventDefault()
            const searchInput = document.querySelector('input[placeholder*="Search"]') as HTMLInputElement
            searchInput?.focus()
            break
        }
      }
    },
    [focusArea, selectNext, selectPrevious, selectFirst, selectLast, selectNextMessage, selectPreviousMessage, selectFirstMessage, selectLastMessage, pageDown, pageUp]
  )

  const handleEmacsKey = useCallback(
    (e: KeyboardEvent) => {
      if (focusArea === 'detail') {
        // Detail pane navigation
        if (e.ctrlKey) {
          switch (e.key) {
            case 'n':
              e.preventDefault()
              selectNextMessage()
              break
            case 'p':
              e.preventDefault()
              selectPreviousMessage()
              break
          }
        }
        // Alt+< / Alt+> for first/last
        if (e.altKey) {
          switch (e.key) {
            case '<':
              e.preventDefault()
              selectFirstMessage()
              break
            case '>':
              e.preventDefault()
              selectLastMessage()
              break
            // Paging: M-n / M-p
            case 'n':
              e.preventDefault()
              pageDown()
              break
            case 'p':
              e.preventDefault()
              pageUp()
              break
          }
        }
      } else {
        // List pane navigation
        if (e.ctrlKey) {
          switch (e.key) {
            case 'n':
              e.preventDefault()
              selectNext()
              break
            case 'p':
              e.preventDefault()
              selectPrevious()
              break
            case 's':
              e.preventDefault()
              const searchInput = document.querySelector('input[placeholder*="Search"]') as HTMLInputElement
              searchInput?.focus()
              break
          }
        }
        // Alt+< / Alt+> for first/last in list
        if (e.altKey) {
          switch (e.key) {
            case '<':
              e.preventDefault()
              selectFirst()
              break
            case '>':
              e.preventDefault()
              selectLast()
              break
          }
        }
      }
    },
    [focusArea, selectNext, selectPrevious, selectFirst, selectLast, selectNextMessage, selectPreviousMessage, selectFirstMessage, selectLastMessage, pageDown, pageUp]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
}
