import { expect, test } from '@playwright/test';
import { signIn } from './auth';

// usePersisted moved from "render the fallback, then read localStorage in an effect" to
// useSyncExternalStore. The point of the old shape was that the server and the client
// agree on the first paint, so the thing worth testing is that the stored value still
// survives a reload and still does not blow up hydration.

test('a collapsed sidebar section stays collapsed across a reload', async ({
  page,
  context,
  baseURL,
}) => {
  const hydrationErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && /hydrat|did not match/i.test(m.text())) hydrationErrors.push(m.text());
  });

  await signIn(context, baseURL!, 'marketing@usaindiacfo.com');
  await page.goto('/');
  await page.waitForSelector('nav a');

  // The sidebar remembers its own collapse state under this key.
  await page.evaluate(() => window.localStorage.setItem('gc.sidebar.open', 'false'));
  await page.reload();
  await page.waitForSelector('nav');

  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem('gc.sidebar.open')))
    .toBe('false');

  // Restored, so the suite leaves no state behind for the screenshot specs.
  await page.evaluate(() => window.localStorage.setItem('gc.sidebar.open', 'true'));
  expect(hydrationErrors, hydrationErrors.join('\n')).toHaveLength(0);
});

test('a metrics band written by the old version still reads as collapsed', async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context, baseURL!, 'marketing@usaindiacfo.com');
  await page.goto('/analytics');
  await page.waitForSelector('nav a');

  // What the previous implementation wrote: '0' rather than JSON false. It has to keep
  // reading as collapsed, or everyone's bands spring open once on upgrade.
  await page.evaluate(() => window.localStorage.setItem('gc.band./analytics', '0'));
  await page.reload();

  await expect(page.getByRole('button', { name: /Show the numbers/ })).toBeVisible();
});
