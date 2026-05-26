import { useSyncExternalStore } from 'react'
import {
  isImageFailureTombstoned,
  subscribeImageFailures,
} from '@/lib/imageFailureRegistry'

/**
 * Subscribe to the image-failure registry so a component re-renders
 * the moment ANY image URL crosses the failure threshold (a sibling
 * referencing the same URL might have just tombstoned it).
 *
 * Used by both `CcImageMarkerTile` and `InlineImageBlock` so a single
 * <img onError> burst across viewport-visible siblings collapses them
 * all to the fallback tile without each one issuing its own request.
 */
export function useImageFailureTombstone(url: string): boolean {
  return useSyncExternalStore(
    subscribeImageFailures,
    () => isImageFailureTombstoned(url),
    () => false, // SSR / hydration: never report tombstoned on first paint
  )
}
