import { test } from '@playwright/test';
import { signIn } from './auth';

// Not a check, a look. The calendar's spacing, range shading and the two-month layout are
// things a passing assertion says nothing useful about.
test('capture the open calendar', async ({ page, context, baseURL }) => {
  await signIn(context, baseURL!, 'marketing@usaindiacfo.com');
  await page.goto('/analytics');
  await page.waitForSelector('nav a');
  await page.click('button[aria-haspopup="dialog"]');

  const dialog = page.getByRole('dialog', { name: 'Choose a date range' });
  const days = dialog.locator('button[aria-label]:not([disabled])');

  // A start and a hover, so the shaded in-between range is in the shot rather than an
  // empty grid.
  await days.nth(5).click();
  await days.nth(20).hover();

  await page.screenshot({ path: 'screenshots/date-range-calendar.png', clip: { x: 240, y: 0, width: 1200, height: 520 } });
});
