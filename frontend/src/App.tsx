import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { queryClient } from '@/lib/queryClient'
import { SettingsProvider, useSettings } from '@/contexts/SettingsContext'
import { SourceFilterProvider } from '@/contexts/SourceFilterContext'
import { SearchPanelProvider } from '@/contexts/SearchPanelContext'
import { KeyboardNavigationProvider } from '@/contexts/KeyboardNavigationContext'
import { RootLayout } from '@/components/layout/RootLayout'
import { ConversationPage } from '@/routes/ConversationPage'
import { SettingsPage } from '@/routes/SettingsPage'
import { ConnectionStatus } from '@/components/ConnectionStatus'
import { KeyboardHelpModal } from '@/components/KeyboardHelpModal'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'

function ThemeApplier({ children }: { children: React.ReactNode }) {
  const { effectiveTheme } = useSettings()

  useEffect(() => {
    const root = document.documentElement
    if (effectiveTheme === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
  }, [effectiveTheme])

  return <>{children}</>
}

function KeyboardShortcutHandler() {
  useKeyboardShortcuts()
  return null
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <ThemeApplier>
          <SourceFilterProvider>
            <SearchPanelProvider>
              <BrowserRouter>
                <KeyboardNavigationProvider>
                  <KeyboardShortcutHandler />
                  <KeyboardHelpModal />
                  <Routes>
                  <Route element={<RootLayout />}>
                    <Route index element={<Navigate to="/conversations" replace />} />
                    <Route path="conversations" element={<ConversationPage />} />
                    <Route path="conversations/:uuid" element={<ConversationPage />} />
                    <Route path="settings" element={<SettingsPage />} />
                  </Route>
                  </Routes>
                </KeyboardNavigationProvider>
              </BrowserRouter>
              <Toaster position="bottom-right" />
              <ConnectionStatus />
            </SearchPanelProvider>
          </SourceFilterProvider>
        </ThemeApplier>
      </SettingsProvider>
    </QueryClientProvider>
  )
}

export default App