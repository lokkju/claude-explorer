import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Playwright E2E test configuration.
 *
 * The suite runs in **fixture mode by default**: the backend is booted
 * with `CLAUDE_EXPORTER_DATA_DIR` and `CLAUDE_DIR` pointing at
 * `tests/fixtures/`, which contains a small set of synthetic
 * conversations checked into the repo. This means external
 * contributors can clone the repo and run `npm run test:e2e` without
 * needing Raymond's `~/.claude-exporter/` or `~/.claude/` on disk.
 *
 * To run against your own real data instead (back-compat for Raymond),
 * use `npm run test:e2e:live`, which sets `PLAYWRIGHT_LIVE_DATA=1` and
 * leaves both env vars unset so the backend falls back to the user's
 * home dir.
 */
const REPO_ROOT = path.resolve(__dirname, '..');
const FIXTURES_DESKTOP = path.join(REPO_ROOT, 'tests', 'fixtures', 'desktop');
const FIXTURES_CLAUDE = path.join(REPO_ROOT, 'tests', 'fixtures', 'claude');
const USE_FIXTURES = !process.env.PLAYWRIGHT_LIVE_DATA;

const backendEnv = USE_FIXTURES
  ? `CLAUDE_EXPORTER_DATA_DIR='${FIXTURES_DESKTOP}' CLAUDE_DIR='${FIXTURES_CLAUDE}'`
  : '';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  // Fixture mode reads small synthetic JSON/JSONL files (microsecond
  // I/O), so we can safely run more workers than live mode allowed.
  // Live mode (PLAYWRIGHT_LIVE_DATA=1) keeps the conservative cap.
  workers: process.env.CI ? 2 : USE_FIXTURES ? 4 : 2,
  timeout: USE_FIXTURES ? 60_000 : 120_000,
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
      // dirs to point at tests/fixtures/. In live mode (the original
      // behavior) backendEnv is empty and the backend falls back to
      // ~/.claude-exporter/conversations + ~/.claude.
      command: `cd .. && ${backendEnv} DYLD_LIBRARY_PATH=/opt/homebrew/lib uv run uvicorn backend.main:app --port 8000`,
      url: 'http://localhost:8000/api/config',
      // In CI we want a fresh backend boot each run (so env vars take
      // effect cleanly). Locally, reuse existing for fast iteration.
      reuseExistingServer: !process.env.CI && !USE_FIXTURES,
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
