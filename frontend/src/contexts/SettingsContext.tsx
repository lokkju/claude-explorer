import { createContext, useContext, useState, type ReactNode } from 'react'

interface SettingsContextType {
  showToolCalls: boolean
  setShowToolCalls: (show: boolean) => void
  expandAllTools: boolean
  setExpandAllTools: (expand: boolean) => void
  showPhantomSessions: boolean
  setShowPhantomSessions: (show: boolean) => void
}

const SettingsContext = createContext<SettingsContextType | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [showToolCalls, setShowToolCalls] = useState(true)
  const [expandAllTools, setExpandAllTools] = useState(false)
  const [showPhantomSessions, setShowPhantomSessions] = useState(false)

  return (
    <SettingsContext.Provider value={{
      showToolCalls,
      setShowToolCalls,
      expandAllTools,
      setExpandAllTools,
      showPhantomSessions,
      setShowPhantomSessions,
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
