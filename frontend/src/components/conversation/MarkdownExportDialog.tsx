/**
 * MarkdownExportDialog (Phase 7) — pop a chooser dialog when the user
 * clicks the "Markdown" button on the conversation header.
 *
 * Three modes:
 *   - inline:            single .md file (no zip)
 *   - bundle-commonmark: zip with images/ + attachments/ + conversation.md
 *                        using CommonMark links
 *   - bundle-obsidian:   same shape as commonmark but with Obsidian
 *                        wikilink syntax
 *
 * The user's last selected mode is stored under the
 * `markdownExportMode` key via `usePreferences` (server-side, with
 * the standard dual-read fallback). An optional "Save as default"
 * checkbox writes the choice through `setMarkdownExportMode` when the
 * user clicks Download. Without the checkbox the choice is local to
 * this dialog session only.
 *
 * The PDF button on the header is intentionally NOT routed through
 * this dialog — it stays a single-click direct download.
 */

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useSettings } from '@/contexts/SettingsContext'
import { usePreferences } from '@/hooks/usePreferences'
import { api } from '@/lib/api'
import { downloadBlob, sanitizeFilename } from '@/lib/utils'

export type MarkdownExportMode =
  | 'inline'
  | 'bundle-commonmark'
  | 'bundle-obsidian'

// Runtime predicate — Radix `RadioGroup.onValueChange` hands callers a
// `string`, not the narrow MarkdownExportMode union. Used by the
// onValueChange callback below to reject unknown values (defense in
// depth — the RadioGroupItem children below only ever supply known
// values, so the guard catches drift, not normal usage).
const MARKDOWN_EXPORT_MODES: readonly MarkdownExportMode[] = [
  'inline',
  'bundle-commonmark',
  'bundle-obsidian',
]

// eslint-disable-next-line react-refresh/only-export-components -- safe: helper predicate co-located with the dialog component that consumes it. HMR fast refresh falls back to a full reload for this file; no runtime impact.
export function isMarkdownExportMode(v: unknown): v is MarkdownExportMode {
  return (
    typeof v === 'string' &&
    (MARKDOWN_EXPORT_MODES as readonly string[]).includes(v)
  )
}

interface MarkdownExportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  conversationUuid: string
  conversationName: string
}

export function MarkdownExportDialog({
  open,
  onOpenChange,
  conversationUuid,
  conversationName,
}: MarkdownExportDialogProps) {
  const { showToolCalls } = useSettings()
  const [storedMode, setStoredMode] = usePreferences<MarkdownExportMode>(
    'markdownExportMode',
    'inline',
  )

  // Local copy of the radio selection so the user can audition a mode
  // (without persisting) before clicking Download. We seed from the
  // stored preference each time the dialog opens so reopening reflects
  // the current pre-selection.
  const [mode, setMode] = useState<MarkdownExportMode>(storedMode)
  const [saveAsDefault, setSaveAsDefault] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setMode(storedMode)
      setSaveAsDefault(false)
    }
  }, [open, storedMode])

  const handleDownload = async () => {
    if (busy) return
    setBusy(true)
    try {
      if (saveAsDefault) {
        setStoredMode(mode)
      }
      const safeName = sanitizeFilename(conversationName || 'conversation')
      if (mode === 'inline') {
        const response = await api.exportMarkdown(conversationUuid, showToolCalls)
        const blob = await response.blob()
        downloadBlob(blob, `${safeName}.md`)
      } else {
        const dialect = mode === 'bundle-obsidian' ? 'obsidian' : 'commonmark'
        const response = await api.exportMarkdownBundle(
          conversationUuid,
          showToolCalls,
          dialect,
        )
        const blob = await response.blob()
        downloadBlob(blob, `${safeName}.zip`)
      }
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="markdown-export-dialog">
        <DialogHeader>
          <DialogTitle>Markdown export</DialogTitle>
          <DialogDescription>
            Choose how to export this conversation as Markdown.
          </DialogDescription>
        </DialogHeader>

        <RadioGroup
          value={mode}
          onValueChange={(v) => {
            if (isMarkdownExportMode(v)) setMode(v)
          }}
          className="gap-3"
        >
          <label className="flex items-start gap-3 rounded border border-zinc-200 p-3 dark:border-zinc-800">
            <RadioGroupItem value="inline" id="md-mode-inline" className="mt-0.5" />
            <div className="flex flex-col">
              <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Inline
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                Single .md file. Images embedded inline or omitted.
              </span>
            </div>
          </label>

          <label className="flex items-start gap-3 rounded border border-zinc-200 p-3 dark:border-zinc-800">
            <RadioGroupItem
              value="bundle-commonmark"
              id="md-mode-bundle-cm"
              className="mt-0.5"
            />
            <div className="flex flex-col">
              <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Bundle CommonMark
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                Zip with conversation.md, images/, attachments/. Standard
                Markdown links.
              </span>
            </div>
          </label>

          <label className="flex items-start gap-3 rounded border border-zinc-200 p-3 dark:border-zinc-800">
            <RadioGroupItem
              value="bundle-obsidian"
              id="md-mode-bundle-ob"
              className="mt-0.5"
            />
            <div className="flex flex-col">
              <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Bundle Obsidian
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                Same as CommonMark but uses Obsidian wikilink syntax.
              </span>
            </div>
          </label>
        </RadioGroup>

        <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-400 dark:border-zinc-600 dark:bg-zinc-900"
            checked={saveAsDefault}
            onChange={(e) => setSaveAsDefault(e.target.checked)}
          />
          <span>Save as default</span>
        </label>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button onClick={handleDownload} disabled={busy}>
            Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
