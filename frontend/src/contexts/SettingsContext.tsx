import { createContext, useContext, useState, type ReactNode } from 'react'
import type { SortField, SortOrder } from '@/lib/types'

interface SettingsContextType {
  showToolCalls: boolean
  setShowToolCalls: (show: boolean) => void
  expandAllTools: boolean
  setExpandAllTools: (expand: boolean) => void
  showPhantomSessions: boolean
  setShowPhantomSessions: (show: boolean) => void
  sortField: SortField
  setSortField: (field: SortField) => void
  sortOrder: SortOrder
  setSortOrder: (order: SortOrder) => void
  groupByProject: boolean
  setGroupByProject: (group: boolean) => void
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

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [showToolCalls, setShowToolCalls] = useState(true)
  const [expandAllTools, setExpandAllTools] = useState(false)
  const [showPhantomSessions, setShowPhantomSessions] = useState(false)

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

  // Persist to localStorage when values change
  const setSortField = (field: SortField) => {
    setSortFieldState(field)
    localStorage.setItem('sortField', JSON.stringify(field))
  }

  const setSortOrder = (order: SortOrder) => {
    setSortOrderState(order)
    localStorage.setItem('sortOrder', JSON.stringify(order))
  }

  const setGroupByProject = (group: boolean) => {
    setGroupByProjectState(group)
    localStorage.setItem('groupByProject', JSON.stringify(group))
  }

  return (
    <SettingsContext.Provider value={{
      showToolCalls,
      setShowToolCalls,
      expandAllTools,
      setExpandAllTools,
      showPhantomSessions,
      setShowPhantomSessions,
      sortField,
      setSortField,
      sortOrder,
      setSortOrder,
      groupByProject,
      setGroupByProject,
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
