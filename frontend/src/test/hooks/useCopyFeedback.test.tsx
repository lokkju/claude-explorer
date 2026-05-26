/**
 * Council E4 (2026-05-22) — `useCopyFeedback` hook.
 *
 * Pins the Hunt #11 timer-lifecycle contract that the hook MUST satisfy
 * (independent of any component that consumes it):
 *
 *   1. `copied` starts false.
 *   2. `trigger()` flips `copied` to true.
 *   3. `copied` auto-resets to false after the requested `timeoutMs`
 *      (default 2000).
 *   4. Calling `trigger()` twice in quick succession cancels the first
 *      pending reset and re-arms a new one (rapid clicks coalesce into
 *      a single 2s window starting from the LAST click).
 *   5. After unmount, `clearTimeout` has been called with the pending
 *      timer id, so a dead-component `setCopied(false)` never fires.
 *
 * These five pin the bidirectional contract: positive (state flips +
 * auto-resets as expected) + negative (no leaked timer / no state
 * change on a dead component).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import { useCopyFeedback } from '../../hooks/useCopyFeedback'

describe('useCopyFeedback (council E4)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts with copied=false', () => {
    const { result } = renderHook(() => useCopyFeedback())
    expect(result.current.copied).toBe(false)
  })

  it('trigger() flips copied to true', () => {
    const { result } = renderHook(() => useCopyFeedback())
    act(() => {
      result.current.trigger()
    })
    expect(result.current.copied).toBe(true)
  })

  it('auto-resets copied to false after the default 2000ms window', () => {
    const { result } = renderHook(() => useCopyFeedback())

    act(() => {
      result.current.trigger()
    })
    expect(result.current.copied).toBe(true)

    // Just before the deadline, still true.
    act(() => {
      vi.advanceTimersByTime(1999)
    })
    expect(result.current.copied).toBe(true)

    // Crossing the deadline flips it.
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.copied).toBe(false)
  })

  it('respects a custom timeoutMs', () => {
    const { result } = renderHook(() => useCopyFeedback(500))

    act(() => {
      result.current.trigger()
    })
    expect(result.current.copied).toBe(true)

    act(() => {
      vi.advanceTimersByTime(499)
    })
    expect(result.current.copied).toBe(true)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.copied).toBe(false)
  })

  it('a second trigger() cancels the first pending reset (rapid clicks coalesce)', () => {
    const { result } = renderHook(() => useCopyFeedback())

    act(() => {
      result.current.trigger()
    })
    // 1500ms in, fire a SECOND trigger. The first 2000ms timer should
    // be cancelled and a new 2000ms timer should start from this point.
    act(() => {
      vi.advanceTimersByTime(1500)
      result.current.trigger()
    })
    expect(result.current.copied).toBe(true)

    // The original deadline (2000ms from the first call) would land at
    // t=2000. If the cancel didn't happen we'd flip to false here.
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(result.current.copied).toBe(true)

    // The NEW deadline is t=1500 + 2000 = t=3500. Advance to just
    // before that, still true.
    act(() => {
      vi.advanceTimersByTime(1499)
    })
    expect(result.current.copied).toBe(true)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.copied).toBe(false)
  })

  it('clears the pending timer on unmount (Hunt #11)', () => {
    // Spy on setTimeout/clearTimeout BEFORE the hook mounts so the
    // hook's calls are visible.
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')

    const { result, unmount } = renderHook(() => useCopyFeedback())

    act(() => {
      result.current.trigger()
    })

    // Find the 2000ms timer the hook scheduled.
    const ourCall = setTimeoutSpy.mock.calls.find((c) => c[1] === 2000)
    expect(
      ourCall,
      '2000ms copy-reset timer should have been scheduled',
    ).toBeDefined()
    const ourTimerId =
      setTimeoutSpy.mock.results[
        setTimeoutSpy.mock.calls.indexOf(ourCall!)
      ].value

    // Reset clearTimeout spy so we only see the unmount-time call.
    clearTimeoutSpy.mockClear()

    unmount()

    const clearedIds = clearTimeoutSpy.mock.calls.map((c) => c[0])
    expect(clearedIds).toContain(ourTimerId)
  })
})
