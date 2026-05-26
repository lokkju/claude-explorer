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

/**
 * Structural equality on PinScope. Two values match when their `kind`
 * AND every kind-specific field (uuid/path/name) are identical.
 *
 * Used by `SearchPinProvider` to avoid emitting a NEW object reference
 * for a scope that hasn't logically changed. Without this, every
 * `location.search` mutation (the search-hit `?highlight=<msg>` URL
 * land, the 2-second `scheduleHighlightClear` removal, the
 * `?pin=conv:...` pin URL writes from other contexts) would set a
 * fresh `{kind: 'none'}` reference here even when the URL contained
 * no `pin=` param either before or after.
 *
 * Why identity stability matters: downstream consumers
 * (SearchPanelContext at minimum) include `pinScope` in `useMemo` /
 * `useEffect` dep lists. New references invalidate those memos and
 * fire those effects, which cascade into Cmd+G / search-hit-click
 * jump-back behavior (2026-05-24 user report). The root fix is here
 * at the source of the churn; downstream memos add defense in depth.
 */
function scopesEqual(a: PinScope, b: PinScope): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'none' && b.kind === 'none') return true
  if (a.kind === 'conversation' && b.kind === 'conversation') {
    return a.uuid === b.uuid && a.name === b.name
  }
  if (a.kind === 'project' && b.kind === 'project') {
    return a.path === b.path && a.name === b.name
  }
  return false
}

export function SearchPinProvider({ children }: { children: ReactNode }) {
  const [scope, setScope] = useState<PinScope>(() => readScopeFromUrl())
  const location = useLocation()

  // React to React Router navigation AND browser back/forward.
  //
  // 2026-05-24 (Cmd+G jump-back fix): functional `setScope((prev) =>
  // ...)` so we return the SAME reference when the URL-derived scope
  // is structurally identical to the prior value. Critical because:
  //   1. `readScopeFromUrl()` always returns a NEW object (`{kind:
  //      'none'}` literal, etc.) on every call.
  //   2. This effect re-runs on EVERY `location.search` change.
  //   3. Search-hit navigation (navigateToMatch URL fallback) appends
  //      `?highlight=<msg>` to the URL; the 2s `scheduleHighlightClear`
  //      removes it. Both trigger this effect.
  //   4. Without the functional-set guard, every such URL mutation
  //      churned `scope`'s identity, propagated through
  //      SearchPanelContext's `scope` useMemo (which returns
  //      `{organizationId: ...}` for real users with a workspace
  //      selected — also identity-fresh on every recompute), and
  //      fired the `activeMatchIndex` reset effect → auto-promote
  //      → user yanked back to match 1 ("jumps then jumps back" bug).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- TODO React 19 migration: derive scope from useLocation() directly. Today this is "sync to external state (URL) on change" — bounded cascade; the structural-equality guard ensures bail-out when the URL-derived scope is logically unchanged.
    setScope((prev) => {
      const next = readScopeFromUrl()
      return scopesEqual(prev, next) ? prev : next
    })
  }, [location.pathname, location.search])

  useEffect(() => {
    const onPop = () => setScope((prev) => {
      const next = readScopeFromUrl()
      return scopesEqual(prev, next) ? prev : next
    })
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
