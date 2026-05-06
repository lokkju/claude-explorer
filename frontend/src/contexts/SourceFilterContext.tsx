import { createContext, useContext, type ReactNode } from 'react'
import type { SourceFilter } from '@/lib/types'
import { usePreferences } from '@/hooks/usePreferences'

interface SourceFilterContextType {
  sourceFilter: SourceFilter
  setSourceFilter: (source: SourceFilter) => void
  // cowork-multi-org C6: workspace filter (composes with sourceFilter).
  // null = "All workspaces" (NEW2-P0-η escape hatch).
  organizationId: string | null
  setOrganizationId: (orgId: string | null) => void
}

const SourceFilterContext = createContext<SourceFilterContextType | null>(null)

// Legacy key kept verbatim so existing browser sessions keep working
// without a rename. usePreferences PATCHes the server under this same
// key string AND mirrors the value into localStorage[key].
const ORG_FILTER_STORAGE_KEY = 'claude-explorer.organizationFilter'

export function SourceFilterProvider({ children }: { children: ReactNode }) {
  // P3d: dual-read/dual-write via usePreferences. sourceFilter was
  // ephemeral useState before this commit — now persisted so a Claude
  // Code-only user doesn't have to re-pick the filter every reload.
  const [sourceFilter, setSourceFilter] = usePreferences<SourceFilter>(
    'sourceFilter',
    'all',
  )
  const [organizationId, setOrganizationId] = usePreferences<string | null>(
    ORG_FILTER_STORAGE_KEY,
    null,
  )

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
