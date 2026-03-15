import { BrowserRouter, Routes, Route, Navigate } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { queryClient } from '@/lib/queryClient'
import { SettingsProvider } from '@/contexts/SettingsContext'
import { SourceFilterProvider } from '@/contexts/SourceFilterContext'
import { RootLayout } from '@/components/layout/RootLayout'
import { ConversationPage } from '@/routes/ConversationPage'
import { CommandPalette } from '@/components/search/CommandPalette'
import { ConnectionStatus } from '@/components/ConnectionStatus'

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <SourceFilterProvider>
          <BrowserRouter>
            <CommandPalette />
            <Routes>
            <Route element={<RootLayout />}>
              <Route index element={<Navigate to="/conversations" replace />} />
              <Route path="conversations" element={<ConversationPage />} />
              <Route path="conversations/:uuid" element={<ConversationPage />} />
            </Route>
            </Routes>
          </BrowserRouter>
          <Toaster position="bottom-right" />
          <ConnectionStatus />
        </SourceFilterProvider>
      </SettingsProvider>
    </QueryClientProvider>
  )
}

export default App