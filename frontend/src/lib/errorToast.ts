// Bug C: Error toasts must remain visible long enough for the user to read them.
//
// Real-world bug: a brief refresh failure popped a `toast.error` that
// disappeared in <5s. Sonner's default error duration is variable (often
// 4s); never let it pick. This wrapper enforces:
//   - Non-sticky errors: minimum 8s.
//   - Sticky errors (TERMINAL / AUTH): never auto-dismiss.
//
// All call sites that previously used `toast.error(message)` directly
// should migrate to `errorToast(message, opts)`.

import { toast } from 'sonner'

const DEFAULT_ERROR_DURATION_MS = 8000

export interface ErrorToastOpts {
  /** Existing toast id to update in place. */
  id?: number | string
  /** Description text shown beneath the headline (also good for screen readers). */
  description?: string
  /** Sticky: never auto-dismiss. Used for TERMINAL and AUTH errors. */
  sticky?: boolean
  /** If provided, a Retry action button is shown that invokes this callback. */
  retry?: () => void
  /** If provided (and no retry), a Details action button is shown. */
  details?: () => void
}

/**
 * Show an error toast with a guaranteed minimum visible duration.
 *
 * Defaults to 8000ms; pass `sticky: true` for errors that require explicit
 * user dismissal (TERMINAL and AUTH classifications).
 *
 * The action button is inferred:
 *   - `retry` provided -> "Retry" button.
 *   - `details` provided -> "Details" button.
 *   - both unset -> no action.
 */
export function errorToast(message: string, opts: ErrorToastOpts = {}): number | string {
  const action = opts.retry
    ? { label: 'Retry', onClick: opts.retry }
    : opts.details
      ? { label: 'Details', onClick: opts.details }
      : undefined

  return toast.error(message, {
    id: opts.id,
    description: opts.description,
    duration: opts.sticky ? Infinity : DEFAULT_ERROR_DURATION_MS,
    action,
  }) as number | string
}

export const ERROR_TOAST_DEFAULT_DURATION_MS = DEFAULT_ERROR_DURATION_MS
