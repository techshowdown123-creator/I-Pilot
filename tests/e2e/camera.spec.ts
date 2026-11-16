import { expect, test } from '@playwright/test';

// Chrome is launched with a fake camera (a moving test pattern, no face), so
// this checks that the self-hosted MediaPipe WASM + model load and that frames
// flow through the pipeline — not gaze accuracy.
test('camera mode loads MediaPipe Face Landmarker and processes frames on-device', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (!['localhost', '127.0.0.1'].includes(u.hostname) && u.protocol.startsWith('http')) external.push(r.url());
  });
  await page.goto('/#/');
  await page.getByTestId('start-camera').click();
  await expect(page.getByTestId('source-pill')).toHaveText('Camera', { timeout: 45_000 });

  // No calibration yet in a fresh profile: the next step is offered.
  await expect(page.locator('ipilot-overlay').locator('.status')).toContainText('Not calibrated');
  await expect(page.getByTestId('calibrate')).toBeVisible();
  // The camera preview is shown on the calibration page.
  await expect(page.locator('video')).toBeVisible();

  // Frames are processed at a real frame rate.
  const fps = () => page.evaluate(() => (window as unknown as { __ipilot: { getSource: () => { frames: { fps: number } } } }).__ipilot.getSource().frames.fps);
  // Generous timeout: the first run after a rebuild loads the model cold.
  await expect.poll(fps, { timeout: 40_000 }).toBeGreaterThan(3);
  expect(external, 'no third-party requests: model and WASM are self-hosted').toEqual([]);
});

test('after a reload, a calibrated user with camera access goes straight back to playing', async ({ page, context }) => {
  await context.grantPermissions(['camera']);
  await page.addInitScript(() => {
    const d = 16;
    const model = { version: 1, fit: 2, mean: new Array(d).fill(0), std: new Array(d).fill(1), wx: new Array(d + 4).fill(0), wy: new Array(d + 4).fill(0), lambda: 1, createdAt: Date.now() };
    localStorage.setItem('ipilot.model', JSON.stringify(model));
    localStorage.setItem('ipilot.calibration', JSON.stringify({ errorPx: 50, rmsPx: 60, blinkThreshold: null, at: Date.now(), samples: 300 }));
  });
  await page.goto('/#/game');
  await expect(page.getByTestId('source-pill')).toHaveText('Camera', { timeout: 45_000 });
  await expect(page.getByTestId('game-start')).toBeVisible();
});

test('the camera keeps running when you go from calibration to the game and back', async ({ page }) => {
  const state = () =>
    page.evaluate(() => {
      const src = (window as unknown as { __ipilot: { getSource: () => { frames: { fps: number; video: HTMLVideoElement } } } }).__ipilot.getSource();
      return { fps: src.frames.fps, paused: src.frames.video.paused };
    });
  await page.goto('/#/');
  await page.getByTestId('start-camera').click();
  await expect(page.getByTestId('calibrate')).toBeVisible({ timeout: 45_000 });
  await expect.poll(async () => (await state()).fps, { timeout: 40_000 }).toBeGreaterThan(3);

  await page.getByRole('link', { name: '2 · Play' }).click();
  await page.waitForTimeout(2500);
  expect((await state()).paused).toBe(false);
  await expect.poll(async () => (await state()).fps, { timeout: 5000 }).toBeGreaterThan(3);

  await page.getByRole('link', { name: '1 · Calibrate' }).click();
  await page.waitForTimeout(2500);
  expect((await state()).paused).toBe(false);
  await expect.poll(async () => (await state()).fps, { timeout: 5000 }).toBeGreaterThan(3);
  // The preview on the calibration page is live again.
  await expect.poll(() => page.locator('[data-testid=camera-preview] video').evaluate((v: HTMLVideoElement) => !v.paused && v.readyState >= 2)).toBe(true);
});
