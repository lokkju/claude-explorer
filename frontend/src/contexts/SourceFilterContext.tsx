import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { SourceFilter } from '@/lib/types'

interface SourceFilterContextType {
  sourceFilter: SourceFilter
  setSourceFilter: (source: SourceFilter) => void
  // cowork-multi-org C6: workspace filter (composes with sourceFilter).
  // null = "All workspaces" (NEW2-P0-η escape hatch).
  organizationId: string | null
  setOrganizationId: (orgId: string | null) => void
}

const SourceFilterContext = createContext<SourceFilterContextType | null>(null)

const ORG_FILTER_STORAGE_KEY = 'claude-explorer.organizationFilter'

export function SourceFilterProvider({ children }: { children: ReactNode }) {
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [organizationId, setOrganizationIdState] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    try {
      const v = window.localStorage.getItem(ORG_FILTER_STORAGE_KEY)
      return v === '' ? null : v
    } catch {
      return null
    }
  })

  // Persist organizationId across reloads.
  useEffect(() => {
    try {
      if (organizationId === null) {
        window.localStorage.removeItem(ORG_FILTER_STORAGE_KEY)
      } else {
        window.localStorage.setItem(ORG_FILTER_STORAGE_KEY, organizationId)
      }
    } catch {
      // localStorage may be unavailable in private browsing.
    }
  }, [organizationId])

  const setOrganizationId = (orgId: string | null) => setOrganizationIdState(orgId)

  return (
    <SourceFilterContext.Provider
      value={{ sourceFilter, setSourceFilter, organizationId, setOrganizationId }}
    >
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
