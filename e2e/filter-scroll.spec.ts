import { expect, test } from '@playwright/test';
import { signIn } from './auth';

// Refining the view you are on must not throw you back to the page heading. Next scrolls
// to the top on every navigation unless told otherwise, and the filters navigate.
//
// These drive the search field rather than a dropdown on purpose: Playwright scrolls a
// control into view before clicking it, and every filter control sits at the top of the
// page, so a clicked filter would report a scroll reset that the app did not cause.

async function scrolledTasksPage(page: import('@playwright/test').Page) {
  await page.goto('/tasks', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('nav a', { timeout: 120_000 });
  await page.waitForTimeout(1200);
  await page.getByPlaceholder(/task title/i).fill('a');
  await page.mouse.wheel(0, 1200);
  await page.waitForTimeout(500);
  expect(
    await page.evaluate(() => window.scrollY),
    'the page must actually be scrolled for this test to mean anything',
  ).toBeGreaterThan(1000);
}

test('applying a filter keeps your place on the page', async ({ page, context, baseURL }) => {
  test.setTimeout(180_000);
  await signIn(context, baseURL!, 'marketing@usaindiacfo.com');
  await scrolledTasksPage(page);

  await page.getByPlaceholder(/task title/i).press('Enter');
  await expect(page).toHaveURL(/q=a/, { timeout: 20_000 });
  await page.waitForTimeout(1500);

  // Not 1200 exactly: a filtered table is shorter, so the browser clamps. Anywhere near
  // where you were is the point; 0 is the bug.
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(800);
});

test('sorting a column keeps your place too', async ({ page, context, baseURL }) => {
  test.setTimeout(180_000);
  await signIn(context, baseURL!, 'marketing@usaindiacfo.com');
  await page.goto('/leads', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('nav a', { timeout: 120_000 });
  await page.waitForTimeout(1200);
  await page.mouse.wheel(0, 1200);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(300);

  await page.locator('thead button').first().click();
  await page.waitForTimeout(1800);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
});
