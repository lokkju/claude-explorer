import { useCallback, useEffect, useRef, useState } from 'react'

export interface UseCopyFeedbackResult {
  /** True while the "Copied" indicator should be shown. Flips to false
   *  automatically `timeoutMs` after the most recent `trigger()` call. */
  copied: boolean
  /** Flip `copied` to true and schedule a reset after `timeoutMs`. Safe
   *  to call multiple times — each call clears the previous timer
   *  before re-arming, so rapid clicks coalesce into a single 2s
   *  display window starting from the latest click. */
  trigger: () => void
}

/**
 * Shared copy-feedback ("Copied" → "" after 2s) state machine.
 *
 * Hunt #11 (timer lifecycle): the setTimeout must be cleared on
 * unmount. Otherwise a user who hits Copy and then switches
 * conversation within 2s drives the timer callback at a dead
 * component. React 18+ silently no-ops the setState, but the timer +
 * closure leak in memory, and any future refactor that resurrects the
 * warning would surface a real bug.
 *
 * Implementation invariants pinned by `MessageBubble.test.tsx` ("timer
 * cleanup on unmount") and `useCopyFeedback.test.ts`:
 *   1. timer id is stored in a useRef so the cleanup effect sees the
 *      latest id without re-running on every render.
 *   2. trigger() clears the previous timer BEFORE re-arming (rapid
 *      clicks don't leak the older timer).
 *   3. unmount cleanup clears any pending timer.
 *
 * Default 2000ms matches the prior in-line implementations in
 * MessageBubbleImpl and ToolUseBlock that this hook replaces.
 */
export function useCopyFeedback(timeoutMs = 2000): UseCopyFeedbackResult {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  const trigger = useCallback(() => {
    setCopied(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setCopied(false), timeoutMs)
  }, [timeoutMs])

  return { copied, trigger }
}
