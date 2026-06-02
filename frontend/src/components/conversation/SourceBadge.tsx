/**
 * SourceBadge — single render site for the conversation-source indicator.
 *
 * Collapses the three-way ternary that previously lived in both
 * `ConversationPage.tsx` (under the conversation title) and
 * `ConversationList.tsx` (in the sidebar list row footer). Two variants
 * cover the existing surfaces:
 *
 *   - `header`: full <Badge> with icon + label text ("Code" / "Cowork" /
 *     "Desktop"). Used at ConversationPage.tsx:1125-1140.
 *   - `row`:    bare <span title="..."><Icon /></span>. Used at
 *     ConversationList.tsx:813-820. The sidebar filter dropdown
 *     (Sidebar.tsx) uses a parallel <SelectItem> with a different a11y
 *     shape; that surface stays separate by design.
 *
 * The source → icon + color map lives ONCE in `SOURCE_PRESETS` below.
 * Adding a new source (or renaming, or recoloring) is a single-file
 * change instead of the previous three-file diff.
 *
 * Extracted 2026-05-30 per PLANS/2026.05.30-STRICT-CODE-QUALITY-REVIEW.md
 * P1.2 (rubric F — canonical layer & reuse).
 */
import { Terminal, Sparkles, MessageSquare, type LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { ConversationSource } from '@/lib/types'

interface SourcePreset {
  Icon: LucideIcon
  label: string         // header-variant text
  title: string         // row-variant title attribute (hover tooltip)
  // Tailwind class fragments split per variant. We keep header's
  // bg/text/dark- triple separate from row's flat text-* color because
  // the visual languages diverge.
  headerClasses: string
  rowIconClass: string
}

// "Desktop" (CLAUDE_AI) doubles as the fallback for unknown sources —
// the runtime should never hit an unknown source under normal operation,
// but a backend that adds a new enum value before the frontend ships an
// update should degrade gracefully rather than render nothing.
const DESKTOP_PRESET: SourcePreset = {
  Icon: MessageSquare,
  label: 'Desktop',
  title: 'Claude Desktop',
  headerClasses:
    'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  rowIconClass: 'text-blue-500',
}

const SOURCE_PRESETS: Record<ConversationSource, SourcePreset> = {
  CLAUDE_CODE: {
    Icon: Terminal,
    label: 'Code',
    title: 'Claude Code',
    headerClasses:
      'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
    rowIconClass: 'text-green-500',
  },
  CLAUDE_COWORK: {
    Icon: Sparkles,
    label: 'Cowork',
    title: 'Claude Cowork',
    headerClasses:
      'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
    rowIconClass: 'text-purple-500',
  },
  CLAUDE_AI: DESKTOP_PRESET,
}

interface SourceBadgeProps {
  source: ConversationSource
  variant: 'header' | 'row'
}

export function SourceBadge({ source, variant }: SourceBadgeProps) {
  const preset = SOURCE_PRESETS[source] ?? DESKTOP_PRESET
  const { Icon } = preset

  if (variant === 'header') {
    return (
      <Badge
        variant="secondary"
        className={`flex items-center gap-1 ${preset.headerClasses}`}
      >
        <Icon className="h-3 w-3" />
        {preset.label}
      </Badge>
    )
  }

  // row variant
  return (
    <span title={preset.title}>
      <Icon className={`h-3 w-3 ${preset.rowIconClass}`} />
    </span>
  )
}
