import { cn } from '@/lib/utils'

/**
 * SessionPreludeAffordance — V1 polish (2026-05-12, council round 2).
 *
 * Renders a small muted button at the top of a CC conversation when the
 * backend reports `prelude_hidden_count > 0`. CC sessions that start with
 * one or more `/exit` slash commands have a "prelude" of synthetic
 * `Session: /exit` markers (each one folded together with CC's canned
 * `"No response requested."` reply) BEFORE the first real user turn.
 * Showing those markers raw at the top makes the conversation look like
 * it starts with confusing boilerplate — instead we hide them by default
 * and surface this affordance so the user can:
 *
 *   1. SEE that prelude markers exist (no silent erasure — see project
 *      MEMORY rule `feedback_no_silent_article_softening`),
 *   2. CLICK to reveal them inline at the top of the stream.
 *
 * The component renders nothing when `hiddenCount <= 0` (i.e. on every
 * Desktop conversation and every CC conversation that doesn't start with
 * an /exit prelude), so it's safe to mount unconditionally.
 *
 * Test hooks:
 *   - `data-testid="session-prelude-affordance"` — Playwright settle target.
 *   - `data-prelude-count="<N>"` — assert the rendered count without
 *      parsing the visible copy.
 *   - `data-expanded="true|false"` — assert toggle state.
 */
interface SessionPreludeAffordanceProps {
  hiddenCount: number
  expanded: boolean
  onToggle: () => void
  className?: string
}

export function SessionPreludeAffordance({
  hiddenCount,
  expanded,
  onToggle,
  className,
}: SessionPreludeAffordanceProps) {
  if (hiddenCount <= 0) return null

  // Singular vs plural copy. "1 earlier /exit run" reads naturally; the
  // generic plural for higher counts. The verb `(show)` / `(hide)` is
  // wrapped in parentheses so it visually subordinates to the count.
  const runLabel = hiddenCount === 1 ? '1 earlier /exit run' : `${hiddenCount} earlier /exit runs`
  const action = expanded ? 'hide' : 'show'

  return (
    <button
      type="button"
      data-testid="session-prelude-affordance"
      data-prelude-count={hiddenCount}
      data-expanded={expanded ? 'true' : 'false'}
      aria-expanded={expanded}
      onClick={onToggle}
      className={cn(
        // Muted, italic, small — visually subordinate so it doesn't compete
        // with the first real bubble. Hover bumps contrast so the user can
        // see it's clickable.
        'text-xs italic text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200',
        'transition-colors',
        // Keep it within the centered max-w-3xl messages column.
        'self-start',
        className,
      )}
    >
      Session prelude: {runLabel} ({action})
    </button>
  )
}
