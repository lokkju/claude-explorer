import { AlertTriangle } from 'lucide-react'
import { useWatcherHealth } from '@/hooks/useWatcherHealth'

/**
 * Phase 3 of PLANS/2026.05.26-watcher-install-detection.md.
 *
 * Persistent warning banner that surfaces when the supervised CC
 * image-cache watcher isn't installed. Reads /api/health/watcher
 * (polled every 5 min; refetched on window-focus). Renders nothing
 * while the query is loading or on error — we never want a
 * false-positive "watcher missing" flash.
 *
 * Why non-dismissible: per user direction on 2026-05-26, the banner
 * shows regardless of whether the conversation has observed missing
 * images. It's preventative, not reactive. A dismissed banner can
 * still mask an unbounded future loss; we'd rather one persistent
 * row of UI than a forgotten dismiss.
 *
 * The banner clears automatically as soon as the user runs
 * `claude-explorer install-watcher` and the next poll (≤5 min) or
 * window-focus refetch arrives. No backend restart required —
 * /api/health/watcher invalidates its module-level cache on every
 * call.
 *
 * Mount once at the top of the app shell (RootLayout). Renders
 * nothing when installed → flex container shrinks accordingly with
 * no layout jump, just like ConfigCorruptionBanner.
 */
export function WatcherMissingBanner() {
  const { data, isError, isLoading } = useWatcherHealth()

  // Graceful degrade: while loading OR on error OR when installed,
  // render nothing. Bidirectional pair anchors live in the test file
  // (renders-when-uninstalled vs absent-when-installed vs
  // absent-while-loading vs absent-on-error).
  if (isLoading || isError || !data || data.installed) {
    return null
  }

  return (
    <div
      data-testid="watcher-missing-banner"
      role="alert"
      aria-live="polite"
      className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400"
          aria-hidden="true"
        />
        <div className="flex-1 text-sm">
          <p className="font-medium">
            Image-cache watcher not installed — Claude Code screenshots may
            be permanently lost during backend downtime.
          </p>
          <p className="mt-1 text-xs">
            Run this once to install a supervised background watcher:
          </p>
          <pre className="mt-1 inline-block rounded bg-amber-100 px-2 py-1 font-mono text-xs dark:bg-amber-900/40">
            {data.install_command}
          </pre>
        </div>
      </div>
    </div>
  )
}
