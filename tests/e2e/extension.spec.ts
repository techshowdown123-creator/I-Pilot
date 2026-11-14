import { chromium, expect, test, type BrowserContext } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Loads the built extension (npm run build:ext) into Playwright's Chromium
// with a fake camera, and checks the whole MV3 path:
// service worker → offscreen camera page (MediaPipe) → port → content script overlay.
const EXT = resolve('dist-extension');
const PAGE = `<!doctype html><title>Test page</title><body style="font:20px system-ui;padding:40px">
<button id="b1" onclick="this.textContent='clicked'">Button one</button> <a href="#x">A link</a></body>`;

let ctx: BrowserContext;
let dir: string;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ipilot-ext-'));
  ctx = await chromium.launchPersistentContext(dir, {
    channel: process.env.PW_EXT_CHANNEL ?? 'chromium',
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--disable-features=DisableLoadExtensionCommandLineSwitch', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
});

test.afterAll(async () => {
  await ctx?.close();
  rmSync(dir, { recursive: true, force: true });
});

async function worker() {
  return ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
}

test('extension injects the overlay and streams camera frames from the offscreen document', async () => {
  const sw = await worker();
  const page = await ctx.newPage();
  await page.route('http://ipilot.test/**', (r) => r.fulfill({ contentType: 'text/html', body: PAGE }));
  await page.goto('http://ipilot.test/');

  // Disabled by default: no overlay.
  await page.waitForTimeout(500);
  await expect(page.locator('ipilot-overlay')).toHaveCount(0);

  // Enable with a placeholder calibration so frames produce gaze samples.
  const dims = 16;
  await sw.evaluate(async (d) => {
    const model = { version: 1, mean: new Array(d).fill(0), std: new Array(d).fill(1), wx: new Array(d + 4).fill(0), wy: new Array(d + 4).fill(0), lambda: 1, createdAt: Date.now() };
    await chrome.storage.local.set({ enabled: true, model, settings: {} });
  }, dims);

  const status = page.locator('ipilot-overlay').locator('.status');
  await expect(page.locator('ipilot-overlay')).toHaveCount(1);
  // The fake camera shows a test pattern (no face), so once frames arrive from
  // the offscreen MediaPipe pipeline the engine pauses with "face not detected".
  await expect(status).toContainText('face not detected', { timeout: 30_000 });

  // Offscreen document exists and reports a running camera.
  const camera = await sw.evaluate(async () => {
    const ctxs = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
    return ctxs.length;
  });
  expect(camera).toBe(1);

  // Disabling removes the overlay and closes the camera.
  await sw.evaluate(() => chrome.storage.local.set({ enabled: false }));
  await expect(page.locator('ipilot-overlay')).toHaveCount(0);
  await expect
    .poll(() => sw.evaluate(async () => (await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] })).length))
    .toBe(0);
});
