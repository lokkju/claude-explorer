import { test as base, expect, type Page, type Route } from '@playwright/test'
import type {
  AppConfig,
  ConversationDetail,
  ConversationSummary,
  ConversationTree,
  Message,
  MessageNode,
  OrgsResponse,
} from '../src/lib/types'

/**
 * Shared Playwright test fixtures for the article ↔ test coverage suite.
 *
 * Why this exists:
 *   - Clipboard tests (Cmd+C copy paths) need explicit browser-context
 *     permissions or they fail headless. Grant once for every spec.
 *   - Most specs ad-hoc reimplement `mockBackend()`; mock drift across
 *     files is a real risk. Centralize the backend mock here.
 *   - Mock payloads should match backend Pydantic shapes. We import the
 *     real TS types from `src/lib/types.ts` so any backend schema change
 *     that lands in TS surfaces as a type error in fixtures, not a flaky
 *     test in CI.
 *
 * Usage:
 *   import { test, expect } from './fixtures'
 *   test('something', async ({ page, mockBackend }) => {
 *     await mockBackend({ conversations: [...], detail: {...} })
 *     await page.goto('/')
 *   })
 */

export interface MockBackendOptions {
  /** Defaults: data_dir='/tmp', conversation_count = conversations.length */
  config?: Partial<AppConfig>
  /** Sidebar list payload. Default: []. */
  conversations?: ConversationSummary[]
  /** Detail responses keyed by uuid. Tree payload synthesized if missing. */
  details?: Record<string, ConversationDetail>
  /** Tree responses keyed by uuid. Default: synthesize linear from messages. */
  trees?: Record<string, ConversationTree>
  /** /api/orgs response. Default: authenticated single primary org. */
  orgs?: OrgsResponse
  /**
   * Initial server-side preferences blob (the `data` field of the
   * `/api/preferences` envelope). Tests that need pre-populated prefs
   * pass them here; subsequent PATCH/PUT requests in the same test
   * mutate this state in-memory.
   */
  preferences?: Record<string, unknown>
  /** Optional extra route handlers (priority over the defaults). */
  extraRoutes?: (page: Page) => Promise<void>
}

export type MockBackendFn = (opts?: MockBackendOptions) => Promise<void>

interface Fixtures {
  mockBackend: MockBackendFn
}

const PRIMARY_ORG_ID = 'ae24ae66-4622-48e7-b4b3-1ab2c49f933d'

const DEFAULT_ORGS: OrgsResponse = {
  authenticated: true,
  orgs: [{ org_id: PRIMARY_ORG_ID, name: 'Personal', is_primary: true }],
}

/**
 * Build a ConversationSummary fixture. All fields default to safe sentinels;
 * pass overrides for whatever your test cares about.
 */
export function makeSummary(overrides: Partial<ConversationSummary> & { uuid: string }): ConversationSummary {
  return {
    name: 'Untitled',
    summary: '',
    model: 'claude-sonnet-4-6',
    created_at: '2026-04-01T10:00:00Z',
    updated_at: '2026-04-01T10:00:00Z',
    is_starred: false,
    is_temporary: false,
    message_count: 0,
    human_message_count: 0,
    has_branches: false,
    source: 'CLAUDE_AI',
    project_path: null,
    project_name: null,
    git_branch: null,
    organization_id: PRIMARY_ORG_ID,
    organization_name: 'Personal',
    subagents: [],
    ...overrides,
  }
}

export function makeMessage(overrides: Partial<Message> & { uuid: string }): Message {
  return {
    sender: 'human',
    text: '',
    content: [],
    created_at: '2026-04-01T10:00:00Z',
    updated_at: '2026-04-01T10:00:00Z',
    truncated: false,
    parent_message_uuid: null,
    attachments: [],
    files: [],
    ...overrides,
  }
}

export function makeDetail(
  summary: ConversationSummary,
  messages: Message[],
  overrides: Partial<ConversationDetail> = {},
): ConversationDetail {
  return {
    ...summary,
    messages,
    current_leaf_message_uuid: messages.length > 0 ? messages[messages.length - 1].uuid : '',
    file_path: null,
    compact_markers: [],
    ...overrides,
  }
}

function synthesizeTree(detail: ConversationDetail): ConversationTree {
  // Linear chain: each message has at most one child.
  let chain: MessageNode[] = []
  for (let i = detail.messages.length - 1; i >= 0; i--) {
    chain = [{ message: detail.messages[i], children: chain }]
  }
  return {
    uuid: detail.uuid,
    root_messages: chain,
    active_path: detail.messages.map((m) => m.uuid),
  }
}

export const test = base.extend<Fixtures>({
  /**
   * Grant clipboard permissions for every spec so Cmd+C tests pass headless.
   * Override per-test by re-granting different permissions if needed.
   */
  context: async ({ context }, use) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await use(context)
  },

  mockBackend: async ({ page }, use) => {
    const fn: MockBackendFn = async (opts = {}) => {
      const conversations = opts.conversations ?? []
      const details = opts.details ?? {}
      const trees = opts.trees ?? {}
      const orgs = opts.orgs ?? DEFAULT_ORGS
      const config: AppConfig = {
        data_dir: '/tmp',
        conversation_count: conversations.length,
        ...(opts.config ?? {}),
      }

      // Per-test mutable preferences state. Deep-copy seed so callers
      // can safely reuse the same object across tests.
      const prefsState: { data: Record<string, unknown> } = {
        data: JSON.parse(JSON.stringify(opts.preferences ?? {})),
      }

      // -----------------------------------------------------------------
      // Catch-all leakage guard (registered FIRST so LIFO order runs it
      // LAST). Any /api/* request that isn't matched by a more specific
      // default below — or by an extraRoutes/per-test override — falls
      // through to here, gets a noisy 500, and surfaces as a test
      // failure instead of silently leaking to whatever backend is
      // running on :8000. This is the load-bearing safety net for the
      // whole mock-data-conversion plan.
      // -----------------------------------------------------------------
      await page.route('**/api/**', (route: Route) => {
        const req = route.request()
        console.error(
          `[mockBackend] Unmocked API call leaked through: ${req.method()} ${req.url()}`,
        )
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'Unmocked API route hit in test',
            method: req.method(),
            url: req.url(),
          }),
        })
      })

      // -----------------------------------------------------------------
      // Config
      // -----------------------------------------------------------------
      await page.route('**/api/config', (route: Route) => {
        route.fulfill({ contentType: 'application/json', body: JSON.stringify(config) })
      })

      await page.route('**/api/config/stats', (route: Route) => {
        route.fulfill({ contentType: 'application/json', body: JSON.stringify(config) })
      })

      // -----------------------------------------------------------------
      // Orgs
      // -----------------------------------------------------------------
      await page.route('**/api/orgs', (route: Route) => {
        route.fulfill({ contentType: 'application/json', body: JSON.stringify(orgs) })
      })

      // -----------------------------------------------------------------
      // Preferences (GET / PATCH / PUT) — stateful echo.
      //
      // The Settings + filter migrations all dual-write here, so a real
      // PATCH must merge into in-memory state and a follow-up GET must
      // reflect prior PATCHes. This is the highest-leakage route post-P3
      // and the single biggest reason this M1 fixture extension exists.
      // -----------------------------------------------------------------
      await page.route('**/api/preferences', (route: Route) => {
        const req = route.request()
        const method = req.method()
        if (method === 'PATCH' || method === 'PUT') {
          let body: { data?: Record<string, unknown> } = {}
          try {
            body = JSON.parse(req.postData() ?? '{}') as { data?: Record<string, unknown> }
          } catch {
            body = {}
          }
          const incoming = body.data ?? {}
          if (method === 'PUT') {
            prefsState.data = { ...incoming }
          } else {
            Object.assign(prefsState.data, incoming)
          }
        }
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ version: 1, data: prefsState.data }),
        })
      })

      // -----------------------------------------------------------------
      // Search — empty results by default. Per-test specs that exercise
      // search override via extraRoutes or page.route().
      // -----------------------------------------------------------------
      await page.route('**/api/search**', (route: Route) => {
        route.fulfill({ contentType: 'application/json', body: '[]' })
      })

      // -----------------------------------------------------------------
      // Claude Code image cache — 404 by default. Specs that need a real
      // image (or a 200 retry path) install their own page.route().
      // -----------------------------------------------------------------
      await page.route('**/api/cc-image**', (route: Route) => {
        route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'no cache' }),
        })
      })

      // -----------------------------------------------------------------
      // Bookmarks — list + CRUD echo.
      // -----------------------------------------------------------------
      await page.route('**/api/bookmarks', (route: Route) => {
        const req = route.request()
        if (req.method() === 'POST') {
          let body: Record<string, unknown> = {}
          try {
            body = JSON.parse(req.postData() ?? '{}') as Record<string, unknown>
          } catch {
            body = {}
          }
          const created = {
            id: `bk-${Math.random().toString(36).slice(2, 10)}`,
            created_at: new Date().toISOString(),
            ...body,
          }
          route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify(created),
          })
          return
        }
        // GET (list) → unwrapped envelope shape: src/lib/api.ts:listBookmarks
        // reads `body.bookmarks`, so the envelope must be present.
        route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ bookmarks: [] }),
        })
      })

      await page.route('**/api/bookmarks/*', (route: Route) => {
        const req = route.request()
        const url = req.url()
        const id = url.split('/').pop()?.split('?')[0] ?? ''
        if (req.method() === 'DELETE') {
          route.fulfill({ status: 204, body: '' })
          return
        }
        if (req.method() === 'PATCH') {
          let body: Record<string, unknown> = {}
          try {
            body = JSON.parse(req.postData() ?? '{}') as Record<string, unknown>
          } catch {
            body = {}
          }
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              id,
              conversation_uuid: '',
              message_uuid: '',
              created_at: new Date().toISOString(),
              ...body,
            }),
          })
          return
        }
        route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
      })

      // -----------------------------------------------------------------
      // Desktop file proxy: /api/{org_id}/files/{file_uuid}/{thumbnail|preview}
      // The single-segment `*` glob safely matches UUID org ids.
      // -----------------------------------------------------------------
      await page.route('**/api/*/files/**', (route: Route) => {
        route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'not cached' }),
        })
      })

      // -----------------------------------------------------------------
      // Post-P4c local attachments cache: /api/attachments/{conv}/{file}/{variant}
      // -----------------------------------------------------------------
      await page.route('**/api/attachments/**', (route: Route) => {
        route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'not cached' }),
        })
      })

      // -----------------------------------------------------------------
      // Fetch pipeline routes
      // -----------------------------------------------------------------
      await page.route('**/api/fetch/status', (route: Route) => {
        route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            has_credentials: false,
            credentials_path: '/tmp/credentials.json',
            output_dir: '/tmp/conversations',
            existing_count: 0,
            credentials_age_days: null,
          }),
        })
      })

      // SSE streams — emit a minimal start+complete frame and signal a
      // huge `retry:` interval so the browser's native EventSource does
      // NOT auto-reconnect after the body closes (default 3s reconnect
      // would loop forever).
      const sseBody =
        'retry: 999999\n' +
        'event: start\ndata: {}\n\n' +
        'event: complete\ndata: {}\n\n'

      const fulfillSse = (route: Route) => {
        route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          headers: { 'cache-control': 'no-cache' },
          body: sseBody,
        })
      }
      await page.route('**/api/fetch/start**', fulfillSse)
      await page.route('**/api/fetch/refresh**', fulfillSse)

      await page.route('**/api/fetch/conversation/*', (route: Route) => {
        const url = route.request().url()
        const uuid = url.split('/').pop()?.split('?')[0] ?? ''
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ uuid, status: 'fetched', name: 'Mock' }),
        })
      })

      // -----------------------------------------------------------------
      // Conversations list/detail/tree (existing behavior)
      // -----------------------------------------------------------------
      await page.route('**/api/conversations**', (route: Route) => {
        const url = route.request().url()
        // Detail tree: /api/conversations/<uuid>/tree
        const treeMatch = url.match(/\/api\/conversations\/([^/?]+)\/tree/)
        if (treeMatch) {
          const uuid = treeMatch[1]
          const tree = trees[uuid] ?? (details[uuid] ? synthesizeTree(details[uuid]) : { uuid, root_messages: [], active_path: [] })
          route.fulfill({ contentType: 'application/json', body: JSON.stringify(tree) })
          return
        }
        // Detail: /api/conversations/<uuid>
        const detailMatch = url.match(/\/api\/conversations\/([^/?]+)(?:\?|$)/)
        if (detailMatch) {
          const uuid = detailMatch[1]
          const detail = details[uuid]
          if (detail) {
            route.fulfill({ contentType: 'application/json', body: JSON.stringify(detail) })
          } else {
            route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ detail: 'not found' }) })
          }
          return
        }
        // List: /api/conversations(?...)
        route.fulfill({ contentType: 'application/json', body: JSON.stringify(conversations) })
      })

      // -----------------------------------------------------------------
      // Export endpoints — empty octet-stream by default. Registered
      // AFTER the conversations handler so LIFO favors the export
      // matcher for /api/conversations/<uuid>/export/* paths.
      // -----------------------------------------------------------------
      const fulfillEmptyOctet = (route: Route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/octet-stream',
          body: '',
        })
      }
      await page.route('**/api/conversations/*/export/**', fulfillEmptyOctet)
      await page.route('**/api/export/**', fulfillEmptyOctet)

      // Per-test overrides go LAST so LIFO grants them top priority.
      if (opts.extraRoutes) {
        await opts.extraRoutes(page)
      }
    }
    await use(fn)
  },
})

export { expect }
export type { Page, Route } from '@playwright/test'
export const PRIMARY_ORG = PRIMARY_ORG_ID
