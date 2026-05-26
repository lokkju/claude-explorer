/**
 * usePreferences (P3b) — dual-read / dual-write preferences hook.
 *
 *   const [value, setValue] = usePreferences<T>(key, fallback)
 *
 * Reads the per-user preferences blob from `/api/preferences` (TanStack
 * Query, cached under the `['preferences']` key). When the caller asks
 * for a particular key, resolution prefers the LATEST signal from this
 * browser (localStorage), falling back to the server, then the default:
 *
 *     localStorage[key]  ??  server.data[key]  ??  fallback
 *
 * **Local-first rationale (2026-05-22 fix):** localStorage is written
 * synchronously on every `setValue` call from THIS browser. It captures
 * the user's most recent explicit choice. The server is the cross-
 * tab/cross-process fallback. If the server's cached value diverges
 * from localStorage (stale from another tab, an earlier Playwright run,
 * or an in-flight PATCH that never landed), the user's local choice
 * still wins on the next render — they don't get "I changed it but it
 * keeps reverting" on each reload.
 *
 * Trade-off: a multi-device user who changes prefs on Device A won't
 * see those changes on Device B's next page load unless Device B's
 * localStorage is empty (first-time use) or the user clears it. For
 * the V1 single-device deployment model this is the right call —
 * "last action in this browser wins" matches user expectation. Cross-
 * device live sync is V1.1 territory.
 *
 * `setValue(v)` performs a *dual-write*: it PATCHes `/api/preferences`
 * with `{ data: { [key]: v } }` AND mirrors the value into localStorage
 * synchronously. localStorage is now load-bearing for the resolution
 * order above, NOT just a soak-window mirror.
 *
 * Migration marker: any successful call to setValue writes
 * `prefs_migrated_v1=true` to localStorage. The per-context migration
 * commits (P3c–f) check this flag so the second tab does not re-run a
 * migration that the first tab already completed. This commit only
 * sets the marker — it does NOT migrate any existing localStorage keys.
 */

import { useCallback } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

const PREFS_QUERY_KEY = ['preferences'] as const;
const MIGRATION_MARKER_KEY = 'prefs_migrated_v1';

// Mirrors backend `PreferencesEnvelope` Pydantic model in
// `backend/routers/preferences.py`. Lives here (not in `lib/types.ts`)
// because this hook is the only frontend consumer; per the Task B
// Pydantic↔TS drift audit (2026-05-18, Decision Record #7), we leave
// this co-located until a second consumer appears. If you find
// yourself re-declaring this interface in another file, HOIST it to
// `lib/types.ts` instead.
interface PreferencesEnvelope {
  version: number;
  data: Record<string, unknown>;
}

// 2026-05-18 (type-assertion-lies audit): the previous `(await r.json())
// as PreferencesEnvelope` cast was a runtime lie. If the backend ever
// returns a malformed shape (null, an array, missing `version`, …) we'd
// hand the caller a value typed PreferencesEnvelope that would either
// crash downstream or silently coerce to undefined via `?.`. This guard
// surfaces the malformation as a query error instead. `typeof === 'object'`
// alone is not enough: `typeof [] === 'object'` and `typeof null ===
// 'object'`, so both `!== null` and `!Array.isArray(...)` are
// load-bearing.
function isPrefsEnvelope(v: unknown): v is PreferencesEnvelope {
  return (
    typeof v === 'object' &&
    v !== null &&
    'version' in v &&
    typeof (v as { version: unknown }).version === 'number' &&
    'data' in v &&
    typeof (v as { data: unknown }).data === 'object' &&
    (v as { data: unknown }).data !== null &&
    !Array.isArray((v as { data: unknown }).data)
  );
}

async function fetchPrefs(signal?: AbortSignal): Promise<PreferencesEnvelope> {
  const r = await fetch('/api/preferences', { signal });
  if (!r.ok) throw new Error(`prefs GET ${r.status}`);
  const body: unknown = await r.json();
  if (!isPrefsEnvelope(body)) {
    throw new Error('prefs GET: malformed response envelope');
  }
  return body;
}

async function patchPrefs(
  patch: Record<string, unknown>,
): Promise<PreferencesEnvelope> {
  const r = await fetch('/api/preferences', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: patch }),
  });
  if (!r.ok) throw new Error(`prefs PATCH ${r.status}`);
  const body: unknown = await r.json();
  if (!isPrefsEnvelope(body)) {
    throw new Error('prefs PATCH: malformed response envelope');
  }
  return body;
}

// Trust boundary: `JSON.parse(raw) as T` is a runtime lie. We catch
// parse errors (returns undefined) but cannot validate the parsed shape
// against the generic T — that would require a per-key schema, which we
// deliberately do not adopt (council rejected wholesale Zod). Downstream
// consumers should defend against "valid JSON, wrong shape" via their
// own fallbacks. Server-of-record is the canonical store; localStorage
// is a transient mirror that may legitimately hold stale shapes during
// migrations.
function readLocalStorage<T>(key: string): T | undefined {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

function writeLocalStorage<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / disabled storage — best effort */
  }
}

function setMigrationMarker(): void {
  try {
    window.localStorage.setItem(MIGRATION_MARKER_KEY, 'true');
  } catch {
    /* best effort */
  }
}

export function usePreferences<T>(
  key: string,
  fallback: T,
): [T, (value: T) => void] {
  const qc = useQueryClient();

  // 2026-05-22 perf fix: subscribe ONLY to this hook's slice of the
  // preferences envelope via a per-key `select`. Without this, every
  // `usePreferences` consumer subscribes to the same `['preferences']`
  // queryKey, so a write to ANY preference notifies ALL observers
  // (and on the 3964-bubble conversation the resulting SettingsProvider
  // re-render cascaded through 3964 MessageBubbles via the
  // useSettings/MessageBubble.tsx:50 context-bypass-memo route, costing
  // ~9.6 s of sync work per Snippet/Full toggle).
  //
  // TanStack Query v5 short-circuits the observer notification when the
  // `select` output is referentially === to the previous output. With a
  // primitive return (string/boolean/enum — which IS what every current
  // preference key holds), `===` works correctly out of the box and no
  // custom `structuralSharing` is needed.
  //
  // `useCallback`-wrap the selector so its identity is stable across
  // renders. A fresh `select` reference would force TanStack to
  // re-evaluate it on every observer notification, defeating the
  // bailout in some configurations.
  //
  // The localStorage merge stays in the render body (NOT inside
  // select). `select` runs only when the query cache changes, but
  // `setValue` writes localStorage synchronously and triggers a
  // re-render via the useMutation observer's status change. The local-
  // first contract requires reading localStorage on every render of
  // this hook — see the regression test in
  // `usePreferences.subscriptionIsolation.test.tsx`.
  const selectKey = useCallback(
    (envelope: PreferencesEnvelope) => envelope.data[key] as T | undefined,
    [key],
  );

  const { data: serverValue } = useQuery<PreferencesEnvelope, Error, T | undefined>({
    queryKey: PREFS_QUERY_KEY,
    queryFn: ({ signal }) => fetchPrefs(signal),
    select: selectKey,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const mutation = useMutation({
    mutationFn: patchPrefs,
    onSuccess: (data) => {
      qc.setQueryData(PREFS_QUERY_KEY, data);
    },
  });

  // Dual-read: prefer localStorage (the LATEST signal from THIS browser)
  // over server (the cross-tab fallback) over the caller's fallback.
  // See module docstring for the bug this fixes — "I keep changing the
  // theme but it reverts on reload" was caused by stale server cache
  // winning over localStorage's fresh user choice.
  const localValue = readLocalStorage<T>(key);
  const value: T =
    localValue !== undefined
      ? localValue
      : serverValue !== undefined
        ? serverValue
        : fallback;

  const setValue = useCallback(
    (next: T) => {
      // Mark this client as having performed at least one server-write
      // so concurrent tabs / future contexts skip their own migration.
      setMigrationMarker();
      // Dual-write: mirror to localStorage *first* (synchronous, so the
      // value survives even if the PATCH never lands), then PATCH the
      // server.
      writeLocalStorage(key, next);
      mutation.mutate({ [key]: next });
    },
    [key, mutation],
  );

  return [value, setValue];
}
