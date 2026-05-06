import { createContext, useContext, useEffect, useMemo, useCallback, useRef, type ReactNode } from 'react'
import type { Filter } from '@/lib/filterEngine'
import { usePreferences } from '@/hooks/usePreferences'

interface FilterContextType {
  filters: Filter[]
  activeFilterIds: string[]
  activeFilters: Filter[]
  addFilter: (filter: Omit<Filter, 'id'>) => Filter
  updateFilter: (id: string, partial: Partial<Filter>) => void
  removeFilter: (id: string) => void
  toggleActive: (id: string) => void
  clearAllActive: () => void
}

const FilterContext = createContext<FilterContextType | null>(null)

const STORAGE_FILTERS = 'savedFilters'
const STORAGE_ACTIVE_PINNED = 'activeFilterIds'

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return 'flt-' + Math.random().toString(36).slice(2, 10)
}

export function FilterProvider({ children }: { children: ReactNode }) {
  // P3f: dual-read/dual-write via usePreferences. Server-of-record with a
  // synchronous localStorage mirror. The hook reads server -> local ->
  // fallback on first paint, and PATCHes the server (plus mirrors locally)
  // on every setValue.
  const [filters, setFiltersPref] = usePreferences<Filter[]>(STORAGE_FILTERS, [])
  const [activeFilterIds, setActiveFilterIdsPref] = usePreferences<string[]>(STORAGE_ACTIVE_PINNED, [])

  // Auto-activate pinned filters on first mount when nothing is currently
  // active. Mirrors the legacy fallback behavior for sessions that have
  // never persisted an explicit active set yet.
  const didSeedActiveRef = useRef(false)
  useEffect(() => {
    if (didSeedActiveRef.current) return
    if (activeFilterIds.length > 0) {
      didSeedActiveRef.current = true
      return
    }
    const pinned = filters.filter((f) => f.pinned).map((f) => f.id)
    if (pinned.length > 0) {
      didSeedActiveRef.current = true
      setActiveFilterIdsPref(pinned)
    }
    // We deliberately do not list setActiveFilterIdsPref / activeFilterIds
    // in deps beyond the initial filters arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters])

  const addFilter = useCallback((partial: Omit<Filter, 'id'>): Filter => {
    const filter: Filter = { id: newId(), ...partial }
    const nextFilters = [...filters, filter]
    setFiltersPref(nextFilters)
    if (filter.pinned && !activeFilterIds.includes(filter.id)) {
      setActiveFilterIdsPref([...activeFilterIds, filter.id])
    }
    return filter
  }, [filters, activeFilterIds, setFiltersPref, setActiveFilterIdsPref])

  const updateFilter = useCallback((id: string, partial: Partial<Filter>) => {
    setFiltersPref(filters.map((f) => (f.id === id ? { ...f, ...partial } : f)))
  }, [filters, setFiltersPref])

  const removeFilter = useCallback((id: string) => {
    setFiltersPref(filters.filter((f) => f.id !== id))
    if (activeFilterIds.includes(id)) {
      setActiveFilterIdsPref(activeFilterIds.filter((x) => x !== id))
    }
  }, [filters, activeFilterIds, setFiltersPref, setActiveFilterIdsPref])

  const toggleActive = useCallback((id: string) => {
    const next = activeFilterIds.includes(id)
      ? activeFilterIds.filter((x) => x !== id)
      : [...activeFilterIds, id]
    setActiveFilterIdsPref(next)
  }, [activeFilterIds, setActiveFilterIdsPref])

  const clearAllActive = useCallback(() => {
    setActiveFilterIdsPref([])
  }, [setActiveFilterIdsPref])

  const activeFilters = useMemo(
    () => activeFilterIds.map((id) => filters.find((f) => f.id === id)).filter((f): f is Filter => Boolean(f)),
    [activeFilterIds, filters]
  )

  return (
    <FilterContext.Provider value={{ filters, activeFilterIds, activeFilters, addFilter, updateFilter, removeFilter, toggleActive, clearAllActive }}>
      {children}
    </FilterContext.Provider>
  )
}

export function useFilters(): FilterContextType {
  const ctx = useContext(FilterContext)
  if (!ctx) throw new Error('useFilters must be used within a FilterProvider')
  return ctx
}
