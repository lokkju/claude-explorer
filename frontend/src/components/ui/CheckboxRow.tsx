/**
 * CheckboxRow — checkbox with an implicit label, in the project-standard
 * "<label> wraps both input and visible text" WCAG-conformant shape.
 *
 * Collapses the repeated pattern across MarkdownExportDialog,
 * SettingsPage, Sidebar, and ConversationPage. Each prior site carried
 * its own `oxlint-disable-next-line react-doctor/control-has-associated-label`
 * rationale comment — encapsulating the suppression here means the
 * disable lives in one place.
 *
 * Phase 1 a11y rationale: nesting <input type="checkbox"> inside a
 * <label> with a sibling text node IS a WCAG-conformant implicit label
 * (no `htmlFor` / `id` round-trip required). Oxlint flags it because it
 * can't tell whether the sibling text is genuinely labeling the control.
 *
 * Extracted 2026-05-30 per PLANS/2026.05.30-STRICT-CODE-QUALITY-REVIEW.md
 * P1.3 (rubric F — canonical layer & reuse).
 */
import type { ReactNode } from 'react'

interface CheckboxRowProps {
  label: ReactNode
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  /** Optional className extension for the wrapping <label>. */
  className?: string
}

export function CheckboxRow({
  label,
  checked,
  onCheckedChange,
  className,
}: CheckboxRowProps) {
  const labelClass =
    className ??
    'flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300'
  return (
    <label className={labelClass}>
      {/* oxlint-disable-next-line react-doctor/control-has-associated-label -- WCAG-conformant implicit label: input nested in <label> with sibling text. */}
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-400 dark:border-zinc-600 dark:bg-zinc-900"
        checked={checked}
        onChange={(e) => onCheckedChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  )
}
