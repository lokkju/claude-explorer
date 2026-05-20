import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router'

/**
 * Search-scope pin (manual finding 2026-05-04).
 *
 * Default scope is global (subject only to the sidebar Source/Starred
 * filters). The user can pin search to a single conversation OR a whole
 * project; the pin is durable across panel-open/close, conversation
 * navigation, and reload, until the user explicitly unpins OR runs a
 * sidebar title-search (a global-by-construction action).
 *
 * Pin is encoded in the URL via `?pin=conv:<uuid>` or
 * `?pin=project:<path>`. URL is the source of truth so the state is
 * shareable and isolated naturally per browser tab.
 *
 * Article justification (Part 2): a sticky pin is more honest than auto-
 * scoping behind the user's back. Title search clears the pin because
 * titles span all conversations — running one is the user signaling
 * "I want to broaden."
 */

export type PinScope =
  | { kind: 'none' }
  | { kind: 'conversation'; uuid: string; name: string }
  | { kind: 'project'; path: string; name: string }

interface SearchPinContextValue {
  scope: PinScope
  pinConversation: (uuid: string, name: string) => void
  pinProject: (path: string, name: string) => void
  unpin: () => void
}

const SearchPinContext = createContext<SearchPinContextValue | null>(null)

function readScopeFromUrl(): PinScope {
  if (typeof window === 'undefined') return { kind: 'none' }
  try {
    const url = new URL(window.location.href)
    const raw = url.searchParams.get('pin')
    if (!raw) return { kind: 'none' }
    if (raw.startsWith('conv:')) {
      const uuid = raw.slice(5)
      if (!uuid) return { kind: 'none' }
      return { kind: 'conversation', uuid, name: '' }
    }
    if (raw.startsWith('project:')) {
      const path = decodeURIComponent(raw.slice(8))
      if (!path) return { kind: 'none' }
      const name = path.split('/').filter(Boolean).pop() || path
      return { kind: 'project', path, name }
    }
  } catch {
    /* fall through */
  }
  return { kind: 'none' }
}

function writeScopeToUrl(scope: PinScope) {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (scope.kind === 'none') {
    url.searchParams.delete('pin')
  } else if (scope.kind === 'conversation') {
    url.searchParams.set('pin', `conv:${scope.uuid}`)
  } else {
    url.searchParams.set('pin', `project:${encodeURIComponent(scope.path)}`)
  }
  window.history.replaceState(window.history.state, '', url.toString())
}

export function SearchPinProvider({ children }: { children: ReactNode }) {
  const [scope, setScope] = useState<PinScope>(() => readScopeFromUrl())
  const location = useLocation()

  // React to React Router navigation AND browser back/forward.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- TODO React 19 migration: derive scope from useLocation() directly. Today this is "sync to external state (URL) on change" — bounded cascade.
    setScope(readScopeFromUrl())
  }, [location.pathname, location.search])

  useEffect(() => {
    const onPop = () => setScope(readScopeFromUrl())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const pinConversation = useCallback((uuid: string, name: string) => {
    const next: PinScope = { kind: 'conversation', uuid, name }
    setScope(next)
    writeScopeToUrl(next)
  }, [])

  const pinProject = useCallback((path: string, name: string) => {
    const next: PinScope = { kind: 'project', path, name }
    setScope(next)
    writeScopeToUrl(next)
  }, [])

  const unpin = useCallback(() => {
    setScope({ kind: 'none' })
    writeScopeToUrl({ kind: 'none' })
  }, [])

  const value = useMemo<SearchPinContextValue>(
    () => ({ scope, pinConversation, pinProject, unpin }),
    [scope, pinConversation, pinProject, unpin],
  )

  return <SearchPinContext.Provider value={value}>{children}</SearchPinContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components -- safe: context Provider + hook co-located by convention. HMR fast refresh falls back to full reload; no runtime impact.
export function useSearchPin(): SearchPinContextValue {
  const ctx = useContext(SearchPinContext)
  if (!ctx) {
    return {
      scope: { kind: 'none' },
      pinConversation: () => {},
      pinProject: () => {},
      unpin: () => {},
    }
  }
  return ctx
}
