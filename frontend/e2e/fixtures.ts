import { test as base, expect, type Page, type Route } from '@playwright/test'
import type {
  AppConfig,
  AppConfigStats,
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
  /**
   * G1 audit — pass a caller-owned prefs state map so multiple Pages
   * (e.g. two browser contexts in a single test) can share the same
   * server-side prefs blob. Behavior:
   *   - When provided, mockBackend uses this object's `data` map for
   *     GET / merges PATCH bodies into it / overwrites it on PUT.
   *   - The `preferences` option is ignored in this mode (caller seeds
   *     the shared state directly).
   *   - When NOT provided, behavior is unchanged: each call gets its
   *     own private state. Existing tests remain isolated by default.
   *
   * Used by `preferences-cross-context.spec.ts` to prove cross-context
   * persistence without spinning up a real uvicorn process.
   */
  sharedPrefsState?: { data: Record<string, unknown> }
  /** Optional extra route handlers (priority over the defaults). */
  extraRoutes?: (page: Page) => Promise<void>
}

export type MockBackendFn = (opts?: MockBackendOptions) => Promise<void>

/**
 * Console / page-error capture, attached automatically to every spec via the
 * `consoleAssertions` auto-fixture below. Tests can opt-in to inspect or
 * extend the allowlist by depending on `consoleAssertions` directly.
 */
export interface ConsoleCapture {
  errors: string[]
  warnings: string[]
  /** Live-allowlist hook: each entry is a regex tested against the message
   *  text. Caller-added entries apply only within the test that pushes them.
   *  Pre-populated with the project-wide noise allowlist defined inside the
   *  fixture (HMR connect handshakes, React DevTools install hint, etc.). */
  allowlist: RegExp[]
}

interface Fixtures {
  mockBackend: MockBackendFn
  consoleAssertions: ConsoleCapture
}

/**
 * Project-wide console-noise allowlist. Each pattern needs a comment naming
 * its source and reason for tolerance. Adding to this list is a code-review
 * checkpoint per CLAUDE-TESTING.md §5.15.
 *
 * Tests can extend per-test by pushing into `consoleAssertions.allowlist`
 * inside the test body (the auto-fixture is invoked AFTER the test, so
 * mid-test additions take effect for that test only).
 */
const PROJECT_CONSOLE_ALLOWLIST: RegExp[] = [
  // Vite HMR client handshake — fires on every page load in dev.
  /\[vite\] (connecting\.{3}|connected\.)/,
  // React DevTools install hint — environment-level info message.
  /Download the React DevTools/,
  // MSW unhandled-request warnings only fire in vitest, not Playwright;
  // listed defensively in case a spec ever spins up the worker.
  /\[MSW\]/,
  // Our own mockBackend leakage guard writes `[mockBackend] Unmocked
  // API call leaked through:` — that IS the failure mode (route not
  // mocked); leave it as an error so it fails the test, NOT allowlisted.
]

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

/**
 * Wrap an array of SearchResult in the SearchResponse envelope shape
 * that `/api/search` now returns (plan §B). Per-spec route overrides
 * that used to pass `body: JSON.stringify([...])` should now pass
 * `body: searchEnvelopeJson([...])` so the response shape matches
 * what the frontend parses.
 *
 * The envelope's totals default to the array length with
 * `truncated: false`. Tests that care about the truncation footer
 * should pass `total` / `returned` / `truncated` overrides.
 */
export function searchEnvelope(
  results: unknown[],
  opts: { total?: number; returned?: number; truncated?: boolean } = {},
): {
  results: unknown[]
  total_messages_matched: number
  returned_messages: number
  truncated: boolean
} {
  const returned = opts.returned ?? results.length
  const total = opts.total ?? returned
  return {
    results,
    total_messages_matched: total,
    returned_messages: returned,
    truncated: opts.truncated ?? returned < total,
  }
}

export function searchEnvelopeJson(
  results: unknown[],
  opts: { total?: number; returned?: number; truncated?: boolean } = {},
): string {
  return JSON.stringify(searchEnvelope(results, opts))
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

/**
 * Wrap any Playwright navigation action (`page.reload`, `page.goto`,
 * etc.) so it tolerates Tailscale-induced `net::ERR_NETWORK_CHANGED`
 * from Chromium. macOS flips the routing table when Tailscale
 * re-associates, WiFi roams, or a VPN reconnects; a navigation that
 * happens to land in that millisecond window dies with the network-
 * changed error even though the localhost dev server is still up.
 * Retrying within a few hundred milliseconds always wins.
 *
 * Catches that specific error class only — any other failure (real
 * test bug, server down, navigation timeout) propagates unchanged.
 *
 * Use in place of `page.reload()` / `page.goto(...)` for tests that
 * exercise navigation early in setup (before the page has settled),
 * or anywhere a Tailscale-style routing tick has been observed to
 * intercept a navigation. CI without Tailscale will never trip the
 * retry path.
 *
 * Usage:
 *   await withNetRetry(() => page.reload())
 *   await withNetRetry(() => page.goto('/conversations'))
 */
export async function withNetRetry<T>(action: () => Promise<T>, maxAttempts = 4): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await action()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!message.includes('net::ERR_NETWORK_CHANGED')) {
        throw err
      }
      lastError = err
      // Tiny backoff so the next OS routing tick lands first.
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  throw lastError
}

export const test = base.extend<Fixtures>({
  /**
   * Grant clipboard permissions for every spec so Cmd+C tests pass headless.
   * Override per-test by re-granting different permissions if needed.
   */
  context: async ({ context }, use) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    // eslint-disable-next-line react-hooks/rules-of-hooks -- safe: Playwright fixture API `use(value)`, not React.use(). The eslint plugin pattern-matches on the bare name.
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
        ...(opts.config ?? {}),
      }
      const configStats: AppConfigStats = {
        ...config,
        conversation_count: conversations.length,
      }

      // Per-test mutable preferences state. Deep-copy seed so callers
      // can safely reuse the same object across tests.
      //
      // G1 audit: when `sharedPrefsState` is supplied, the caller owns
      // the map and we wire route handlers to mutate it directly — that
      // lets two different page contexts in the same test see each
      // other's PATCHes. Default path (no sharedPrefsState) is unchanged
      // and remains test-isolated.
      const prefsState: { data: Record<string, unknown> } =
        opts.sharedPrefsState ?? {
          data: JSON.parse(JSON.stringify(opts.preferences ?? {})),
        }

      // -----------------------------------------------------------------
      // Catch-all leakage guard (registered FIRST so LIFO order runs it
      // LAST). Any /api/* request that isn't matched by a more specific
      // default below — or by an extraRoutes/per-test override — falls
      // through to here, gets a noisy 500, and surfaces as a test
      // failure instead of silently leaking to whatever backend is
      // running on :8765. This is the load-bearing safety net for the
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
      // Watcher health (RootLayout's WatcherMissingBanner consumes this
      // on every page mount). The endpoint shipped after the e2e
      // leakage-guard and the console-error assertion fixtures, so
      // pre-fixture-update specs hit the catch-all 500 and the auto-
      // assertion fired on every test. Default to ``installed: true``
      // so the banner renders nothing — matches the production
      // experience for users who have run ``install-watcher``. Specs
      // that need to assert the banner can override via extraRoutes.
      // -----------------------------------------------------------------
      await page.route('**/api/health/watcher', (route: Route) => {
        route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            installed: true,
            platform: 'darwin',
            install_command: 'uv run claude-explorer install-watcher',
            docs_url: '',
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
        route.fulfill({ contentType: 'application/json', body: JSON.stringify(configStats) })
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
      // Search — empty SearchResponse envelope by default. Per-test
      // specs that exercise search override via extraRoutes or
      // page.route(). 2026-05-16 (plan §B): the wire format changed
      // from `list[SearchResult]` to a wrapped envelope with
      // truncation disclosure (backend.models.SearchResponse).
      // -----------------------------------------------------------------
      await page.route('**/api/search**', (route: Route) => {
        route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            results: [],
            total_messages_matched: 0,
            returned_messages: 0,
            truncated: false,
          }),
        })
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
    // eslint-disable-next-line react-hooks/rules-of-hooks -- safe: Playwright fixture API `use(value)`, not React.use(). The eslint plugin pattern-matches on the bare name.
    await use(fn)
  },

  /**
   * AUTO-FIXTURE (runs for every test): capture browser console errors
   * and warnings + uncaught page errors throughout the test, then assert
   * empty at teardown (modulo PROJECT_CONSOLE_ALLOWLIST + any per-test
   * additions to `consoleAssertions.allowlist`).
   *
   * Codified in CLAUDE-TESTING.md §5.15. Caught by the 2026-05-24 settings
   * flash-and-disappear regression — that bug shipped past my e2e because
   * I asserted DOM state but never console state. The user found it on
   * first manual test.
   *
   * Failure modes this catches:
   *   - Uncaught promise rejections (e.g. setIncludeCompactInExports
   *     racing with a destroyed component)
   *   - React lifecycle warnings (missing key, missing aria-describedby
   *     on Dialog, useEffect dep drift)
   *   - Network errors that the UI silently swallows (e.g. failed
   *     prefs PATCH that the user doesn't see but the dev tools do)
   *
   * Per-test opt-out: a test that legitimately needs a noisy console can
   * push a regex into `consoleAssertions.allowlist`:
   *
   *     test('legacy noisy thing', async ({ page, consoleAssertions }) => {
   *       consoleAssertions.allowlist.push(/known third-party warning/)
   *       // ... rest of test
   *     })
   *
   * The push is scoped to that test (allowlist array is fresh per test).
   */
  consoleAssertions: [
    async ({ page }, use) => {
      const capture: ConsoleCapture = {
        errors: [],
        warnings: [],
        allowlist: [...PROJECT_CONSOLE_ALLOWLIST],
      }
      const isAllowed = (text: string) =>
        capture.allowlist.some((rx) => rx.test(text))
      page.on('pageerror', (e: Error) => {
        const msg = `pageerror: ${e.message}`
        if (!isAllowed(msg)) capture.errors.push(msg)
      })
      page.on('console', (m) => {
        const text = m.text()
        if (isAllowed(text)) return
        const type = m.type()
        if (type === 'error') capture.errors.push(text)
        else if (type === 'warning') capture.warnings.push(text)
      })
      await use(capture)
      // Assert AFTER the test body completes. Both arrays empty → test
      // truly passed. Either populated → test was misleading-green per
      // §5.15.
      if (capture.errors.length > 0) {
        throw new Error(
          `Console errors during test (see CLAUDE-TESTING.md §5.15):\n  ` +
            capture.errors.join('\n  '),
        )
      }
      if (capture.warnings.length > 0) {
        throw new Error(
          `Console warnings during test (see CLAUDE-TESTING.md §5.15):\n  ` +
            capture.warnings.join('\n  '),
        )
      }
    },
    { auto: true },
  ],
})

export { expect }
export type { Page, Route } from '@playwright/test'
export const PRIMARY_ORG = PRIMARY_ORG_ID
