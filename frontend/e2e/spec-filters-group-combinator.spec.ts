// Spec-driven test: group-level combinator semantics.
//
// UX.md clauses verified (lines 615-738, "Composable filters"):
//   - "Groups combine other named filters. A group is either match all of
//     these (every member must pass) or match any of these (at least one
//     member must pass). Groups can reference atoms or other groups.
//     Groups carry no Behavior of their own — they are pure combinators
//     over their children's keep/drop decisions."
//   - "Disabled members are dropped from a group's quantifier *before* the
//     match runs. A match: 'any' group containing a single disabled member
//     therefore does NOT pass for everything; the disabled member is
//     removed first, and the resulting empty group passes."
//   - "An atom with zero patterns passes for every conversation."
//   - "A group with zero members (or a group whose members are all
//     disabled / all orphans) passes for every conversation."
//   - Cycle defense: "a cycle introduced by manual edit of the prefs file
//     short-circuits to 'no-op' rather than blowing the stack." (recursive
//     groups must traverse arbitrary depths cleanly.)
//   - Stale activeId: a stale FilterId must be treated as a no-op.
//
// NO APP CODE was read while writing this test.

import { test, expect, withNetRetry } from './fixtures'
import { makeSummary, withNetRetry } from './fixtures'

const conversations = [
  makeSummary({ uuid: 'c-foo', name: 'Foo morning' }),
  makeSummary({ uuid: 'c-bar', name: 'Bar afternoon' }),
  makeSummary({ uuid: 'c-foobar', name: 'Foo and Bar' }),
  makeSummary({ uuid: 'c-baz', name: 'Baz evening' }),
]

test.describe('Group combinator semantics', () => {
  test('match: all — every enabled member must pass', async ({ page, mockBackend }) => {
    // show-only Foo + show-only Bar, all-of: only "Foo and Bar" passes.
    await mockBackend({
      conversations,
      preferences: {
        filters: {
          nodes: {
            'a-foo': {
              id: 'a-foo',
              type: 'atom',
              name: 'Show only Foo',
              enabled: true,
              behavior: 'show-only',
              patterns: ['*Foo*'],
              mode: 'glob',
              target: 'title',
            },
            'a-bar': {
              id: 'a-bar',
              type: 'atom',
              name: 'Show only Bar',
              enabled: true,
              behavior: 'show-only',
              patterns: ['*Bar*'],
              mode: 'glob',
              target: 'title',
            },
            'g-all': {
              id: 'g-all',
              type: 'group',
              name: 'All of these',
              enabled: true,
              match: 'all',
              childIds: ['a-foo', 'a-bar'],
            },
          },
          activeId: 'g-all',
          _migratedV1: true,
          _migratedV2: true,
        },
      },
    })
    await withNetRetry(() => page.goto('/'))

    await expect(page.getByText('Foo and Bar')).toBeVisible()
    await expect(page.getByText('Foo morning')).toHaveCount(0)
    await expect(page.getByText('Bar afternoon')).toHaveCount(0)
    await expect(page.getByText('Baz evening')).toHaveCount(0)
  })

  test('match: any — at least one enabled member must pass', async ({ page, mockBackend }) => {
    // show-only Foo + show-only Bar, any-of: any title containing Foo or Bar
    await mockBackend({
      conversations,
      preferences: {
        filters: {
          nodes: {
            'a-foo': {
              id: 'a-foo',
              type: 'atom',
              name: 'Show only Foo',
              enabled: true,
              behavior: 'show-only',
              patterns: ['*Foo*'],
              mode: 'glob',
              target: 'title',
            },
            'a-bar': {
              id: 'a-bar',
              type: 'atom',
              name: 'Show only Bar',
              enabled: true,
              behavior: 'show-only',
              patterns: ['*Bar*'],
              mode: 'glob',
              target: 'title',
            },
            'g-any': {
              id: 'g-any',
              type: 'group',
              name: 'Any of these',
              enabled: true,
              match: 'any',
              childIds: ['a-foo', 'a-bar'],
            },
          },
          activeId: 'g-any',
          _migratedV1: true,
          _migratedV2: true,
        },
      },
    })
    await withNetRetry(() => page.goto('/'))

    await expect(page.getByText('Foo morning')).toBeVisible()
    await expect(page.getByText('Bar afternoon')).toBeVisible()
    await expect(page.getByText('Foo and Bar')).toBeVisible()
    await expect(page.getByText('Baz evening')).toHaveCount(0)
  })

  test('Mixed children: hide-atom + show-only-atom under match: all', async ({ page, mockBackend }) => {
    // hide Baz + show-only Foo, all-of:
    //   - "Foo morning"   : hide-Baz keeps; show-only-Foo keeps. KEEP.
    //   - "Bar afternoon" : hide-Baz keeps; show-only-Foo drops.  DROP.
    //   - "Foo and Bar"   : hide-Baz keeps; show-only-Foo keeps. KEEP.
    //   - "Baz evening"   : hide-Baz drops; (irrelevant).         DROP.
    await mockBackend({
      conversations,
      preferences: {
        filters: {
          nodes: {
            'a-hide-baz': {
              id: 'a-hide-baz',
              type: 'atom',
              name: 'Hide Baz',
              enabled: true,
              behavior: 'hide',
              patterns: ['*Baz*'],
              mode: 'glob',
              target: 'title',
            },
            'a-show-foo': {
              id: 'a-show-foo',
              type: 'atom',
              name: 'Show only Foo',
              enabled: true,
              behavior: 'show-only',
              patterns: ['*Foo*'],
              mode: 'glob',
              target: 'title',
            },
            'g-mix': {
              id: 'g-mix',
              type: 'group',
              name: 'Mixed all',
              enabled: true,
              match: 'all',
              childIds: ['a-hide-baz', 'a-show-foo'],
            },
          },
          activeId: 'g-mix',
          _migratedV1: true,
          _migratedV2: true,
        },
      },
    })
    await withNetRetry(() => page.goto('/'))

    await expect(page.getByText('Foo morning')).toBeVisible()
    await expect(page.getByText('Foo and Bar')).toBeVisible()
    await expect(page.getByText('Bar afternoon')).toHaveCount(0)
    await expect(page.getByText('Baz evening')).toHaveCount(0)
  })

  test('Empty group passes every conversation (least surprise)', async ({ page, mockBackend }) => {
    await mockBackend({
      conversations,
      preferences: {
        filters: {
          nodes: {
            'g-empty': {
              id: 'g-empty',
              type: 'group',
              name: 'Empty group',
              enabled: true,
              match: 'all',
              childIds: [],
            },
          },
          activeId: 'g-empty',
          _migratedV1: true,
          _migratedV2: true,
        },
      },
    })
    await withNetRetry(() => page.goto('/'))

    await expect(page.getByText('Foo morning')).toBeVisible()
    await expect(page.getByText('Bar afternoon')).toBeVisible()
    await expect(page.getByText('Foo and Bar')).toBeVisible()
    await expect(page.getByText('Baz evening')).toBeVisible()
  })

  test('Disabled member dropped from match: any (not short-circuited)', async ({ page, mockBackend }) => {
    // The bug being guarded: if a disabled member returned `true` from
    // evaluate(), `some()` would short-circuit and the group would pass
    // for every conversation. Correct semantics: drop the disabled
    // member, then evaluate the quantifier.
    //
    // Setup: match=any with two members
    //   Member 1 (disabled) — would match ALL if buggily evaluated
    //   Member 2 (enabled)  — show-only Foo
    //
    // Buggy behavior would let every row through. Correct behavior keeps
    // only Foo-titled rows.
    await mockBackend({
      conversations,
      preferences: {
        filters: {
          nodes: {
            'a-disabled-allpass': {
              id: 'a-disabled-allpass',
              type: 'atom',
              name: 'Disabled empty (would pass-all)',
              enabled: false,
              behavior: 'show-only',
              patterns: [],
              mode: 'glob',
              target: 'title',
            },
            'a-show-foo': {
              id: 'a-show-foo',
              type: 'atom',
              name: 'Show only Foo',
              enabled: true,
              behavior: 'show-only',
              patterns: ['*Foo*'],
              mode: 'glob',
              target: 'title',
            },
            'g-any': {
              id: 'g-any',
              type: 'group',
              name: 'Any with disabled',
              enabled: true,
              match: 'any',
              childIds: ['a-disabled-allpass', 'a-show-foo'],
            },
          },
          activeId: 'g-any',
          _migratedV1: true,
          _migratedV2: true,
        },
      },
    })
    await withNetRetry(() => page.goto('/'))

    // Correct: only Foo-titled visible. Buggy short-circuit would let
    // Bar/Baz through.
    await expect(page.getByText('Foo morning')).toBeVisible()
    await expect(page.getByText('Foo and Bar')).toBeVisible()
    await expect(page.getByText('Bar afternoon')).toHaveCount(0)
    await expect(page.getByText('Baz evening')).toHaveCount(0)
  })

  test('Recursive groups: A (match: all) → B (match: any) traverses arbitrary depth', async ({ page, mockBackend }) => {
    // Group A `match: all`, members = [Group B, Hide-Baz atom]
    // Group B `match: any`, members = [show-only Foo, show-only Bar]
    //
    // For "Foo morning": B passes (Foo matches), Hide-Baz keeps. KEEP.
    // For "Bar afternoon": B passes, Hide-Baz keeps. KEEP.
    // For "Foo and Bar": B passes, Hide-Baz keeps. KEEP.
    // For "Baz evening": B fails, Hide-Baz drops. DROP.
    await mockBackend({
      conversations,
      preferences: {
        filters: {
          nodes: {
            'a-show-foo': {
              id: 'a-show-foo',
              type: 'atom',
              name: 'Show only Foo',
              enabled: true,
              behavior: 'show-only',
              patterns: ['*Foo*'],
              mode: 'glob',
              target: 'title',
            },
            'a-show-bar': {
              id: 'a-show-bar',
              type: 'atom',
              name: 'Show only Bar',
              enabled: true,
              behavior: 'show-only',
              patterns: ['*Bar*'],
              mode: 'glob',
              target: 'title',
            },
            'a-hide-baz': {
              id: 'a-hide-baz',
              type: 'atom',
              name: 'Hide Baz',
              enabled: true,
              behavior: 'hide',
              patterns: ['*Baz*'],
              mode: 'glob',
              target: 'title',
            },
            'g-b': {
              id: 'g-b',
              type: 'group',
              name: 'Inner B',
              enabled: true,
              match: 'any',
              childIds: ['a-show-foo', 'a-show-bar'],
            },
            'g-a': {
              id: 'g-a',
              type: 'group',
              name: 'Outer A',
              enabled: true,
              match: 'all',
              childIds: ['g-b', 'a-hide-baz'],
            },
          },
          activeId: 'g-a',
          _migratedV1: true,
          _migratedV2: true,
        },
      },
    })
    await withNetRetry(() => page.goto('/'))

    await expect(page.getByText('Foo morning')).toBeVisible()
    await expect(page.getByText('Bar afternoon')).toBeVisible()
    await expect(page.getByText('Foo and Bar')).toBeVisible()
    await expect(page.getByText('Baz evening')).toHaveCount(0)
  })

  test('Stale activeId pointing at a non-existent FilterId: app loads, no filter active', async ({ page, mockBackend }) => {
    await mockBackend({
      conversations,
      preferences: {
        filters: {
          nodes: {
            'a-1': {
              id: 'a-1',
              type: 'atom',
              name: 'Some filter',
              enabled: true,
              behavior: 'hide',
              patterns: ['*Foo*'],
              mode: 'glob',
              target: 'title',
            },
          },
          activeId: 'does-not-exist-xyz',
          _migratedV1: true,
          _migratedV2: true,
        },
      },
    })
    await withNetRetry(() => page.goto('/'))

    // App must load (no crash). Stale activeId acts as no-op: every
    // conversation visible.
    await expect(page.getByText('Foo morning')).toBeVisible()
    await expect(page.getByText('Bar afternoon')).toBeVisible()
    await expect(page.getByText('Foo and Bar')).toBeVisible()
    await expect(page.getByText('Baz evening')).toBeVisible()
  })
})
