/**
 * Phase 3 of PLANS/2026.05.26-watcher-install-detection.md.
 *
 * Polls /api/health/watcher every 5 minutes plus on window-focus so a
 * user who runs `claude-explorer install-watcher` while the tab is in
 * the background sees the banner clear within ~1 RTT of tabbing back.
 * The backend endpoint invalidates its module-level cache on every
 * call, so a refetch always sees current state.
 */
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export function useWatcherHealth() {
  return useQuery({
    queryKey: ['watcher-health'],
    queryFn: ({ signal }) => api.getWatcherHealth(signal),
    // 5 min poll matches the plan's design target. Cheap on the
    // backend (one subprocess call per request, ~5ms on macOS).
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
    // Network errors must NOT auto-render the banner. The hook's
    // consumer (WatcherMissingBanner) gates on `data?.installed === false`,
    // so an undefined `data` on error falls through to "render nothing".
    retry: 1,
  })
}
