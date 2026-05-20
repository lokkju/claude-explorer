/**
 * Runtime-narrowing tests for SortField / SourceFilter predicates (Hunt #2).
 *
 * Sidebar and SearchPanel both did `setX(v as SortField)` /
 * `setSourceFilter(v as SourceFilter)` on shadcn `<Select>`
 * onValueChange. The shadcn callback signature is `(value: string) =>
 * void`, so the cast was a runtime lie: a corrupted persisted value
 * or a future shadcn change emitting a different string would
 * coerce garbage into a typed setter and propagate into the backend
 * query string (e.g. `?source=garbage`).
 *
 * Added isSortField / isSourceFilter predicates to lib/types.ts.
 */

import { describe, it, expect } from 'vitest'
import { isSortField, isSourceFilter } from '../../lib/types'

describe('isSortField (Hunt #2)', () => {
  it('accepts every value in the SortField union', () => {
    expect(isSortField('updated_at')).toBe(true)
    expect(isSortField('created_at')).toBe(true)
    expect(isSortField('name')).toBe(true)
    expect(isSortField('project')).toBe(true)
  })

  it('rejects unknown strings', () => {
    expect(isSortField('updated')).toBe(false)
    expect(isSortField('UPDATED_AT')).toBe(false)
    expect(isSortField('')).toBe(false)
  })

  it('rejects non-string values', () => {
    expect(isSortField(null)).toBe(false)
    expect(isSortField(undefined)).toBe(false)
    expect(isSortField(0)).toBe(false)
  })
})

describe('isSourceFilter (Hunt #2)', () => {
  it('accepts every value in the SourceFilter union', () => {
    expect(isSourceFilter('all')).toBe(true)
    expect(isSourceFilter('CLAUDE_AI')).toBe(true)
    expect(isSourceFilter('CLAUDE_CODE')).toBe(true)
  })

  it('rejects unknown strings', () => {
    expect(isSourceFilter('claude_ai')).toBe(false)
    expect(isSourceFilter('ALL')).toBe(false)
    expect(isSourceFilter('')).toBe(false)
  })

  it('rejects non-string values', () => {
    expect(isSourceFilter(null)).toBe(false)
    expect(isSourceFilter(undefined)).toBe(false)
    expect(isSourceFilter(0)).toBe(false)
  })
})
