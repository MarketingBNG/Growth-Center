import { expect, test } from '@playwright/test';
import { signIn } from './auth';

// The top bar is the only acknowledgement a click gets on /crm and /pipeline, which
// cannot carry a loading.tsx without turning their detail routes' 404s into 200s. If it
// silently stops appearing, those two screens go back to looking dead on click — so it
// is worth a test rather than a look.

const BAR = 'div.fixed.inset-x-0.top-0 > div';

test('the top bar appears while a tab is loading and clears on arrival', async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context, baseURL!, 'marketing@usaindiacfo.com');
  await page.goto('/');

  // Held open until the assertion below, so the bar is observed mid-navigation rather
  // than raced against a page that has already arrived.
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/pipeline**', async (route) => {
    await held;
    await route.continue();
  });

  await page.getByRole('link', { name: 'Pipeline', exact: true }).click();

  const bar = page.locator(BAR).first();
  await expect(bar).toBeVisible();
  await expect
    .poll(async () => parseFloat((await bar.evaluate((el) => getComputedStyle(el).width)) || '0'))
    .toBeGreaterThan(0);

  release();
  await page.waitForURL('**/pipeline');

  // Back to zero width once the page is there, rather than stranded across the top.
  await expect
    .poll(
      async () => parseFloat((await bar.evaluate((el) => getComputedStyle(el).width)) || '0'),
      { timeout: 5000 },
    )
    .toBe(0);
});
