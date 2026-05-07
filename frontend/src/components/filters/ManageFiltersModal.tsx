/**
 * Manage Filters modal — CF2 two-pane atom + group editor.
 *
 * Layout:
 *   [Manage filters]                                     [+ New filter]
 *   ┌──────────────────────┬──────────────────────────────────────┐
 *   │ Search...            │ Editing: <name input>                 │
 *   │  Filter A   [Atom]   │ Used by: G1, G2 (under name field)    │
 *   │  Filter B   [Group]  │ Type: ( • Atom )( Group )              │
 *   │  ...                 │ Enabled: [toggle]                      │
 *   │                      │ <type-specific editor>                  │
 *   │                      │                                         │
 *   │                      │                                         │
 *   │                      │                              [Cancel] [Save]
 *   └──────────────────────┴──────────────────────────────────────┘
 *
 * Atom editor:
 *   - Name input with placeholder "Name (auto-filled from first pattern)".
 *     Prefill rule: if `userEditedName === false`, debounce 300ms after the
 *     Patterns textarea changes, then set Name to `stripMetacharsForName(...)`.
 *     When the input is FOCUSED, never auto-update (don't shift under cursor).
 *     If the user clears the Name back to empty, set userEditedName=false so
 *     auto-fill resumes.
 *     The sentinels (`userEditedName`, `nameFocused`) are `useRef`s — they
 *     gate the effect, no render dependency. They are NEVER persisted.
 *   - Polarity radio (include / exclude).
 *   - Mode radio (glob / regex).
 *   - Patterns textarea (one pattern per line).
 *
 * Group editor:
 *   - Match radio: "all of these" / "any of these" (no AND/OR jargon).
 *   - Members chip rail with × on each chip.
 *   - "Add member" Select listing every other filter except (a) self, and
 *     (b) any candidate that already transitively references this group
 *     (DFS from candidate; if it reaches G, it's a cycle). Disabled
 *     candidates appear with "(disabled)" suffix.
 *   - "Exclude + any" warning: shown iff match='any', members non-empty,
 *     AND every member is an Atom with polarity='exclude'. Empty-group
 *     guard prevents `[].every() === true` from false-triggering.
 *
 * Type switch:
 *   - Single unified draft retains type-specific fields across switches
 *     (council recommendation: drop the confirm dialog entirely; submit
 *     handler picks fields based on current type).
 *
 * Delete flow:
 *   - Each row has a delete affordance. If `findReferencingGroups()` is
 *     non-empty, the click reveals an inline "Used by ..." popover
 *     (`filter-delete-blocked-{id}`) and deletion is blocked.
 *   - If unreferenced, the click reveals an inline [Cancel][Confirm] pair
 *     in an aria-live region; Confirm calls removeNode().
 *
 * Save flow:
 *   - validateNoCycle() over the prospective state.
 *   - empty-name check.
 *   - graceful orphan-strip (chip childIds whose nodes are missing in state
 *     are dropped on save).
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useFilters } from '@/contexts/FilterContext'
import {
  findReferencingGroups,
  stripMetacharsForName,
  validateNoCycle,
  type AtomFilter,
  type FilterId,
  type FilterMode,
  type FilterNode,
  type FilterPolarity,
  type FiltersState,
  type GroupFilter,
} from '@/lib/filterEngine'
import { cn } from '@/lib/utils'

interface ManageFiltersModalProps {
  isOpen: boolean
  onClose: () => void
}

// Unified draft holds every field — submit-time pruning by `type`.
interface Draft {
  id: string                   // existing id when editing; freshly-generated for new
  isNew: boolean
  type: 'atom' | 'group'
  name: string
  enabled: boolean
  // atom fields
  patterns: string             // textarea raw, one per line
  polarity: FilterPolarity
  mode: FilterMode
  // group fields
  match: 'all' | 'any'
  childIds: FilterId[]
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return 'flt-' + Math.random().toString(36).slice(2, 10)
}

function emptyDraft(): Draft {
  return {
    id: newId(),
    isNew: true,
    type: 'atom',
    name: '',
    enabled: true,
    patterns: '',
    polarity: 'include',
    mode: 'glob',
    match: 'all',
    childIds: [],
  }
}

function nodeToDraft(node: FilterNode): Draft {
  if (node.type === 'atom') {
    return {
      id: node.id,
      isNew: false,
      type: 'atom',
      name: node.name,
      enabled: node.enabled,
      patterns: node.patterns.join('\n'),
      polarity: node.polarity,
      mode: node.mode,
      match: 'all',
      childIds: [],
    }
  }
  return {
    id: node.id,
    isNew: false,
    type: 'group',
    name: node.name,
    enabled: node.enabled,
    patterns: '',
    polarity: 'include',
    mode: 'glob',
    match: node.match,
    childIds: [...node.childIds],
  }
}

/**
 * "Would adding `candidateId` as a child of group with id `groupId` create
 * a cycle?" — DFS from candidate through state.nodes; if groupId is reached,
 * yes. Caveat: if groupId doesn't exist in state.nodes (a brand-new group),
 * no node can reference it, so no cycle is structurally possible.
 */
function wouldCreateCycle(state: FiltersState, groupId: FilterId, candidateId: FilterId): boolean {
  if (candidateId === groupId) return true
  const stack: FilterId[] = [candidateId]
  const seen = new Set<FilterId>()
  while (stack.length > 0) {
    const cur = stack.pop()!
    if (seen.has(cur)) continue
    seen.add(cur)
    if (cur === groupId) return true
    const node = state.nodes[cur]
    if (node && node.type === 'group') {
      for (const child of node.childIds) stack.push(child)
    }
  }
  return false
}

export function ManageFiltersModal({ isOpen, onClose }: ManageFiltersModalProps) {
  const { filtersState, addNode, updateNode, removeNode } = useFilters()

  const [draft, setDraft] = useState<Draft | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  // Per-row delete UI state: 'idle' | 'blocked' | 'confirm'
  const [deleteUi, setDeleteUi] = useState<Record<FilterId, 'blocked' | 'confirm' | undefined>>({})

  const allNodes = useMemo(
    () => Object.values(filtersState.nodes).sort((a, b) => a.name.localeCompare(b.name)),
    [filtersState.nodes],
  )

  const visibleNodes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return allNodes
    return allNodes.filter((n) => n.name.toLowerCase().includes(q))
  }, [allNodes, searchQuery])

  const handleClose = () => {
    setDraft(null)
    setSaveError(null)
    setDeleteUi({})
    setSearchQuery('')
    onClose()
  }

  const handleStartCreate = () => {
    setDraft(emptyDraft())
    setSaveError(null)
  }

  const handleSelectRow = (node: FilterNode) => {
    setDraft(nodeToDraft(node))
    setSaveError(null)
    // Clear any open delete UI on selection.
    setDeleteUi({})
  }

  const handleToggleEnabled = (node: FilterNode) => {
    updateNode(node.id, { enabled: !node.enabled } as Partial<FilterNode>)
    if (draft && draft.id === node.id) {
      setDraft({ ...draft, enabled: !draft.enabled })
    }
  }

  const handleRequestDelete = (node: FilterNode) => {
    const refs = findReferencingGroups(node.id, filtersState)
    if (refs.length > 0) {
      setDeleteUi((s) => ({ ...s, [node.id]: 'blocked' }))
    } else {
      setDeleteUi((s) => ({ ...s, [node.id]: 'confirm' }))
    }
  }

  const handleCancelDelete = (id: FilterId) => {
    setDeleteUi((s) => ({ ...s, [id]: undefined }))
  }

  const handleConfirmDelete = (id: FilterId) => {
    removeNode(id)
    setDeleteUi((s) => ({ ...s, [id]: undefined }))
    if (draft && draft.id === id) setDraft(null)
  }

  const handleSave = () => {
    if (!draft) return
    const trimmedName = draft.name.trim()
    if (!trimmedName) {
      setSaveError('Name is required.')
      return
    }
    let prospective: FilterNode
    if (draft.type === 'atom') {
      const patterns = draft.patterns
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
      const atom: AtomFilter = {
        type: 'atom',
        id: draft.id,
        name: trimmedName,
        enabled: draft.enabled,
        patterns,
        polarity: draft.polarity,
        mode: draft.mode,
        target: 'title',
      }
      prospective = atom
    } else {
      // Strip orphan childIds defensively.
      const cleanChildren = draft.childIds.filter((cid) => cid in filtersState.nodes)
      const group: GroupFilter = {
        type: 'group',
        id: draft.id,
        name: trimmedName,
        enabled: draft.enabled,
        match: draft.match,
        childIds: cleanChildren,
      }
      prospective = group
    }
    // Cycle check on the prospective state.
    const nextNodes = { ...filtersState.nodes, [prospective.id]: prospective }
    const ok = validateNoCycle({ ...filtersState, nodes: nextNodes })
    if (!ok) {
      setSaveError('This change would create a cycle.')
      return
    }

    if (draft.isNew) {
      addNode(prospective)
    } else {
      updateNode(prospective.id, prospective as Partial<FilterNode>)
    }
    setDraft(null)
    setSaveError(null)
  }

  return (
    <Dialog open={isOpen} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent className="sm:max-w-4xl" aria-label="Manage filters">
        <DialogHeader>
          <DialogTitle>Manage filters</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-[14rem_minmax(0,1fr)] gap-4 min-h-[24rem]">
          {/* Left pane */}
          <div className="flex flex-col gap-2 border-r border-zinc-200 dark:border-zinc-800 pr-3">
            <div className="flex gap-2">
              <Input
                data-testid="manage-filters-search"
                placeholder="Search filters"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8"
              />
            </div>
            <Button
              data-testid="manage-filters-new"
              onClick={handleStartCreate}
              size="sm"
              className="h-8"
            >
              <Plus className="h-3 w-3 mr-1" /> New filter
            </Button>
            <ScrollArea className="flex-1 max-h-[28rem]">
              <div className="space-y-1 pr-1" data-testid="manage-filters-list">
                {visibleNodes.length === 0 && (
                  <div className="text-xs text-zinc-500 py-4 text-center">
                    {allNodes.length === 0 ? 'No filters yet.' : 'No matches.'}
                  </div>
                )}
                {visibleNodes.map((n) => (
                  <FilterRow
                    key={n.id}
                    node={n}
                    selected={draft?.id === n.id && !draft?.isNew}
                    deleteUi={deleteUi[n.id]}
                    onSelect={() => handleSelectRow(n)}
                    onToggleEnabled={() => handleToggleEnabled(n)}
                    onRequestDelete={() => handleRequestDelete(n)}
                    onCancelDelete={() => handleCancelDelete(n.id)}
                    onConfirmDelete={() => handleConfirmDelete(n.id)}
                    referencingGroups={findReferencingGroups(n.id, filtersState)}
                  />
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* Right pane (editor) */}
          <div data-testid="filter-editor" className="flex flex-col gap-3 min-w-0">
            {!draft ? (
              <div className="text-sm text-zinc-500 flex items-center justify-center h-full py-12">
                Select a filter on the left or click <span className="font-medium mx-1">+ New filter</span> to begin.
              </div>
            ) : (
              <DraftEditor
                draft={draft}
                state={filtersState}
                onChange={setDraft}
                onSave={handleSave}
                onCancel={() => { setDraft(null); setSaveError(null) }}
                saveError={saveError}
              />
            )}
          </div>
        </div>

        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={handleClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Filter row (left pane)
// ---------------------------------------------------------------------------

interface FilterRowProps {
  node: FilterNode
  selected: boolean
  deleteUi: 'blocked' | 'confirm' | undefined
  onSelect: () => void
  onToggleEnabled: () => void
  onRequestDelete: () => void
  onCancelDelete: () => void
  onConfirmDelete: () => void
  referencingGroups: GroupFilter[]
}

function FilterRow({
  node,
  selected,
  deleteUi,
  onSelect,
  onToggleEnabled,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  referencingGroups,
}: FilterRowProps) {
  return (
    <div
      data-testid={`filter-row-${node.id}`}
      className={cn(
        'flex flex-col gap-1 rounded border px-2 py-1.5 text-sm cursor-pointer',
        selected
          ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
          : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900',
      )}
      onClick={onSelect}
    >
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate text-zinc-900 dark:text-zinc-100">{node.name || '(unnamed)'}</div>
        </div>
        <Badge variant="outline" className="text-[10px] uppercase">
          {node.type}
        </Badge>
        <label
          className="flex items-center gap-1 text-xs text-zinc-500"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            data-testid={`filter-row-toggle-${node.id}`}
            checked={node.enabled}
            onChange={onToggleEnabled}
          />
          <span>Enabled</span>
        </label>
        <Button
          variant="ghost"
          size="sm"
          data-testid={`filter-row-delete-${node.id}`}
          onClick={(e) => { e.stopPropagation(); onRequestDelete() }}
          aria-label={`Delete ${node.name}`}
          className="h-6 w-6 p-0"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
      {/* Inline delete state */}
      {deleteUi === 'blocked' && (
        <div
          data-testid={`filter-delete-blocked-${node.id}`}
          aria-live="polite"
          className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 rounded px-2 py-1"
          onClick={(e) => e.stopPropagation()}
        >
          Can&rsquo;t delete: used by {referencingGroups.map((g) => g.name).join(', ')}. Remove it from those groups first.
          <button
            type="button"
            className="ml-2 underline"
            onClick={onCancelDelete}
            aria-label="Dismiss"
          >Dismiss</button>
        </div>
      )}
      {deleteUi === 'confirm' && (
        <div
          aria-live="polite"
          className="flex items-center gap-2 text-xs"
          onClick={(e) => e.stopPropagation()}
        >
          <span>Delete &ldquo;{node.name}&rdquo;?</span>
          <Button
            variant="outline"
            size="sm"
            onClick={onCancelDelete}
            className="h-6 px-2 text-xs"
            data-testid={`filter-row-delete-cancel-${node.id}`}
          >Cancel</Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={onConfirmDelete}
            className="h-6 px-2 text-xs"
            data-testid={`filter-row-delete-confirm-${node.id}`}
          >Confirm</Button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Draft editor (right pane)
// ---------------------------------------------------------------------------

interface DraftEditorProps {
  draft: Draft
  state: FiltersState
  onChange: (d: Draft) => void
  onSave: () => void
  onCancel: () => void
  saveError: string | null
}

function DraftEditor({ draft, state, onChange, onSave, onCancel, saveError }: DraftEditorProps) {
  // Sentinels: useRef so they gate the prefill effect without forcing
  // re-renders. They are NEVER persisted.
  // - userEditedNameRef: true once the user types into Name.
  //   Initial value: !draft.isNew (editing existing → don't auto-overwrite),
  //                   false for new drafts.
  // - nameFocusedRef: true while the Name input is focused (don't shift
  //   under the cursor).
  const userEditedNameRef = useRef<boolean>(!draft.isNew)
  const nameFocusedRef = useRef<boolean>(false)

  // Re-initialize sentinels when the draft id changes (selecting a different
  // filter, or starting a new one). Re-keying on id only — pure ref reset.
  const lastDraftIdRef = useRef<string>(draft.id)
  if (lastDraftIdRef.current !== draft.id) {
    lastDraftIdRef.current = draft.id
    userEditedNameRef.current = !draft.isNew
    nameFocusedRef.current = false
  }

  // Prefill effect — keyed ONLY on patterns string. Refs read inside the
  // closure so focus/edit toggles don't re-run the timer.
  useEffect(() => {
    if (draft.type !== 'atom') return
    const patternsText = draft.patterns
    const t = setTimeout(() => {
      if (userEditedNameRef.current) return
      if (nameFocusedRef.current) return
      const generated = stripMetacharsForName(patternsText)
      if (!generated) return
      // Only update if it would actually change — prevents redundant renders.
      if (generated === draft.name) return
      // Guard against stale fires after draft swap.
      if (lastDraftIdRef.current !== draft.id) return
      onChange({ ...draft, name: generated })
    }, 300)
    return () => clearTimeout(t)
    // We deliberately depend only on patterns + type so focus/edit toggles
    // don't reset the debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.patterns, draft.type])

  const onNameChange = (v: string) => {
    // Mark as edited when the user types (rather than the prefill writing).
    // Resume on clear: empty value sets the sentinel back to false.
    if (v === '') {
      userEditedNameRef.current = false
    } else {
      userEditedNameRef.current = true
    }
    onChange({ ...draft, name: v })
  }

  const referencing = findReferencingGroups(draft.id, state)

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1" htmlFor="filter-editor-name">
          Name
        </label>
        <Input
          id="filter-editor-name"
          data-testid="filter-editor-name"
          value={draft.name}
          placeholder={draft.type === 'atom' ? 'Name (auto-filled from first pattern)' : 'Group filter name'}
          onChange={(e) => onNameChange(e.target.value)}
          onFocus={() => { nameFocusedRef.current = true }}
          onBlur={() => { nameFocusedRef.current = false }}
        />
        {referencing.length > 0 && (
          <div
            data-testid="filter-editor-used-by"
            className="text-xs italic text-zinc-500 mt-1"
          >
            Used by: {referencing.map((g) => g.name).join(', ')}
          </div>
        )}
      </div>

      <div className="flex items-center gap-4 text-sm">
        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Type:</span>
        <RadioPill
          name="type"
          value="atom"
          current={draft.type}
          onPick={(v) => onChange({ ...draft, type: v as 'atom' | 'group' })}
          testId="filter-editor-type-atom"
        >
          Atom
        </RadioPill>
        <RadioPill
          name="type"
          value="group"
          current={draft.type}
          onPick={(v) => onChange({ ...draft, type: v as 'atom' | 'group' })}
          testId="filter-editor-type-group"
        >
          Group
        </RadioPill>
        <label className="ml-auto flex items-center gap-1 text-xs text-zinc-500">
          <input
            type="checkbox"
            data-testid="filter-editor-enabled"
            checked={draft.enabled}
            onChange={(e) => onChange({ ...draft, enabled: e.target.checked })}
          />
          <span>Enabled</span>
        </label>
      </div>

      {draft.type === 'atom' ? (
        <AtomEditor draft={draft} onChange={onChange} />
      ) : (
        <GroupEditor draft={draft} state={state} onChange={onChange} />
      )}

      {saveError && (
        <div className="text-xs text-red-600 dark:text-red-400">{saveError}</div>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={onCancel} data-testid="filter-editor-cancel">Cancel</Button>
        <Button onClick={onSave} data-testid="filter-editor-save">Save</Button>
      </DialogFooter>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Atom editor body
// ---------------------------------------------------------------------------

function AtomEditor({ draft, onChange }: { draft: Draft; onChange: (d: Draft) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Polarity</span>
          <div className="flex gap-2">
            <RadioPill
              name="polarity"
              value="include"
              current={draft.polarity}
              onPick={(v) => onChange({ ...draft, polarity: v as FilterPolarity })}
              testId="filter-editor-polarity-include"
            >include</RadioPill>
            <RadioPill
              name="polarity"
              value="exclude"
              current={draft.polarity}
              onPick={(v) => onChange({ ...draft, polarity: v as FilterPolarity })}
              testId="filter-editor-polarity-exclude"
            >exclude</RadioPill>
          </div>
        </div>
        <div>
          <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Mode</span>
          <div className="flex gap-2">
            <RadioPill
              name="mode"
              value="glob"
              current={draft.mode}
              onPick={(v) => onChange({ ...draft, mode: v as FilterMode })}
              testId="filter-editor-mode-glob"
            >glob</RadioPill>
            <RadioPill
              name="mode"
              value="regex"
              current={draft.mode}
              onPick={(v) => onChange({ ...draft, mode: v as FilterMode })}
              testId="filter-editor-mode-regex"
            >regex</RadioPill>
          </div>
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1" htmlFor="filter-editor-patterns">
          Patterns (one per line)
        </label>
        <textarea
          id="filter-editor-patterns"
          data-testid="filter-editor-patterns"
          rows={5}
          value={draft.patterns}
          onChange={(e) => onChange({ ...draft, patterns: e.target.value })}
          className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-mono shadow-sm focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
          placeholder={'*react*\n*typescript*'}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Group editor body
// ---------------------------------------------------------------------------

function GroupEditor({ draft, state, onChange }: { draft: Draft; state: FiltersState; onChange: (d: Draft) => void }) {
  // Pending Add-member selection (Select drives this; clicking [Add] commits).
  const [pendingMemberId, setPendingMemberId] = useState<string>('')

  // Cycle-safe candidate set. Disabled candidates DO appear (suffix
  // "(disabled)") so the user can re-enable + add in one flow.
  const candidates = useMemo(() => {
    const out: FilterNode[] = []
    for (const n of Object.values(state.nodes)) {
      if (n.id === draft.id) continue                       // self
      if (draft.childIds.includes(n.id)) continue           // already a member
      if (wouldCreateCycle(state, draft.id, n.id)) continue // cycle
      out.push(n)
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }, [state, draft.id, draft.childIds])

  const memberNodes: Array<{ id: FilterId; node: FilterNode | undefined }> = draft.childIds.map((id) => ({
    id,
    node: state.nodes[id],
  }))

  // "Exclude + any" warning trigger.
  const showExcludeAnyWarning = useMemo(() => {
    if (draft.match !== 'any') return false
    if (draft.childIds.length === 0) return false
    return draft.childIds.every((cid) => {
      const n = state.nodes[cid]
      return n && n.type === 'atom' && n.polarity === 'exclude'
    })
  }, [draft.match, draft.childIds, state.nodes])

  const handleAdd = () => {
    if (!pendingMemberId) return
    if (draft.childIds.includes(pendingMemberId)) {
      setPendingMemberId('')
      return
    }
    onChange({ ...draft, childIds: [...draft.childIds, pendingMemberId] })
    setPendingMemberId('')
  }

  const handleRemove = (id: FilterId) => {
    onChange({ ...draft, childIds: draft.childIds.filter((c) => c !== id) })
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Match</span>
        <div className="flex gap-2">
          <RadioPill
            name="match"
            value="all"
            current={draft.match}
            onPick={(v) => onChange({ ...draft, match: v as 'all' | 'any' })}
            testId="filter-editor-match-all"
          >all of these</RadioPill>
          <RadioPill
            name="match"
            value="any"
            current={draft.match}
            onPick={(v) => onChange({ ...draft, match: v as 'all' | 'any' })}
            testId="filter-editor-match-any"
          >any of these</RadioPill>
        </div>
        {showExcludeAnyWarning && (
          <div
            data-testid="filter-editor-exclude-any-warning"
            className="mt-2 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 rounded px-2 py-1.5"
          >
            ⚠ This combination usually matches almost everything. Consider switching to
            {' '}<strong>Match all of these</strong>, or change some members to <strong>Include</strong>.
          </div>
        )}
      </div>

      <div>
        <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Members</span>
        {memberNodes.length === 0 ? (
          <div className="text-xs italic text-zinc-500">No members yet — add some below.</div>
        ) : (
          <div className="flex flex-wrap gap-1" data-testid="filter-editor-members-list">
            {memberNodes.map(({ id, node }) => (
              <span
                key={id}
                data-testid={`filter-editor-member-${id}`}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs',
                  node
                    ? 'border-zinc-300 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800'
                    : 'border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-950/40 dark:text-red-200',
                )}
              >
                <span className="truncate max-w-[12rem]">{node ? node.name : `(missing ${id})`}</span>
                {node && !node.enabled && (
                  <span className="text-zinc-500">(disabled)</span>
                )}
                <button
                  type="button"
                  data-testid={`filter-editor-member-remove-${id}`}
                  onClick={() => handleRemove(id)}
                  aria-label={`Remove member ${node ? node.name : id}`}
                  className="ml-0.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-end gap-2">
        <div className="flex-1 min-w-0">
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Add member</label>
          <Select value={pendingMemberId} onValueChange={setPendingMemberId}>
            <SelectTrigger data-testid="filter-editor-add-member-trigger">
              <SelectValue placeholder={candidates.length === 0 ? 'No more filters available' : 'Pick a filter'} />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}{!c.enabled ? ' (disabled)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          data-testid="filter-editor-add-member-button"
          onClick={handleAdd}
          disabled={!pendingMemberId}
        >
          Add
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function RadioPill({
  value,
  current,
  onPick,
  testId,
  children,
}: {
  /** Reserved for future native-radio rendering; currently unused. */
  name?: string
  value: string
  current: string
  onPick: (v: string) => void
  testId: string
  children: ReactNode
}) {
  const active = current === value
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={() => onPick(value)}
      className={cn(
        'rounded border px-3 py-1 text-sm',
        active
          ? 'border-blue-500 bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200'
          : 'border-zinc-300 dark:border-zinc-700',
      )}
    >
      {children}
    </button>
  )
}
