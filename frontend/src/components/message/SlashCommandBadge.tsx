import { cn } from '@/lib/utils'

/**
 * SlashCommandBadge — V1 polish round 3 (2026-05-12).
 *
 * Renders a small muted pill above the body of a Claude Code message
 * whose `slash_command` field is set. Paired with the args-preservation
 * change in `backend/claude_code_reader.py::_collapse_local_command_triplets`:
 * when a CC slash command carries `<command-args>...</command-args>`
 * (e.g. `/coding Double-check your plan with the LLM council.`), the
 * args body is surfaced as the marker's `text` AND the command name is
 * surfaced as a separate `slash_command` field. The frontend renders
 * the badge so the user can SEE which slash command produced the bubble
 * without losing the body text.
 *
 * Visual register:
 *   * Monospace font, uppercase, small (10px) — consistent with the
 *     "muted, italic, small" register the `SessionPreludeAffordance`
 *     established for CC-only chrome.
 *   * Subtle border + zinc-50 background so it sits visually BELOW the
 *     header (avatar/timestamp) and ABOVE the body, not competing with
 *     either.
 *   * `self-start` so it never stretches across the bubble width.
 *
 * Test hooks (mirror the prelude affordance pattern):
 *   * `data-testid="slash-command-badge"` — Playwright settle target.
 *   * `data-command="/coding"` — assert the command name without
 *     parsing the visible copy (which lowercases differently on
 *     different OSes / browsers).
 *
 * The caller (MessageBubble) is responsible for the `if (slash_command)`
 * render guard — this component assumes `command` is a non-empty
 * string. Rendering an empty badge would be a presentation bug.
 */
interface SlashCommandBadgeProps {
  command: string
  className?: string
}

export function SlashCommandBadge({ command, className }: SlashCommandBadgeProps) {
  return (
    <span
      data-testid="slash-command-badge"
      data-command={command}
      className={cn(
        // Pill shape, monospace for the leading-slash glyph readability.
        'inline-flex items-center self-start rounded-md border px-1.5 py-0.5',
        'font-mono text-[10px] uppercase tracking-wide',
        // Muted color so the badge subordinates to the body text.
        'border-zinc-200 bg-zinc-50 text-zinc-600',
        'dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
        className,
      )}
    >
      {command}
    </span>
  )
}
