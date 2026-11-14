import { defineConfig } from '@playwright/test';

// Extension test: needs Playwright's bundled Chromium (`npx playwright install chromium`),
// because branded Chrome/Edge no longer allow --load-extension. Run: npm run e2e:ext
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: 'extension.spec.ts',
  timeout: 90_000,
  workers: 1,
  reporter: [['list']],
});
