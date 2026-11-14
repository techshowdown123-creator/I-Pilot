import { defineConfig } from '@playwright/test';

// End-to-end tests drive the demo app with *simulated gaze*: the mouse is the
// eye and holding Shift closes the eyes (see MouseGazeSource). By default they
// run in the locally installed Google Chrome; set PW_CHANNEL=chromium to use
// Playwright's bundled browser (`npx playwright install chromium`).
export default defineConfig({
  testDir: 'tests/e2e',
  testIgnore: 'extension.spec.ts', // see playwright.ext.config.ts
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    channel: process.env.PW_CHANNEL === 'chromium' ? undefined : 'chrome',
    viewport: { width: 1280, height: 800 },
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
  },
  webServer: {
    command: 'npx vite --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
