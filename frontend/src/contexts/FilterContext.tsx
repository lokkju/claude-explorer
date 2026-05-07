/**
 * FilterContext — composable named filters (CF1, 2026-05-07).
 *
 * Replaces the old flat `Filter[] + activeFilterIds[]` model with a graph
 * (`FiltersState`) keyed by filter id. The graph is persisted under one
 * preferences key, `'filters'`, via the existing `usePreferences` hook
 * (server-of-record + localStorage mirror).
 *
 * On first mount, if a legacy prefs blob is detected (`savedFilters` and/or
 * `activeFilterIds` present, AND `filters._migratedV1 !== true`), we run a
 * one-shot migration:
 *
 *   1. Each legacy filter -> AtomFilter (drop pinned/target).
 *   2. Build a 'default-migrated' Group containing the previously-pinned
 *      atom IDs; activeId = 'default-migrated' if any were pinned, else
 *      null.
 *   3. PATCH the new blob AND explicitly null savedFilters/activeFilterIds.
 *      The backend's per-key overwrite leaves untouched any key not in the
 *      payload, so omitting the legacy keys would leave them on disk;
 *      explicit null is required to clear them.
 *   4. Set _migratedV1 = true so subsequent mounts skip migration.
 *
 * The migration is idempotent under React StrictMode double-mount: a
 * module-level ref tracks "have we sent the migration PATCH this load",
 * and the on-disk sentinel guards future page loads.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { FilterNode, FiltersState, AtomFilter, GroupFilter, FilterId } from '@/lib/filterEngine'
import { usePreferences } from '@/hooks/usePreferences'

interface LegacyFilter {
  id: string
  name: string
  patterns: string[]
  polarity: 'include' | 'exclude'
  mode: 'glob' | 'regex'
  target: 'title'
  pinned?: boolean
}

interface FilterContextType {
  filtersState: FiltersState
  setActiveId: (id: FilterId | null) => void
  addNode: (node: FilterNode) => void
  updateNode: (id: FilterId, partial: Partial<FilterNode>) => void
  removeNode: (id: FilterId) => void
  /**
   * CF3: persistently dismiss the one-time migration banner. Writes
   * `migrationBannerDismissed: true` into the same `filters` blob (so the
   * sentinel and the dismiss flag travel together) via usePreferences,
   * which handles the server PATCH and localStorage mirror.
   */
  dismissMigrationBanner: () => void
}

const FilterContext = createContext<FilterContextType | null>(null)

const FILTERS_KEY = 'filters'
const LEGACY_FILTERS_KEY = 'savedFilters'
const LEGACY_ACTIVE_KEY = 'activeFilterIds'
const MIGRATED_GROUP_ID = 'default-migrated'
const MIGRATED_GROUP_NAME = 'Default (migrated)'

const INITIAL_STATE: FiltersState = { nodes: {}, activeId: null, _migratedV1: false }

function migrateLegacy(
  legacyFilters: LegacyFilter[],
  legacyActiveIds: string[],
): FiltersState {
  const nodes: Record<FilterId, FilterNode> = {}
  for (const lf of legacyFilters) {
    const atom: AtomFilter = {
      type: 'atom',
      id: lf.id,
      name: lf.name,
      enabled: true,
      patterns: Array.isArray(lf.patterns) ? lf.patterns : [],
      polarity: lf.polarity,
      mode: lf.mode,
      target: 'title',
    }
    nodes[atom.id] = atom
  }
  // The set of pinned atoms goes into the default-migrated group. Union
  // with any legacyActiveIds so an explicit "active" wins over `pinned`
  // on a per-id basis (matches the old seeding semantics).
  const pinnedIds = legacyFilters.filter((f) => f.pinned).map((f) => f.id)
  const groupChildren = Array.from(new Set([...pinnedIds, ...legacyActiveIds])).filter(
    (id) => id in nodes,
  )
  const group: GroupFilter = {
    type: 'group',
    id: MIGRATED_GROUP_ID,
    name: MIGRATED_GROUP_NAME,
    enabled: true,
    match: 'all',
    childIds: groupChildren,
  }
  nodes[MIGRATED_GROUP_ID] = group
  return {
    nodes,
    activeId: groupChildren.length > 0 ? MIGRATED_GROUP_ID : null,
    _migratedV1: true,
  }
}

export function FilterProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [filtersState, setFiltersState] = usePreferences<FiltersState>(FILTERS_KEY, INITIAL_STATE)

  // Read legacy keys via the same hook so they participate in the same
  // server fetch / localStorage mirror chain. We never write to these,
  // except via the explicit-null clear inside the migration PATCH.
  const [legacyFilters] = usePreferences<LegacyFilter[] | null>(LEGACY_FILTERS_KEY, null)
  const [legacyActive] = usePreferences<string[] | null>(LEGACY_ACTIVE_KEY, null)

  // Idempotency guard: avoid re-PATCHing during React StrictMode's double
  // mount and across re-renders inside a single page load. The on-disk
  // sentinel guards future loads.
  const didMigrateRef = useRef(false)

  useEffect(() => {
    if (didMigrateRef.current) return
    if (filtersState._migratedV1) return

    const hasLegacyFilters = Array.isArray(legacyFilters) && legacyFilters.length > 0
    const hasLegacyActive = Array.isArray(legacyActive) && legacyActive.length > 0

    if (!hasLegacyFilters && !hasLegacyActive) {
      // No legacy, nothing to migrate. We don't flip the sentinel here so
      // a future install with legacy keys would still migrate.
      return
    }

    didMigrateRef.current = true
    const migrated = migrateLegacy(
      hasLegacyFilters ? legacyFilters! : [],
      hasLegacyActive ? legacyActive! : [],
    )
    // Single atomic PATCH that:
    //   - writes the new `filters` blob (with _migratedV1: true), AND
    //   - explicitly nulls the legacy keys to clear them server-side.
    // The backend's per-key overwrite leaves untouched any key not
    // present in the payload, so omitting `savedFilters` /
    // `activeFilterIds` would leave them on disk; explicit null is
    // required to clear them.
    void migratePatch(migrated).then(() => {
      // Invalidate the prefs query so subscribers (this provider + every
      // other usePreferences caller) re-fetch and observe the migrated
      // blob without a hard reload.
      qc.invalidateQueries({ queryKey: ['preferences'] })
    })
    // We deliberately depend ONLY on the inputs that decide whether to
    // migrate. Re-running on every render would cause an infinite write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersState._migratedV1, legacyFilters, legacyActive, qc])

  const setActiveId = useCallback(
    (id: FilterId | null) => {
      setFiltersState({ ...filtersState, activeId: id })
    },
    [filtersState, setFiltersState],
  )

  const addNode = useCallback(
    (node: FilterNode) => {
      setFiltersState({
        ...filtersState,
        nodes: { ...filtersState.nodes, [node.id]: node },
      })
    },
    [filtersState, setFiltersState],
  )

  const updateNode = useCallback(
    (id: FilterId, partial: Partial<FilterNode>) => {
      const existing = filtersState.nodes[id]
      if (!existing) return
      const merged = { ...existing, ...partial } as FilterNode
      setFiltersState({
        ...filtersState,
        nodes: { ...filtersState.nodes, [id]: merged },
      })
    },
    [filtersState, setFiltersState],
  )

  const removeNode = useCallback(
    (id: FilterId) => {
      const nextNodes = { ...filtersState.nodes }
      delete nextNodes[id]
      // Strip the id from every group's childIds.
      for (const k of Object.keys(nextNodes)) {
        const n = nextNodes[k]
        if (n.type === 'group' && n.childIds.includes(id)) {
          nextNodes[k] = { ...n, childIds: n.childIds.filter((c) => c !== id) }
        }
      }
      const nextActive = filtersState.activeId === id ? null : filtersState.activeId
      setFiltersState({
        ...filtersState,
        nodes: nextNodes,
        activeId: nextActive,
      })
    },
    [filtersState, setFiltersState],
  )

  const dismissMigrationBanner = useCallback(() => {
    setFiltersState({ ...filtersState, migrationBannerDismissed: true })
  }, [filtersState, setFiltersState])

  const value = useMemo<FilterContextType>(
    () => ({
      filtersState,
      setActiveId,
      addNode,
      updateNode,
      removeNode,
      dismissMigrationBanner,
    }),
    [filtersState, setActiveId, addNode, updateNode, removeNode, dismissMigrationBanner],
  )

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>
}

export function useFilters(): FilterContextType {
  const ctx = useContext(FilterContext)
  if (!ctx) throw new Error('useFilters must be used within a FilterProvider')
  return ctx
}

// ---------------------------------------------------------------------------
// Migration PATCH helper
// ---------------------------------------------------------------------------

/**
 * Issue a single PATCH that writes the migrated `filters` blob AND
 * explicitly nulls the legacy keys, so the backend's per-key overwrite
 * clears them. Bypasses usePreferences' single-key setter so we can send
 * three keys atomically. The TanStack-Query cache picks up the new state
 * on the next GET; we also mirror the new filters blob to localStorage so
 * a refresh-before-GET path still sees the migrated value.
 */
async function migratePatch(migrated: FiltersState): Promise<void> {
  // Mirror to localStorage so a tab that loads before the GET refetch
  // still sees the migrated state through usePreferences' fallback. Also
  // clear the legacy mirrors so a hard offline refresh immediately after
  // migrating doesn't resurrect them.
  try {
    window.localStorage.setItem(FILTERS_KEY, JSON.stringify(migrated))
    window.localStorage.removeItem(LEGACY_FILTERS_KEY)
    window.localStorage.removeItem(LEGACY_ACTIVE_KEY)
  } catch {
    /* best effort */
  }
  try {
    await fetch('/api/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: {
          [FILTERS_KEY]: migrated,
          [LEGACY_FILTERS_KEY]: null,
          [LEGACY_ACTIVE_KEY]: null,
        },
      }),
    })
  } catch {
    /* best effort — localStorage mirror keeps the new blob alive */
  }
}
