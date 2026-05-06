/**
 * usePreferences (P3b) — dual-read / dual-write preferences hook.
 *
 *   const [value, setValue] = usePreferences<T>(key, fallback)
 *
 * Reads the per-user preferences blob from `/api/preferences` (TanStack
 * Query, cached under the `['preferences']` key). When the caller asks
 * for a particular key, we resolve it as:
 *
 *     server.data[key]  ??  localStorage[key]  ??  fallback
 *
 * `setValue(v)` performs a *dual-write*: it PATCHes `/api/preferences`
 * with `{ data: { [key]: v } }` AND mirrors the value into localStorage
 * synchronously. The localStorage mirror is intentional during the soak
 * window — it lets the app keep working if the backend is briefly down,
 * and lets a tab that loaded before the migration still see the latest
 * value. (The mirror will be removed in a follow-up commit after the
 * server-of-record path has been validated.)
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

interface PreferencesEnvelope {
  version: number;
  data: Record<string, unknown>;
}

async function fetchPrefs(): Promise<PreferencesEnvelope> {
  const r = await fetch('/api/preferences');
  if (!r.ok) throw new Error(`prefs GET ${r.status}`);
  return (await r.json()) as PreferencesEnvelope;
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
  return (await r.json()) as PreferencesEnvelope;
}

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

  const { data: envelope } = useQuery<PreferencesEnvelope>({
    queryKey: PREFS_QUERY_KEY,
    queryFn: fetchPrefs,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const mutation = useMutation({
    mutationFn: patchPrefs,
    onSuccess: (data) => {
      qc.setQueryData(PREFS_QUERY_KEY, data);
    },
  });

  // Dual-read: prefer server, fall back to localStorage, then to default.
  const serverValue = envelope?.data?.[key] as T | undefined;
  const localValue = readLocalStorage<T>(key);
  const value: T =
    serverValue !== undefined
      ? serverValue
      : localValue !== undefined
        ? localValue
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
