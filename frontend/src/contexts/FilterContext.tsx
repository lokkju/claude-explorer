import { createContext, useContext, useState, useEffect, useMemo, useCallback, type ReactNode } from 'react'
import type { Filter } from '@/lib/filterEngine'

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

function readJson<T>(key: string, fallback: T): T {
  try {
    if (typeof localStorage === 'undefined' || typeof localStorage.getItem !== 'function') return fallback
    const v = localStorage.getItem(key)
    if (v) return JSON.parse(v) as T
  } catch {
    // ignore
  }
  return fallback
}

function writeJson(key: string, value: unknown): void {
  try {
    if (typeof localStorage === 'undefined' || typeof localStorage.setItem !== 'function') return
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // ignore
  }
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return 'flt-' + Math.random().toString(36).slice(2, 10)
}

export function FilterProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState<Filter[]>(() => readJson<Filter[]>(STORAGE_FILTERS, []))
  // Pinned filters auto-active on load. Unpinned active state is per-session only.
  const [activeFilterIds, setActiveFilterIds] = useState<string[]>(() => {
    const stored = readJson<string[]>(STORAGE_ACTIVE_PINNED, [])
    if (stored.length > 0) return stored
    return readJson<Filter[]>(STORAGE_FILTERS, []).filter((f) => f.pinned).map((f) => f.id)
  })

  useEffect(() => {
    writeJson(STORAGE_FILTERS, filters)
  }, [filters])

  useEffect(() => {
    // Persist only the pinned-active subset; unpinned-active is session-only.
    const persistableActive = activeFilterIds.filter((id) => filters.find((f) => f.id === id)?.pinned)
    writeJson(STORAGE_ACTIVE_PINNED, persistableActive)
  }, [activeFilterIds, filters])

  const addFilter = useCallback((partial: Omit<Filter, 'id'>): Filter => {
    const filter: Filter = { id: newId(), ...partial }
    setFilters((prev) => [...prev, filter])
    if (filter.pinned) {
      setActiveFilterIds((prev) => (prev.includes(filter.id) ? prev : [...prev, filter.id]))
    }
    return filter
  }, [])

  const updateFilter = useCallback((id: string, partial: Partial<Filter>) => {
    setFilters((prev) => prev.map((f) => (f.id === id ? { ...f, ...partial } : f)))
  }, [])

  const removeFilter = useCallback((id: string) => {
    setFilters((prev) => prev.filter((f) => f.id !== id))
    setActiveFilterIds((prev) => prev.filter((x) => x !== id))
  }, [])

  const toggleActive = useCallback((id: string) => {
    setActiveFilterIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }, [])

  const clearAllActive = useCallback(() => {
    setActiveFilterIds([])
  }, [])

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
