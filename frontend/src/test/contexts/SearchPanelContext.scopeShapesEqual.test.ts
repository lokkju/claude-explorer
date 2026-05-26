/**
 * Unit tests for `scopeShapesEqual` (2026-05-24).
 *
 * Pins the identity-stability contract that prevents the Cmd+G
 * "jumps then jumps back" regression. The helper is the
 * defense-in-depth half of the fix; the upstream half lives in
 * `SearchPinContext.tsx` (`scopesEqual` + functional `setScope`).
 *
 * Contract: two `scope` payloads are equal iff both are undefined OR
 * both are objects whose conversationUuid + projectPath +
 * organizationId + conversationUuids (array element-wise) match.
 */

import { describe, it, expect } from 'vitest'
import { scopeShapesEqual } from '../../contexts/SearchPanelContext'

describe('scopeShapesEqual', () => {
  it('returns true for two undefined scopes', () => {
    expect(scopeShapesEqual(undefined, undefined)).toBe(true)
  })

  it('returns false when only one side is undefined', () => {
    expect(scopeShapesEqual(undefined, { organizationId: 'org-a' })).toBe(false)
    expect(scopeShapesEqual({ organizationId: 'org-a' }, undefined)).toBe(false)
  })

  it('returns true for two object scopes with identical organizationId only', () => {
    expect(
      scopeShapesEqual(
        { organizationId: 'org-primary' },
        { organizationId: 'org-primary' },
      ),
    ).toBe(true)
  })

  it('returns false when organizationId differs', () => {
    expect(
      scopeShapesEqual(
        { organizationId: 'org-a' },
        { organizationId: 'org-b' },
      ),
    ).toBe(false)
  })

  it('returns true for two scopes with identical conversationUuid', () => {
    expect(
      scopeShapesEqual(
        { conversationUuid: 'conv-1' },
        { conversationUuid: 'conv-1' },
      ),
    ).toBe(true)
  })

  it('returns true for two scopes with identical conversationUuids array (different identity, same content)', () => {
    // This is the exact scenario the helper exists to suppress: two
    // calls to the `scope` factory that produce structurally-identical
    // arrays via Array.prototype.map (new reference each call).
    expect(
      scopeShapesEqual(
        { conversationUuids: ['c1', 'c2', 'c3'] },
        { conversationUuids: ['c1', 'c2', 'c3'] },
      ),
    ).toBe(true)
  })

  it('returns false when conversationUuids differ at any position', () => {
    expect(
      scopeShapesEqual(
        { conversationUuids: ['c1', 'c2', 'c3'] },
        { conversationUuids: ['c1', 'c2', 'c4'] },
      ),
    ).toBe(false)
  })

  it('returns false when conversationUuids lengths differ', () => {
    expect(
      scopeShapesEqual(
        { conversationUuids: ['c1', 'c2'] },
        { conversationUuids: ['c1', 'c2', 'c3'] },
      ),
    ).toBe(false)
  })

  it('returns true for fully-populated identical scopes', () => {
    expect(
      scopeShapesEqual(
        {
          conversationUuid: 'conv-1',
          projectPath: '/x',
          organizationId: 'org-primary',
          conversationUuids: ['c1', 'c2'],
        },
        {
          conversationUuid: 'conv-1',
          projectPath: '/x',
          organizationId: 'org-primary',
          conversationUuids: ['c1', 'c2'],
        },
      ),
    ).toBe(true)
  })

  it('handles "same reference" short-circuit (===)', () => {
    const same = { organizationId: 'org' }
    expect(scopeShapesEqual(same, same)).toBe(true)
  })
})
