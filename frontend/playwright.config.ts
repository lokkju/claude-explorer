import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E test configuration.
 * See https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  // Live-backend specs (conversations.spec.ts, search.spec.ts,
  // keyboard-navigation.spec.ts, etc.) hit the user's actual data dir,
  // which can be hundreds of MB. With multiple workers in flight the
  // backend serializes file I/O and individual requests routinely take
  // 2–3 seconds. Cap workers at 2 and give every test a 120s budget so
  // those specs finish reliably under load.
  workers: process.env.CI ? 1 : 2,
  timeout: 120_000,
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
      command: 'cd .. && DYLD_LIBRARY_PATH=/opt/homebrew/lib uv run uvicorn backend.main:app --port 8000',
      url: 'http://localhost:8000/api/config',
      reuseExistingServer: !process.env.CI,
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
