import { expect, test } from '@playwright/test';

test('study mode runs pointing trials from gaze selections and records them', async ({ page }) => {
  await page.goto('/#/');
  await page.getByTestId('start-sim').click();
  await page.goto('/#/study');
  // Keep the run short: pointing task only.
  for (const t of ['menu', 'form', 'reading', 'sus']) await page.getByRole('checkbox', { name: t, exact: true }).uncheck();
  await page.getByTestId('study-begin').click();
  await expect(page.locator('h1')).toContainText('A · Raw gaze cursor'); // order A → B → C
  await page.getByTestId('condition-start').click();

  for (let i = 1; i <= 3; i++) {
    const target = page.locator('[data-study-id^="pt-"].bg-amber-400');
    await expect(target).toHaveCount(1);
    const b = (await target.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
    // Condition A selects by dwell on the element under the cursor.
    await expect(page.locator('.rounded-full.font-mono', { hasText: `${i + 1} / 12` })).toBeVisible({ timeout: 6000 });
  }
});
