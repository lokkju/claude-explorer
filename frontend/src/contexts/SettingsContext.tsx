import { createContext, useContext, useState, type ReactNode } from 'react'

interface SettingsContextType {
  showToolCalls: boolean
  setShowToolCalls: (show: boolean) => void
  expandAllTools: boolean
  setExpandAllTools: (expand: boolean) => void
}

const SettingsContext = createContext<SettingsContextType | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [showToolCalls, setShowToolCalls] = useState(true)
  const [expandAllTools, setExpandAllTools] = useState(false)

  return (
    <SettingsContext.Provider value={{ showToolCalls, setShowToolCalls, expandAllTools, setExpandAllTools }}>
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
