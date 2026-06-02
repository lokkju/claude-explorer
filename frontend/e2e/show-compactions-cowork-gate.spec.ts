/**
 * Pin the "Show Compactions" checkbox visibility for non-CC sessions
 * that have compaction markers.
 *
 * Bug observed 2026-05-26: The checkbox was gated on
 * ``isCC && hasCompactMarkers`` in ConversationPage.tsx. A Cowork
 * conversation with a compaction-summary message had no way to
 * toggle the marker visibility — the checkbox simply didn't render.
 *
 * Contract (this spec pins):
 *
 *   - Cowork session WITH compact_markers populated → checkbox shows.
 *   - Cowork session WITHOUT compact_markers → checkbox hidden
 *     (bidirectional pair — toggling a session that has no markers
 *     is meaningless, so the affordance correctly stays out of the UI).
 */
import { test, expect, makeSummary, makeMessage, makeDetail, withNetRetry } from './fixtures'


const COWORK_UUID = '00000000-0000-4000-8000-000000000c0c'


test.describe('Show Compactions checkbox for non-CC conversations', () => {
  test('renders when a Cowork session has compact_markers', async ({ page, mockBackend }) => {
    const summary = makeSummary({
      uuid: COWORK_UUID,
      name: 'Cowork session — JAV renamer',
      source: 'CLAUDE_COWORK',
    })
    const messages = [
      makeMessage({ uuid: 'msg-pre', sender: 'human', text: 'Hello, please help me research X.' }),
      makeMessage({
        uuid: 'msg-compact',
        sender: 'human',
        text:
          'This session is being continued from a previous conversation that ' +
          'ran out of context. The summary below covers the earlier portion of ' +
          'the conversation.\n\nSummary:\n1. Primary Request and Intent...',
      }),
      makeMessage({ uuid: 'msg-post', sender: 'assistant', text: 'Continuing.' }),
    ]
    const detail = makeDetail(summary, messages, {
      compact_markers: [
        {
          message_uuid: 'msg-compact',
          summary_text: messages[1].text,
          timestamp: '2026-05-26T10:00:00Z',
          kind: 'auto',
          user_prompt: null,
        },
      ],
    })

    await mockBackend({
      conversations: [summary],
      details: { [COWORK_UUID]: detail },
    })
    await withNetRetry(() => page.goto(`/conversations/${COWORK_UUID}`))

    // Settle: Show Tools is unconditional in the header — its presence
    // proves the header is fully rendered. Then assert Show Compactions
    // is ALSO present (pre-fix: this assertion would fail).
    await expect(page.getByTestId('header-show-tools-checkbox')).toBeVisible()
    await expect(
      page.getByTestId('header-show-compactions-checkbox'),
    ).toBeVisible()
  })

  test('hidden when a Cowork session has zero compact_markers', async ({ page, mockBackend }) => {
    const summary = makeSummary({
      uuid: COWORK_UUID,
      name: 'Plain Cowork session',
      source: 'CLAUDE_COWORK',
    })
    const messages = [
      makeMessage({ uuid: 'm1', sender: 'human', text: 'Plain question.' }),
      makeMessage({ uuid: 'm2', sender: 'assistant', text: 'Plain answer.' }),
    ]
    const detail = makeDetail(summary, messages)  // compact_markers defaults to []

    await mockBackend({
      conversations: [summary],
      details: { [COWORK_UUID]: detail },
    })
    await withNetRetry(() => page.goto(`/conversations/${COWORK_UUID}`))

    await expect(page.getByTestId('header-show-tools-checkbox')).toBeVisible()
    await expect(
      page.getByTestId('header-show-compactions-checkbox'),
    ).toHaveCount(0)
  })
})
