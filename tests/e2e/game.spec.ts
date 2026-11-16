import { expect, test, type Page } from '@playwright/test';

interface GameView {
  phase: string;
  score: number;
  paused: boolean;
  lanternY: number;
  nextGapY: number | null;
  canvasTop: number;
  canvasHeight: number;
}
const view = (page: Page) => page.evaluate(() => (window as unknown as { __game: { state: GameView } }).__game.state);

test('Lantern Drift: start by gaze, steer through gaps with gaze height, pause when looking away, crash ends it', async ({ page }) => {
  test.setTimeout(90_000);
  // ?sim: the mouse is the eye, Shift is a blink (hidden test mode).
  await page.goto('/?sim#/game');
  await expect(page.getByTestId('source-pill')).toContainText('Mouse');

  // Start with the eyes: look at the Start button and slow-blink.
  const startBtn = page.getByTestId('game-start');
  const b = (await startBtn.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
  await page.waitForTimeout(900);
  await page.keyboard.down('Shift');
  await page.waitForTimeout(700);
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await view(page)).phase).toBe('countdown');

  // Gaze-only mode while playing: no snapping highlight, status says so.
  await expect(page.locator('ipilot-overlay').locator('.status')).toContainText('Game mode');

  const canvas = (await page.locator('canvas').boundingBox())!;
  const x = canvas.x + canvas.width * 0.6;
  // Autopilot: look at the centre of the next gap.
  const deadline = Date.now() + 40_000;
  let v = await view(page);
  while (Date.now() < deadline) {
    v = await view(page);
    if (v.phase === 'over' || v.score >= 3) break;
    const y = v.nextGapY ?? canvas.y + canvas.height / 2;
    await page.mouse.move(x, y);
    await page.waitForTimeout(60);
  }
  expect(v.phase).toBe('playing');
  expect(v.score).toBeGreaterThanOrEqual(3);
  await expect(page.locator('ipilot-overlay').locator('.hl')).toBeHidden();

  // Looking away pauses the game.
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mouseleave')));
  await expect(page.getByTestId('game-paused')).toBeVisible({ timeout: 4000 });
  const frozen = (await view(page)).score;
  await page.waitForTimeout(1500);
  expect((await view(page)).score).toBe(frozen);

  // Back, then steer into a stalk: game over with "Play again".
  await page.mouse.move(x, canvas.y + 5);
  await expect(page.getByTestId('game-paused')).toBeHidden({ timeout: 4000 });
  await expect.poll(async () => (await view(page)).phase, { timeout: 20_000 }).toBe('over');
  await expect(page.getByTestId('game-start')).toHaveText('Play again');
  await expect(page.locator('ipilot-overlay').locator('.status')).not.toContainText('Game mode');
});

test('gaze estimates that overshoot the screen edge keep the lantern at the edge instead of pausing', async ({ page }) => {
  await page.goto('/?sim#/game');
  await expect(page.getByTestId('source-pill')).toContainText('Mouse');
  const c = (await page.locator('canvas').boundingBox())!;
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2, { steps: 3 });
  await page.getByTestId('game-start').click();
  await expect.poll(async () => (await view(page)).phase, { timeout: 6000 }).toBe('playing');
  // Feed estimates 150 px above the top of the screen for 2 s — typical webcam
  // overshoot when looking at the top of the play area (not looking away).
  await page.evaluate(async () => {
    const e = (window as unknown as { __ipilot: { emit: (k: string, v: object) => void; getSource: () => { stop: () => void } } }).__ipilot;
    e.getSource().stop(); // only the injected estimates from now on
    const end = performance.now() + 2000;
    while (performance.now() < end) {
      e.emit('sample', { t: performance.now(), x: 500, y: -150, fx: NaN, fy: NaN, faceDetected: true, blink: 0, onScreen: false });
      await new Promise((r) => setTimeout(r, 30));
    }
  });
  const v = await view(page);
  expect(v.paused).toBe(false);
  expect(v.lanternY - v.canvasTop).toBeLessThan(60); // lantern pinned near the top
});

test('the game asks for calibration when the camera is not set up', async ({ page }) => {
  await page.goto('/#/game');
  await page.getByTestId('go-calibrate').click();
  await expect(page.getByRole('heading', { name: 'Calibrate your eyes' })).toBeVisible();
  await expect(page.getByTestId('start-camera')).toBeVisible();
});

test('only the calibration step and the game exist', async ({ page }) => {
  await page.goto('/#/');
  const steps = page.getByRole('navigation', { name: 'Steps' }).getByRole('link');
  await expect(steps).toHaveText(['1 · Calibrate', '2 · Play']);
  await page.goto('/#/demo/news');
  await expect(page).toHaveURL(/#\/$/);
});
