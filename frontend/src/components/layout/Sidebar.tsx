import { useState } from 'react'
import { Link } from 'react-router'
import { Search, Settings, Download, MessageSquare } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ConversationList } from '@/components/conversation/ConversationList'
import { cn } from '@/lib/utils'

interface SidebarProps {
  className?: string
}

export function Sidebar({ className }: SidebarProps) {
  const [searchQuery, setSearchQuery] = useState('')

  return (
    <aside
      className={cn(
        'flex h-full w-80 flex-col border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-zinc-200 p-4 dark:border-zinc-800">
        <MessageSquare className="h-6 w-6 text-zinc-700 dark:text-zinc-300" />
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Claude Exporter
        </h1>
      </div>

      {/* Search */}
      <div className="p-4 pb-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <Input
            placeholder="Search titles..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="mt-2 text-xs text-zinc-500">
          <kbd className="rounded bg-zinc-200 px-1 py-0.5 font-mono text-[10px] dark:bg-zinc-700">
            {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+K
          </kbd>{' '}
          to search messages
        </div>
      </div>

      {/* Conversation List */}
      <ScrollArea className="flex-1">
        <ConversationList searchQuery={searchQuery} />
      </ScrollArea>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-zinc-200 p-4 dark:border-zinc-800">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/settings">
            <Settings className="h-4 w-4" />
            <span className="ml-2">Settings</span>
          </Link>
        </Button>
        <Button variant="ghost" size="icon" title="Export All">
          <Download className="h-4 w-4" />
        </Button>
      </div>
    </aside>
  )
}