/**
 * Session-level registry that tracks how many times each image URL has
 * failed to load. Once an URL crosses the failure threshold, callers
 * should render a fallback tile instead of issuing another request.
 *
 * Why module-level (not React state)?
 *   The per-component `retried`/`errored` state in MessageBubble resets
 *   on remount (scrolling out of viewport, navigating between
 *   conversations, virtualized lists). Without a session-level
 *   tombstone, the same dead image re-fetches endlessly. The user
 *   reported this as a real problem in V1 polish.
 *
 * Why useSyncExternalStore?
 *   When `recordFailure` pushes a URL over the threshold while OTHER
 *   instances of that URL are mounted (e.g., the same image referenced
 *   in multiple message bubbles), those siblings need to re-render and
 *   show the fallback too. The store + subscribe pattern handles this
 *   cleanly without prop-drilling or context.
 *
 * Why session-only (no localStorage)?
 *   Failures are often transient (Wi-Fi drop, claude.ai rate limit). A
 *   reload should give every URL a fresh chance. If the URL is truly
 *   gone, the failure count rebuilds quickly under normal use.
 */

export const DEFAULT_IMAGE_FAILURE_THRESHOLD = 10

const _failures = new Map<string, number>()
const _listeners = new Set<() => void>()

function _notify(): void {
  for (const listener of _listeners) {
    try {
      listener()
    } catch {
      // Swallow — never let one bad subscriber break others.
    }
  }
}

/**
 * Record a failure for ``url``. Returns the new failure count.
 * Trips the threshold notification when count crosses the boundary
 * (so previously-mounted siblings re-render via useSyncExternalStore).
 */
export function recordImageFailure(
  url: string,
  threshold: number = DEFAULT_IMAGE_FAILURE_THRESHOLD,
): number {
  const prev = _failures.get(url) ?? 0
  const next = prev + 1
  _failures.set(url, next)
  // Only notify when the count crosses the threshold — avoids a render
  // storm on every individual failure.
  if (prev < threshold && next >= threshold) {
    _notify()
  }
  return next
}

/**
 * Returns true if ``url`` has failed at least ``threshold`` times this
 * session. Cheap O(1) lookup; safe to call on every render.
 */
export function isImageFailureTombstoned(
  url: string,
  threshold: number = DEFAULT_IMAGE_FAILURE_THRESHOLD,
): boolean {
  return (_failures.get(url) ?? 0) >= threshold
}

/**
 * Get the current failure count for ``url`` (0 if never failed).
 * Exposed mainly for debugging / DevTools surface.
 */
export function getImageFailureCount(url: string): number {
  return _failures.get(url) ?? 0
}

/**
 * Subscribe / unsubscribe pair for useSyncExternalStore. Subscribers
 * are called when a URL crosses the threshold (NOT on every failure).
 */
export function subscribeImageFailures(listener: () => void): () => void {
  _listeners.add(listener)
  return () => {
    _listeners.delete(listener)
  }
}

/**
 * Reset registry — for tests. Production code should never call this.
 */
export function _clearImageFailureRegistryForTests(): void {
  _failures.clear()
  _listeners.clear()
}
