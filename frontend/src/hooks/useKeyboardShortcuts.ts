import { useEffect, useCallback, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useSettings } from '@/contexts/SettingsContext'
import { useKeyboardNavigation } from '@/contexts/KeyboardNavigationContext'
import { queryKeys } from '@/lib/queryClient'
import { messageToMarkdown } from '@/lib/utils'
import type { ConversationDetail } from '@/lib/types'

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
  const location = useLocation()
  const currentUuid = useMemo(() => {
    const match = location.pathname.match(/\/conversations\/(.+)/)
    return match?.[1]
  }, [location.pathname])
  const { keyboardMode, showToolCalls } = useSettings()
  const queryClient = useQueryClient()
  const {
    selectNext,
    selectPrevious,
    selectFirst,
    selectLast,
    getSelectedId,
    setIsHelpOpen,
    focusArea,
    setFocusArea,
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
    getSelectedMessageId,
  } = useKeyboardNavigation()

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const cmdOrCtrl = e.metaKey || e.ctrlKey

      // Cmd+R to refresh conversation list (prevent browser refresh)
      if (e.key === 'r' && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        queryClient.invalidateQueries({ queryKey: queryKeys.conversations.all })
        return
      }

      // Cmd+C: Copy selected message (detail pane only, when no text selection)
      if (e.key === 'c' && cmdOrCtrl && !e.altKey && !e.shiftKey) {
        // Only intercept if in detail pane and no text is selected (let normal copy work otherwise)
        if (focusArea === 'detail' && !window.getSelection()?.toString()) {
          const messageId = getSelectedMessageId()
          if (messageId && currentUuid) {
            const conversation = queryClient.getQueryData<ConversationDetail>(
              queryKeys.conversations.detail(currentUuid)
            )
            const message = conversation?.messages.find((m) => m.uuid === messageId)
            if (message) {
              e.preventDefault()
              const markdown = messageToMarkdown(message, showToolCalls)
              navigator.clipboard.writeText(markdown)
              return
            }
          }
        }
      }

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
          setFocusArea(focusArea === 'list' ? 'detail' : 'list')
          return
        }
      }

      // Ignore events in input fields
      if (isInputElement(e.target)) return

      // === Universal keys (both modes) ===

      // Arrow keys
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (focusArea === 'detail') selectNextMessage()
        else selectNext()
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (focusArea === 'detail') selectPreviousMessage()
        else selectPrevious()
        return
      }
      if (e.key === 'ArrowRight' && focusArea === 'list') {
        e.preventDefault()
        const id = getSelectedId()
        if (id) {
          navigate(`/conversations/${id}`)
          setFocusArea('detail')
          setSelectedMessageIndex(0)
        }
        return
      }
      if (e.key === 'ArrowLeft' && focusArea === 'detail') {
        e.preventDefault()
        setFocusArea('list')
        return
      }

      // Enter: Open conversation and focus detail (from list)
      if (e.key === 'Enter' && focusArea === 'list') {
        e.preventDefault()
        const id = getSelectedId()
        if (id) {
          navigate(`/conversations/${id}`)
          setFocusArea('detail')
          setSelectedMessageIndex(0)
        }
        return
      }

      // Escape: Return to sidebar (from detail)
      if (e.key === 'Escape' && focusArea === 'detail') {
        e.preventDefault()
        setFocusArea('list')
        return
      }

      // Role-based navigation (u/a/U/A) - detail only
      if (focusArea === 'detail') {
        switch (e.key) {
          case 'u':
            e.preventDefault()
            selectNextUserMessage()
            return
          case 'U':
            e.preventDefault()
            selectPreviousUserMessage()
            return
          case 'a':
            e.preventDefault()
            selectNextAssistantMessage()
            return
          case 'A':
            e.preventDefault()
            selectPreviousAssistantMessage()
            return
        }
      }

      // === Mode-specific keys ===

      if (keyboardMode === 'vim') {
        if (focusArea === 'detail') {
          switch (e.key) {
            case 'j':
              e.preventDefault()
              selectNextMessage()
              return
            case 'k':
              e.preventDefault()
              selectPreviousMessage()
              return
            case 'g':
              if (!e.ctrlKey && !e.metaKey) {
                e.preventDefault()
                selectFirstMessage()
              }
              return
            case 'G':
              e.preventDefault()
              selectLastMessage()
              return
          }
          if (e.ctrlKey) {
            switch (e.key) {
              case 'd':
                e.preventDefault()
                pageDown()
                return
              case 'u':
                e.preventDefault()
                pageUp()
                return
            }
          }
        } else {
          // List pane - vim
          switch (e.key) {
            case 'j':
              e.preventDefault()
              selectNext()
              return
            case 'k':
              e.preventDefault()
              selectPrevious()
              return
            case 'g':
              if (!e.ctrlKey && !e.metaKey) {
                e.preventDefault()
                selectFirst()
              }
              return
            case 'G':
              e.preventDefault()
              selectLast()
              return
            case '/':
              e.preventDefault()
              ;(document.querySelector('input[placeholder*="Search"]') as HTMLInputElement)?.focus()
              return
          }
        }
      } else {
        // Emacs mode
        if (focusArea === 'detail') {
          if (e.ctrlKey) {
            switch (e.key) {
              case 'n':
                e.preventDefault()
                selectNextMessage()
                return
              case 'p':
                e.preventDefault()
                selectPreviousMessage()
                return
            }
          }
          if (e.altKey) {
            switch (e.key) {
              case '<':
                e.preventDefault()
                selectFirstMessage()
                return
              case '>':
                e.preventDefault()
                selectLastMessage()
                return
              case 'n':
                e.preventDefault()
                pageDown()
                return
              case 'p':
                e.preventDefault()
                pageUp()
                return
            }
          }
        } else {
          // List pane - emacs
          if (e.ctrlKey) {
            switch (e.key) {
              case 'n':
                e.preventDefault()
                selectNext()
                return
              case 'p':
                e.preventDefault()
                selectPrevious()
                return
              case 's':
                e.preventDefault()
                ;(document.querySelector('input[placeholder*="Search"]') as HTMLInputElement)?.focus()
                return
            }
          }
          if (e.altKey) {
            switch (e.key) {
              case '<':
                e.preventDefault()
                selectFirst()
                return
              case '>':
                e.preventDefault()
                selectLast()
                return
            }
          }
        }
      }
    },
    [keyboardMode, focusArea, currentUuid, queryClient, navigate, showToolCalls,
     setFocusArea, setIsHelpOpen, setSelectedMessageIndex,
     selectNext, selectPrevious, selectFirst, selectLast, getSelectedId,
     selectNextMessage, selectPreviousMessage, selectFirstMessage, selectLastMessage,
     selectNextUserMessage, selectPreviousUserMessage,
     selectNextAssistantMessage, selectPreviousAssistantMessage,
     pageDown, pageUp, getSelectedMessageId]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
}