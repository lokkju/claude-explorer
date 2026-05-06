import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Playwright E2E test configuration.
 *
 * The suite runs in **fixture mode**: the backend is booted with
 * `CLAUDE_EXPORTER_DATA_DIR` and `CLAUDE_DIR` pointing at
 * `backend/tests/fixtures/`, which contains a small set of synthetic
 * conversations checked into the repo. This means external
 * contributors can clone the repo and run `npm run test:e2e` without
 * needing access to a real `~/.claude-exporter/` or `~/.claude/`.
 *
 * Note: most specs now use `mockBackend()` (see `e2e/fixtures.ts`) and
 * intercept the API at the network layer, so they do not depend on the
 * booted backend's data at all. The fixture-mode boot remains here as a
 * safety net for any spec that still reaches the real network. Phase 6
 * of the mock-data conversion plan will drop the backend boot entirely.
 */
const REPO_ROOT = path.resolve(__dirname, '..');
const FIXTURES_DESKTOP = path.join(REPO_ROOT, 'backend', 'tests', 'fixtures', 'desktop');
const FIXTURES_CLAUDE = path.join(REPO_ROOT, 'backend', 'tests', 'fixtures', 'claude');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  // Fixture mode reads small synthetic JSON/JSONL files (microsecond
  // I/O), so we can safely run more workers than a live backend would
  // allow.
  workers: process.env.CI ? 2 : 4,
  timeout: 60_000,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Uncomment to test in other browsers
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
    // Mobile viewport
    // {
    //   name: 'mobile-chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
  ],

  // Run local dev servers before tests
  webServer: [
    {
      // Fixture-mode boot: env vars override the backend's data + claude
      // dirs to point at backend/tests/fixtures/.
      command: `cd .. && CLAUDE_EXPORTER_DATA_DIR='${FIXTURES_DESKTOP}' CLAUDE_DIR='${FIXTURES_CLAUDE}' DYLD_LIBRARY_PATH=/opt/homebrew/lib uv run uvicorn backend.main:app --port 8000`,
      url: 'http://localhost:8000/api/config',
      // We need a fresh backend boot so the fixture env vars take
      // effect cleanly.
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
  ],
});
