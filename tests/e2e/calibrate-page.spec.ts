import { expect, test, type Page } from '@playwright/test';

/**
 * The calibration page's two actions (Recalibrate, Play) must be easy to tell
 * apart with webcam-level gaze error. A fake gaze source replaces the camera
 * so the test can say exactly where the "eyes" are, with noise and an offset.
 */

async function setupCalibrated(page: Page) {
  await page.context().grantPermissions(['camera']);
  await page.addInitScript(() => {
    const d = 16;
    const model = { version: 1, fit: 2, mean: new Array(d).fill(0), std: new Array(d).fill(1), wx: new Array(d + 4).fill(0), wy: new Array(d + 4).fill(0), lambda: 1, createdAt: Date.now() };
    localStorage.setItem('ipilot.model', JSON.stringify(model));
    localStorage.setItem('ipilot.calibration', JSON.stringify({ errorPx: 50, rmsPx: 60, cvErrorPx: 70, blinkThreshold: null, at: Date.now(), samples: 300 }));
  });
  await page.goto('/#/');
  await expect(page.getByTestId('play')).toBeVisible({ timeout: 45_000 });
  // Teach the screen mapper the window offset, then swap in a fake gaze source.
  await page.mouse.move(5, 5);
  await page.mouse.move(10, 10);
  await page.evaluate(() => {
    type Sample = { t: number; x: number; y: number; faceDetected: boolean; blink: number };
    const fns = new Set<(s: Sample) => void>();
    let off = { x: 0, y: 0 };
    window.addEventListener('mousemove', (e) => (off = { x: e.screenX - e.clientX, y: e.screenY - e.clientY }), true);
    const w = window as unknown as {
      __gazeAt: { x: number; y: number } | null;
      __ipilot: { setSource: (s: object) => void };
    };
    w.__gazeAt = null;
    let seed = 3;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const randn = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
    const src = {
      kind: 'camera',
      running: true,
      calibrated: true,
      subscribe(fn: (s: Sample) => void) {
        fns.add(fn);
        return () => fns.delete(fn);
      },
      async start() {},
      stop() {},
    };
    setInterval(() => {
      const g = w.__gazeAt;
      if (!g) return;
      // Webcam-like estimate: 30 px jitter.
      const s = { t: performance.now(), x: g.x + off.x + randn() * 30, y: g.y + off.y + randn() * 30, faceDetected: true, blink: 0 };
      for (const f of fns) f(s);
    }, 33);
    w.__ipilot.setSource(src);
  });
}

const centre = async (page: Page, id: string) => {
  const b = (await page.getByTestId(id).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const lookAt = (page: Page, p: { x: number; y: number }) => page.evaluate((q) => ((window as unknown as { __gazeAt: unknown }).__gazeAt = q), p);
/** Which of the two buttons the highlight ring is on. */
const highlighted = (page: Page) =>
  page.evaluate(() => {
    const host = document.querySelector('ipilot-overlay')!;
    const hl = host.shadowRoot!.querySelector('.hl:not(.alt)') as HTMLElement | null;
    if (!hl || getComputedStyle(hl).display === 'none') return null;
    const r = hl.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    for (const id of ['calibrate', 'play']) {
      const b = document.querySelector(`[data-testid=${id}]`)!.getBoundingClientRect();
      if (cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom) return id;
    }
    return 'other';
  });

test('looking from Play to Recalibrate moves the highlight, even with a 100 px gaze offset towards Play', async ({ page }) => {
  test.setTimeout(90_000);
  await setupCalibrated(page);
  const play = await centre(page, 'play');
  const recal = await centre(page, 'calibrate');
  // The two actions are far apart compared with typical webcam error.
  expect(Math.hypot(play.x - recal.x, play.y - recal.y)).toBeGreaterThan(250);

  await lookAt(page, play);
  await expect.poll(() => highlighted(page), { timeout: 5000 }).toBe('play');
  // Estimate biased 100 px to the right (towards Play), as a calibration
  // offset would be. With the old side-by-side buttons this picked Play.
  await lookAt(page, { x: recal.x + 100, y: recal.y });
  await expect.poll(() => highlighted(page), { timeout: 5000 }).toBe('calibrate');
  // …and back.
  await lookAt(page, { x: play.x - 100, y: play.y });
  await expect.poll(() => highlighted(page), { timeout: 5000 }).toBe('play');
});

test('the gaze-dot switch shows where I-Pilot thinks you are looking', async ({ page }) => {
  test.setTimeout(90_000);
  await setupCalibrated(page);
  const toggle = page.getByTestId('gaze-dot-toggle').locator('input');
  await toggle.check();
  await lookAt(page, await centre(page, 'calibrate'));
  const dotVisible = () =>
    page.evaluate(() => {
      const d = document.querySelector('ipilot-overlay')!.shadowRoot!.querySelector('.gaze') as HTMLElement | null;
      return !!d && getComputedStyle(d).display !== 'none' && getComputedStyle(d).opacity !== '0';
    });
  await expect.poll(dotVisible, { timeout: 5000 }).toBe(true);
  await toggle.uncheck();
  await expect.poll(dotVisible, { timeout: 5000 }).toBe(false);
});
