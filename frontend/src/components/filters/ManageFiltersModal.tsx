import { useMemo, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useFilters } from '@/contexts/FilterContext'
import { useConversations } from '@/hooks/useConversations'
import {
  applyFilters,
  parseCommaPatterns,
  type Filter,
  type FilterMode,
  type FilterPolarity,
} from '@/lib/filterEngine'
import { cn } from '@/lib/utils'

interface ManageFiltersModalProps {
  isOpen: boolean
  onClose: () => void
}

interface DraftFilter {
  id?: string
  name: string
  patterns: string
  polarity: FilterPolarity
  mode: FilterMode
  pinned: boolean
}

const EMPTY_DRAFT: DraftFilter = {
  name: '',
  patterns: '',
  polarity: 'include',
  mode: 'glob',
  pinned: false,
}

export function ManageFiltersModal({ isOpen, onClose }: ManageFiltersModalProps) {
  const { filters, addFilter, updateFilter, removeFilter } = useFilters()
  const [draft, setDraft] = useState<DraftFilter | null>(null)

  const startCreate = () => setDraft({ ...EMPTY_DRAFT })
  const startEdit = (f: Filter) => setDraft({
    id: f.id,
    name: f.name,
    patterns: f.patterns.join(', '),
    polarity: f.polarity,
    mode: f.mode,
    pinned: f.pinned,
  })

  const cancelDraft = () => setDraft(null)

  const handleSave = () => {
    if (!draft) return
    const patterns = parseCommaPatterns(draft.patterns)
    const payload = {
      name: draft.name.trim() || 'Untitled filter',
      patterns,
      polarity: draft.polarity,
      mode: draft.mode,
      target: 'title' as const,
      pinned: draft.pinned,
    }
    if (draft.id) {
      updateFilter(draft.id, payload)
    } else {
      addFilter(payload)
    }
    setDraft(null)
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={(o) => { if (!o) { setDraft(null); onClose() } }}>
      <DialogContent className="sm:max-w-2xl" aria-label="Manage filters">
        <DialogHeader>
          <DialogTitle>Manage filters</DialogTitle>
        </DialogHeader>

        {!draft && (
          <>
            <div className="space-y-1 max-h-[40vh] overflow-y-auto">
              {filters.length === 0 && (
                <div className="text-sm text-zinc-500 py-4 text-center">
                  No filters yet. Add your first filter to start narrowing the sidebar.
                </div>
              )}
              {filters.map((f) => (
                <FilterRow key={f.id} filter={f} onEdit={() => startEdit(f)} onRemove={() => removeFilter(f.id)} />
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Close</Button>
              <Button onClick={startCreate}>
                <Plus className="h-4 w-4 mr-1" />
                Add filter
              </Button>
            </DialogFooter>
          </>
        )}

        {draft && (
          <DraftForm
            draft={draft}
            onChange={(d) => setDraft(d)}
            onCancel={cancelDraft}
            onSave={handleSave}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function FilterRow({ filter, onEdit, onRemove }: { filter: Filter; onEdit: () => void; onRemove: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex-1 min-w-0">
        <div className="font-medium text-zinc-900 dark:text-zinc-100">{filter.name}</div>
        <div className="text-xs text-zinc-500">
          {filter.polarity} · {filter.mode} · {filter.patterns.join(', ') || '(no patterns)'}
          {filter.pinned && ' · pinned'}
        </div>
      </div>
      <Button variant="ghost" size="sm" onClick={onEdit} aria-label={`Edit ${filter.name}`}>
        <Pencil className="h-3 w-3" />
      </Button>
      <Button variant="ghost" size="sm" onClick={onRemove} aria-label={`Delete ${filter.name}`}>
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  )
}

interface DraftFormProps {
  draft: DraftFilter
  onChange: (d: DraftFilter) => void
  onCancel: () => void
  onSave: () => void
}

function DraftForm({ draft, onChange, onCancel, onSave }: DraftFormProps) {
  const { data: conversations } = useConversations({})

  const previewFilter: Filter = useMemo(() => ({
    id: draft.id ?? 'preview',
    name: draft.name || 'preview',
    patterns: parseCommaPatterns(draft.patterns),
    polarity: draft.polarity,
    mode: draft.mode,
    target: 'title',
    pinned: draft.pinned,
  }), [draft])

  const previewMatches = useMemo(() => {
    if (!conversations) return []
    if (previewFilter.patterns.length === 0) return []
    return applyFilters(conversations, [previewFilter])
  }, [conversations, previewFilter])

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300" htmlFor="filter-name">
          Filter name
        </label>
        <Input
          id="filter-name"
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          placeholder="Frontend work"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300" htmlFor="filter-patterns">
          Patterns (comma-separated)
        </label>
        <Input
          id="filter-patterns"
          value={draft.patterns}
          onChange={(e) => onChange({ ...draft, patterns: e.target.value })}
          placeholder="*react*, *typescript*"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Polarity</span>
          <div className="flex gap-2">
            {(['include', 'exclude'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => onChange({ ...draft, polarity: p })}
                className={cn(
                  'rounded border px-3 py-1 text-sm',
                  draft.polarity === p
                    ? 'border-blue-500 bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200'
                    : 'border-zinc-300 dark:border-zinc-700'
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Mode</span>
          <div className="flex gap-2">
            {(['glob', 'regex'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onChange({ ...draft, mode: m })}
                className={cn(
                  'rounded border px-3 py-1 text-sm',
                  draft.mode === m
                    ? 'border-blue-500 bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200'
                    : 'border-zinc-300 dark:border-zinc-700'
                )}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm" htmlFor="filter-pinned">
        <input
          id="filter-pinned"
          type="checkbox"
          checked={draft.pinned}
          onChange={(e) => onChange({ ...draft, pinned: e.target.checked })}
          className="h-4 w-4"
        />
        Pin (auto-applies on every page load)
      </label>

      <div className="rounded border border-zinc-200 p-3 text-xs dark:border-zinc-800">
        <div className="mb-1 font-medium text-zinc-700 dark:text-zinc-300">
          {previewFilter.patterns.length === 0
            ? 'Enter at least one pattern to preview matches.'
            : `${previewMatches.length} match${previewMatches.length === 1 ? '' : 'es'}`}
        </div>
        {previewMatches.slice(0, 5).map((c) => (
          <div key={c.uuid} className="truncate text-zinc-600 dark:text-zinc-400">{c.name}</div>
        ))}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={onSave}>Save</Button>
      </DialogFooter>
    </div>
  )
}
