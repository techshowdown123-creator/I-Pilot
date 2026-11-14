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
  await expect(page.getByTestId('source-pill')).toContainText('Camera', { timeout: 45_000 });

  // No calibration yet in a fresh profile.
  await expect(page.locator('ipilot-overlay').locator('.status')).toContainText('Not calibrated');

  // Diagnostics show the camera running at a real frame rate.
  await page.getByRole('button', { name: /Diagnostics/ }).click();
  const fps = page.getByText(/\d+ fps · (GPU|CPU)/);
  await expect.poll(async () => parseInt((await fps.textContent()) ?? '0'), { timeout: 15_000 }).toBeGreaterThan(3);
  expect(external, 'no third-party requests: model and WASM are self-hosted').toEqual([]);
});
