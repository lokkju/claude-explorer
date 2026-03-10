import { useState } from 'react'
import { Link } from 'react-router'
import { Search, Settings, Download, MessageSquare, Terminal } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ConversationList } from '@/components/conversation/ConversationList'
import { useSourceFilter } from '@/contexts/SourceFilterContext'
import { useSettings } from '@/contexts/SettingsContext'
import { cn } from '@/lib/utils'
import type { SourceFilter } from '@/lib/types'

interface SidebarProps {
  className?: string
}

export function Sidebar({ className }: SidebarProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const { sourceFilter, setSourceFilter } = useSourceFilter()
  const { showPhantomSessions, setShowPhantomSessions } = useSettings()

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

      {/* Search and Filter */}
      <div className="p-4 pb-2 space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <Input
            placeholder="Search titles..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={sourceFilter} onValueChange={(v: string) => setSourceFilter(v as SourceFilter)}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Filter by source" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              <span className="flex items-center gap-2">
                All Conversations
              </span>
            </SelectItem>
            <SelectItem value="CLAUDE_AI">
              <span className="flex items-center gap-2">
                <MessageSquare className="h-3 w-3 text-blue-500" />
                Claude Desktop
              </span>
            </SelectItem>
            <SelectItem value="CLAUDE_CODE">
              <span className="flex items-center gap-2">
                <Terminal className="h-3 w-3 text-green-500" />
                Claude Code
              </span>
            </SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center justify-between">
          <div className="text-xs text-zinc-500">
            <kbd className="rounded bg-zinc-200 px-1 py-0.5 font-mono text-[10px] dark:bg-zinc-700">
              {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+K
            </kbd>{' '}
            to search messages
          </div>
          <label className="flex items-center gap-1 text-xs text-zinc-500 cursor-pointer" title="Show empty sessions created by local commands">
            <input
              type="checkbox"
              checked={showPhantomSessions}
              onChange={(e) => setShowPhantomSessions(e.target.checked)}
              className="h-3 w-3 rounded border-zinc-300"
            />
            <span>Empty</span>
          </label>
        </div>
      </div>

      {/* Conversation List */}
      <ScrollArea className="flex-1">
        <ConversationList
          searchQuery={searchQuery}
          sourceFilter={sourceFilter}
          includePhantom={showPhantomSessions}
        />
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