import { useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

interface FetchProgress {
  type: 'start' | 'progress' | 'complete' | 'error'
  message: string
  current: number
  total: number
  conversation_name?: string
}

interface UseFetchToastOptions {
  onOpenDetails: () => void
}

export function useFetchToast({ onOpenDetails }: UseFetchToastOptions) {
  const queryClient = useQueryClient()
  const sourceRef = useRef<EventSource | null>(null)

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
          toast.error(data.message || 'Fetch failed.', {
            id: toastId,
            duration: Infinity,
            action: {
              label: 'Details',
              onClick: () => onOpenDetails(),
            },
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
        toast.error('Connection lost during fetch.', {
          id: toastId,
          duration: Infinity,
          action: {
            label: 'Details',
            onClick: () => onOpenDetails(),
          },
        })
        eventSource.close()
        sourceRef.current = null
      }
    },
    [onOpenDetails, queryClient],
  )

  return { startFetch }
}
