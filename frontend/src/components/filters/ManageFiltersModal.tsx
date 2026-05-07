/**
 * Manage Filters modal — CF1 interim state.
 *
 * The full two-pane atom + group editor lands in CF2. For now this modal
 * only edits atom filters under the new schema (no Pin checkbox, no
 * group editor). The "Group editor coming soon." note flags the gap.
 */

import { useMemo, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useFilters } from '@/contexts/FilterContext'
import { useConversations } from '@/hooks/useConversations'
import {
  patternMatches,
  parseCommaPatterns,
  type AtomFilter,
  type FilterMode,
  type FilterPolarity,
  type FilterNode,
} from '@/lib/filterEngine'
import { cn } from '@/lib/utils'

interface ManageFiltersModalProps {
  isOpen: boolean
  onClose: () => void
}

interface DraftAtom {
  id?: string
  name: string
  patterns: string
  polarity: FilterPolarity
  mode: FilterMode
}

const EMPTY_DRAFT: DraftAtom = {
  name: '',
  patterns: '',
  polarity: 'include',
  mode: 'glob',
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return 'flt-' + Math.random().toString(36).slice(2, 10)
}

export function ManageFiltersModal({ isOpen, onClose }: ManageFiltersModalProps) {
  const { filtersState, addNode, updateNode, removeNode } = useFilters()
  const [draft, setDraft] = useState<DraftAtom | null>(null)

  const allNodes = Object.values(filtersState.nodes)
  // Atom-only list for the interim modal. Groups are read-only here until CF2.
  const atomNodes = allNodes.filter((n): n is AtomFilter => n.type === 'atom')
  const groupNodes = allNodes.filter((n) => n.type === 'group')

  const startCreate = () => setDraft({ ...EMPTY_DRAFT })
  const startEdit = (f: AtomFilter) =>
    setDraft({
      id: f.id,
      name: f.name,
      patterns: f.patterns.join(', '),
      polarity: f.polarity,
      mode: f.mode,
    })

  const cancelDraft = () => setDraft(null)

  const handleSave = () => {
    if (!draft) return
    const patterns = parseCommaPatterns(draft.patterns)
    if (draft.id) {
      const partial: Partial<AtomFilter> = {
        name: draft.name.trim() || 'Untitled filter',
        patterns,
        polarity: draft.polarity,
        mode: draft.mode,
      }
      updateNode(draft.id, partial as Partial<FilterNode>)
    } else {
      const node: AtomFilter = {
        type: 'atom',
        id: newId(),
        name: draft.name.trim() || 'Untitled filter',
        enabled: true,
        patterns,
        polarity: draft.polarity,
        mode: draft.mode,
        target: 'title',
      }
      addNode(node)
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
            <div className="text-xs text-zinc-500">Group editor coming soon.</div>
            <div className="space-y-1 max-h-[40vh] overflow-y-auto">
              {atomNodes.length === 0 && groupNodes.length === 0 && (
                <div className="text-sm text-zinc-500 py-4 text-center">
                  No filters yet. Add your first filter to start narrowing the sidebar.
                </div>
              )}
              {atomNodes.map((f) => (
                <FilterRow
                  key={f.id}
                  filter={f}
                  onEdit={() => startEdit(f)}
                  onRemove={() => removeNode(f.id)}
                />
              ))}
              {groupNodes.map((g) => (
                <div
                  key={g.id}
                  className="flex items-center justify-between gap-2 rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900/40"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-zinc-900 dark:text-zinc-100">{g.name}</div>
                    <div className="text-xs text-zinc-500">
                      group · {g.type === 'group' ? `${g.match} of` : ''} {g.type === 'group' ? `${g.childIds.length} member${g.childIds.length === 1 ? '' : 's'}` : ''}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => removeNode(g.id)} aria-label={`Delete ${g.name}`}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
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

function FilterRow({
  filter,
  onEdit,
  onRemove,
}: {
  filter: AtomFilter
  onEdit: () => void
  onRemove: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex-1 min-w-0">
        <div className="font-medium text-zinc-900 dark:text-zinc-100">{filter.name}</div>
        <div className="text-xs text-zinc-500">
          {filter.polarity} · {filter.mode} · {filter.patterns.join(', ') || '(no patterns)'}
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
  draft: DraftAtom
  onChange: (d: DraftAtom) => void
  onCancel: () => void
  onSave: () => void
}

function DraftForm({ draft, onChange, onCancel, onSave }: DraftFormProps) {
  const { data: conversations } = useConversations({})

  const previewPatterns = useMemo(() => parseCommaPatterns(draft.patterns), [draft.patterns])

  const previewMatches = useMemo(() => {
    if (!conversations) return []
    if (previewPatterns.length === 0) return []
    return conversations.filter((c) => {
      const hit = previewPatterns.some((p) => patternMatches(c.name, p, draft.mode))
      return draft.polarity === 'include' ? hit : !hit
    })
  }, [conversations, previewPatterns, draft.polarity, draft.mode])

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

      <div className="rounded border border-zinc-200 p-3 text-xs dark:border-zinc-800">
        <div className="mb-1 font-medium text-zinc-700 dark:text-zinc-300">
          {previewPatterns.length === 0
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
