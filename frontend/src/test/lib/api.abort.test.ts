/**
 * S5 T2b (2026-05-20) — AbortSignal threading on `api.ts` static-endpoint
 * methods.
 *
 * Hunt #5 (2026-05-18) plumbed AbortSignal through the heavy reads
 * (`getConversations`, `getConversation`, `search`) but explicitly
 * skipped the static endpoints (`getOrgs`, `getConfig`, `getConfigStats`,
 * `getConversationTree`, `fetchPrefs`) on the grounds that their warm-
 * path latency was below a React lifecycle tick. S5 (2026-05-19)
 * reraised this as a MED finding: cold-start, slow network, and
 * legitimate cancel paths still benefit from the signal — the cost is
 * ~25 LOC and the upside is uniform behavior across every query in the
 * app.
 *
 * These tests pin the contract at the unit level: each api.ts method
 * accepts an optional `signal` and forwards it to `fetch()`. An
 * already-aborted signal must cause the call to reject with the same
 * error fetch emits for aborted requests.
 *
 * The bidirectional pair (signal absent → call resolves normally) is
 * covered by the existing per-route tests in `useConversations.staleTime`
 * and the original Hunt #5 test slab; we don't re-prove those here.
 */

import { describe, it, expect } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server'

import { api } from '../../lib/api'

function abortedController(): AbortController {
  const c = new AbortController()
  c.abort()
  return c
}

describe('api.ts — AbortSignal threading on static endpoints (S5 T2b)', () => {
  it('getOrgs forwards signal to fetch (aborted signal -> rejection)', async () => {
    server.use(
      http.get('/api/orgs', () => HttpResponse.json({ organizations: [] })),
    )
    const c = abortedController()
    await expect(api.getOrgs(c.signal)).rejects.toThrow()
  })

  it('getConfig forwards signal to fetch (aborted signal -> rejection)', async () => {
    server.use(
      http.get('/api/config', () =>
        HttpResponse.json({
          data_dir: '/tmp',
          config_corrupt_reason: null,
        }),
      ),
    )
    const c = abortedController()
    await expect(api.getConfig(c.signal)).rejects.toThrow()
  })

  it('getConfigStats forwards signal to fetch (aborted signal -> rejection)', async () => {
    server.use(
      http.get('/api/config/stats', () =>
        HttpResponse.json({ message_count: 0, conversation_count: 0 }),
      ),
    )
    const c = abortedController()
    await expect(api.getConfigStats(c.signal)).rejects.toThrow()
  })

  it('getConversationTree forwards signal to fetch (aborted signal -> rejection)', async () => {
    server.use(
      http.get('/api/conversations/:uuid/tree', () =>
        HttpResponse.json({ root: null, leaves: [] }),
      ),
    )
    const c = abortedController()
    await expect(api.getConversationTree('uuid-x', c.signal)).rejects.toThrow()
  })
})
