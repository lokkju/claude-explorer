import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { errorToast } from '@/lib/errorToast'

// Bug B/C: SSE error events now carry a `kind` field (AUTH | TRANSIENT |
// TERMINAL) and a `retryable` boolean. The frontend uses these to decide
// whether to show a Retry button vs. a sticky Details toast.
type ErrorKind = 'AUTH' | 'TRANSIENT' | 'TERMINAL'

interface FetchProgress {
  type:
    | 'start'
    | 'progress'
    | 'complete'
    | 'error'
    // Build-9: capture phase events for the combined pipeline.
    | 'capture_start'
    | 'capture_waiting_login'
    | 'capture_done'
  message: string
  current?: number
  total?: number
  conversation_name?: string
  // Bug B: present on `type:"error"` events.
  kind?: ErrorKind
  retryable?: boolean
}

interface UseFetchToastOptions {
  onOpenDetails: () => void
}

export function useFetchToast({ onOpenDetails }: UseFetchToastOptions) {
  const queryClient = useQueryClient()
  const sourceRef = useRef<EventSource | null>(null)
  // Forward-reference to startFetch so the toast's Retry action can call it.
  const startRef = useRef<(incremental?: boolean) => void>(() => {})

  const startFetch = useCallback(
    (incremental: boolean = true) => {
      if (sourceRef.current) {
        sourceRef.current.close()
        sourceRef.current = null
      }

      const toastId = toast.loading('Fetching…', {
        duration: Infinity,
        action: {
          label: 'Details',
          onClick: () => onOpenDetails(),
        },
      })

      const eventSource = api.startFetch(incremental)
      sourceRef.current = eventSource

      let latestProgress: FetchProgress | null = null

      eventSource.onmessage = (event) => {
        let data: FetchProgress
        try {
          data = JSON.parse(event.data)
        } catch {
          return
        }
        latestProgress = data

        if (data.type === 'complete') {
          toast.success(data.message || 'Fetch complete.', {
            id: toastId,
            duration: 5000,
          })
          queryClient.invalidateQueries({ queryKey: ['conversations'] })
          eventSource.close()
          sourceRef.current = null
        } else if (data.type === 'error') {
          // Bug C: classify by SSE kind. TRANSIENT gets a Retry button +
          // 8s minimum; AUTH/TERMINAL/unknown stays sticky.
          const isTransient =
            data.kind === 'TRANSIENT' || data.retryable === true
          errorToast(data.message || 'Fetch failed.', {
            id: toastId,
            sticky: !isTransient,
            retry: isTransient ? () => startRef.current(incremental) : undefined,
            details: isTransient ? undefined : () => onOpenDetails(),
          })
          eventSource.close()
          sourceRef.current = null
        } else if (data.type === 'progress' || data.type === 'start') {
          const text = data.total
            ? `Fetching ${data.current}/${data.total}…`
            : data.message || 'Fetching…'
          toast.loading(text, {
            id: toastId,
            duration: Infinity,
            action: {
              label: 'Details',
              onClick: () => onOpenDetails(),
            },
          })
        }
      }

      eventSource.onerror = () => {
        if (latestProgress?.type === 'complete') {
          return
        }
        // Connection drops are transient by nature — give the user a Retry
        // button rather than a sticky doom toast.
        errorToast('Connection lost during fetch.', {
          id: toastId,
          retry: () => startRef.current(incremental),
        })
        eventSource.close()
        sourceRef.current = null
      }
    },
    [onOpenDetails, queryClient],
  )

  startRef.current = startFetch

  return { startFetch }
}


// ---------------------------------------------------------------------------
// Build-9: One-button Refresh — capture + fetch pipeline.
// ---------------------------------------------------------------------------

interface UseRefreshPipelineOptions {
  onOpenDetails: () => void
}

export function useRefreshPipeline({ onOpenDetails }: UseRefreshPipelineOptions) {
  const queryClient = useQueryClient()
  const sourceRef = useRef<EventSource | null>(null)
  const [isRunning, setIsRunning] = useState(false)

  const startRefresh = useCallback(
    (incremental: boolean = true) => {
      // Defense-in-depth: if a pipeline is already running, ignore the click.
      if (sourceRef.current) {
        return
      }
      setIsRunning(true)

      const toastId = toast.loading('Refreshing…', {
        duration: Infinity,
        action: {
          label: 'Details',
          onClick: () => onOpenDetails(),
        },
      })

      const eventSource = api.startRefresh(incremental)
      sourceRef.current = eventSource

      let latestProgress: FetchProgress | null = null

      const close = () => {
        eventSource.close()
        sourceRef.current = null
        setIsRunning(false)
      }

      // Bug C: classify error events by `kind`.
      //   TRANSIENT -> 8s minimum, Retry button.
      //   AUTH/TERMINAL/unknown -> sticky, Retry button (so the user is
      //   never trapped without a way to recover from a real-world failure).
      const showErrorByKind = (message: string, kind?: ErrorKind, retryable?: boolean) => {
        const isTransient = kind === 'TRANSIENT' || retryable === true
        errorToast(message, {
          id: toastId,
          sticky: !isTransient,
          retry: () => {
            toast.dismiss(toastId)
            startRefresh(incremental)
          },
        })
      }

      eventSource.onmessage = (event) => {
        let data: FetchProgress
        try {
          data = JSON.parse(event.data)
        } catch {
          return
        }
        latestProgress = data

        switch (data.type) {
          case 'capture_start':
            toast.loading(
              data.message || 'Opening browser to log in to Claude…',
              {
                id: toastId,
                duration: Infinity,
                action: {
                  label: 'Details',
                  onClick: () => onOpenDetails(),
                },
              },
            )
            break
          case 'capture_waiting_login':
            toast.loading(
              data.message || 'Waiting for you to log in…',
              {
                id: toastId,
                duration: Infinity,
                action: {
                  label: 'Details',
                  onClick: () => onOpenDetails(),
                },
              },
            )
            break
          case 'capture_done':
            toast.loading(data.message || 'Credentials captured. Fetching…', {
              id: toastId,
              duration: Infinity,
              action: {
                label: 'Details',
                onClick: () => onOpenDetails(),
              },
            })
            break
          case 'start':
          case 'progress': {
            const text = data.total
              ? `Fetching ${data.current ?? 0}/${data.total}…`
              : data.message || 'Fetching…'
            toast.loading(text, {
              id: toastId,
              duration: Infinity,
              action: {
                label: 'Details',
                onClick: () => onOpenDetails(),
              },
            })
            break
          }
          case 'complete':
            toast.success(data.message || 'Refresh complete.', {
              id: toastId,
              duration: 5000,
            })
            queryClient.invalidateQueries({ queryKey: ['conversations'] })
            close()
            break
          case 'error':
            showErrorByKind(
              data.message || 'Refresh failed.',
              data.kind,
              data.retryable,
            )
            close()
            break
        }
      }

      eventSource.onerror = () => {
        if (latestProgress?.type === 'complete') {
          return
        }
        // Connection drop -> treat as transient (give user a Retry button).
        showErrorByKind('Connection lost during refresh.', 'TRANSIENT', true)
        close()
      }
    },
    [onOpenDetails, queryClient],
  )

  return { startRefresh, isRunning }
}
