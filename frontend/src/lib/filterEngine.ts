/**
 * Title-based filter engine shared by Build-5 (saved filters) and Build-6 (URL filters).
 *
 * Grammar (Council-resolved final form):
 *  - A `Filter` has patterns (OR within), polarity (include/exclude), mode (glob/regex), target (title for now).
 *  - A `FilterSet` is a list of active filters AND-ed together; a conversation must satisfy every active filter.
 *  - Glob mode: shell-style globbing (`*`, `?`, `[abc]`); patterns without wildcards become substring matches.
 *  - Regex mode: case-insensitive JS RegExp; invalid regexes are treated as no-match (caller validates).
 */

export type FilterPolarity = 'include' | 'exclude'
export type FilterMode = 'glob' | 'regex'
export type FilterTarget = 'title'

export interface Filter {
  id: string
  name: string
  patterns: string[]
  polarity: FilterPolarity
  mode: FilterMode
  target: FilterTarget
  pinned: boolean
}

function escapeRegex(s: string): string {
  return s.replace(/[.+^${}()|\\]/g, '\\$&')
}

function globToRegex(pattern: string): RegExp {
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
