/**
 * Phase 3 of PLANS/2026.05.26-watcher-install-detection.md.
 *
 * The WatcherMissingBanner consumes /api/health/watcher and renders
 * a persistent warning when the supervised CC image-cache watcher
 * isn't installed.
 *
 * Discipline (mirrors ConfigCorruptionBanner.test pattern):
 *
 *   - **Bidirectional pairs**: every "renders when uninstalled"
 *     test pairs with "absent when installed". A trivially-broken
 *     always-render impl would pass the show-side test alone.
 *
 *   - **Install command shown verbatim**: the user must be able to
 *     copy the install command directly. Pin the substring so a
 *     future copy refactor can't silently drop the action.
 *
 *   - **User decision pinned**: per user direction on 2026-05-26,
 *     the banner shows REGARDLESS of whether the conversation has
 *     observed any missing-image events. The banner is preventative,
 *     not reactive.
 */
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { render, screen, waitFor } from '../utils';
import { server } from '../mocks/server';
import { WatcherMissingBanner } from '../../components/WatcherMissingBanner';


describe('WatcherMissingBanner', () => {
  it('renders when /api/health/watcher reports installed=false', async () => {
    server.use(
      http.get('/api/health/watcher', () =>
        HttpResponse.json({
          installed: false,
          platform: 'darwin',
          install_command: 'uv run claude-explorer install-watcher',
          docs_url: 'PLANS/2026.05.26-watcher-install-detection.md',
        }),
      ),
    );

    render(<WatcherMissingBanner />);

    await waitFor(async () => {
      const banner = await screen.findByTestId('watcher-missing-banner');
      expect(banner).toBeTruthy();
    });

    // Install command must appear verbatim — the user copies it from
    // here. A copy refactor that drops the command would fail this.
    const cmdMatches = await screen.findAllByText(/install-watcher/i);
    expect(cmdMatches.length).toBeGreaterThan(0);
  });

  it('renders nothing when /api/health/watcher reports installed=true', async () => {
    server.use(
      http.get('/api/health/watcher', () =>
        HttpResponse.json({
          installed: true,
          platform: 'darwin',
          install_command: 'uv run claude-explorer install-watcher',
          docs_url: 'PLANS/2026.05.26-watcher-install-detection.md',
        }),
      ),
    );

    const { container } = render(<WatcherMissingBanner />);

    // Wait one tick for the query to resolve, then assert absence.
    // Using container.querySelector instead of getByTestId so the
    // assertion fails fast (synchronous) if the banner appeared.
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector('[data-testid="watcher-missing-banner"]')).toBeNull();
  });

  it('renders nothing while the endpoint is still loading', async () => {
    // Hang the response forever — banner must NOT render during loading.
    // Without this, a brief "flash of warning" would show on every page
    // load even for users with the watcher installed.
    server.use(
      http.get('/api/health/watcher', () =>
        new Promise(() => { /* never resolves */ }),
      ),
    );

    const { container } = render(<WatcherMissingBanner />);

    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector('[data-testid="watcher-missing-banner"]')).toBeNull();
  });

  it('renders nothing on endpoint error (graceful degrade)', async () => {
    // If /api/health/watcher 500s for any reason, do NOT silently
    // claim "watcher missing!" — that would false-positive. Render
    // nothing; the structured log line still surfaces the truth.
    server.use(
      http.get('/api/health/watcher', () =>
        new HttpResponse(null, { status: 500 }),
      ),
    );

    const { container } = render(<WatcherMissingBanner />);

    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector('[data-testid="watcher-missing-banner"]')).toBeNull();
  });
});
