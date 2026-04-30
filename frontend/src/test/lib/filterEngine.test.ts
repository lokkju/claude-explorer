import { describe, it, expect } from 'vitest'
import { applyFilters, filterPasses, parseCommaPatterns, patternMatches, type Filter } from '@/lib/filterEngine'

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

describe('filterEngine.filterPasses', () => {
  const includeMCP: Filter = {
    id: '1', name: 'MCP', patterns: ['*mcp*'], polarity: 'include', mode: 'glob', target: 'title', pinned: false,
  }
  const excludeTests: Filter = {
    id: '2', name: 'Hide tests', patterns: ['*test*', '*spec*'], polarity: 'exclude', mode: 'glob', target: 'title', pinned: false,
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

describe('filterEngine.applyFilters AND-composition', () => {
  const items = [
    conv('MCP work in React'),
    conv('MCP test plan'),
    conv('React refactor'),
    conv('Plain prose notes'),
  ]

  const includeMCP: Filter = {
    id: '1', name: 'MCP', patterns: ['*mcp*'], polarity: 'include', mode: 'glob', target: 'title', pinned: false,
  }
  const excludeTests: Filter = {
    id: '2', name: 'Hide tests', patterns: ['*test*'], polarity: 'exclude', mode: 'glob', target: 'title', pinned: false,
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
      polarity: 'include', mode: 'glob', target: 'title', pinned: false,
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
