import { expect, test, type Page } from '@playwright/test';

/**
 * "Correct my guesses": a fake camera whose eye features follow a point the
 * test controls, and a gaze model that is consistently 230 px too far right
 * (so looking at a button highlights its right-hand neighbour).
 */
async function setup(page: Page) {
  await page.goto('/?sim#/tune');
  await page.mouse.move(5, 5);
  await page.evaluate(async () => {
    const { CameraGazeSource } = await import('/src/core/input/sources.ts');
    const { GazeModel } = await import('/src/core/gaze/regression.ts');
    let off = { x: 0, y: 0 };
    window.addEventListener('mousemove', (e) => (off = { x: e.screenX - e.clientX, y: e.screenY - e.clientY }), true);
    let seed = 9;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const feat = (sx: number, sy: number) =>
      [sx / 4000, sy / 6000, sx / 4000, sy / 6000, 0, 0, 0, 0, 0, 0, 0, 0, 0, -50, 0.3, 0.3].map((v, i) => v + (i < 4 ? (rand() - 0.5) * 2e-4 : (rand() - 0.5) * 1e-3));
    // Calibration that ended up 230 px off to the right.
    const X: number[][] = [];
    const Y: { x: number; y: number }[] = [];
    for (const gx of [0.05, 0.5, 0.95]) for (const gy of [0.05, 0.5, 0.95]) for (let k = 0; k < 12; k++) {
      const sx = gx * screen.width, sy = gy * screen.height;
      X.push(feat(sx, sy));
      Y.push({ x: sx + 230, y: sy });
    }
    const model = GazeModel.fit(X, Y, 0.5);
    const w = window as unknown as { __eye: { x: number; y: number } | null; __ipilot: { setSource: (s: object) => void } };
    w.__eye = null;
    const fns = new Set<(f: object) => void>();
    const frames = { subscribeFrames: (fn: (f: object) => void) => (fns.add(fn), () => fns.delete(fn)), start: async () => {}, stop() {}, running: true };
    setInterval(() => {
      const e = w.__eye;
      if (!e) return;
      const f = { t: performance.timeOrigin + performance.now(), faceDetected: true, features: feat(e.x + off.x, e.y + off.y), blinkLeft: 0.05, blinkRight: 0.05 };
      fns.forEach((fn) => fn(f));
    }, 33);
    const src = new CameraGazeSource(frames as never, model);
    await src.start();
    w.__ipilot.setSource(src);
  });
  await page.mouse.move(10, 10);
  await expect(page.getByTestId('tune-F')).toBeVisible({ timeout: 5000 });
}

const lookAt = async (page: Page, label: string) => {
  const b = (await page.getByTestId(`tune-${label}`).boundingBox())!;
  await page.evaluate((q) => ((window as unknown as { __eye: unknown }).__eye = q), { x: b.x + b.width / 2, y: b.y + b.height / 2 });
};
/** The button I-Pilot's blue highlight is on. */
const guess = (page: Page) =>
  page.evaluate(() => {
    const hl = document.querySelector('ipilot-overlay')!.shadowRoot!.querySelector('.hl:not(.alt)') as HTMLElement | null;
    if (!hl || hl.style.display === 'none') return null;
    const r = hl.getBoundingClientRect();
    const cx = r.left + r.width / 2,
      cy = r.top + r.height / 2;
    for (const b of document.querySelectorAll('[data-testid^="tune-"]')) {
      const q = b.getBoundingClientRect();
      if (b.textContent && b.textContent.length <= 30 && cx >= q.left && cx <= q.right && cy >= q.top && cy <= q.bottom) return (b as HTMLElement).dataset.testid!.slice(5);
    }
    return 'other';
  });

test('one arrow-key correction fixes the offset, so other buttons are guessed right too', async ({ page }) => {
  test.setTimeout(90_000);
  await setup(page);
  // Looking at F: the 230 px offset makes I-Pilot guess G.
  await lookAt(page, 'F');
  await expect.poll(() => guess(page), { timeout: 5000 }).toBe('G');
  // Point it the right way: ← moves the guess onto F (orange), Enter confirms.
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('tune-F')).toHaveClass(/outline-amber-400/);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('tune-count')).toHaveText('1');
  await expect(page.getByTestId('tune-F')).toContainText(/I was 2\d\d px off/);
  await page.screenshot({ path: 'test-results/tune.png' });

  // Now a different button is guessed right straight away.
  await lookAt(page, 'B');
  await expect.poll(() => guess(page), { timeout: 5000 }).toBe('B');
  await page.keyboard.press('Enter'); // confirm a right guess
  await expect(page.getByTestId('tune-count')).toHaveText('2');
  await expect(page.getByTestId('tune-B')).toContainText(/I was \d{1,2} px off/);
  await lookAt(page, 'K');
  await expect.poll(() => guess(page), { timeout: 5000 }).toBe('K');

  // Undo brings the offset back.
  await page.getByTestId('tune-undo').click();
  await expect(page.getByTestId('tune-count')).toHaveText('0');
  await lookAt(page, 'I');
  await expect.poll(() => guess(page), { timeout: 5000 }).toBe('J');
});

test('clicking the button you are looking at also counts as a correction', async ({ page }) => {
  test.setTimeout(90_000);
  await setup(page);
  await lookAt(page, 'C');
  await expect.poll(() => guess(page), { timeout: 5000 }).toBe('D');
  await page.waitForTimeout(800);
  await page.getByTestId('tune-C').click();
  await expect(page.getByTestId('tune-count')).toHaveText('1');
  await lookAt(page, 'E');
  await expect.poll(() => guess(page), { timeout: 5000 }).toBe('E');
});

test('without a camera the page explains what is needed', async ({ page }) => {
  await page.goto('/#/tune');
  await expect(page.getByTestId('tune-go-calibrate')).toBeVisible();
  await page.getByTestId('tune-go-calibrate').click();
  await expect(page.getByRole('heading', { name: 'Calibrate your eyes' })).toBeVisible();
});

test('a calibrated user finds fine-tuning on the calibration page', async ({ page, context }) => {
  test.setTimeout(90_000);
  await context.grantPermissions(['camera']);
  await page.addInitScript(() => {
    const d = 16;
    const model = { version: 1, fit: 2, mean: new Array(d).fill(0), std: new Array(d).fill(1), wx: new Array(d + 4).fill(0), wy: new Array(d + 4).fill(0), lambda: 1, createdAt: Date.now() };
    localStorage.setItem('ipilot.model', JSON.stringify(model));
    localStorage.setItem('ipilot.calibration', JSON.stringify({ errorPx: 50, rmsPx: 60, blinkThreshold: null, at: Date.now(), samples: 300 }));
  });
  await page.goto('/#/');
  await expect(page.getByTestId('tune')).toBeVisible({ timeout: 45_000 });
  await page.getByTestId('tune').click();
  await expect(page.getByRole('heading', { name: 'Correct my guesses' })).toBeVisible();
});
