import { GitBranch, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { TreeView } from './TreeView'
import { useConversationTree } from '@/hooks/useConversations'

interface TreeViewModalProps {
  uuid: string
  isOpen: boolean
  onClose: () => void
  onSelectPath: (path: string[]) => void
}

export function TreeViewModal({
  uuid,
  isOpen,
  onClose,
  onSelectPath,
}: TreeViewModalProps) {
  const { data: tree, isLoading, error } = useConversationTree(uuid)

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="fixed right-0 top-0 h-full w-full max-w-lg bg-white shadow-xl dark:bg-zinc-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Conversation Tree
            </h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Content */}
        <ScrollArea className="h-[calc(100%-57px)]">
          {isLoading && (
            <div className="flex items-center justify-center p-8">
              <div className="text-sm text-zinc-500">Loading tree...</div>
            </div>
          )}

          {error && (
            <div className="flex items-center justify-center p-8">
              <div className="text-sm text-red-500">Failed to load tree</div>
            </div>
          )}

          {tree && (
            <>
              <div className="border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
                <p className="text-xs text-zinc-500">
                  Click on a message to switch to that branch. Active path is highlighted.
                </p>
              </div>
              <TreeView
                tree={tree}
                onSelectPath={(path) => {
                  onSelectPath(path)
                  onClose()
                }}
              />
            </>
          )}
        </ScrollArea>
      </div>
    </div>
  )
}
