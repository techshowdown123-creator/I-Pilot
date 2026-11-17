import { expect, test, type Page } from '@playwright/test';

/**
 * Guided calibration, end to end in the page with a fake camera whose "eyes"
 * follow the calibration dot with a 0.2 s travel delay (like real eyes).
 * Blink check and head step are skipped to keep the test short.
 */
async function start(page: Page) {
  await page.goto('/?sim#/');
  await page.mouse.move(5, 5);
  await page.mouse.move(10, 10);
  await page.evaluate(async () => {
    const { runCalibration } = await import('/src/core/gaze/calibration.ts');
    let off = { x: 0, y: 0 };
    window.addEventListener('mousemove', (e) => (off = { x: e.screenX - e.clientX, y: e.screenY - e.clientY }), true);
    let seed = 5;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const randn = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
    const root = () => document.querySelector('ipilot-overlay')!.shadowRoot!;
    let eye = { x: innerWidth / 2, y: innerHeight / 2 };
    let aim = { ...eye };
    let aimAt = 0;
    const fns = new Set<(f: object) => void>();
    setInterval(() => {
      const d = root().querySelector('.calib .target') as HTMLElement | null;
      const now = performance.now();
      if (d && d.style.display !== 'none') {
        const p = { x: parseFloat(d.style.left), y: parseFloat(d.style.top) };
        if (p.x !== aim.x || p.y !== aim.y) {
          aim = p;
          aimAt = now;
        }
        if (now - aimAt > 200) eye = aim; // the eyes arrive 0.2 s after the dot moves
      }
      const sx = eye.x + off.x + randn() * 10,
        sy = eye.y + off.y + randn() * 10;
      const features = [sx / 4000, sy / 6000, sx / 4000, sy / 6000, 0, 0, 0, 0, 0, 0, 0, 0, 0, -50, 0.3, 0.3].map((v, i) => v + (i < 4 ? 0 : (rand() - 0.5) * 1e-3));
      const f = { t: performance.timeOrigin + now, faceDetected: true, features, blinkLeft: 0.05, blinkRight: 0.05 };
      fns.forEach((fn) => fn(f));
    }, 33);
    const frames = { subscribeFrames: (fn: (f: object) => void) => (fns.add(fn), () => fns.delete(fn)), start: async () => {}, stop() {}, running: true };
    const w = window as unknown as { __ipilot: { overlay: never }; __calib: Promise<unknown> };
    w.__calib = runCalibration(w.__ipilot.overlay, frames as never, { guided: true, blinkStep: false, headStep: false }).then(
      (r) => {
        const res = r as { errorPx: number; validation: unknown[]; samples: number };
        return { ok: true, errorPx: res.errorPx, checks: res.validation.length, samples: res.samples };
      },
      (e) => ({ ok: false, error: String(e) }),
    );
  });
}

const hint = (page: Page) => page.evaluate(() => (document.querySelector('ipilot-overlay')!.shadowRoot!.querySelector('.calib .hint') as HTMLElement | null)?.innerText ?? '');
const msg = (page: Page) => page.evaluate(() => (document.querySelector('ipilot-overlay')!.shadowRoot!.querySelector('.calib .msg') as HTMLElement | null)?.innerText ?? '');
const dotCentre = (page: Page) =>
  page.evaluate(() => {
    const d = document.querySelector('ipilot-overlay')!.shadowRoot!.querySelector('.calib .target') as HTMLElement;
    return { x: parseFloat(d.style.left), y: parseFloat(d.style.top) };
  });

test('guided calibration waits for you at each dot, refuses early confirmations, then checks with a live ring and learns', async ({ page }) => {
  test.setTimeout(150_000);
  await start(page);
  await expect.poll(() => msg(page)).toContain('Guided calibration');
  await page.keyboard.press(' ');

  // Dot 1: confirming the instant it appears is refused (the eyes are still on the way).
  await expect.poll(() => hint(page)).toContain('Dot 1 of 13');
  await page.keyboard.press(' ');
  await expect.poll(() => hint(page)).toContain('a moment longer');
  // The dot waits for you.
  await page.waitForTimeout(2000);
  expect(await hint(page)).toContain('a moment longer');
  await page.keyboard.press(' ');
  await expect.poll(() => hint(page)).toContain('Dot 2 of 13');

  // Dot 2: a click away from the dot doesn't count; a click on it does.
  await page.waitForTimeout(1100);
  const d2 = await dotCentre(page);
  await page.mouse.click(d2.x + 250 > 1200 ? d2.x - 250 : d2.x + 250, d2.y);
  await expect.poll(() => hint(page)).toContain('on the dot');
  await page.mouse.click(d2.x, d2.y);
  await expect.poll(() => hint(page)).toContain('Dot 3 of 13');

  for (let i = 3; i <= 13; i++) {
    await page.waitForTimeout(1100);
    await page.keyboard.press(' ');
    if (i < 13) await expect.poll(() => hint(page)).toContain(`Dot ${i + 1} of 13`);
  }

  // Check phase: the yellow ring shows where I-Pilot thinks you're looking.
  for (let i = 1; i <= 8; i++) {
    await expect.poll(() => hint(page), { timeout: 10_000 }).toContain(`Check ${i} of 8`);
    await page.waitForTimeout(1100);
    if (i === 1) {
      const ring = await page.evaluate(() => {
        const r = document.querySelector('ipilot-overlay')!.shadowRoot!.querySelector('.calib .live') as HTMLElement;
        return { shown: r.style.display !== 'none', x: parseFloat(r.style.left), y: parseFloat(r.style.top) };
      });
      const d = await dotCentre(page);
      expect(ring.shown).toBe(true);
      expect(Math.hypot(ring.x - d.x, ring.y - d.y)).toBeLessThan(80);
      await page.screenshot({ path: 'test-results/guided-check.png' });
    }
    await page.keyboard.press(' ');
    await expect.poll(() => hint(page)).toMatch(/off here → learned/);
  }

  const r = (await page.evaluate(() => (window as unknown as { __calib: Promise<unknown> }).__calib)) as { ok: boolean; errorPx: number; checks: number; samples: number };
  expect(r.ok).toBe(true);
  expect(r.checks).toBe(8);
  expect(r.errorPx).toBeLessThan(60);
});
