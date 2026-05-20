import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '@/lib/api'
import type { Bookmark } from '@/lib/types'

interface BookmarkContextType {
  bookmarks: Bookmark[]
  isLoaded: boolean
  isBookmarked: (conversationId: string, messageUuid: string) => boolean
  getBookmarksForConversation: (conversationId: string) => Bookmark[]
  toggleBookmark: (input: Omit<Bookmark, 'id' | 'created_at'>) => Promise<void>
  updateBookmarkNote: (id: string, note: string) => Promise<void>
  deleteBookmark: (id: string) => Promise<void>
  reload: () => Promise<void>
}

const BookmarkContext = createContext<BookmarkContextType | null>(null)

export function BookmarkProvider({ children }: { children: ReactNode }) {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [isLoaded, setIsLoaded] = useState(false)

  const reload = useCallback(async () => {
    try {
      const list = await api.listBookmarks()
      setBookmarks(list)
    } catch {
      setBookmarks([])
    } finally {
      setIsLoaded(true)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const isBookmarked = useCallback(
    (conversationId: string, messageUuid: string) =>
      bookmarks.some((b) => b.conversation_id === conversationId && b.message_uuid === messageUuid),
    [bookmarks]
  )

  const getBookmarksForConversation = useCallback(
    (conversationId: string) => bookmarks.filter((b) => b.conversation_id === conversationId),
    [bookmarks]
  )

  const toggleBookmark = useCallback(async (input: Omit<Bookmark, 'id' | 'created_at'>) => {
    const existing = bookmarks.find(
      (b) => b.conversation_id === input.conversation_id && b.message_uuid === input.message_uuid
    )
    if (existing) {
      await api.deleteBookmark(existing.id)
      setBookmarks((prev) => prev.filter((b) => b.id !== existing.id))
      return
    }
    const created = await api.createBookmark(input)
    setBookmarks((prev) => [...prev, created])
  }, [bookmarks])

  const updateBookmarkNote = useCallback(async (id: string, note: string) => {
    const updated = await api.updateBookmark(id, { note })
    setBookmarks((prev) => prev.map((b) => (b.id === id ? updated : b)))
  }, [])

  const deleteBookmarkFn = useCallback(async (id: string) => {
    await api.deleteBookmark(id)
    setBookmarks((prev) => prev.filter((b) => b.id !== id))
  }, [])

  const value = useMemo<BookmarkContextType>(() => ({
    bookmarks,
    isLoaded,
    isBookmarked,
    getBookmarksForConversation,
    toggleBookmark,
    updateBookmarkNote,
    deleteBookmark: deleteBookmarkFn,
    reload,
  }), [bookmarks, isLoaded, isBookmarked, getBookmarksForConversation, toggleBookmark, updateBookmarkNote, deleteBookmarkFn, reload])

  return <BookmarkContext.Provider value={value}>{children}</BookmarkContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components -- safe: context Provider + hook co-located by convention. Splitting would force every consumer to re-import. HMR fast refresh falls back to full reload for this file; no runtime impact.
export function useBookmarks(): BookmarkContextType {
  const ctx = useContext(BookmarkContext)
  if (!ctx) throw new Error('useBookmarks must be used within a BookmarkProvider')
  return ctx
}
