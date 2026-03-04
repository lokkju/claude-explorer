import { BrowserRouter, Routes, Route, Navigate } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { queryClient } from '@/lib/queryClient'
import { RootLayout } from '@/components/layout/RootLayout'
import { ConversationPage } from '@/routes/ConversationPage'

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<RootLayout />}>
            <Route index element={<Navigate to="/conversations" replace />} />
            <Route path="conversations" element={<ConversationPage />} />
            <Route path="conversations/:uuid" element={<ConversationPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <Toaster position="bottom-right" />
    </QueryClientProvider>
  )
}

export default App