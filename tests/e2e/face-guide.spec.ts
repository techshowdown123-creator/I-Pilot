import { expect, test, type Page } from '@playwright/test';

/**
 * Face-position guide. The fake camera shows no face, so the head position
 * the guide reads (frames.lastPose) is supplied by the test; the calibration
 * stored in the browser holds where the head was when calibrating.
 */
const REF = { cx: 0.5, cy: 0.24, iod: 0.11, roll: 0, yaw: 0, pitch: 0 };

async function setup(page: Page) {
  await page.context().grantPermissions(['camera']);
  await page.addInitScript((ref) => {
    const d = 16;
    const model = { version: 1, fit: 2, mean: new Array(d).fill(0), std: new Array(d).fill(1), wx: new Array(d + 4).fill(0), wy: new Array(d + 4).fill(0), lambda: 1, createdAt: Date.now() };
    localStorage.setItem('ipilot.model', JSON.stringify(model));
    localStorage.setItem('ipilot.calibration', JSON.stringify({ errorPx: 50, rmsPx: 60, blinkThreshold: null, at: Date.now(), samples: 300, headPose: ref }));
  }, REF);
  await page.goto('/#/');
  await expect(page.getByTestId('source-pill')).toHaveText('Camera', { timeout: 45_000 });
  await page.evaluate((ref) => {
    const w = window as unknown as { __pose: object | null; __ipilot: { getSource: () => { frames: object } } };
    w.__pose = ref;
    Object.defineProperty(w.__ipilot.getSource().frames, 'lastPose', { get: () => w.__pose, set: () => {}, configurable: true });
  }, REF);
}
const setPose = (page: Page, patch: Partial<typeof REF> | null) =>
  page.evaluate(([ref, p]) => ((window as unknown as { __pose: unknown }).__pose = p ? { ...ref, ...p } : null), [REF, patch] as const);
const ellipseX = (page: Page, id: string) => page.getByTestId(id).evaluate((e) => Number(e.getAttribute('cx')));

test('the camera preview shows where you calibrated, where you are, and how to get back', async ({ page }) => {
  test.setTimeout(90_000);
  await setup(page);
  const hint = page.getByTestId('face-guide-hint');
  await expect(page.getByTestId('face-target')).toBeVisible();
  await expect(hint).toHaveText('✓ Same position as when you calibrated');
  await expect(page.getByTestId('face-now')).toHaveAttribute('stroke', '#22c55e');

  // You moved to your left: your face is further right in the camera image,
  // which the mirrored preview shows on the LEFT of the outline.
  await setPose(page, { cx: REF.cx + 0.06 });
  await expect(hint).toContainText('Move a little to your right');
  await expect(page.getByTestId('face-now')).toHaveAttribute('stroke', '#f59e0b');
  expect(await ellipseX(page, 'face-now')).toBeLessThan(await ellipseX(page, 'face-target'));
  await page.getByTestId('camera-preview').screenshot({ path: 'test-results/face-guide.png' });

  await setPose(page, { iod: 0.13 });
  await expect(hint).toContainText('Lean back a little');
  await setPose(page, null);
  await expect(hint).toHaveText('Looking for your face…');
});

test('on other pages, a hint appears after a second away from the calibration spot and goes when you are back', async ({ page }) => {
  test.setTimeout(90_000);
  await setup(page);
  await page.getByRole('link', { name: '2 · Play' }).click();
  const pill = page.getByTestId('position-hint');
  await expect(pill).toBeHidden();
  // A brief move doesn't nag.
  await setPose(page, { cx: REF.cx - 0.06 });
  await page.waitForTimeout(600);
  await setPose(page, {});
  await page.waitForTimeout(1500);
  await expect(pill).toBeHidden();
  // Staying away does.
  await setPose(page, { cx: REF.cx - 0.06 });
  await expect(pill).toContainText('Move a little to your left', { timeout: 3000 });
  await setPose(page, {});
  await expect(pill).toBeHidden({ timeout: 2000 });
});
