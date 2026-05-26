/* eslint-disable react-refresh/only-export-components -- safe: context Provider, hook, and three runtime predicates (isTheme/isKeyboardMode/isMarkdownDialect) co-located by intent. The predicates pair-narrow the Settings unions; splitting them into a separate file would force every consumer to track two imports. HMR fast refresh falls back to full reload for this file; no runtime impact. */
import { createContext, useCallback, useContext, useState, useEffect, useMemo, type ReactNode } from 'react'
import type { SortField, SortOrder } from '@/lib/types'
import { usePreferences } from '@/hooks/usePreferences'

export type Theme = 'light' | 'dark' | 'system'
export type KeyboardMode = 'emacs' | 'vim'
export type MarkdownDialect = 'commonmark' | 'obsidian'

// Runtime predicates for the closed string unions above. Radix
// `RadioGroup.onValueChange` hands callers a `string`, not the
// narrow union — the old `setX(value as Theme)` callsites in
// SettingsPage were runtime lies. These predicates let SettingsPage
// (and any other consumer of an `(value: string)` callback) reject
// unknown values instead of writing garbage to a typed setter.
const THEMES: readonly Theme[] = ['light', 'dark', 'system']
const KEYBOARD_MODES: readonly KeyboardMode[] = ['emacs', 'vim']
const MARKDOWN_DIALECTS: readonly MarkdownDialect[] = ['commonmark', 'obsidian']

export function isTheme(v: unknown): v is Theme {
  return typeof v === 'string' && (THEMES as readonly string[]).includes(v)
}

export function isKeyboardMode(v: unknown): v is KeyboardMode {
  return typeof v === 'string' && (KEYBOARD_MODES as readonly string[]).includes(v)
}

export function isMarkdownDialect(v: unknown): v is MarkdownDialect {
  return typeof v === 'string' && (MARKDOWN_DIALECTS as readonly string[]).includes(v)
}

interface SettingsContextType {
  // Display settings
  showToolCalls: boolean
  setShowToolCalls: (show: boolean) => void
  expandAllTools: boolean
  setExpandAllTools: (expand: boolean) => void
  showPhantomSessions: boolean
  setShowPhantomSessions: (show: boolean) => void
  // D8 (Cowork, 2026-05-25): toggle for hidden archived Cowork sessions.
  // Persisted via usePreferences like showPhantomSessions.
  showArchivedSessions: boolean
  setShowArchivedSessions: (show: boolean) => void
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

  // D8: same persistence path as showPhantomSessions. Default false
  // so a fresh install hides archived Cowork sessions by default.
  const [showArchivedSessions, setShowArchivedSessions] = usePreferences<boolean>(
    'showArchivedSessions',
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
  //
  // `useCallback` is load-bearing for the value-object memo below: a
  // fresh function identity each render would defeat the memo and let
  // the whole context value object churn even when no preferences
  // changed.
  const setSortField = useCallback(
    (field: SortField) => {
      setSortFieldRaw(field)
      setSortOrder(getDefaultSortOrder(field))
    },
    [setSortFieldRaw, setSortOrder],
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

  // 2026-05-22 perf fix (defense-in-depth alongside per-key `select` in
  // usePreferences.ts): memoize the context value so consumers like
  // MessageBubble (which reads useSettings() in its hot render path,
  // MessageBubble.tsx:50) don't get force-rerendered every time
  // SettingsProvider itself rerenders. A bare object literal here
  // would change identity on every render and punch through every
  // consumer's `React.memo` via context-invalidation. Each field is
  // listed explicitly so a future addition that forgets to thread its
  // value/setter into the deps list will surface as a stale-data bug
  // in dev rather than a silent memo-defeat.
  const value = useMemo<SettingsContextType>(
    () => ({
      showToolCalls,
      setShowToolCalls,
      expandAllTools,
      setExpandAllTools,
      showPhantomSessions,
      setShowPhantomSessions,
      showArchivedSessions,
      setShowArchivedSessions,
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
    }),
    [
      showToolCalls,
      expandAllTools,
      showPhantomSessions,
      setShowPhantomSessions,
      showArchivedSessions,
      setShowArchivedSessions,
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
    ],
  )

  return (
    <SettingsContext.Provider value={value}>
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
