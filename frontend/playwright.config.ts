import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E test configuration.
 *
 * Specs that import from `./fixtures` use `mockBackend()` (see
 * `e2e/fixtures.ts`) to intercept the network layer with an in-memory
 * mock backend, including a load-bearing catch-all guard that turns any
 * unmocked `/api/*` request into a noisy 500. As a result, no live
 * Python backend is required to run the suite — only Vite (the frontend
 * dev server) is booted here.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
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

  // Run the Vite dev server before tests. No Python backend is needed —
  // see the docblock above.
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
