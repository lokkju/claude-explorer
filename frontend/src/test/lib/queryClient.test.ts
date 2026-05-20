import { describe, it, expect } from 'vitest'

import { queryClient } from '../../lib/queryClient'

// 2026-05-18 (Task A6): React Query staleTime/gcTime tuning.
//
// Why: `/api/conversations` (sidebar list) dropped from 5s warm to ~87ms
// warm. The previous 5-minute default staleTime made the sidebar feel
// stale on return-to-app; tighten it now that refetches are cheap.
//
// The config lives in two places to stay introspectable from a single
// QueryClient instance (vs. inline per-hook overrides that can drift):
//
//   1. defaultOptions.queries.{staleTime, gcTime} on the QueryClient.
//   2. setQueryDefaults() for the conversations.list / conversations.detail
//      query-key prefixes.
//
// This test is the executable contract for those values.
describe('queryClient configuration (Task A6)', () => {
  it('default staleTime is 30 seconds', () => {
    const defaults = queryClient.getDefaultOptions()
    expect(defaults.queries?.staleTime).toBe(30 * 1000)
  })

  it('default gcTime is 10 minutes', () => {
    const defaults = queryClient.getDefaultOptions()
    // React Query v5 renamed cacheTime → gcTime.
    expect(defaults.queries?.gcTime).toBe(10 * 60 * 1000)
  })

  it('conversations.list staleTime is 30 seconds', () => {
    const opts = queryClient.getQueryDefaults(['conversations', 'list'])
    expect(opts.staleTime).toBe(30 * 1000)
  })

  it('conversations.detail staleTime is 5 minutes', () => {
    const opts = queryClient.getQueryDefaults(['conversations', 'detail'])
    expect(opts.staleTime).toBe(5 * 60 * 1000)
  })
})
