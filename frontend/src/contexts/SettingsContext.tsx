import { createContext, useContext, useState, useEffect, useMemo, type ReactNode } from 'react'
import type { SortField, SortOrder } from '@/lib/types'
import { usePreferences } from '@/hooks/usePreferences'

export type Theme = 'light' | 'dark' | 'system'
export type KeyboardMode = 'emacs' | 'vim'
export type MarkdownDialect = 'commonmark' | 'obsidian'

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
  // Markdown export bundle settings (Issue #4)
  markdownBundleImages: boolean
  setMarkdownBundleImages: (bundle: boolean) => void
  markdownDialect: MarkdownDialect
  setMarkdownDialect: (dialect: MarkdownDialect) => void
}

const SettingsContext = createContext<SettingsContextType | null>(null)

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
  // Ephemeral (per-session) toggles — not persisted anywhere.
  const [showToolCalls, setShowToolCalls] = useState(false)
  const [expandAllTools, setExpandAllTools] = useState(false)

  // P3d: showPhantomSessions persists via usePreferences (was ephemeral
  // useState before). Server PATCH + localStorage mirror under
  // 'showPhantomSessions'.
  const [showPhantomSessions, setShowPhantomSessions] = usePreferences<boolean>(
    'showPhantomSessions',
    false,
  )

  // P3c — persisted prefs migrated to dual-read/dual-write via
  // usePreferences. The localStorage *keys* are the same legacy strings
  // (e.g. 'theme', 'keyboardMode') so existing browser sessions keep
  // working seamlessly. The local mirror is kept on purpose during the
  // soak window — the hook PATCHes the server AND writes localStorage.
  const [hideCompactMarkers, setHideCompactMarkers] = usePreferences<boolean>(
    'hideCompactMarkers',
    false,
  )
  const [rightPaneTab, setRightPaneTab] = usePreferences<'search' | 'bookmarks'>(
    'rightPaneTab',
    'search',
  )
  const [markdownBundleImages, setMarkdownBundleImages] = usePreferences<boolean>(
    'markdownBundleImages',
    false,
  )
  const [markdownDialect, setMarkdownDialect] = usePreferences<MarkdownDialect>(
    'markdownDialect',
    'commonmark',
  )
  const [sortField, setSortFieldRaw] = usePreferences<SortField>(
    'sortField',
    'updated_at',
  )
  const [sortOrder, setSortOrder] = usePreferences<SortOrder>('sortOrder', 'desc')
  const [groupByProject, setGroupByProject] = usePreferences<boolean>(
    'groupByProject',
    false,
  )
  const [theme, setTheme] = usePreferences<Theme>('theme', 'system')
  const [keyboardMode, setKeyboardMode] = usePreferences<KeyboardMode>(
    'keyboardMode',
    'emacs',
  )

  // Setting sortField also flips sortOrder to its natural direction —
  // preserve that legacy UX. Both writes go through usePreferences, so
  // both PATCH the server and mirror localStorage.
  const setSortField = (field: SortField) => {
    setSortFieldRaw(field)
    setSortOrder(getDefaultSortOrder(field))
  }

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
      markdownBundleImages,
      setMarkdownBundleImages,
      markdownDialect,
      setMarkdownDialect,
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
