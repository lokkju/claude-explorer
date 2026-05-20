/**
 * useOrgs — workspace-selector source.
 *
 * cowork-multi-org C6 / Council P1-2 + NEW-P0-C: derives the sidebar's
 * workspace selector options from credentials.json (read via /api/orgs)
 * rather than from the conversation list (which would force a 5-10k row
 * reduction every render and flip set membership during streaming SSE
 * fetches).
 *
 * Three-state mapping:
 *   - { authenticated: true, orgs: [...] }  -> selector active
 *   - { authenticated: false, orgs: [] }   -> "run capture" empty state
 *   - 500 (corrupt creds)                  -> explicit error banner
 */

import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Org } from '@/lib/types'

export function useOrgs() {
  const query = useQuery({
    queryKey: ['orgs'],
    queryFn: ({ signal }) => api.getOrgs(signal),
    staleTime: 5 * 60 * 1000, // 5 minutes — orgs change rarely
  })

  const orgs: Org[] = query.data?.orgs ?? []
  const isAuthenticated = query.data?.authenticated ?? false

  return {
    ...query,
    orgs,
    isAuthenticated,
    // Selector visibility gate: ≥ 2 distinct org_ids.
    showSelector: isAuthenticated && orgs.length >= 2,
  }
}
