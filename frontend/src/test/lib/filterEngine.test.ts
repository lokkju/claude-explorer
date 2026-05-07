import { describe, it, expect } from 'vitest'
import {
  applyFilters,
  filterPasses,
  parseCommaPatterns,
  patternMatches,
  evaluate,
  applyActiveFilter,
  validateNoCycle,
  findReferencingGroups,
  stripMetacharsForName,
  type Filter,
  type FilterNode,
  type FiltersState,
  type AtomFilter,
  type GroupFilter,
} from '@/lib/filterEngine'

const conv = (name: string) => ({ name })

describe('filterEngine.patternMatches', () => {
  it('treats a no-wildcard glob as a substring match (case-insensitive)', () => {
    expect(patternMatches('React component refactor', 'react', 'glob')).toBe(true)
    expect(patternMatches('React component refactor', 'mcp', 'glob')).toBe(false)
  })

  it('supports * and ? in glob patterns', () => {
    expect(patternMatches('My MCP work', '*MCP*', 'glob')).toBe(true)
    expect(patternMatches('MCp lower', '*mcp*', 'glob')).toBe(true)
    expect(patternMatches('cat', 'c?t', 'glob')).toBe(true)
    expect(patternMatches('cart', 'c?t', 'glob')).toBe(false)
  })

  it('supports JS regex with case-insensitive flag', () => {
    expect(patternMatches('React 19 release notes', '^React', 'regex')).toBe(true)
    expect(patternMatches('Notes on react 19', '^React', 'regex')).toBe(false)
    expect(patternMatches('Multi-modal', 'multi-?modal', 'regex')).toBe(true)
  })

  it('treats invalid regex as no match', () => {
    expect(patternMatches('anything', '[unclosed', 'regex')).toBe(false)
  })
})

describe('filterEngine.filterPasses (legacy single-filter helper)', () => {
  const includeMCP: Filter = {
    id: '1', name: 'MCP', patterns: ['*mcp*'], polarity: 'include', mode: 'glob', target: 'title',
  }
  const excludeTests: Filter = {
    id: '2', name: 'Hide tests', patterns: ['*test*', '*spec*'], polarity: 'exclude', mode: 'glob', target: 'title',
  }

  it('include-filter passes when at least one pattern matches', () => {
    expect(filterPasses('MCP server bootstrap', includeMCP)).toBe(true)
    expect(filterPasses('React component', includeMCP)).toBe(false)
  })

  it('exclude-filter passes when zero patterns match', () => {
    expect(filterPasses('Auth refactor', excludeTests)).toBe(true)
    expect(filterPasses('Add unit tests', excludeTests)).toBe(false)
    expect(filterPasses('test spec', excludeTests)).toBe(false)
  })

  it('empty pattern list passes (no constraint)', () => {
    const empty: Filter = { ...includeMCP, patterns: [] }
    expect(filterPasses('Anything', empty)).toBe(true)
  })
})

describe('filterEngine.applyFilters AND-composition (legacy)', () => {
  const items = [
    conv('MCP work in React'),
    conv('MCP test plan'),
    conv('React refactor'),
    conv('Plain prose notes'),
  ]
  const includeMCP: Filter = {
    id: '1', name: 'MCP', patterns: ['*mcp*'], polarity: 'include', mode: 'glob', target: 'title',
  }
  const excludeTests: Filter = {
    id: '2', name: 'Hide tests', patterns: ['*test*'], polarity: 'exclude', mode: 'glob', target: 'title',
  }

  it('applies AND across multiple filters', () => {
    const result = applyFilters(items, [includeMCP, excludeTests])
    expect(result.map((c) => c.name)).toEqual(['MCP work in React'])
  })

  it('with no filters returns the input list unchanged', () => {
    expect(applyFilters(items, [])).toBe(items)
  })

  it('OR-composition within a filter: any pattern matching counts', () => {
    const includeReactOrPlain: Filter = {
      id: '3', name: 'Front-end OR notes', patterns: ['*react*', '*plain*'],
      polarity: 'include', mode: 'glob', target: 'title',
    }
    const result = applyFilters(items, [includeReactOrPlain])
    expect(result.map((c) => c.name).sort()).toEqual([
      'MCP work in React',
      'Plain prose notes',
      'React refactor',
    ])
  })
})

describe('filterEngine.parseCommaPatterns', () => {
  it('splits and trims comma-separated patterns', () => {
    expect(parseCommaPatterns('*react*,  *typescript*  ,*css*')).toEqual([
      '*react*',
      '*typescript*',
      '*css*',
    ])
  })

  it('drops empty fragments', () => {
    expect(parseCommaPatterns('a,,b, ')).toEqual(['a', 'b'])
  })
})

// =============================================================================
// New composable filter graph (CF1)
// =============================================================================

function makeAtom(overrides: Partial<AtomFilter> & { id: string }): AtomFilter {
  return {
    type: 'atom',
    name: overrides.name ?? overrides.id,
    enabled: overrides.enabled ?? true,
    patterns: overrides.patterns ?? [],
    polarity: overrides.polarity ?? 'include',
    mode: overrides.mode ?? 'glob',
    target: 'title',
    ...overrides,
  }
}

function makeGroup(overrides: Partial<GroupFilter> & { id: string; childIds: string[] }): GroupFilter {
  return {
    type: 'group',
    name: overrides.name ?? overrides.id,
    enabled: overrides.enabled ?? true,
    match: overrides.match ?? 'all',
    ...overrides,
  }
}

function buildState(...nodes: FilterNode[]): FiltersState {
  const dict: Record<string, FilterNode> = {}
  for (const n of nodes) dict[n.id] = n
  return { nodes: dict, activeId: null }
}

describe('filterEngine.evaluate — atoms', () => {
  it('include-atom returns true on match, false on miss', () => {
    const a = makeAtom({ id: 'a', patterns: ['*mcp*'], polarity: 'include' })
    const state = buildState(a)
    expect(evaluate(a, 'MCP server', state)).toBe(true)
    expect(evaluate(a, 'React', state)).toBe(false)
  })

  it('exclude-atom inverts: true on no-match, false on match', () => {
    const a = makeAtom({ id: 'a', patterns: ['*test*'], polarity: 'exclude' })
    const state = buildState(a)
    expect(evaluate(a, 'Auth refactor', state)).toBe(true)
    expect(evaluate(a, 'unit tests', state)).toBe(false)
  })

  it('empty-pattern atom passes for any text', () => {
    const a = makeAtom({ id: 'a', patterns: [] })
    const state = buildState(a)
    expect(evaluate(a, 'anything', state)).toBe(true)
    expect(evaluate(a, '', state)).toBe(true)
  })
})

describe('filterEngine.evaluate — groups (match: all)', () => {
  it('every-child semantics with mixed include/exclude', () => {
    const inc = makeAtom({ id: 'inc', patterns: ['*mcp*'], polarity: 'include' })
    const exc = makeAtom({ id: 'exc', patterns: ['*test*'], polarity: 'exclude' })
    const g = makeGroup({ id: 'g', match: 'all', childIds: ['inc', 'exc'] })
    const state = buildState(inc, exc, g)

    expect(evaluate(g, 'MCP work in React', state)).toBe(true)   // include passes, exclude passes
    expect(evaluate(g, 'MCP test plan', state)).toBe(false)       // include passes, exclude fails
    expect(evaluate(g, 'React refactor', state)).toBe(false)      // include fails
  })

  it('empty group (no children) passes', () => {
    const g = makeGroup({ id: 'g', match: 'all', childIds: [] })
    const state = buildState(g)
    expect(evaluate(g, 'anything', state)).toBe(true)
  })

  it('a disabled child is dropped from the quantifier (does not affect result)', () => {
    const inc = makeAtom({ id: 'inc', patterns: ['*mcp*'], polarity: 'include' })
    // This atom would FAIL if evaluated, but it's disabled -> dropped.
    const dis = makeAtom({ id: 'dis', patterns: ['*never-occurring-pattern*'], polarity: 'include', enabled: false })
    const g = makeGroup({ id: 'g', match: 'all', childIds: ['inc', 'dis'] })
    const state = buildState(inc, dis, g)
    expect(evaluate(g, 'MCP work', state)).toBe(true)
  })
})

describe('filterEngine.evaluate — groups (match: any)', () => {
  it('some-child semantics', () => {
    const a = makeAtom({ id: 'a', patterns: ['*mcp*'], polarity: 'include' })
    const b = makeAtom({ id: 'b', patterns: ['*react*'], polarity: 'include' })
    const g = makeGroup({ id: 'g', match: 'any', childIds: ['a', 'b'] })
    const state = buildState(a, b, g)

    expect(evaluate(g, 'MCP server', state)).toBe(true)
    expect(evaluate(g, 'React refactor', state)).toBe(true)
    expect(evaluate(g, 'Plain notes', state)).toBe(false)
  })

  // *** GEMINI COUNCIL BUG ***
  // If `enabled === false` early-returned `true` from evaluate(), an `any`
  // group whose first member happened to be disabled would short-circuit
  // to true — passing for every conversation. The fix is to drop disabled
  // children at the group level BEFORE applying the quantifier.
  it('GEMINI: disabled child does NOT short-circuit a match=any group', () => {
    const dis = makeAtom({ id: 'dis', patterns: ['*x*'], polarity: 'include', enabled: false })
    const real = makeAtom({ id: 'real', patterns: ['*react*'], polarity: 'include' })
    const g = makeGroup({ id: 'g', match: 'any', childIds: ['dis', 'real'] })
    const state = buildState(dis, real, g)

    // 'Plain notes' matches NEITHER child. The disabled child is dropped
    // at the group level, so the quantifier runs on [real] only, which
    // does not match -> false. (Naive impl returns true via the disabled
    // member's early-return.)
    expect(evaluate(g, 'Plain notes', state)).toBe(false)
    // Sanity: a string the real atom matches still passes.
    expect(evaluate(g, 'React refactor', state)).toBe(true)
  })

  it('all-disabled group passes (empty after filter)', () => {
    const a = makeAtom({ id: 'a', patterns: ['*x*'], polarity: 'include', enabled: false })
    const b = makeAtom({ id: 'b', patterns: ['*y*'], polarity: 'include', enabled: false })
    const g = makeGroup({ id: 'g', match: 'any', childIds: ['a', 'b'] })
    const state = buildState(a, b, g)
    expect(evaluate(g, 'anything', state)).toBe(true)
  })
})

describe('filterEngine.evaluate — cycles & orphans', () => {
  it('cycle (A -> B -> A) short-circuits without infinite recursion', () => {
    const A = makeGroup({ id: 'A', match: 'all', childIds: ['B'] })
    const B = makeGroup({ id: 'B', match: 'all', childIds: ['A'] })
    const state = buildState(A, B)
    // Should not stack-overflow; we just assert it terminates.
    expect(() => evaluate(A, 'anything', state)).not.toThrow()
  })

  it('orphan child IDs are silently filtered', () => {
    const real = makeAtom({ id: 'real', patterns: ['*react*'], polarity: 'include' })
    const g = makeGroup({ id: 'g', match: 'all', childIds: ['real', 'does-not-exist'] })
    const state = buildState(real, g)
    expect(evaluate(g, 'React refactor', state)).toBe(true)
    expect(evaluate(g, 'plain', state)).toBe(false)
  })
})

describe('filterEngine.applyActiveFilter', () => {
  it('null activeId means "All conversations" — every text passes', () => {
    const a = makeAtom({ id: 'a', patterns: ['*x*'], polarity: 'include' })
    const state: FiltersState = { nodes: { a }, activeId: null }
    expect(applyActiveFilter('anything', state)).toBe(true)
  })

  it('stale activeId pointing at a deleted node passes everything', () => {
    const state: FiltersState = { nodes: {}, activeId: 'gone' }
    expect(applyActiveFilter('anything', state)).toBe(true)
  })

  it('disabled active node passes everything', () => {
    const a = makeAtom({ id: 'a', patterns: ['*x*'], polarity: 'include', enabled: false })
    const state: FiltersState = { nodes: { a }, activeId: 'a' }
    expect(applyActiveFilter('xyz', state)).toBe(true)
  })

  it('active enabled node evaluates normally', () => {
    const a = makeAtom({ id: 'a', patterns: ['*mcp*'], polarity: 'include' })
    const state: FiltersState = { nodes: { a }, activeId: 'a' }
    expect(applyActiveFilter('MCP work', state)).toBe(true)
    expect(applyActiveFilter('React', state)).toBe(false)
  })
})

describe('filterEngine.validateNoCycle', () => {
  it('returns true for an acyclic DAG', () => {
    const a = makeAtom({ id: 'a', patterns: [] })
    const b = makeAtom({ id: 'b', patterns: [] })
    const g = makeGroup({ id: 'g', match: 'all', childIds: ['a', 'b'] })
    const state = buildState(a, b, g)
    expect(validateNoCycle(state)).toBe(true)
  })

  it('returns false when a cycle is present', () => {
    const A = makeGroup({ id: 'A', match: 'all', childIds: ['B'] })
    const B = makeGroup({ id: 'B', match: 'all', childIds: ['A'] })
    const state = buildState(A, B)
    expect(validateNoCycle(state)).toBe(false)
  })

  it('returns false for self-reference', () => {
    const A = makeGroup({ id: 'A', match: 'all', childIds: ['A'] })
    const state = buildState(A)
    expect(validateNoCycle(state)).toBe(false)
  })
})

describe('filterEngine.findReferencingGroups', () => {
  it('returns groups that reference a given filter id', () => {
    const a = makeAtom({ id: 'a', patterns: [] })
    const g1 = makeGroup({ id: 'g1', match: 'all', childIds: ['a'] })
    const g2 = makeGroup({ id: 'g2', match: 'any', childIds: ['a'] })
    const state = buildState(a, g1, g2)
    const refs = findReferencingGroups('a', state).map((g) => g.id).sort()
    expect(refs).toEqual(['g1', 'g2'])
  })

  it('returns [] for an unreferenced atom', () => {
    const a = makeAtom({ id: 'a', patterns: [] })
    const state = buildState(a)
    expect(findReferencingGroups('a', state)).toEqual([])
  })
})

describe('filterEngine.stripMetacharsForName', () => {
  it('strips * ? [...] anchors and escapes; trims', () => {
    expect(stripMetacharsForName('  *MCP*  ')).toBe('MCP')
    expect(stripMetacharsForName('?abc?')).toBe('abc')
    expect(stripMetacharsForName('[abc]def')).toBe('def')
    expect(stripMetacharsForName('^foo$')).toBe('foo')
    expect(stripMetacharsForName('foo\\bar')).toBe('foobar')
  })

  it('multi-pattern: falls through to the next non-empty after strip', () => {
    expect(stripMetacharsForName('*\n*react*')).toBe('react')
    expect(stripMetacharsForName('   \n  *typescript*')).toBe('typescript')
  })

  it('falls through if a stripped pattern is under 3 alphanumeric chars', () => {
    // First pattern strips to "ab" (2 chars) -> fall through to next.
    expect(stripMetacharsForName('*ab*\n*react*')).toBe('react')
  })

  it('returns empty string when nothing usable remains', () => {
    expect(stripMetacharsForName('*\n?\n^$')).toBe('')
  })
})
