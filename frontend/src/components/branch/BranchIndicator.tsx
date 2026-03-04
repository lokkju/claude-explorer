import { useState } from 'react'
import { GitBranch, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { MessageNode } from '@/lib/types'

interface BranchIndicatorProps {
  siblings: MessageNode[]
  currentIndex: number
  onSwitch: (node: MessageNode) => void
}

export function BranchIndicator({
  siblings,
  currentIndex,
  onSwitch,
}: BranchIndicatorProps) {
  const [isHovered, setIsHovered] = useState(false)

  if (siblings.length <= 1) {
    return null
  }

  const canGoPrev = currentIndex > 0
  const canGoNext = currentIndex < siblings.length - 1

  return (
    <div
      className="my-2 flex items-center justify-center gap-2"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className={cn(
          'flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition-all',
          isHovered
            ? 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950'
            : 'border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900'
        )}
      >
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5"
          onClick={() => canGoPrev && onSwitch(siblings[currentIndex - 1])}
          disabled={!canGoPrev}
        >
          <ChevronLeft className="h-3 w-3" />
        </Button>

        <div className="flex items-center gap-1 px-2">
          <GitBranch className="h-3 w-3 text-amber-600 dark:text-amber-400" />
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            {currentIndex + 1} / {siblings.length}
          </span>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5"
          onClick={() => canGoNext && onSwitch(siblings[currentIndex + 1])}
          disabled={!canGoNext}
        >
          <ChevronRight className="h-3 w-3" />
        </Button>
      </div>
    </div>
  )
}
