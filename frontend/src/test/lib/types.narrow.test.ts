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
import { isSortField, isSourceFilter, isSearchResponse } from '../../lib/types'

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

describe('isSearchResponse (S5 T2a — runtime-validate /api/search envelope)', () => {
  const validResponse = {
    results: [],
    total_messages_matched: 0,
    returned_messages: 0,
    truncated: false,
  }

  it('accepts a minimal valid response envelope', () => {
    expect(isSearchResponse(validResponse)).toBe(true)
  })

  it('accepts an envelope with populated results', () => {
    expect(
      isSearchResponse({
        results: [
          {
            conversation_uuid: 'u1',
            conversation_name: 'n',
            conversation_updated_at: '2026-01-01T00:00:00Z',
            conversation_created_at: '2026-01-01T00:00:00Z',
            project_name: null,
            matching_messages: [],
          },
        ],
        total_messages_matched: 1,
        returned_messages: 1,
        truncated: false,
      }),
    ).toBe(true)
  })

  it('rejects null', () => {
    expect(isSearchResponse(null)).toBe(false)
  })

  it('rejects a non-object root', () => {
    expect(isSearchResponse('not-an-object')).toBe(false)
    expect(isSearchResponse(42)).toBe(false)
    expect(isSearchResponse(true)).toBe(false)
  })

  it('rejects an array root (not the envelope shape)', () => {
    expect(isSearchResponse([])).toBe(false)
    expect(isSearchResponse([validResponse])).toBe(false)
  })

  it('rejects envelopes missing required fields', () => {
    const { results: _results, ...noResults } = validResponse
    void _results
    expect(isSearchResponse(noResults)).toBe(false)

    const { total_messages_matched: _t, ...noTotal } = validResponse
    void _t
    expect(isSearchResponse(noTotal)).toBe(false)

    const { returned_messages: _r, ...noReturned } = validResponse
    void _r
    expect(isSearchResponse(noReturned)).toBe(false)

    const { truncated: _tr, ...noTruncated } = validResponse
    void _tr
    expect(isSearchResponse(noTruncated)).toBe(false)
  })

  it('rejects envelopes with wrong field types', () => {
    expect(
      isSearchResponse({ ...validResponse, results: 'not-an-array' }),
    ).toBe(false)
    expect(
      isSearchResponse({ ...validResponse, total_messages_matched: '0' }),
    ).toBe(false)
    expect(
      isSearchResponse({ ...validResponse, returned_messages: null }),
    ).toBe(false)
    expect(
      isSearchResponse({ ...validResponse, truncated: 'false' }),
    ).toBe(false)
  })
})
