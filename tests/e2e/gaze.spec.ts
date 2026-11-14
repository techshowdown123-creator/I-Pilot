import { expect, test, type Locator, type Page } from '@playwright/test';

/** Start simulated gaze (mouse = eye, Shift = eyes closed) and open a page. */
async function start(page: Page, route: string, condition?: 'A' | 'B' | 'C') {
  await page.goto('/#/');
  await page.getByTestId('start-sim').click();
  if (condition) await page.getByRole('combobox', { name: 'Condition' }).selectOption(condition);
  await page.goto('/#' + route);
  await page.waitForTimeout(300);
}

/** Look at a point: move the "eye" there and wait for the fixation to land. */
async function lookAt(page: Page, x: number, y: number, settleMs = 900) {
  await page.mouse.move(x, y, { steps: 4 });
  await page.waitForTimeout(settleMs);
}

async function lookAtEl(page: Page, el: Locator, dx = 0, dy = 0, settleMs = 900) {
  const b = (await el.boundingBox())!;
  await lookAt(page, b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, settleMs);
}

async function blink(page: Page, ms = 700) {
  await page.keyboard.down('Shift');
  await page.waitForTimeout(ms);
  await page.keyboard.up('Shift');
  await page.waitForTimeout(250);
}

const pilotState = (page: Page) => page.evaluate(() => (window as unknown as { __ipilot: { state: string } }).__ipilot.state);
const overlay = (page: Page) => page.locator('ipilot-overlay');

test('a deliberate slow blink clicks the snapped element', async ({ page }) => {
  await start(page, '/demo/dense');
  await lookAtEl(page, page.getByRole('button', { name: '5', exact: true }));
  expect(await pilotState(page)).toBe('LOCKED');
  await blink(page);
  await expect(page.getByTestId('dense-last')).toHaveText('Pressed: Key 5 (×1)');
});

test('natural (short) blinks are ignored', async ({ page }) => {
  await start(page, '/demo/dense');
  await lookAtEl(page, page.getByRole('button', { name: '8', exact: true }));
  await blink(page, 180);
  await blink(page, 300);
  await expect(page.getByTestId('dense-last')).toHaveCount(0);
});

test('gaze slightly off a button still snaps to it', async ({ page }) => {
  await start(page, '/demo/dense');
  const key = page.getByRole('button', { name: '4', exact: true });
  const b = (await key.boundingBox())!;
  // 14 px to the left of the key's edge, over empty card padding.
  await lookAt(page, b.x - 14, b.y + b.height / 2);
  await blink(page);
  await expect(page.getByTestId('dense-last')).toHaveText('Pressed: Key 4 (×1)');
});

test('close targets open a numbered chooser; looking at a tile and blinking picks it', async ({ page }) => {
  await start(page, '/demo/dense');
  const b1 = (await page.getByRole('button', { name: 'Tool B' }).boundingBox())!;
  const b2 = (await page.getByRole('button', { name: 'Tool I' }).boundingBox())!;
  await lookAt(page, (b1.x + b1.width + b2.x) / 2, b1.y + b1.height / 2);
  await blink(page);
  const tile = overlay(page).locator('.tile', { hasText: 'Tool I' });
  await expect(tile).toBeVisible();
  await lookAtEl(page, tile);
  await blink(page);
  await expect(page.getByTestId('dense-last')).toHaveText('Pressed: Tool I (×1)');
  await expect(overlay(page).locator('.modal')).toHaveCount(0);
});

test('condition B: dwell selects after about one second, once per look', async ({ page }) => {
  await start(page, '/demo/dense', 'B');
  const nine = page.getByRole('button', { name: '9', exact: true });
  await lookAtEl(page, nine, 0, 0, 1800);
  await expect(page.getByTestId('dense-last')).toHaveText('Pressed: Key 9 (×1)');
  // Keep staring: no repeated clicks (Midas touch).
  await page.waitForTimeout(2500);
  await expect(page.getByTestId('dense-last')).toHaveText('Pressed: Key 9 (×1)');
  // Look away and back: selects again.
  await lookAt(page, 900, 600, 600);
  await lookAtEl(page, nine, 0, 0, 1800);
  await expect(page.getByTestId('dense-last')).toHaveText('Pressed: Key 9 (×2)');
});

test('condition A: raw cursor does not snap, but dwelling directly on a target selects it', async ({ page }) => {
  await start(page, '/demo/dense', 'A');
  const key = page.getByRole('button', { name: '6', exact: true });
  const b = (await key.boundingBox())!;
  await lookAt(page, b.x + b.width + 4, b.y + b.height / 2, 1800); // in the gap: nothing under the cursor
  await expect(page.getByTestId('dense-last')).toHaveCount(0);
  await lookAtEl(page, key, 0, 0, 1800);
  await expect(page.getByTestId('dense-last')).toHaveText('Pressed: Key 6 (×1)');
  await page.waitForTimeout(2000);
  await expect(page.getByTestId('dense-last')).toHaveText('Pressed: Key 6 (×1)');
});

test('looking away pauses (no events) and a new fixation resumes', async ({ page }) => {
  await start(page, '/demo/dense');
  const key = page.getByRole('button', { name: '2', exact: true });
  await lookAtEl(page, key);
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mouseleave')));
  await page.waitForTimeout(600);
  expect(await pilotState(page)).toBe('PAUSED');
  await blink(page);
  await expect(page.getByTestId('dense-last')).toHaveCount(0);
  await lookAtEl(page, key, 2, 2);
  expect(await pilotState(page)).toBe('LOCKED');
  await blink(page);
  await expect(page.getByTestId('dense-last')).toHaveText('Pressed: Key 2 (×1)');
});

test('dangerous actions need confirmation', async ({ page }) => {
  await start(page, '/demo/shop');
  await page.getByRole('button', { name: 'Add to cart' }).first().click(); // set-up by mouse
  await lookAtEl(page, page.getByRole('button', { name: 'Pay now' }));
  await blink(page);
  const yes = overlay(page).locator('.tile.danger');
  await expect(yes).toContainText('Pay now');
  await lookAtEl(page, yes);
  await blink(page);
  await expect(page.getByRole('status')).toContainText('Demo payment of ₹240');
});

test('a <select> opens a gaze chooser and a text field opens the gaze keyboard', async ({ page }) => {
  await start(page, '/demo/form');
  await lookAtEl(page, page.locator('select[name=country]'));
  await blink(page);
  const nepal = overlay(page).locator('.tile', { hasText: 'Nepal' });
  await expect(nepal).toBeVisible();
  await lookAtEl(page, nepal);
  await blink(page);
  await expect(page.locator('select[name=country]')).toHaveValue('NP');

  await lookAtEl(page, page.locator('input[name=name]'));
  await blink(page);
  for (const k of ['h', 'i']) {
    await lookAtEl(page, overlay(page).locator('.key', { hasText: new RegExp(`^${k}$`) }));
    await blink(page);
  }
  await lookAtEl(page, overlay(page).locator('.key.done'));
  await blink(page);
  await expect(page.locator('input[name=name]')).toHaveValue('hi');
});

test('canvas content uses the grid fallback', async ({ page }) => {
  await start(page, '/demo/canvas');
  const c = (await page.locator('canvas').boundingBox())!;
  await lookAt(page, c.x + c.width * 0.25, c.y + c.height * 0.5);
  await blink(page);
  await expect(page.getByTestId('canvas-last')).toHaveText(/Last cell: [A-F]\d+/);
});

test('toolbar pause blocks selection until Resume is selected by gaze', async ({ page }) => {
  await start(page, '/demo/dense');
  const pause = overlay(page).locator('.tbtn.keep');
  await lookAtEl(page, pause);
  await blink(page);
  await expect(pause).toContainText('Resume');
  await lookAtEl(page, page.getByRole('button', { name: '7', exact: true }));
  await blink(page);
  await expect(page.getByTestId('dense-last')).toHaveCount(0);
  await lookAtEl(page, pause);
  await blink(page);
  await expect(pause).toContainText('Pause');
  await lookAtEl(page, page.getByRole('button', { name: '7', exact: true }));
  await blink(page);
  await expect(page.getByTestId('dense-last')).toHaveText('Pressed: Key 7 (×1)');
});
