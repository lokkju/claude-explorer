/**
 * Regression: CompactMarker must auto-expand when its message_uuid is
 * the target of a search-hit highlight.
 *
 * User report (2026-05-22): clicking a search result whose match
 * lives inside a /compact bubble's summary text scrolled the
 * conversation to the marker — but the marker stayed COLLAPSED, so
 * the user couldn't see the matched content. The compact bubble
 * needs to expand when it receives search-hit focus.
 *
 * User-observable contract (per CLAUDE-TESTING §5.13):
 *   - `forceOpen` prop transitions false → true → marker panel
 *     becomes visible (summary_text rendered).
 *   - `forceOpen` stays false (default) → marker panel stays
 *     hidden until the user clicks the pill themselves.
 *   - Marker outer div carries `data-message-uuid` so
 *     ConversationPage's existing highlight effect (querySelector
 *     on `[data-message-uuid=...]`) finds compact markers too.
 *
 * Three tests pin this — two are the bidirectional pair, one is
 * the DOM-attribute precondition for the existing highlight effect
 * to work.
 */

import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CompactMarker } from '@/components/conversation/CompactMarker'
import type { CompactMarker as CompactMarkerType } from '@/lib/types'

const baseMarker: CompactMarkerType = {
  message_uuid: 'marker-uuid-1',
  summary_text: 'NEEDLE_SUMMARY_TEXT inside the compact summary body',
  timestamp: '2026-05-22T12:00:00Z',
  kind: 'manual',
  user_prompt: 'NEEDLE_USER_PROMPT what the user asked',
}

const noop = () => undefined

describe('CompactMarker — forceOpen for search-hit highlight (2026-05-22)', () => {
  it('forceOpen=true expands the marker panel on mount (summary text visible)', () => {
    render(
      <CompactMarker
        marker={baseMarker}
        index={0}
        total={1}
        isActive={false}
        onPrev={noop}
        onNext={noop}
        forceOpen={true}
      />,
    )
    // Panel must render → summary_text is visible.
    expect(screen.getByText(/NEEDLE_SUMMARY_TEXT/)).toBeInTheDocument()
  })

  it('forceOpen=false (default) keeps the marker collapsed', () => {
    render(
      <CompactMarker
        marker={baseMarker}
        index={0}
        total={1}
        isActive={false}
        onPrev={noop}
        onNext={noop}
      />,
    )
    // The pill is visible (always), but the panel summary text is NOT.
    expect(screen.queryByText(/NEEDLE_SUMMARY_TEXT/)).not.toBeInTheDocument()
  })

  it('forceOpen flipped false → true AFTER mount expands the panel (re-render case)', () => {
    // The dynamic case: user clicks a search hit; the marker is
    // already mounted (collapsed). highlightMessageId changes →
    // ConversationPage re-renders → forceOpen flips false → true.
    // The marker MUST open. This is the case the on-mount test
    // alone can't catch — if forceOpen only seeded the initial
    // useState() value, a mid-life transition would do nothing.
    const { rerender } = render(
      <CompactMarker
        marker={baseMarker}
        index={0}
        total={1}
        isActive={false}
        onPrev={noop}
        onNext={noop}
        forceOpen={false}
      />,
    )
    expect(screen.queryByText(/NEEDLE_SUMMARY_TEXT/)).not.toBeInTheDocument()

    rerender(
      <CompactMarker
        marker={baseMarker}
        index={0}
        total={1}
        isActive={false}
        onPrev={noop}
        onNext={noop}
        forceOpen={true}
      />,
    )
    expect(screen.getByText(/NEEDLE_SUMMARY_TEXT/)).toBeInTheDocument()
  })

  it('clicking the pill after forceOpen=true collapses the panel (user-controllable)', () => {
    // Pin that forceOpen doesn't HOLD the panel open against user
    // intent. Once opened by the highlight effect, the user can
    // still collapse the marker by clicking the pill. Without this,
    // the panel would feel "stuck" open until the highlight URL
    // params get cleared.
    render(
      <CompactMarker
        marker={baseMarker}
        index={0}
        total={1}
        isActive={false}
        onPrev={noop}
        onNext={noop}
        forceOpen={true}
      />,
    )
    expect(screen.getByText(/NEEDLE_SUMMARY_TEXT/)).toBeInTheDocument()

    // Click the pill to toggle off.
    const pill = document.querySelector('[data-compact-marker-pill]') as HTMLElement
    fireEvent.click(pill)
    expect(screen.queryByText(/NEEDLE_SUMMARY_TEXT/)).not.toBeInTheDocument()
  })

  it('outer div carries data-message-uuid so the highlight effect can find it', () => {
    // The existing highlight effect in ConversationPage uses
    // document.querySelector('[data-message-uuid=...]') to locate the
    // scroll target. CompactMarker MUST surface this attribute on its
    // outer div so the same querySelector finds it without needing
    // a separate `[data-compact-marker=...]` lookup branch.
    const { container } = render(
      <CompactMarker
        marker={baseMarker}
        index={0}
        total={1}
        isActive={false}
        onPrev={noop}
        onNext={noop}
      />,
    )
    const el = container.querySelector(`[data-message-uuid="${baseMarker.message_uuid}"]`)
    expect(el, 'CompactMarker outer div must expose data-message-uuid for the search-highlight querySelector').not.toBeNull()
  })
})
