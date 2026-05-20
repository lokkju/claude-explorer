import { useEffect, useState } from 'react'

export function useMediaQuery(query: string): boolean {
  const get = () => (typeof window === 'undefined' ? false : window.matchMedia(query).matches)
  const [matches, setMatches] = useState<boolean>(get)

  useEffect(() => {
    const mql = window.matchMedia(query)
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- TODO React 19 migration: convert to useSyncExternalStore (the React-19-blessed API for external-system subscriptions like matchMedia). The setState here is the standard "sync to external on mount" pattern; cascade is bounded to one render.
    setMatches(mql.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [query])

  return matches
}
