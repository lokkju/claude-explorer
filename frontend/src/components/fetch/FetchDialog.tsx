import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, CheckCircle, XCircle, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { queryClient } from '@/lib/queryClient'

interface FetchDialogProps {
  isOpen: boolean
  onClose: () => void
}

interface FetchProgress {
  type: 'start' | 'progress' | 'complete' | 'error'
  message: string
  current: number
  total: number
  conversation_name?: string
}

type FetchState = 'idle' | 'checking' | 'fetching' | 'complete' | 'error'

export function FetchDialog({ isOpen, onClose }: FetchDialogProps) {
  const [state, setState] = useState<FetchState>('idle')
  const [hasCredentials, setHasCredentials] = useState(false)
  const [existingCount, setExistingCount] = useState(0)
  const [progress, setProgress] = useState<FetchProgress | null>(null)
  const [errorMessage, setErrorMessage] = useState('')

  // Check status when dialog opens
  useEffect(() => {
    if (isOpen) {
      setState('checking')
      api.getFetchStatus()
        .then((status) => {
          setHasCredentials(status.has_credentials)
          setExistingCount(status.existing_count)
          setState('idle')
        })
        .catch(() => {
          setErrorMessage('Failed to check fetch status')
          setState('error')
        })
    }
  }, [isOpen])

  const handleStartFetch = useCallback((incremental: boolean) => {
    setState('fetching')
    setProgress(null)
    setErrorMessage('')

    const eventSource = api.startFetch(incremental)

    eventSource.onmessage = (event) => {
      try {
        const data: FetchProgress = JSON.parse(event.data)
        setProgress(data)

        if (data.type === 'complete') {
          setState('complete')
          eventSource.close()
          // Invalidate conversation list cache
          queryClient.invalidateQueries({ queryKey: ['conversations'] })
        } else if (data.type === 'error') {
          setState('error')
          setErrorMessage(data.message)
          eventSource.close()
        }
      } catch (err) {
        console.error('Failed to parse SSE event:', err)
      }
    }

    eventSource.onerror = () => {
      setState('error')
      setErrorMessage('Connection lost during fetch')
      eventSource.close()
    }
  }, [])

  const handleClose = () => {
    if (state !== 'fetching') {
      onClose()
      // Reset state after close animation
      setTimeout(() => {
        setState('idle')
        setProgress(null)
        setErrorMessage('')
      }, 200)
    }
  }

  const progressPercent = progress?.total
    ? Math.round((progress.current / progress.total) * 100)
    : 0

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className={`h-5 w-5 ${state === 'fetching' ? 'animate-spin' : ''}`} />
            Fetch Claude Desktop Conversations
          </DialogTitle>
          <DialogDescription>
            Download conversations from the Claude Desktop API.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {state === 'checking' && (
            <div className="text-center text-zinc-500">
              Checking status...
            </div>
          )}

          {state === 'idle' && !hasCredentials && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5" />
                <div>
                  <p className="font-medium text-amber-800 dark:text-amber-200">
                    No credentials found
                  </p>
                  <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
                    Run this command to log in and capture credentials:
                  </p>
                  <pre className="mt-2 rounded bg-amber-200 px-2 py-1 text-xs font-mono dark:bg-amber-800">
                    claude-explorer capture
                  </pre>
                  <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                    This will open a browser where you can log into Claude normally.
                  </p>
                </div>
              </div>
            </div>
          )}

          {state === 'idle' && hasCredentials && (
            <div className="space-y-4">
              <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950">
                <div className="flex items-start gap-3">
                  <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5" />
                  <div>
                    <p className="font-medium text-green-800 dark:text-green-200">
                      Credentials found
                    </p>
                    <p className="mt-1 text-sm text-green-700 dark:text-green-300">
                      {existingCount} conversations already downloaded.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {state === 'fetching' && progress && (
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-zinc-600 dark:text-zinc-400">
                  {progress.message}
                </span>
                <span className="font-medium">
                  {progress.current}/{progress.total}
                </span>
              </div>
              <div className="h-2 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              {progress.conversation_name && (
                <p className="text-xs text-zinc-500 truncate">
                  {progress.conversation_name}
                </p>
              )}
            </div>
          )}

          {state === 'complete' && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950">
              <div className="flex items-start gap-3">
                <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5" />
                <div>
                  <p className="font-medium text-green-800 dark:text-green-200">
                    Fetch complete!
                  </p>
                  <p className="mt-1 text-sm text-green-700 dark:text-green-300">
                    {progress?.message}
                  </p>
                </div>
              </div>
            </div>
          )}

          {state === 'error' && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
              <div className="flex items-start gap-3">
                <XCircle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5" />
                <div>
                  <p className="font-medium text-red-800 dark:text-red-200">
                    Fetch failed
                  </p>
                  <p className="mt-1 text-sm text-red-700 dark:text-red-300">
                    {errorMessage}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {state === 'idle' && hasCredentials && (
            <>
              <Button
                variant="outline"
                onClick={() => handleStartFetch(false)}
              >
                Full Refresh
              </Button>
              <Button onClick={() => handleStartFetch(true)}>
                Fetch New
              </Button>
            </>
          )}

          {(state === 'complete' || state === 'error') && (
            <Button onClick={handleClose}>
              Close
            </Button>
          )}

          {state === 'idle' && !hasCredentials && (
            <Button variant="outline" onClick={handleClose}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}