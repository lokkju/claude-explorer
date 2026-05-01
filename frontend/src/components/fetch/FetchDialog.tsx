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
import { useFetchPipeline } from '@/contexts/FetchPipelineContext'

interface FetchDialogProps {
  isOpen: boolean
  onClose: () => void
}

interface LegacyFetchProgress {
  type: 'start' | 'progress' | 'complete' | 'error'
  message: string
  current: number
  total: number
  conversation_name?: string
}

type FetchState = 'idle' | 'checking' | 'fetching' | 'complete' | 'error'

export function FetchDialog({ isOpen, onClose }: FetchDialogProps) {
  // Build-9 Bug 1: subscribe to the shared pipeline state. When a refresh
  // is in flight (driven by the Sidebar Refresh button), this dialog must
  // mirror the live SSE progress instead of showing a stale snapshot.
  const pipeline = useFetchPipeline()

  const [state, setState] = useState<FetchState>('idle')
  const [hasCredentials, setHasCredentials] = useState(false)
  const [existingCount, setExistingCount] = useState(0)
  const [progress, setProgress] = useState<LegacyFetchProgress | null>(null)
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
        const data: LegacyFetchProgress = JSON.parse(event.data)
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
    if (state !== 'fetching' && pipeline.state !== 'running') {
      onClose()
      // Reset state after close animation
      setTimeout(() => {
        setState('idle')
        setProgress(null)
        setErrorMessage('')
      }, 200)
    }
  }

  // Build-9 Bug 1: when a Build-9 refresh pipeline is active, override our
  // local "fetching/complete/error" state with the shared one so the modal
  // never shows a stale snapshot. The local state still drives the legacy
  // "Full Refresh" / "Fetch New" buttons in this dialog (which use the
  // older /fetch/start route, not the combined /fetch/refresh).
  const liveProgress = pipeline.progress
  const pipelineActive = pipeline.state !== 'idle' || liveProgress !== null

  // Effective render state: prefer live pipeline state when active.
  let effectiveState: FetchState = state
  let effectiveProgress: LegacyFetchProgress | null = progress
  let effectiveError = errorMessage
  if (pipelineActive) {
    if (pipeline.state === 'running') {
      effectiveState = 'fetching'
    } else if (pipeline.state === 'complete') {
      effectiveState = 'complete'
    } else if (pipeline.state === 'error') {
      effectiveState = 'error'
      effectiveError = pipeline.errorMessage || ''
    }
    if (liveProgress) {
      const captureTypes = new Set<string>([
        'capture_start',
        'capture_waiting_login',
        'capture_done',
      ])
      const mappedType: LegacyFetchProgress['type'] = captureTypes.has(
        liveProgress.type,
      )
        ? 'progress'
        : (liveProgress.type as LegacyFetchProgress['type'])
      effectiveProgress = {
        type: mappedType,
        message: liveProgress.message,
        current: liveProgress.current ?? 0,
        total: liveProgress.total ?? 0,
        conversation_name: liveProgress.conversation_name,
      }
    }
  }

  const progressPercent = effectiveProgress?.total
    ? Math.round((effectiveProgress.current / effectiveProgress.total) * 100)
    : 0

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className={`h-5 w-5 ${effectiveState === 'fetching' ? 'animate-spin' : ''}`} />
            Fetch Claude Desktop Conversations
          </DialogTitle>
          <DialogDescription>
            Download conversations from the Claude Desktop API.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {effectiveState === 'checking' && (
            <div className="text-center text-zinc-500">
              Checking status...
            </div>
          )}

          {effectiveState === 'idle' && !hasCredentials && (
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

          {effectiveState === 'idle' && hasCredentials && (
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

          {effectiveState === 'fetching' && effectiveProgress && (
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-zinc-600 dark:text-zinc-400">
                  {effectiveProgress.message}
                </span>
                <span className="font-medium">
                  {effectiveProgress.current}/{effectiveProgress.total}
                </span>
              </div>
              <div className="h-2 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              {effectiveProgress.conversation_name && (
                <p className="text-xs text-zinc-500 truncate">
                  {effectiveProgress.conversation_name}
                </p>
              )}
            </div>
          )}

          {effectiveState === 'complete' && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950">
              <div className="flex items-start gap-3">
                <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5" />
                <div>
                  <p className="font-medium text-green-800 dark:text-green-200">
                    Fetch complete!
                  </p>
                  <p className="mt-1 text-sm text-green-700 dark:text-green-300">
                    {effectiveProgress?.message}
                  </p>
                </div>
              </div>
            </div>
          )}

          {effectiveState === 'error' && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
              <div className="flex items-start gap-3">
                <XCircle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5" />
                <div>
                  <p className="font-medium text-red-800 dark:text-red-200">
                    Fetch failed
                  </p>
                  <p className="mt-1 text-sm text-red-700 dark:text-red-300">
                    {effectiveError}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {/* Manual override buttons only available when no Build-9 pipeline
              is active — they would otherwise race the Sidebar Refresh's
              EventSource. */}
          {effectiveState === 'idle' && hasCredentials && !pipelineActive && (
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

          {(effectiveState === 'complete' || effectiveState === 'error') && (
            <Button onClick={handleClose}>
              Close
            </Button>
          )}

          {effectiveState === 'idle' && !hasCredentials && (
            <Button variant="outline" onClick={handleClose}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
