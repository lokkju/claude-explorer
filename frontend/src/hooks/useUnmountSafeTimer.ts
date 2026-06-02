import { useEffect, useRef } from 'react'

/**
 * Unmount-safe replacement for raw ``setTimeout`` in components.
 *
 * Returns a ``schedule(fn, ms)`` function. Each call cancels any
 * previously-scheduled callback registered through the same hook
 * instance, then arms a new timer. On component unmount, any still-
 * pending timer is cleared automatically.
 *
 * Two failure modes this defeats:
 *   1. **setState-after-unmount**: a click handler stores a ``setTimeout``
 *      that later calls ``setState`` on a component that has since
 *      unmounted. React 18 warns; React 19 with stricter guarantees may
 *      surface harder errors. The cleanup effect cancels the pending
 *      timer before unmount completes.
 *   2. **Race on rapid re-clicks**: a user clicking "Copy" three times
 *      in quick succession previously armed three independent timers,
 *      each fighting to clear the "copied" flag at staggered
 *      intervals. ``schedule`` cancels the prior handle so only the
 *      most-recent call is in flight.
 *
 * Use one hook instance per logical timer (one per copy-feedback flag,
 * for example). Sharing a single hook across unrelated timers would
 * make the "cancel previous on schedule" behavior interfere across
 * unrelated state.
 *
 * S5 T2d (2026-05-20): pinned by
 * ``frontend/src/test/hooks/useUnmountSafeTimer.test.tsx``.
 */
export function useUnmountSafeTimer(): (fn: () => void, ms: number) => void {
  const handleRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // oxlint-disable-next-line react-doctor/exhaustive-deps -- Cleanup deliberately reads `handleRef.current` at unmount time. Capturing at effect-run would snapshot `null` (this effect runs on mount before any timer is scheduled). The intent on unmount is "cancel whichever timer is currently armed," which requires the live ref read.
  useEffect(() => {
    return () => {
      if (handleRef.current !== null) {
        clearTimeout(handleRef.current)
        handleRef.current = null
      }
    }
  }, [])

  return (fn: () => void, ms: number) => {
    if (handleRef.current !== null) {
      clearTimeout(handleRef.current)
    }
    handleRef.current = setTimeout(() => {
      handleRef.current = null
      fn()
    }, ms)
  }
}
