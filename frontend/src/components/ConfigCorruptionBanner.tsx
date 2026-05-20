import { AlertTriangle } from 'lucide-react'
import { useConfig } from '@/hooks/useConversations'

/**
 * Layer 3 of PLANS/2026.05.18-config-corruption-safe-mode.md.
 *
 * Persistent (non-dismissible) warning banner that surfaces when the
 * backend reports `config_corrupt_reason` on `/api/config`.
 *
 * Why non-dismissible: while `config_corrupt_reason` is set the
 * backend's Layer-2 writer gate refuses every mutation (fetch,
 * bookmarks, preferences) with HTTP 503 to avoid silently orphaning
 * the user's archive at a wrong-default `data_dir`. Letting the user
 * dismiss the banner would silently re-enable that failure mode (the
 * 503s would still happen, just without the explanation). The banner
 * clears automatically when the user repairs `~/.claude-explorer/
 * config.json` — the backend's per-request lru_cache clear on
 * `/api/config` plus this component's `useConfig` polling
 * (`staleTime: 60s`, `refetchOnWindowFocus: true`) close the loop
 * within ~1 RTT of the user tabbing back from their editor.
 *
 * Mount once near the top of the app shell so the banner renders
 * above all routed content (it pushes layout via standard document
 * flow rather than overlaying — the user can still navigate the
 * archive while it's visible).
 */
export function ConfigCorruptionBanner() {
  const { data } = useConfig()
  const reason = data?.config_corrupt_reason

  if (!reason) {
    // Bidirectional pair anchor: a missing reason means EITHER the
    // backend hasn't responded yet OR the config parsed cleanly. In
    // both cases we render nothing — surfacing an "all good" banner
    // would compete with the corruption signal for attention.
    return null
  }

  return (
    <div
      data-testid="config-corruption-banner"
      role="alert"
      aria-live="assertive"
      className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400"
          aria-hidden="true"
        />
        <div className="flex-1 text-sm">
          <p className="font-medium">
            Config file is corrupt — writes are disabled until you fix it.
          </p>
          <p className="mt-1 break-words text-xs opacity-80">
            Reason: <code className="font-mono">{reason}</code>
          </p>
          <p className="mt-1 text-xs">
            Fix or remove{' '}
            <code className="font-mono">~/.claude-explorer/config.json</code>;
            the banner will clear automatically once the file parses.
          </p>
        </div>
      </div>
    </div>
  )
}
