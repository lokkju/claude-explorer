import { useState, useEffect, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { WifiOff, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { queryKeys } from '@/lib/queryClient'

export function ConnectionStatus() {
  const [isDisconnected, setIsDisconnected] = useState(false)
  const [isReconnecting, setIsReconnecting] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  // Check connection by fetching config
  const checkConnection = useCallback(async () => {
    try {
      const response = await fetch('/api/config', {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      })
      if (response.ok) {
        setIsDisconnected(false)
        setLastError(null)
        return true
      }
      throw new Error(`Server returned ${response.status}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      setLastError(message)
      return false
    }
  }, [])

  // Monitor query errors
  useEffect(() => {
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event?.type === 'updated' && event.query.state.status === 'error') {
        const error = event.query.state.error
        // Check if it's a connection error (fetch failed)
        if (error instanceof TypeError && error.message.includes('fetch')) {
          setIsDisconnected(true)
          setLastError('Cannot connect to backend server')
        } else if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
          setIsDisconnected(true)
          setLastError('Backend server is not running')
        }
      }
    })

    return () => unsubscribe()
  }, [queryClient])

  // Initial connection check
  useEffect(() => {
    checkConnection()
  }, [checkConnection])

  const handleReconnect = async () => {
    setIsReconnecting(true)
    const connected = await checkConnection()
    if (connected) {
      // Refetch all queries
      await queryClient.invalidateQueries({ queryKey: queryKeys.conversations.all })
    } else {
      setIsDisconnected(true)
    }
    setIsReconnecting(false)
  }

  return (
    <Dialog open={isDisconnected} onOpenChange={setIsDisconnected}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <WifiOff className="h-5 w-5 text-red-500" />
            Connection Lost
          </DialogTitle>
          <DialogDescription className="space-y-2">
            <p>
              Unable to connect to the backend server. Make sure the server is running:
            </p>
            <pre className="mt-2 rounded bg-zinc-100 p-2 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              claude-exporter serve
            </pre>
            {lastError && (
              <p className="text-xs text-red-500">
                Error: {lastError}
              </p>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2 mt-4">
          <Button
            variant="outline"
            onClick={() => setIsDisconnected(false)}
          >
            Dismiss
          </Button>
          <Button
            onClick={handleReconnect}
            disabled={isReconnecting}
          >
            {isReconnecting ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Reconnecting...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Reconnect
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}