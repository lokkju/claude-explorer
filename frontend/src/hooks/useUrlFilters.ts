import { useMemo } from 'react'
import { useSearchParams, useLocation, useParams } from 'react-router'
import type { FilterMode } from '@/lib/filterEngine'

/**
 * URL-derived transient filter state for the conversation sidebar (Build-6).
 *
 * Reads `?q=`, `?title=`, `?filterMode=`, `?project=` from the current URL,
 * plus the `:projectSlug` path param for `/projects/:projectSlug`.
 */
export interface UrlFilters {
  q: string
  title: string
  filterMode: FilterMode
  project: string
}

export function useUrlFilters(): UrlFilters {
  const [params] = useSearchParams()
  const location = useLocation()
  const pathParams = useParams()

  return useMemo(() => {
    const q = params.get('q') ?? ''
    const title = params.get('title') ?? ''
    const rawMode = params.get('filterMode')
    const filterMode: FilterMode = rawMode === 'regex' ? 'regex' : 'glob'

    let project = params.get('project') ?? ''
    if (!project && location.pathname.startsWith('/projects/')) {
      project = pathParams.projectSlug ?? ''
    }
    return { q, title, filterMode, project }
  }, [params, location.pathname, pathParams.projectSlug])
}
