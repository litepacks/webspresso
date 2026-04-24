/**
 * Playwright E2E Test Configuration
 */

const { defineConfig, devices } = require('@playwright/test');
const path = require('path');

module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // Run tests serially to avoid port conflicts
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker to avoid port conflicts
  /** Stop the run after the first failure (fail fast). Override: `playwright test --max-failures=N` (larger N = more failures before exit). */
  maxFailures: 1,
  reporter: 'html',
  
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'node tests/e2e/fixtures/test-server.js',
    port: 3001,
    reuseExistingServer: !process.env.CI, // Reuse existing server in dev, fresh in CI
    timeout: 120 * 1000, // 2 minutes for npm install
  },

  globalSetup: path.join(__dirname, 'tests/e2e/global-setup.js'),
  globalTeardown: path.join(__dirname, 'tests/e2e/global-teardown.js'),
});
