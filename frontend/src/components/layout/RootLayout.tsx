import { Outlet } from 'react-router'
import { Sidebar } from './Sidebar'

export function RootLayout() {
  return (
    <div className="flex h-screen bg-white dark:bg-zinc-950">
      <Sidebar />
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  )
}