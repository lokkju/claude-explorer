import { createContext, useContext, useState, type ReactNode } from 'react'
import type { SourceFilter } from '@/lib/types'

interface SourceFilterContextType {
  sourceFilter: SourceFilter
  setSourceFilter: (source: SourceFilter) => void
}

const SourceFilterContext = createContext<SourceFilterContextType | null>(null)

export function SourceFilterProvider({ children }: { children: ReactNode }) {
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')

  return (
    <SourceFilterContext.Provider value={{ sourceFilter, setSourceFilter }}>
      {children}
    </SourceFilterContext.Provider>
  )
}

export function useSourceFilter() {
  const context = useContext(SourceFilterContext)
  if (!context) {
    throw new Error('useSourceFilter must be used within a SourceFilterProvider')
  }
  return context
}