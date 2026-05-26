/**
 * Commit 5 — React Query duplicate-fetch fix: /api/config 3×.
 *
 * The Playwright waterfall on 2026-05-23 showed /api/config fetched 3
 * times on a single page load. Investigation: SettingsPage has an
 * inline `useQuery({ queryKey: ['config'], queryFn: () => api.getConfig() })`
 * that bypasses the shared `useConfig()` hook used by
 * ConfigCorruptionBanner.
 *
 * Both call sites use the SAME queryKey ('config'), so React Query
 * SHOULD dedupe them — but only if BOTH subscribers register at
 * roughly the same time AND with identical key shapes. The inline
 * useQuery in SettingsPage has subtly different timing (mounts on
 * route navigation) and the dev-mode StrictMode double-mount can
 * push the per-mount count past dedup's window.
 *
 * Fix: SettingsPage uses the `useConfig()` hook — single source of
 * truth. Both ConfigCorruptionBanner and SettingsPage become
 * observers of the SAME query (key + queryFn shared), so React Query
 * dedupes cleanly.
 *
 * Contract pinned here: rendering SettingsPage results in AT MOST
 * ONE `/api/config` fetch (the same query SettingsPage and the banner
 * are observing).
 */
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';

import { render, screen, waitFor } from '../utils';
import { server } from '../mocks/server';
import { SettingsPage } from '../../routes/SettingsPage';

describe('SettingsPage — /api/config dedup', () => {
  it('fetches /api/config exactly once on mount', async () => {
    const spy = vi.fn();
    server.use(
      http.get('/api/config', () => {
        spy();
        return HttpResponse.json({
          data_dir: '/home/test/.claude-explorer/conversations',
          config_corrupt_reason: null,
        });
      }),
      // Provide a config-stats handler too so the separate useQuery
      // on ['config-stats'] doesn't 404 and trigger React Query
      // retries / refetches that would muddy our count.
      http.get('/api/config/stats', () =>
        HttpResponse.json({ conversation_count: 42 }),
      ),
    );

    render(<SettingsPage />);

    // Wait for the page to render the data_dir (proxy for "config
    // fetch settled"). The text appears in the <p> below the
    // "Data Directory" label.
    await waitFor(
      () => {
        expect(
          screen.getByText('/home/test/.claude-explorer/conversations'),
        ).toBeInTheDocument();
      },
      { timeout: 1500 },
    );

    // The MSW handler should have been hit exactly ONCE. Pre-fix,
    // this was 2-3× due to the inline `useQuery({queryKey:['config']})`
    // not sharing observers with useConfig() somehow (probably
    // strictly-related to dev StrictMode double-mount + per-component
    // subscription timing).
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
