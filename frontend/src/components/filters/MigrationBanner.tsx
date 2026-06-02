/**
 * CF3 — One-time migration banner.
 *
 * Renders iff:
 *   filtersState._migratedV1 === true AND
 *   filtersState.migrationBannerDismissed !== true
 *
 * Placement: directly above the conversation list in the sidebar. The
 * conversation list lives in the sidebar in this app, so that's where
 * the user sees the result of the filter selection take effect — the
 * banner sits where the change is most visible.
 *
 * Persistence: dismiss writes `migrationBannerDismissed: true` into the
 * same `filters` blob via `dismissMigrationBanner()`, which routes
 * through usePreferences (server PATCH + localStorage mirror). The
 * sentinel and the dismiss flag travel together so the on-disk state is
 * cohesive.
 */

import { X } from 'lucide-react'
import { useFilters } from '@/contexts/FilterContext'

export function MigrationBanner() {
  const { filtersState, dismissMigrationBanner } = useFilters()

  if (!filtersState._migratedV1) return null
  if (filtersState.migrationBannerDismissed) return null

  // Phase 1 a11y: role="status" is correct for a non-modal state-change
  // banner that contains a dismiss button. React Doctor's prefer-tag-
  // over-role suggests <output>, but <output> is a form-associated
  // element for computed results; wrong semantic fit. Suppress.
  return (
    /* react-doctor-disable-next-line react-doctor/prefer-tag-over-role */
    <div
      role="status"
      aria-label="Filter update"
      data-testid="filters-migration-banner"
      className="mx-4 mb-2 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
    >
      <div className="min-w-0 flex-1 leading-relaxed">
        Filters are now composable. Your previously-pinned filters are
        grouped under <strong>Default (migrated)</strong>, your active
        filter. Click <em>Manage filters</em> to review.
      </div>
      <button
        type="button"
        onClick={dismissMigrationBanner}
        aria-label="Dismiss migration banner"
        data-testid="filters-migration-banner-dismiss"
        className="-mr-1 -mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-amber-700 hover:bg-amber-100 hover:text-amber-900 dark:text-amber-200 dark:hover:bg-amber-900 dark:hover:text-amber-50"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
