/**
 * Runtime-narrowing test for mapLiveProgressType (Hunt #2).
 *
 * FetchDialog mapped FetchProgress (7-member union, with 3 capture_*
 * variants) to LegacyFetchProgress (4-member union, no capture variants)
 * using `(liveProgress.type as LegacyFetchProgress['type'])`. The cast
 * was a runtime lie: if the backend ever emits a new SSE event type
 * not in either union, the cast lets garbage flow into the modal's
 * effectiveProgress.type, where downstream branches keyed on
 * `=== 'complete'` / `=== 'error'` silently miss-classify it.
 *
 * The fix exports mapLiveProgressType, which:
 *   - Maps the 3 capture_* types to 'progress' (existing semantic).
 *   - Returns the value when it's a known LegacyFetchProgress type.
 *   - Falls back to 'progress' for ANY unknown value.
 */

import { describe, it, expect } from 'vitest'
import { mapLiveProgressType } from '../../components/fetch/FetchDialog'

describe('mapLiveProgressType (Hunt #2)', () => {
  it('passes through the 4 legacy LegacyFetchProgress types', () => {
    expect(mapLiveProgressType('start')).toBe('start')
    expect(mapLiveProgressType('progress')).toBe('progress')
    expect(mapLiveProgressType('complete')).toBe('complete')
    expect(mapLiveProgressType('error')).toBe('error')
  })

  it("maps the 3 capture_* types to 'progress'", () => {
    expect(mapLiveProgressType('capture_start')).toBe('progress')
    expect(mapLiveProgressType('capture_waiting_login')).toBe('progress')
    expect(mapLiveProgressType('capture_done')).toBe('progress')
  })

  it("falls back to 'progress' for unknown future SSE event types", () => {
    // Simulate backend adding a new SSE event type the frontend doesn't
    // know about yet. The old cast would silently misclassify; the
    // guard treats it as a benign progress tick.
    expect(mapLiveProgressType('capture_warning' as never)).toBe('progress')
    expect(mapLiveProgressType('fatal' as never)).toBe('progress')
    expect(mapLiveProgressType('' as never)).toBe('progress')
  })
})
