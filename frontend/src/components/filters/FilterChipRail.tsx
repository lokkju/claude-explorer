import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useFilters } from '@/contexts/FilterContext'
import { ManageFiltersModal } from './ManageFiltersModal'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function FilterChipRail() {
  const { filters, activeFilterIds, toggleActive } = useFilters()
  const [isModalOpen, setIsModalOpen] = useState(false)

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1">
        {filters.map((f) => {
          const active = activeFilterIds.includes(f.id)
          const glyph = f.polarity === 'include' ? '+' : '−'
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => toggleActive(f.id)}
              data-filter-chip
              data-filter-id={f.id}
              data-filter-active={active ? '' : undefined}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors',
                active
                  ? 'border-blue-500 bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200'
                  : 'border-zinc-300 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300'
              )}
              title={`${f.polarity} ${f.mode}: ${f.patterns.join(', ') || '(no patterns)'}`}
            >
              <span className={cn(
                'inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold',
                f.polarity === 'include' ? 'text-emerald-600' : 'text-red-600'
              )}>
                {glyph}
              </span>
              {f.name}
            </button>
          )
        })}
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={() => setIsModalOpen(true)}
          aria-label="Manage filters"
        >
          <Plus className="h-3 w-3 mr-1" />
          Manage filters
        </Button>
      </div>
      <ManageFiltersModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </div>
  )
}
