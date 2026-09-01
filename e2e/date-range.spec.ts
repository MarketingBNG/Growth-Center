import { expect, test } from '@playwright/test';
import { signIn } from './auth';

// The calendar writes ?from=&to= and six pages had to be taught to honour them. A picker
// that quietly changes nothing on five of the pages it appears on is worse than no picker,
// so each of them is checked rather than assumed from the one that already worked.

const PILL = 'button[aria-haspopup="dialog"]';

test.beforeEach(async ({ context, baseURL }) => {
  await signIn(context, baseURL!, 'marketing@usaindiacfo.com');
});

test('picking a start and an end puts both dates in the URL', async ({ page }) => {
  await page.goto('/analytics');
  await page.click(PILL);

  const dialog = page.getByRole('dialog', { name: 'Choose a date range' });
  await expect(dialog).toBeVisible();

  // Apply stays disabled until both ends exist — half a range is not a range.
  const apply = dialog.getByRole('button', { name: 'Apply' });
  await expect(apply).toBeDisabled();

  // Selectable days only, addressed by their ISO label so the test does not depend on
  // which month happens to be showing. Future days are disabled, and on the 1st of a
  // month that is most of what is on screen.
  const days = dialog.locator('button[aria-label]:not([disabled])');
  const first = days.nth(3);
  const startLabel = await first.getAttribute('aria-label');
  await first.click();
  await expect(apply).toBeDisabled();

  const second = days.nth(9);
  const endLabel = await second.getAttribute('aria-label');
  await second.click();
  await expect(apply).toBeEnabled();

  await apply.click();

  await expect(page).toHaveURL(new RegExp(`from=${startLabel}`));
  await expect(page).toHaveURL(new RegExp(`to=${endLabel}`));
  // The preset is dropped, or the URL would claim two different windows at once.
  await expect(page).not.toHaveURL(/range=/);
});

test('choosing a preset afterwards clears the hand-picked dates', async ({ page }) => {
  await page.goto('/analytics?from=2026-07-01&to=2026-07-15');
  await page.getByRole('button', { name: '7 days' }).click();

  await expect(page).toHaveURL(/range=7/);
  await expect(page).not.toHaveURL(/from=/);
  await expect(page).not.toHaveURL(/to=/);
});

test('the pill shows the hand-picked window, not the preset', async ({ page }) => {
  await page.goto('/analytics?from=2026-07-01&to=2026-07-15');
  await expect(page.locator(PILL)).toContainText('Jul 1 – Jul 15, 2026');
});

// Every page carrying the picker. Before this change only leads and crm read from/to; the
// rest silently rendered the last 30 days whatever the URL said.
for (const path of ['/', '/analytics', '/marketing', '/ads', '/pipeline', '/reports', '/leads']) {
  test(`${path} honours a hand-picked window`, async ({ page }) => {
    await page.goto(`${path}?from=2026-07-01&to=2026-07-15`);
    await page.waitForSelector('nav a');
    // The control reflecting the URL is the observable proof the server was handed the
    // window: these pages render the picker from the same query string they queried with.
    await expect(page.locator(PILL).first()).toContainText('Jul 1 – Jul 15, 2026');
  });
}
