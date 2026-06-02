import { createContext, use, useMemo, type ReactNode } from 'react'
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

  // Project invariant #2 (CLAUDE.md "Performance Work"): wrap every
  // Provider value in `useMemo`. The setters from `usePreferences`
  // currently churn identity on each render, so the deps list pins them
  // explicitly — the memo bails out only when sourceFilter + organizationId
  // values AND setter identities are all unchanged.
  const value = useMemo(
    () => ({ sourceFilter, setSourceFilter, organizationId, setOrganizationId }),
    [sourceFilter, setSourceFilter, organizationId, setOrganizationId],
  )

  return (
    <SourceFilterContext.Provider value={value}>
      {children}
    </SourceFilterContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- safe: context Provider + hook co-located by convention. HMR fast refresh falls back to full reload; no runtime impact.
export function useSourceFilter() {
  // Phase 3: React 19 use() replaces useContext().
  const context = use(SourceFilterContext)
  if (!context) {
    throw new Error('useSourceFilter must be used within a SourceFilterProvider')
  }
  return context
}
