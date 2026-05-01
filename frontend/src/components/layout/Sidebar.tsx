import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useUrlFilters } from '@/hooks/useUrlFilters'
import { useFilters } from '@/contexts/FilterContext'
import { FilterChipRail } from '@/components/filters/FilterChipRail'
import { Search, Settings, Download, MessageSquare, Terminal, RefreshCw, ArrowUpDown, FolderTree, Sun, Moon, Monitor } from 'lucide-react'
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
import { FetchDialog } from '@/components/fetch/FetchDialog'
import { useFetchPipeline } from '@/contexts/FetchPipelineContext'
import { useSourceFilter } from '@/contexts/SourceFilterContext'
import { useSettings } from '@/contexts/SettingsContext'
import { useKeyboardNavigation } from '@/contexts/KeyboardNavigationContext'
import { cn } from '@/lib/utils'
import type { SourceFilter, SortField } from '@/lib/types'

interface SidebarProps {
  className?: string
}

const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: 'updated_at', label: 'Last Activity' },
  { value: 'created_at', label: 'Start Time' },
  { value: 'name', label: 'Title' },
  { value: 'project', label: 'Project' },
]

export function Sidebar({ className }: SidebarProps) {
  const urlFilters = useUrlFilters()
  const { activeFilters } = useFilters()
  const [searchQuery, setSearchQuery] = useState(urlFilters.q)

  // Keep the search box synced with the URL so deep-links and back/forward both work.
  useEffect(() => {
    setSearchQuery(urlFilters.q)
  }, [urlFilters.q])
  // Build-9 Bug 1: Refresh button drives the same shared pipeline state
  // that the FetchDialog modal subscribes to. The dialog open state lives
  // in the same context so the toast's "Details" action and the dialog
  // itself stay in sync without prop-drilling.
  const {
    startRefresh,
    isRunning: isPipelineRunning,
    detailsOpen,
    closeDetails,
  } = useFetchPipeline()
  const { sourceFilter, setSourceFilter } = useSourceFilter()
  const { focusArea, setFocusArea } = useKeyboardNavigation()
  const {
    showPhantomSessions,
    setShowPhantomSessions,
    sortField,
    setSortField,
    sortOrder,
    setSortOrder,
    groupByProject,
    setGroupByProject,
    theme,
    setTheme,
    effectiveTheme,
  } = useSettings()

  const cycleTheme = () => {
    const themes = ['light', 'dark', 'system'] as const
    const currentIndex = themes.indexOf(theme)
    const nextIndex = (currentIndex + 1) % themes.length
    setTheme(themes[nextIndex])
  }

  const ThemeIcon = theme === 'system' ? Monitor : effectiveTheme === 'dark' ? Moon : Sun

  const handleRefresh = () => {
    startRefresh(true)
  }

  return (
    <aside
      onClick={() => setFocusArea('list')}
      className={cn(
        'flex h-full w-80 flex-col border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900',
        focusArea === 'list' && 'ring-2 ring-inset ring-blue-500/50',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-zinc-200 p-4 dark:border-zinc-800">
        <MessageSquare className="h-6 w-6 text-zinc-700 dark:text-zinc-300" />
        <h1 className="flex-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Claude Explorer
        </h1>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={handleRefresh}
          disabled={isPipelineRunning}
          title="Refresh conversation list"
        >
          <RefreshCw className={cn("h-4 w-4", isPipelineRunning && "animate-spin")} />
        </Button>
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
        {/* Sort controls */}
        <div className="flex items-center gap-1">
          <Select value={sortField} onValueChange={(v: string) => setSortField(v as SortField)}>
            <SelectTrigger className="flex-1 h-8 text-xs">
              <ArrowUpDown className="h-3 w-3 mr-1 text-zinc-400" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2"
            onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
            title={sortOrder === 'asc' ? 'Ascending' : 'Descending'}
          >
            {sortOrder === 'asc' ? '↑' : '↓'}
          </Button>
        </div>
        <div className="flex items-center justify-between">
          <div className="text-xs text-zinc-500">
            <kbd className="rounded bg-zinc-200 px-1 py-0.5 font-mono text-[10px] dark:bg-zinc-700">
              {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+K
            </kbd>{' '}
            to search messages
          </div>
          <div className="flex items-center gap-2">
            {/* Group by project toggle - only show when Claude Code sessions are visible */}
            {sourceFilter !== 'CLAUDE_AI' && (
              <label className="flex items-center gap-1 text-xs text-zinc-500 cursor-pointer" title="Group sessions by project">
                <input
                  type="checkbox"
                  checked={groupByProject}
                  onChange={(e) => setGroupByProject(e.target.checked)}
                  className="h-3 w-3 rounded border-zinc-300"
                />
                <FolderTree className="h-3 w-3" />
              </label>
            )}
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
      </div>

      {/* Filter chip rail */}
      <div className="px-4 pb-2">
        <FilterChipRail />
      </div>

      {/* Conversation List */}
      <ScrollArea className="flex-1">
        <ConversationList
          searchQuery={searchQuery}
          sourceFilter={sourceFilter}
          includePhantom={showPhantomSessions}
          sortField={sortField}
          sortOrder={sortOrder}
          groupByProject={groupByProject}
          projectSlug={urlFilters.project || undefined}
          titleFilter={urlFilters.title || undefined}
          titleFilterMode={urlFilters.filterMode}
          activeFilters={activeFilters}
        />
      </ScrollArea>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-zinc-200 p-4 dark:border-zinc-800">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/settings">
              <Settings className="h-4 w-4" />
              <span className="ml-2">Settings</span>
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={cycleTheme}
            title={`Theme: ${theme} (click to change)`}
            className="h-8 w-8"
          >
            <ThemeIcon className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" title="Export All">
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Fetch Dialog */}
      <FetchDialog isOpen={detailsOpen} onClose={closeDetails} />
    </aside>
  )
}