/**
 * CF1 — FilterContext composable graph + legacy migration.
 *
 * Strict TDD: these tests are written BEFORE the implementation.
 *
 * Contract:
 *   - usePreferences<FiltersState>('filters', { nodes: {}, activeId: null, _migratedV1: false }).
 *   - On first mount, if _migratedV1 !== true and legacy `savedFilters` /
 *     `activeFilterIds` are present, migrate exactly once:
 *       1. Each legacy filter -> AtomFilter (drop pinned, target, set enabled=true).
 *       2. Build a 'default-migrated' Group containing the IDs of the
 *          previously-pinned filters; activeId = 'default-migrated' if any
 *          were pinned, else null.
 *       3. PATCH the new filters blob AND explicitly null savedFilters /
 *          activeFilterIds to clear the legacy keys server-side.
 *       4. Set _migratedV1 = true so subsequent mounts skip migration.
 *   - Migration is idempotent: running twice produces the same state.
 *   - If `filters` is already present in prefs (no legacy), pass through.
 *   - If both legacy keys are missing/empty, no migration writes.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';

import { server } from '../mocks/server';
import { FilterProvider, useFilters } from '../../contexts/FilterContext';
import type { FiltersState, AtomFilter, GroupFilter } from '../../lib/filterEngine';

// jsdom localStorage mock
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    get store() { return store; },
    getItem: vi.fn((key: string) => (key in store ? store[key] : null)),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

interface PrefsStore {
  data: Record<string, unknown>;
  patches: Array<Record<string, unknown>>;
}

function installPrefs(initial: Record<string, unknown> = {}): PrefsStore {
  const store: PrefsStore = { data: { ...initial }, patches: [] };
  server.use(
    http.get('/api/preferences', () =>
      HttpResponse.json({ version: 1, data: store.data })
    ),
    http.patch('/api/preferences', async ({ request }) => {
      const body = (await request.json()) as { data?: Record<string, unknown> };
      const incoming = body.data ?? {};
      store.patches.push(incoming);
      // Mirror backend's per-key-overwrite semantics so explicit-null clears.
      Object.assign(store.data, incoming);
      return HttpResponse.json({ version: 1, data: store.data });
    })
  );
  return store;
}

function makeQc() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

// Test probe component: surfaces the FilterContext value to the test.
// Uses a ref-like holder so React's lint rule doesn't flag a render-time
// reassignment of a module-scoped binding.
const probeHolder: { current: ReturnType<typeof useFilters> | null } = { current: null };
function Probe() {
  // eslint-disable-next-line react-hooks/globals
  probeHolder.current = useFilters();
  return null;
}

function Wrapper({ children, qc }: { children: ReactNode; qc: QueryClient }) {
  return (
    <QueryClientProvider client={qc}>
      <FilterProvider>{children}</FilterProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  localStorageMock.clear();
  probeHolder.current = null;
});

describe('FilterContext — pass-through (already migrated)', () => {
  it('passes through new-shape filters without re-running migration', async () => {
    const existing: FiltersState = {
      nodes: {
        a: {
          type: 'atom', id: 'a', name: 'A', enabled: true,
          patterns: ['*foo*'], polarity: 'include', mode: 'glob', target: 'title',
        } as AtomFilter,
      },
      activeId: 'a',
      _migratedV1: true,
    };
    const prefs = installPrefs({ filters: existing });

    const qc = makeQc();
    render(
      <Wrapper qc={qc}>
        <Probe />
      </Wrapper>
    );

    await waitFor(() => {
      expect(probeHolder.current).not.toBeNull();
      expect(probeHolder.current?.filtersState.nodes.a).toBeDefined();
    });
    // No PATCH should have been issued (state already migrated).
    expect(prefs.patches).toEqual([]);
  });
});

describe('FilterContext — migration from legacy', () => {
  it('migrates pinned + unpinned legacy filters into atoms + a default-migrated group, with activeId set', async () => {
    const prefs = installPrefs({
      savedFilters: [
        { id: 'p1', name: 'Scan Gmail', patterns: ['Scan Gmail*'], polarity: 'exclude', mode: 'glob', target: 'title', pinned: true },
        { id: 'p2', name: 'Other', patterns: ['*other*'], polarity: 'include', mode: 'glob', target: 'title', pinned: false },
      ],
      activeFilterIds: [],
    });

    const qc = makeQc();
    render(
      <Wrapper qc={qc}>
        <Probe />
      </Wrapper>
    );

    // Migration writes a PATCH that includes the new filters blob and nulls
    // out the legacy keys.
    await waitFor(() => {
      expect(prefs.patches.length).toBeGreaterThan(0);
    }, { timeout: 3000 });

    // Find the migration PATCH that carries the filters key.
    const migrationPatch = prefs.patches.find(
      (b) => 'filters' in b && b.savedFilters === null && b.activeFilterIds === null
    );
    expect(migrationPatch).toBeDefined();
    const filtersBlob = (migrationPatch as { filters: FiltersState }).filters;

    // Both legacy filters present as atoms; pinned flag stripped.
    expect(filtersBlob.nodes.p1).toMatchObject({
      type: 'atom', id: 'p1', name: 'Scan Gmail', enabled: true, polarity: 'exclude',
    });
    expect(filtersBlob.nodes.p2).toMatchObject({
      type: 'atom', id: 'p2', name: 'Other', enabled: true, polarity: 'include',
    });
    // No pinned key on the new shape.
    expect((filtersBlob.nodes.p1 as unknown as { pinned?: boolean }).pinned).toBeUndefined();

    // Default-migrated group exists, contains ONLY the pinned filter, and is the active filter.
    const grp = filtersBlob.nodes['default-migrated'] as GroupFilter | undefined;
    expect(grp).toBeDefined();
    expect(grp?.type).toBe('group');
    expect(grp?.childIds).toEqual(['p1']);
    expect(filtersBlob.activeId).toBe('default-migrated');
    expect(filtersBlob._migratedV1).toBe(true);

    // Final context state reflects the new shape.
    await waitFor(() => {
      expect(probeHolder.current?.filtersState.activeId).toBe('default-migrated');
      expect(probeHolder.current?.filtersState._migratedV1).toBe(true);
    });
  });

  it('idempotency: a remount after migration does NOT re-PATCH', async () => {
    const prefs = installPrefs({
      savedFilters: [
        { id: 'p1', name: 'P1', patterns: ['*p1*'], polarity: 'include', mode: 'glob', target: 'title', pinned: true },
      ],
      activeFilterIds: [],
    });

    const qc = makeQc();
    const { unmount } = render(
      <Wrapper qc={qc}>
        <Probe />
      </Wrapper>
    );
    await waitFor(() => {
      expect(probeHolder.current?.filtersState._migratedV1).toBe(true);
    }, { timeout: 3000 });

    const patchesAfterFirstRun = prefs.patches.length;

    // Unmount + remount: a fresh context must NOT PATCH again because the
    // sentinel _migratedV1 is true on disk and the legacy keys are nulled.
    unmount();
    probeHolder.current = null;
    const qc2 = makeQc();
    render(
      <Wrapper qc={qc2}>
        <Probe />
      </Wrapper>
    );
    await waitFor(() => {
      expect(probeHolder.current?.filtersState._migratedV1).toBe(true);
    });

    // Allow any pending mutation to settle.
    await new Promise((r) => setTimeout(r, 50));
    expect(prefs.patches.length).toBe(patchesAfterFirstRun);
  });

  it('empty legacy state → no migration writes', async () => {
    // No savedFilters / activeFilterIds; no `filters` either.
    const prefs = installPrefs({});

    const qc = makeQc();
    render(
      <Wrapper qc={qc}>
        <Probe />
      </Wrapper>
    );

    // Wait for the context to settle to the fallback state.
    await waitFor(() => {
      expect(probeHolder.current?.filtersState).toBeDefined();
    });
    // A short delay to give any errant migration a chance to run.
    await new Promise((r) => setTimeout(r, 80));
    expect(prefs.patches).toEqual([]);
  });

  it('legacy with no pinned filters: activeId = null but atoms still migrated', async () => {
    const prefs = installPrefs({
      savedFilters: [
        { id: 'u1', name: 'U1', patterns: ['*u1*'], polarity: 'include', mode: 'glob', target: 'title', pinned: false },
      ],
      activeFilterIds: [],
    });

    const qc = makeQc();
    render(
      <Wrapper qc={qc}>
        <Probe />
      </Wrapper>
    );

    await waitFor(() => {
      expect(prefs.patches.length).toBeGreaterThan(0);
    }, { timeout: 3000 });

    const migrationPatch = prefs.patches.find((b) => 'filters' in b);
    expect(migrationPatch).toBeDefined();
    const filtersBlob = (migrationPatch as { filters: FiltersState }).filters;

    expect(filtersBlob.nodes.u1).toBeDefined();
    // Default-migrated group still created (with empty childIds), but not active.
    expect(filtersBlob.activeId).toBeNull();
  });
});
