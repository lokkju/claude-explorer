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

      await page.route('**/api/config', (route: Route) => {
        route.fulfill({ contentType: 'application/json', body: JSON.stringify(config) })
      })

      await page.route('**/api/orgs', (route: Route) => {
        route.fulfill({ contentType: 'application/json', body: JSON.stringify(orgs) })
      })

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
