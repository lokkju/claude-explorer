import { createContext, useContext, useState, useEffect, useMemo, type ReactNode } from 'react'
import type { SortField, SortOrder } from '@/lib/types'

export type Theme = 'light' | 'dark' | 'system'
export type KeyboardMode = 'emacs' | 'vim'

interface SettingsContextType {
  // Display settings
  showToolCalls: boolean
  setShowToolCalls: (show: boolean) => void
  expandAllTools: boolean
  setExpandAllTools: (expand: boolean) => void
  showPhantomSessions: boolean
  setShowPhantomSessions: (show: boolean) => void
  hideCompactMarkers: boolean
  setHideCompactMarkers: (hide: boolean) => void
  // Sort and group settings
  sortField: SortField
  setSortField: (field: SortField) => void
  sortOrder: SortOrder
  setSortOrder: (order: SortOrder) => void
  groupByProject: boolean
  setGroupByProject: (group: boolean) => void
  // Theme settings
  theme: Theme
  setTheme: (theme: Theme) => void
  effectiveTheme: 'light' | 'dark'
  // Keyboard settings
  keyboardMode: KeyboardMode
  setKeyboardMode: (mode: KeyboardMode) => void
  // Right-pane tab
  rightPaneTab: 'search' | 'bookmarks'
  setRightPaneTab: (tab: 'search' | 'bookmarks') => void
}

const SettingsContext = createContext<SettingsContextType | null>(null)

// Helper to read from localStorage with fallback
function getStoredValue<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key)
    if (stored !== null) {
      return JSON.parse(stored) as T
    }
  } catch {
    // Ignore parse errors
  }
  return fallback
}

// Natural sort order for each field
function getDefaultSortOrder(field: SortField): SortOrder {
  switch (field) {
    case 'updated_at':
    case 'created_at':
      return 'desc' // Most recent first
    case 'name':
    case 'project':
      return 'asc' // Alphabetical
    default:
      return 'desc'
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [showToolCalls, setShowToolCalls] = useState(false)
  const [expandAllTools, setExpandAllTools] = useState(false)
  const [showPhantomSessions, setShowPhantomSessions] = useState(false)
  const [hideCompactMarkers, setHideCompactMarkersState] = useState<boolean>(() =>
    getStoredValue<boolean>('hideCompactMarkers', false)
  )
  const [rightPaneTab, setRightPaneTabState] = useState<'search' | 'bookmarks'>(() =>
    getStoredValue<'search' | 'bookmarks'>('rightPaneTab', 'search')
  )

  // Sort and group settings with localStorage persistence
  const [sortField, setSortFieldState] = useState<SortField>(() =>
    getStoredValue<SortField>('sortField', 'updated_at')
  )
  const [sortOrder, setSortOrderState] = useState<SortOrder>(() =>
    getStoredValue<SortOrder>('sortOrder', 'desc')
  )
  const [groupByProject, setGroupByProjectState] = useState<boolean>(() =>
    getStoredValue<boolean>('groupByProject', false)
  )

  // Theme settings
  const [theme, setThemeState] = useState<Theme>(() =>
    getStoredValue<Theme>('theme', 'system')
  )
  const [systemPrefersDark, setSystemPrefersDark] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
  )

  // Listen for system theme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches)
    mediaQuery.addEventListener('change', handler)
    return () => mediaQuery.removeEventListener('change', handler)
  }, [])

  // Compute effective theme
  const effectiveTheme = useMemo(() => {
    if (theme === 'system') {
      return systemPrefersDark ? 'dark' : 'light'
    }
    return theme
  }, [theme, systemPrefersDark])

  // Keyboard mode settings
  const [keyboardMode, setKeyboardModeState] = useState<KeyboardMode>(() =>
    getStoredValue<KeyboardMode>('keyboardMode', 'emacs')
  )

  // Persist to localStorage when values change
  const setSortField = (field: SortField) => {
    setSortFieldState(field)
    localStorage.setItem('sortField', JSON.stringify(field))
    // Automatically set natural sort order for the field
    const naturalOrder = getDefaultSortOrder(field)
    setSortOrderState(naturalOrder)
    localStorage.setItem('sortOrder', JSON.stringify(naturalOrder))
  }

  const setSortOrder = (order: SortOrder) => {
    setSortOrderState(order)
    localStorage.setItem('sortOrder', JSON.stringify(order))
  }

  const setGroupByProject = (group: boolean) => {
    setGroupByProjectState(group)
    localStorage.setItem('groupByProject', JSON.stringify(group))
  }

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme)
    localStorage.setItem('theme', JSON.stringify(newTheme))
  }

  const setKeyboardMode = (mode: KeyboardMode) => {
    setKeyboardModeState(mode)
    localStorage.setItem('keyboardMode', JSON.stringify(mode))
  }

  const setHideCompactMarkers = (hide: boolean) => {
    setHideCompactMarkersState(hide)
    localStorage.setItem('hideCompactMarkers', JSON.stringify(hide))
  }

  const setRightPaneTab = (tab: 'search' | 'bookmarks') => {
    setRightPaneTabState(tab)
    localStorage.setItem('rightPaneTab', JSON.stringify(tab))
  }

  return (
    <SettingsContext.Provider value={{
      showToolCalls,
      setShowToolCalls,
      expandAllTools,
      setExpandAllTools,
      showPhantomSessions,
      setShowPhantomSessions,
      hideCompactMarkers,
      setHideCompactMarkers,
      sortField,
      setSortField,
      sortOrder,
      setSortOrder,
      groupByProject,
      setGroupByProject,
      theme,
      setTheme,
      effectiveTheme,
      keyboardMode,
      setKeyboardMode,
      rightPaneTab,
      setRightPaneTab,
    }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  const context = useContext(SettingsContext)
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider')
  }
  return context
}
