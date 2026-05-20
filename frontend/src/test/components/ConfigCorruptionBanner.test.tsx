/**
 * Layer 3 of PLANS/2026.05.18-config-corruption-safe-mode.md:
 * the ConfigCorruptionBanner consumes /api/config's
 * `config_corrupt_reason` and renders a persistent (non-dismissible)
 * warning at the top of the app shell.
 *
 * Discipline:
 *
 *   - **Bidirectional pairs**: every "renders when reason present"
 *     test pairs with "absent when reason null". A trivially-broken
 *     always-render impl would pass the present-side test alone.
 *
 *   - **Path provenance**: the banner must surface the reason verbatim
 *     so the user knows which file to fix. Pinning the substring keeps
 *     a future "shorten the message for design" refactor from silently
 *     dropping the path.
 *
 *   - **Non-dismissible**: pinned via a "no dismiss button visible"
 *     assertion. Dismissing would re-enable the data-orphaning failure
 *     mode the banner exists to prevent (writes are 503'd while
 *     reason is set — see Layer 2).
 */
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { render, screen, waitFor } from '../utils';
import { server } from '../mocks/server';
import { ConfigCorruptionBanner } from '../../components/ConfigCorruptionBanner';

const CORRUPT_REASON =
  '/home/u/.claude-explorer/config.json: JSONDecodeError: ' +
  'Expecting value: line 1 column 13 (char 12)';

describe('ConfigCorruptionBanner', () => {
  it('renders the corruption reason when /api/config carries it', async () => {
    server.use(
      http.get('/api/config', () =>
        HttpResponse.json({
          data_dir: '/home/u/.claude-explorer/conversations',
          config_corrupt_reason: CORRUPT_REASON,
        }),
      ),
    );

    render(<ConfigCorruptionBanner />);

    // Banner must surface the reason VERBATIM so the user can act on
    // it without leaving the UI. We assert on stable substrings (the
    // file path + the exception name) rather than the full string to
    // allow minor copy edits without breaking the test. Use
    // ``findAllByText`` instead of ``getByText`` because the banner
    // intentionally repeats the path in the recovery hint copy, so
    // a strict singular getter would fail on the duplicate — the
    // duplication is a feature (reason line + actionable copy) not
    // a bug to dedupe.
    await waitFor(async () => {
      const matches = await screen.findAllByText(/config\.json/i);
      expect(matches.length).toBeGreaterThan(0);
    });
    expect(
      screen.getByText(/JSONDecodeError/, { exact: false }),
    ).toBeInTheDocument();
    // The recovery hint MUST appear — without it the banner is just
    // a complaint, not an actionable prompt.
    expect(screen.getByText(/Fix or remove/i)).toBeInTheDocument();
  });

  it('renders nothing when /api/config has reason=null (clean config)', async () => {
    server.use(
      http.get('/api/config', () =>
        HttpResponse.json({
          data_dir: '/home/u/.claude-explorer/conversations',
          config_corrupt_reason: null,
        }),
      ),
    );

    const { container } = render(<ConfigCorruptionBanner />);

    // Wait long enough for the useConfig query to settle. Then
    // assert no banner text is visible. A trivially-broken
    // always-render impl would fail HERE.
    await waitFor(
      () => {
        // The banner has a stable test id so absence is decidable.
        expect(
          screen.queryByTestId('config-corruption-banner'),
        ).toBeNull();
      },
      { timeout: 1500 },
    );
    // Sanity: with no banner visible, the container should have no
    // text content from the corruption pathway.
    expect(container.textContent).not.toMatch(/Fix or remove/i);
  });

  it('renders nothing while /api/config is loading', async () => {
    // Default MSW handler returns clean config; this test confirms
    // the banner doesn't flash an empty/half-rendered state during
    // the initial query. We assert the test id is absent on first
    // render — TanStack Query returns undefined data during the
    // pending state and the banner gates render on the field being
    // truthy.
    const { container } = render(<ConfigCorruptionBanner />);
    expect(
      screen.queryByTestId('config-corruption-banner'),
    ).toBeNull();
    expect(container.textContent ?? '').not.toMatch(/Fix or remove/i);
  });

  it('has no dismiss button (the banner is intentionally persistent)', async () => {
    server.use(
      http.get('/api/config', () =>
        HttpResponse.json({
          data_dir: '/home/u/.claude-explorer/conversations',
          config_corrupt_reason: CORRUPT_REASON,
        }),
      ),
    );

    render(<ConfigCorruptionBanner />);

    await waitFor(() =>
      expect(
        screen.getByTestId('config-corruption-banner'),
      ).toBeInTheDocument(),
    );

    // No close/dismiss affordance. The banner clears when the
    // backend reports config_corrupt_reason: null (which happens
    // after the user fixes their config.json — Layer 1's lru_cache
    // recheck + Layer 3's per-request cache_clear handle the
    // round-trip). Adding a dismiss would silently re-enable the
    // 503 writer gate state — bad UX, worse safety.
    const dismissByLabel = screen.queryByLabelText(/dismiss|close/i);
    expect(dismissByLabel).toBeNull();
    const dismissByRole = screen.queryByRole('button', {
      name: /dismiss|close/i,
    });
    expect(dismissByRole).toBeNull();
  });
});
