/**
 * Null-safety regression tests for `narrowSearchResults` (2026-05-18).
 *
 * Mirrors the backend null-safety fixes (commits 50b5cc5, adbe92d,
 * f9a2fd2): `data.get("key", "").lower()` crashed when the key existed
 * with value `None` because `dict.get` only defaults on MISSING keys.
 *
 * The same bug class previously lived at SearchPanelContext.tsx:265
 * (`r.conversation_name.toLowerCase()`) and SearchPanelContext.tsx:268
 * (`m.snippet.toLowerCase()`). If the backend wire format surfaced
 * null for either field (older on-disk JSONs, partial Pydantic
 * serialization, schema drift), the unguarded `.toLowerCase()` call
 * threw `TypeError: Cannot read properties of null (reading
 * 'toLowerCase')` and white-screened the search panel.
 *
 * Fix mirrors the backend `(data.get(k) or "").lower()` pattern with
 * TypeScript `(value ?? '').toLowerCase()`.
 *
 * These tests are written RED-first: with the guards REMOVED in the
 * narrowSearchResults function, the first two cases throw TypeError.
 * With the guards APPLIED, all cases return graceful filtered output.
 */

import { describe, it, expect } from 'vitest'
import { narrowSearchResults } from '../../contexts/SearchPanelContext'
import type { SearchResult, MessageSnippet } from '../../lib/types'

function makeMsgSnippet(
  uuid: string,
  overrides: Partial<{ snippet: string | null; sender: string }>,
): MessageSnippet {
  return {
    message_uuid: uuid,
    sender: overrides.sender ?? 'human',
    snippet: overrides.snippet as string,
    match_start: 0,
    match_end: 5,
    created_at: '2026-05-18T00:00:00Z',
  }
}

function makeResult(
  uuid: string,
  overrides: Partial<{
    conversation_name: string | null
    matching_messages: MessageSnippet[] | null
  }>,
): SearchResult {
  // Honor `null` explicitly — using `??` would silently coerce null to
  // the default and break the null-safety contract these tests pin.
  // `'matching_messages' in overrides` distinguishes "caller passed null"
  // (drift simulation) from "caller omitted the field" (default fixture).
  const matching_messages =
    'matching_messages' in overrides
      ? overrides.matching_messages
      : [makeMsgSnippet(`${uuid}-m1`, { snippet: 'some snippet text' })]
  return {
    conversation_uuid: uuid,
    conversation_name: overrides.conversation_name as string,
    conversation_updated_at: '2026-05-18T00:00:00Z',
    conversation_created_at: '2026-05-18T00:00:00Z',
    project_name: null,
    matching_messages: matching_messages as MessageSnippet[],
  }
}

describe('narrowSearchResults — null-safety (mirrors backend H1-H4)', () => {
  it('does NOT throw when a result has conversation_name=null', () => {
    const raw: SearchResult[] = [
      makeResult('null-name', {
        conversation_name: null,
        matching_messages: [
          makeMsgSnippet('m1', { snippet: 'has React content' }),
        ],
      }),
      makeResult('has-name', {
        conversation_name: 'React Project',
        matching_messages: [
          makeMsgSnippet('m2', { snippet: 'other content' }),
        ],
      }),
    ]
    // Must not throw.
    const out = narrowSearchResults(raw, 'react')
    // Both results match: null-name via snippet, has-name via title.
    expect(out.map((r) => r.conversation_uuid).sort()).toEqual([
      'has-name',
      'null-name',
    ])
  })

  it('does NOT throw when a matching message has snippet=null', () => {
    const raw: SearchResult[] = [
      makeResult('null-snippet', {
        conversation_name: 'A Title',
        matching_messages: [
          makeMsgSnippet('m1', { snippet: null }),
          makeMsgSnippet('m2', { snippet: 'has Python here' }),
        ],
      }),
    ]
    // Must not throw.
    const out = narrowSearchResults(raw, 'python')
    expect(out).toHaveLength(1)
    // The non-null snippet survives; the null one is filtered (its '' doesn't include 'python').
    expect(out[0].matching_messages.map((m) => m.message_uuid)).toEqual(['m2'])
  })

  it('does NOT throw when matching_messages is null (array drift)', () => {
    const raw: SearchResult[] = [
      makeResult('null-msgs', {
        conversation_name: 'React Project',
        matching_messages: null,
      }),
    ]
    // Must not throw. Name matches, but no msg snippets — name-hit branch
    // pushes through with the original (defensive-empty) matching_messages.
    const out = narrowSearchResults(raw, 'react')
    expect(out).toHaveLength(1)
    expect(out[0].conversation_uuid).toBe('null-msgs')
  })

  it('still applies AND-of-tokens semantics correctly for non-null inputs', () => {
    const raw: SearchResult[] = [
      makeResult('both-tokens', {
        conversation_name: 'unrelated',
        matching_messages: [
          makeMsgSnippet('m1', { snippet: 'React and Python both here' }),
        ],
      }),
      makeResult('one-token', {
        conversation_name: 'unrelated',
        matching_messages: [
          makeMsgSnippet('m2', { snippet: 'only React here' }),
        ],
      }),
    ]
    // Query "react python" requires BOTH tokens.
    const out = narrowSearchResults(raw, 'react python')
    expect(out.map((r) => r.conversation_uuid)).toEqual(['both-tokens'])
  })

  it('returns rawResults unchanged for short queries (no narrow)', () => {
    const raw: SearchResult[] = [
      makeResult('a', { conversation_name: 'A' }),
      makeResult('b', { conversation_name: 'B' }),
    ]
    expect(narrowSearchResults(raw, 'x')).toBe(raw)
  })

  it('returns empty array for undefined rawResults', () => {
    expect(narrowSearchResults(undefined, 'anything')).toEqual([])
  })
})
