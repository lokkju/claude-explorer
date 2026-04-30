import { useEffect, useState } from 'react'
import { Outlet } from 'react-router'
import { Menu, X } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { SearchPanel } from '@/components/search/SearchPanel'
import { Button } from '@/components/ui/button'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { cn } from '@/lib/utils'

export function RootLayout() {
  const isMobile = useMediaQuery('(max-width: 768px)')
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Close drawer on viewport returning to desktop.
  useEffect(() => {
    if (!isMobile) setDrawerOpen(false)
  }, [isMobile])

  return (
    <div className="flex h-screen bg-white dark:bg-zinc-950">
      {!isMobile && <Sidebar />}

      {isMobile && (
        <>
          {drawerOpen && (
            <div
              className="fixed inset-0 z-30 bg-black/40"
              onClick={() => setDrawerOpen(false)}
              aria-hidden
            />
          )}
          <div
            className={cn(
              'fixed left-0 top-0 z-40 h-full transition-transform duration-200',
              drawerOpen ? 'translate-x-0' : '-translate-x-full'
            )}
          >
            <Sidebar />
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-2 h-8 w-8 bg-white/90 dark:bg-zinc-900/90"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close sidebar"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </>
      )}

      <main className={cn('flex-1 overflow-hidden', isMobile && 'w-screen')}>
        {isMobile && !drawerOpen && (
          <div className="flex items-center border-b border-zinc-200 px-2 py-2 dark:border-zinc-800">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open sidebar"
              className="h-8 w-8"
            >
              <Menu className="h-4 w-4" />
            </Button>
          </div>
        )}
        <Outlet />
      </main>
      <SearchPanel />
    </div>
  )
}
