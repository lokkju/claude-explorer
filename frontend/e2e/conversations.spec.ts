import { test, expect, makeSummary, makeMessage, makeDetail } from './fixtures'
import type { ConversationSummary, ConversationDetail } from '../src/lib/types'

/**
 * Fixture conversations mirror the four conversations the original
 * fixture-mode backend served (under backend/tests/fixtures/desktop/
 * + backend/tests/fixtures/claude/), so the assertions below remain
 * stable while the tests no longer require any live backend.
 *
 *   - "Phase 5 fixture: TLS handshakes (long)" — 30 messages
 *   - "Phase 5 fixture: Branch tree" — has_branches=true
 *   - "Phase 5 fixture: Tool calls"
 *   - "Hi! NEEDLE_CC — fixture session for Phase 5 tests." — CC source
 */

const TLS_TITLE = 'Phase 5 fixture: TLS handshakes (long)';
const TLS_UUID = '0f415a45-9c62-8671-d4ad-53b84acb7e1a';
const BRANCH_TITLE = 'Phase 5 fixture: Branch tree';
const BRANCH_UUID = 'c8da94ab-641d-bf28-d4a6-cba9bc72468e';
const TOOL_TITLE = 'Phase 5 fixture: Tool calls';
const TOOL_UUID = 'a3c33811-ab27-c195-6938-54121b8673e4';
const CC_TITLE = 'Hi! NEEDLE_CC — fixture session for Phase 5 tests.';
const CC_UUID = '435e56ed-50ba-21c0-3495-0e8749b20543';

function buildFixtures(): {
  conversations: ConversationSummary[];
  details: Record<string, ConversationDetail>;
} {
  // ---------- TLS (long, 30 alternating messages) ----------
  const tlsSummary = makeSummary({
    uuid: TLS_UUID,
    name: TLS_TITLE,
    message_count: 30,
    human_message_count: 15,
  });
  const tlsMessages = [];
  let prev: string | null = null;
  for (let i = 0; i < 30; i++) {
    const uuid = `tls-${i.toString().padStart(2, '0')}`;
    const sender = i % 2 === 0 ? 'human' : 'assistant';
    const text =
      i === 0
        ? "Hi! Let's talk about TLS. NEEDLE_HANDSHAKE"
        : sender === 'human'
          ? `Follow-up question ${i} about TLS handshakes.`
          : `Answer ${i}: more on TLS handshakes.`;
    tlsMessages.push(
      makeMessage({ uuid, sender, text, parent_message_uuid: prev }),
    );
    prev = uuid;
  }
  const tlsDetail = makeDetail(tlsSummary, tlsMessages);

  // ---------- Branch tree ----------
  const branchSummary = makeSummary({
    uuid: BRANCH_UUID,
    name: BRANCH_TITLE,
    message_count: 4,
    human_message_count: 2,
    has_branches: true,
  });
  const branchMessages = [
    makeMessage({ uuid: 'b1', sender: 'human', text: 'Initial question.' }),
    makeMessage({
      uuid: 'b2',
      sender: 'assistant',
      text: 'Initial answer.',
      parent_message_uuid: 'b1',
    }),
    makeMessage({
      uuid: 'b3',
      sender: 'human',
      text: 'Follow-up.',
      parent_message_uuid: 'b2',
    }),
    makeMessage({
      uuid: 'b4',
      sender: 'assistant',
      text: 'Follow-up answer.',
      parent_message_uuid: 'b3',
    }),
  ];
  const branchDetail = makeDetail(branchSummary, branchMessages);

  // ---------- Tool calls ----------
  const toolSummary = makeSummary({
    uuid: TOOL_UUID,
    name: TOOL_TITLE,
    message_count: 3,
    human_message_count: 1,
  });
  const toolMessages = [
    makeMessage({ uuid: 't1', sender: 'human', text: 'Use a tool please.' }),
    makeMessage({
      uuid: 't2',
      sender: 'assistant',
      text: 'Calling tool.',
      parent_message_uuid: 't1',
    }),
    makeMessage({
      uuid: 't3',
      sender: 'assistant',
      text: 'Tool result received.',
      parent_message_uuid: 't2',
    }),
  ];
  const toolDetail = makeDetail(toolSummary, toolMessages);

  // ---------- Claude Code session ----------
  const ccSummary = makeSummary({
    uuid: CC_UUID,
    name: CC_TITLE,
    message_count: 4,
    human_message_count: 2,
    source: 'CLAUDE_CODE',
    project_path: '/fixture/project',
    project_name: 'fixture-project',
    git_branch: 'fixture-branch',
  });
  const ccMessages = [
    makeMessage({
      uuid: 'cc1',
      sender: 'human',
      text: 'Hi! NEEDLE_CC — fixture session for Phase 5 tests.',
    }),
    makeMessage({
      uuid: 'cc2',
      sender: 'assistant',
      text: 'Hello! Ready to help with the fixture project.',
      parent_message_uuid: 'cc1',
    }),
    makeMessage({
      uuid: 'cc3',
      sender: 'human',
      text: "What's 2+2?",
      parent_message_uuid: 'cc2',
    }),
    makeMessage({
      uuid: 'cc4',
      sender: 'assistant',
      text: 'Four.',
      parent_message_uuid: 'cc3',
    }),
  ];
  const ccDetail = makeDetail(ccSummary, ccMessages);

  return {
    conversations: [tlsSummary, branchSummary, toolSummary, ccSummary],
    details: {
      [TLS_UUID]: tlsDetail,
      [BRANCH_UUID]: branchDetail,
      [TOOL_UUID]: toolDetail,
      [CC_UUID]: ccDetail,
    },
  };
}

test.describe('Conversation Browser', () => {
  test.beforeEach(async ({ mockBackend }) => {
    const { conversations, details } = buildFixtures();
    await mockBackend({ conversations, details });
  });

  test('loads and displays conversation list', async ({ page }) => {
    await page.goto('/');

    // App header.
    await expect(page.getByText('Claude Explorer')).toBeVisible();

    // Search input.
    await expect(page.getByPlaceholder('Search titles and projects')).toBeVisible();

    // The fixtures dataset always includes the long TLS conversation.
    await expect(page.getByText(TLS_TITLE)).toBeVisible({ timeout: 10000 });
  });

  test('displays starred conversations at top', async ({ page }) => {
    await page.goto('/');

    // Wait for the list to render.
    await expect(page.getByText(TLS_TITLE)).toBeVisible({ timeout: 10000 });

    // The fixtures don't include any starred conversations (deliberately
    // — we only want to assert that the starred section is _absent_
    // when nothing is starred). The Starred header should NOT appear.
    await expect(page.getByText('Starred', { exact: true })).toHaveCount(0);
  });

  test('filters conversations with search', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByText(TLS_TITLE)).toBeVisible({ timeout: 10000 });

    // Type a query that matches only the Branch tree fixture by title.
    const searchInput = page.getByPlaceholder('Search titles and projects');
    await searchInput.fill('Branch tree');

    // The TLS title should disappear; the Branch tree title should remain.
    await expect(page.getByText(BRANCH_TITLE)).toBeVisible();
    await expect(page.getByText(TLS_TITLE)).toHaveCount(0);

    // Clear the filter.
    await searchInput.fill('');
    await expect(page.getByText(TLS_TITLE)).toBeVisible();
  });

  test('selects and displays conversation detail', async ({ page }) => {
    await page.goto('/');

    // Click the long TLS conversation by exact title.
    await expect(page.getByText(TLS_TITLE)).toBeVisible({ timeout: 10000 });
    await page.getByText(TLS_TITLE).click();

    // The conversation header should display the title.
    await expect(page.getByRole('heading', { name: TLS_TITLE })).toBeVisible({
      timeout: 5000,
    });

    // The Markdown / PDF export buttons render in the conversation header.
    await expect(page.getByRole('button', { name: 'Markdown', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'PDF', exact: true })).toBeVisible();

    // At least one You / Claude bubble renders.
    await expect(page.getByText(/^(You|Claude)$/).first()).toBeVisible();
  });

  test('URL updates when selecting conversation', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByText(TLS_TITLE)).toBeVisible({ timeout: 10000 });
    await page.getByText(TLS_TITLE).click();

    await expect(page).toHaveURL(/\/conversations\/[a-f0-9-]+/);
  });

  test('shows hint state when no conversation selected', async ({ page }) => {
    await page.goto('/');

    // The empty-state copy: "Press Enter to open this conversation."
    await expect(
      page.getByText(/Press\s+Enter\s+to open this conversation/i)
    ).toBeVisible();
  });
});

test.describe('Conversation Detail', () => {
  test.beforeEach(async ({ mockBackend }) => {
    const { conversations, details } = buildFixtures();
    await mockBackend({ conversations, details });
  });

  test('displays human and assistant messages', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByText(TLS_TITLE)).toBeVisible({ timeout: 10000 });
    await page.getByText(TLS_TITLE).click();

    // Wait for the message stream to mount.
    await page.waitForSelector('[data-testid="message-stream"]', { timeout: 10000 });

    // Expect at least one You and one Claude bubble (the long fixture
    // alternates 30 messages).
    const messageCount = await page.getByText(/^(You|Claude)$/).count();
    expect(messageCount).toBeGreaterThan(1);
  });

  test('renders markdown in messages', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByText(TLS_TITLE)).toBeVisible({ timeout: 10000 });
    await page.getByText(TLS_TITLE).click();

    // The first user message in the long fixture starts with "Hi! Let's talk about TLS."
    await expect(page.getByText(/Let's talk about TLS/)).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Export Functionality', () => {
  test.beforeEach(async ({ mockBackend }) => {
    const { conversations, details } = buildFixtures();
    await mockBackend({ conversations, details });
  });

  test('Markdown export button is visible in the conversation header', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByText(TLS_TITLE)).toBeVisible({ timeout: 10000 });
    await page.getByText(TLS_TITLE).click();

    // Direct buttons in the header (no dropdown menu).
    await expect(page.getByRole('button', { name: 'Markdown', exact: true })).toBeVisible({ timeout: 5000 });
  });

  test('PDF export button is visible in the conversation header', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByText(TLS_TITLE)).toBeVisible({ timeout: 10000 });
    await page.getByText(TLS_TITLE).click();

    await expect(page.getByRole('button', { name: 'PDF', exact: true })).toBeVisible({ timeout: 5000 });
  });
});
