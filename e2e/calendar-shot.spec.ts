import { test } from '@playwright/test';
import { signIn } from './auth';

// Not checks, looks. The calendar's spacing, range shading and the two-month layout are
// things a passing assertion says nothing useful about — and both themes matter, because
// the range fill and the selected-preset tint are separate colours per theme.

test.beforeEach(async ({ context, baseURL }) => {
  await signIn(context, baseURL!, 'marketing@usaindiacfo.com');
});

for (const theme of ['light', 'dark'] as const) {
  test(`capture the open calendar (${theme})`, async ({ page }) => {
    // next-themes reads this before paint, so it is set before the first navigation.
    await page.addInitScript(
      (t) => window.localStorage.setItem('theme', t),
      theme,
    );
    await page.goto('/analytics');
    await page.waitForSelector('nav a');
    await page.click('button[aria-haspopup="dialog"]');

    const dialog = page.getByRole('dialog', { name: 'Choose a date range' });
    const days = dialog.locator('button[aria-label]:not([disabled])');

    // A start and a hover, so the shaded in-between range is in the shot rather than an
    // empty grid.
    await days.nth(5).click();
    await days.nth(20).hover();

    await page.screenshot({
      path: `screenshots/date-range-calendar-${theme}.png`,
      clip: { x: 240, y: 0, width: 1200, height: 520 },
    });
  });

  test(`capture the preset row (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => window.localStorage.setItem('theme', t), theme);
    await page.goto('/analytics?range=7');
    await page.waitForSelector('nav a');
    await page.screenshot({
      path: `screenshots/range-presets-${theme}.png`,
      clip: { x: 540, y: 80, width: 500, height: 56 },
    });
  });
}

// CRM carries the other date control — Today/Week/Month — which until now opened two
// native date inputs instead of this calendar.
for (const theme of ['light', 'dark'] as const) {
  test(`capture the CRM date control (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => window.localStorage.setItem('theme', t), theme);
    await page.goto('/crm?range=7');
    await page.waitForSelector('nav a');
    await page.click('button[aria-haspopup="dialog"]');
    const dialog = page.getByRole('dialog', { name: 'Choose a date range' });
    const days = dialog.locator('button[aria-label]:not([disabled])');
    await days.nth(5).click();
    await days.nth(18).hover();
    await page.screenshot({
      path: `screenshots/crm-date-control-${theme}.png`,
      clip: { x: 240, y: 0, width: 1200, height: 520 },
    });
  });
}
