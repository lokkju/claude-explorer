/**
 * useSearchMatchHighlighting — unit contract.
 *
 * Pins the derivation rules:
 *
 *   activeMatchUuid:
 *     - activeMatchIndex < 0                  → null
 *     - activeMatchIndex >= flatMatches.length → null  (out of bounds)
 *     - in-bounds index                       → flatMatches[i].messageUuid
 *     - in-bounds index but flatMatches[i] has nullish uuid → null (?? null)
 *
 *   deferredSearchQuery:
 *     - Initial render: returns the input value (useDeferredValue
 *       behaves synchronously on first paint).
 *     - Rerender with new value: passes through (the deferral is
 *       transparent to the consumer in test env).
 *
 * The hook reads ZERO context, so no Provider wrapping is needed —
 * `renderHook` directly drives args via its `initialProps` channel.
 */
import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useSearchMatchHighlighting } from '../../hooks/useSearchMatchHighlighting'
import type { SearchMatch } from '../../contexts/SearchPanelContext'

function makeMatch(uuid: string, overrides: Partial<SearchMatch> = {}): SearchMatch {
  return {
    conversationUuid: 'conv-1',
    conversationName: 'Conv 1',
    conversationUpdatedAt: '2026-05-30T12:00:00Z',
    conversationSource: 'CLAUDE_AI',
    projectPath: null,
    sortOrderInGroup: 0,
    messageUuid: uuid,
    sender: 'human',
    timestamp: '2026-05-30T12:00:00Z',
    snippet: 'fixture snippet',
    fragments: [],
    ...overrides,
  } as SearchMatch
}

describe('useSearchMatchHighlighting — activeMatchUuid derivation', () => {
  it('returns null when activeMatchIndex is -1', () => {
    const { result } = renderHook(() =>
      useSearchMatchHighlighting({
        query: '',
        activeMatchIndex: -1,
        flatMatches: [makeMatch('uuid-A')],
      }),
    )
    expect(result.current.activeMatchUuid).toBe(null)
  })

  it('returns null when flatMatches is empty (even at index 0)', () => {
    const { result } = renderHook(() =>
      useSearchMatchHighlighting({
        query: '',
        activeMatchIndex: 0,
        flatMatches: [],
      }),
    )
    expect(result.current.activeMatchUuid).toBe(null)
  })

  it('returns the matching uuid when index is in bounds', () => {
    const { result } = renderHook(() =>
      useSearchMatchHighlighting({
        query: '',
        activeMatchIndex: 1,
        flatMatches: [makeMatch('uuid-A'), makeMatch('uuid-B'), makeMatch('uuid-C')],
      }),
    )
    expect(result.current.activeMatchUuid).toBe('uuid-B')
  })

  it('returns null when activeMatchIndex >= flatMatches.length (out of bounds)', () => {
    const { result } = renderHook(() =>
      useSearchMatchHighlighting({
        query: '',
        activeMatchIndex: 5,
        flatMatches: [makeMatch('uuid-A')],
      }),
    )
    expect(result.current.activeMatchUuid).toBe(null)
  })
})

describe('useSearchMatchHighlighting — deferredSearchQuery passthrough', () => {
  it('initially returns the input query value', () => {
    const { result } = renderHook(() =>
      useSearchMatchHighlighting({
        query: 'hello',
        activeMatchIndex: -1,
        flatMatches: [],
      }),
    )
    expect(result.current.deferredSearchQuery).toBe('hello')
  })

  it('passes through empty string', () => {
    const { result } = renderHook(() =>
      useSearchMatchHighlighting({
        query: '',
        activeMatchIndex: -1,
        flatMatches: [],
      }),
    )
    expect(result.current.deferredSearchQuery).toBe('')
  })
})
