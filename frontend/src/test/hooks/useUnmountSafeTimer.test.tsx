/**
 * S5 T2d (2026-05-20) — `useUnmountSafeTimer` hook.
 *
 * Pins the contract the hook MUST satisfy:
 *
 *   1. After unmount, no pending callback fires.
 *   2. After unmount, no setState executes (even indirectly — proven by
 *      the absence of the timer firing).
 *   3. Calling `schedule` twice in quick succession cancels the first
 *      timer (only the second's callback fires).
 *   4. A scheduled callback fires after the requested delay if no
 *      unmount or re-schedule interrupts.
 *
 * These four cover the bidirectional pair: positive (callback fires
 * when expected) + negative (callback never fires when component
 * unmounts before delay).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import { useUnmountSafeTimer } from '../../hooks/useUnmountSafeTimer'

describe('useUnmountSafeTimer (S5 T2d)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires the scheduled callback after the requested delay', () => {
    const cb = vi.fn()
    const { result } = renderHook(() => useUnmountSafeTimer())

    act(() => {
      result.current(cb, 1000)
    })
    expect(cb).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('does NOT fire the callback if the component unmounts first', () => {
    const cb = vi.fn()
    const { result, unmount } = renderHook(() => useUnmountSafeTimer())

    act(() => {
      result.current(cb, 1000)
    })
    expect(cb).not.toHaveBeenCalled()

    unmount()

    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(cb).not.toHaveBeenCalled()
  })

  it('cancels the first timer when schedule is called again', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { result } = renderHook(() => useUnmountSafeTimer())

    act(() => {
      result.current(first, 1000)
    })
    act(() => {
      result.current(second, 500)
    })

    act(() => {
      vi.advanceTimersByTime(2000)
    })

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('clears the most recent timer on unmount (re-schedule case)', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { result, unmount } = renderHook(() => useUnmountSafeTimer())

    act(() => {
      result.current(first, 1000)
    })
    act(() => {
      result.current(second, 1000)
    })

    unmount()

    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(first).not.toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()
  })
})
