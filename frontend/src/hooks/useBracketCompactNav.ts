/**
 * useBracketCompactNav — `[` / `]` keyboard navigation across compact
 * markers in the open conversation.
 *
 * Extracted from ConversationPage.tsx (2026-05-30, P1.4 Commit A from
 * PLANS/2026.05.30-STRICT-CODE-QUALITY-REVIEW.md) to give the page
 * route a smaller surface. The hook is fully behavior-preserving:
 *
 *   - `]` advances activeCompactIdx by 1 (or starts at 0 from null)
 *   - `[` decreases by 1 (or starts at last from null)
 *   - Modifier keys (cmd/ctrl/alt) are ignored — those collide with
 *     browser tab nav.
 *   - Typing inside <input>, <textarea>, or a contenteditable region
 *     is ignored so the brackets reach the field.
 *   - No listener is mounted when there are zero compact markers.
 *
 * Phase 2 perf (preserved): useEffectEvent lets the keydown listener
 * mount ONCE per conversation. Before useEffectEvent, the listener
 * re-subscribed every time activeCompactIdx ticked (every key press)
 * AND every time focusCompactMarker's identity flipped (which happens
 * whenever compactMarkers changes).
 *
 * The hook is generic over the marker shape — only the array length and
 * the focus callback are read, not any marker fields.
 */
import { useEffect, useEffectEvent } from 'react'

interface UseBracketCompactNavArgs<TMarker> {
  compactMarkers: readonly TMarker[]
  activeCompactIdx: number | null
  focusCompactMarker: (index: number) => void
}

export function useBracketCompactNav<TMarker>({
  compactMarkers,
  activeCompactIdx,
  focusCompactMarker,
}: UseBracketCompactNavArgs<TMarker>): void {
  const onCompactNav = useEffectEvent((e: KeyboardEvent) => {
    // Don't hijack `[` / `]` while the user is typing into a field.
    if (
      e.target instanceof HTMLElement &&
      (e.target.tagName === 'INPUT' ||
        e.target.tagName === 'TEXTAREA' ||
        e.target.isContentEditable)
    ) {
      return
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === ']') {
      e.preventDefault()
      focusCompactMarker(activeCompactIdx === null ? 0 : activeCompactIdx + 1)
    } else if (e.key === '[') {
      e.preventDefault()
      focusCompactMarker(
        activeCompactIdx === null ? compactMarkers.length - 1 : activeCompactIdx - 1,
      )
    }
  })

  useEffect(() => {
    if (compactMarkers.length === 0) return
    const handler = (e: KeyboardEvent) => onCompactNav(e)
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // onCompactNav is a useEffectEvent — its identity is stable and
    // intentionally NOT in the deps. compactMarkers.length is the only
    // value that should toggle mount/unmount of the listener.
  }, [compactMarkers.length])
}
