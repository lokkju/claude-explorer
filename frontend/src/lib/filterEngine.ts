/**
 * Title-based filter engine.
 *
 * Two coexisting layers:
 *
 * 1. Legacy flat-list (Build-5/6): a `Filter` has patterns, polarity, mode,
 *    target. `applyFilters(items, filters)` AND-composes a list of filters.
 *    Atoms in the new graph reuse the `patternMatches` primitive from here.
 *
 * 2. Composable graph (CF1, 2026-05-07): every saved filter is a named
 *    `FilterNode` — either an `AtomFilter` (pattern + polarity + mode) or a
 *    `GroupFilter` (AND/OR of other named filters). Exactly one filter is
 *    "active" via `FiltersState.activeId`. The evaluator is cycle-safe and
 *    drops disabled children at the GROUP level (not via early-return) so
 *    `match: 'any'` groups don't short-circuit on a disabled member.
 *
 * Glob mode: shell-style globbing (`*`, `?`, `[abc]`); patterns without
 * wildcards become substring matches. Regex mode: case-insensitive JS
 * RegExp; invalid regexes treated as no-match (caller validates).
 */

export type FilterPolarity = 'include' | 'exclude'
export type FilterMode = 'glob' | 'regex'
export type FilterTarget = 'title'

// ---------------------------------------------------------------------------
// Legacy single-filter shape (still used internally by the new AtomFilter).
// ---------------------------------------------------------------------------

export interface Filter {
  id: string
  name: string
  patterns: string[]
  polarity: FilterPolarity
  mode: FilterMode
  target: FilterTarget
  // Note: `pinned` was dropped in CF1. Kept off the type so the compiler
  // surfaces any leftover reads as errors.
}

function escapeRegex(s: string): string {
  return s.replace(/[.+^${}()|\\]/g, '\\$&')
}

export function globToRegex(pattern: string): RegExp {
  if (!pattern.includes('*') && !pattern.includes('?') && !pattern.includes('[')) {
    return new RegExp(escapeRegex(pattern), 'i')
  }
  let out = ''
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]
    if (ch === '*') out += '.*'
    else if (ch === '?') out += '.'
    else if (ch === '[') {
      // copy class until ]
      let j = i + 1
      while (j < pattern.length && pattern[j] !== ']') j++
      out += pattern.slice(i, j + 1)
      i = j
    } else {
      out += escapeRegex(ch)
    }
  }
  return new RegExp('^' + out + '$', 'i')
}

function compilePattern(pattern: string, mode: FilterMode): RegExp | null {
  try {
    if (mode === 'glob') return globToRegex(pattern)
    return new RegExp(pattern, 'i')
  } catch {
    return null
  }
}

export function patternMatches(text: string, pattern: string, mode: FilterMode): boolean {
  const re = compilePattern(pattern, mode)
  if (!re) return false
  return re.test(text)
}

export function filterPasses(text: string, filter: Filter): boolean {
  if (filter.patterns.length === 0) return true
  const anyMatch = filter.patterns.some((p) => patternMatches(text, p, filter.mode))
  return filter.polarity === 'include' ? anyMatch : !anyMatch
}

export function applyFilters<T extends { name: string }>(items: T[], filters: Filter[]): T[] {
  if (filters.length === 0) return items
  return items.filter((item) => filters.every((f) => filterPasses(item.name, f)))
}

export function parseCommaPatterns(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

// ---------------------------------------------------------------------------
// Composable graph (CF1, 2026-05-07).
// ---------------------------------------------------------------------------

export type FilterId = string

export interface BaseFilterNode {
  id: FilterId
  name: string
  enabled: boolean
}

export interface AtomFilter extends BaseFilterNode {
  type: 'atom'
  patterns: string[]
  polarity: FilterPolarity
  mode: FilterMode
  target: FilterTarget
}

export interface GroupFilter extends BaseFilterNode {
  type: 'group'
  match: 'all' | 'any'
  childIds: FilterId[]
}

export type FilterNode = AtomFilter | GroupFilter

export interface FiltersState {
  nodes: Record<FilterId, FilterNode>
  activeId: FilterId | null
  /**
   * Sentinel set true once the legacy → composable migration has run.
   * The migration is idempotent and skipped on subsequent mounts.
   */
  _migratedV1?: boolean
}

/**
 * Predicate composition with cycle defense.
 *
 * Council fix (Gemini, 2026-05-07): the `enabled` check is applied at the
 * GROUP's child step, NOT as an early-return inside evaluate(). If we
 * early-returned `true` for a disabled node, a `match: 'any'` group
 * containing one disabled member would pass for every conversation
 * (`some()` short-circuits on the first true). The right semantic is
 * "disabled members are removed before the group's quantifier runs".
 */
export function evaluate(
  node: FilterNode,
  text: string,
  state: FiltersState,
  visited: Set<FilterId> = new Set(),
): boolean {
  if (visited.has(node.id)) return true // cycle: no-op (also caught at save time)
  const nextVisited = new Set(visited)
  nextVisited.add(node.id)

  if (node.type === 'atom') {
    if (node.patterns.length === 0) return true
    const hit = node.patterns.some((p) => patternMatches(text, p, node.mode))
    return node.polarity === 'include' ? hit : !hit
  }

  // Group: drop orphans AND disabled children before applying the
  // quantifier. THIS is where `enabled` gates evaluation.
  const children = node.childIds
    .map((id) => state.nodes[id])
    .filter((c): c is FilterNode => Boolean(c) && c.enabled)
  if (children.length === 0) return true
  if (node.match === 'all') {
    return children.every((c) => evaluate(c, text, state, nextVisited))
  }
  return children.some((c) => evaluate(c, text, state, nextVisited))
}

/**
 * Top-level wrapper for the active filter.
 * - null activeId  → no filter active (all texts pass)
 * - missing/disabled active node → treated as no filter active
 */
export function applyActiveFilter(text: string, state: FiltersState): boolean {
  if (!state.activeId) return true
  const node = state.nodes[state.activeId]
  if (!node || !node.enabled) return true
  return evaluate(node, text, state)
}

/**
 * Save-time cycle check. Returns true when the graph is acyclic, false if
 * any group transitively references itself.
 */
export function validateNoCycle(state: FiltersState): boolean {
  const WHITE = 0
  const GRAY = 1
  const BLACK = 2
  const color: Record<FilterId, number> = {}
  for (const id of Object.keys(state.nodes)) color[id] = WHITE

  function dfs(id: FilterId): boolean {
    const node = state.nodes[id]
    if (!node) return true // orphan — no edges, so no cycle through it
    if (color[id] === GRAY) return false // back-edge: cycle
    if (color[id] === BLACK) return true
    color[id] = GRAY
    if (node.type === 'group') {
      for (const childId of node.childIds) {
        if (!dfs(childId)) return false
      }
    }
    color[id] = BLACK
    return true
  }

  for (const id of Object.keys(state.nodes)) {
    if (!dfs(id)) return false
  }
  return true
}

/**
 * Returns every group that references `targetId` as a direct child.
 * Used for the "Used by:" line in the modal and for delete-block UX.
 */
export function findReferencingGroups(targetId: FilterId, state: FiltersState): GroupFilter[] {
  const out: GroupFilter[] = []
  for (const node of Object.values(state.nodes)) {
    if (node.type === 'group' && node.childIds.includes(targetId)) {
      out.push(node)
    }
  }
  return out
}

/**
 * Strip glob/regex meta-characters and surrounding whitespace from a single
 * line, returning a usable label or '' if nothing usable remains.
 */
function stripMetacharsSingle(raw: string): string {
  return raw
    .replace(/\\(.)/g, '$1')          // unescape \X -> X
    .replace(/\[[^\]]*\]/g, '')       // drop character classes [...]
    .replace(/[*?^$]/g, '')           // drop standalone glob/regex anchors
    .trim()
}

/**
 * Multi-line/multi-pattern fallback: try each pattern in order, returning
 * the first stripped result that has ≥3 alphanumeric characters. Falls back
 * to '' when nothing qualifies.
 */
export function stripMetacharsForName(raw: string): string {
  // Accept either newline-separated patterns or a single one.
  const lines = raw.split(/\r?\n/)
  for (const line of lines) {
    const stripped = stripMetacharsSingle(line)
    if (!stripped) continue
    const alnum = stripped.replace(/[^a-zA-Z0-9]/g, '')
    if (alnum.length >= 3) return stripped
  }
  return ''
}
