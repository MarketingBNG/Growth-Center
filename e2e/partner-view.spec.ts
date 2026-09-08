import { expect, test } from '@playwright/test';
import { signIn } from './auth';

// Partner view is held in the browser, so the toggle must repaint without a navigation.
// This times it and checks the three things that made it worth moving: the copy changes,
// the owner names go, and the URL stays shareable.
test('partner view toggles without a round trip', async ({ page, context, baseURL }) => {
  test.setTimeout(300_000);
  await signIn(context, baseURL!, 'marketing@usaindiacfo.com');
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('nav a', { timeout: 90_000 });
  await page.waitForTimeout(2500);

  // Nothing may be fetched from the server while toggling.
  let docRequests = 0;
  page.on('request', (r) => {
    if (r.resourceType() === 'document' || r.url().includes('_rsc=')) docRequests += 1;
  });

  const btn = page.getByRole('button', { name: 'Partner view' });
  const subtitle = page.locator('main p').first();
  const plain = 'What is happening with growth, why, and what to do next.';

  // Waited for rather than counted: in dev the first hit after an edit compiles, and a
  // count taken mid-compile reads zero and says nothing about the code.
  await expect(btn).toBeVisible({ timeout: 60_000 });
  await expect(subtitle).toHaveText(plain, { timeout: 30_000 });

  for (let i = 0; i < 3; i++) {
    const on = i % 2 === 0;
    const t0 = Date.now();
    await btn.click();
    if (on) {
      await expect(subtitle).toContainText('Performance only', { timeout: 10_000 });
      await expect(btn).toHaveAttribute('aria-pressed', 'true');
    } else {
      await expect(subtitle).toHaveText(plain, { timeout: 10_000 });
      await expect(btn).toHaveAttribute('aria-pressed', 'false');
    }
    console.log(`    toggle ${i + 1} (${on ? 'on' : 'off'}): repainted in ${Date.now() - t0}ms`);
    // The URL keeps carrying it, so the mode is still shareable.
    expect(page.url().includes('view=partner')).toBe(on);
  }

  expect(docRequests, 'toggling must not fetch the page again').toBe(0);

  // The point of the mode: the owner names on Recent leads go. Read off the lead links
  // themselves, which is the one place on this page that prints an owner.
  const leadLines = () =>
    page.locator('main a[href^="/leads/"]').allInnerTexts();

  const inPartnerView = await leadLines();
  await btn.click();                                    // back to the plain view
  await expect(subtitle).toHaveText(plain, { timeout: 10_000 });
  const inPlainView = await leadLines();

  // A plain row reads "Name / Company · 6h ago · owner" — three segments on the meta
  // line. Partner view drops the last one, so count the separators.
  const withOwner = (xs: string[]) => xs.filter((t) => (t.match(/·/g) ?? []).length >= 2).length;
  console.log(
    `    lead rows naming an owner: ${withOwner(inPlainView)} plain, ${withOwner(inPartnerView)} in partner view (of ${inPlainView.length} rows)`,
  );
  expect(inPlainView.length, 'needs recent leads to test against').toBeGreaterThan(0);
  expect(withOwner(inPlainView), 'the plain view should name owners').toBeGreaterThan(0);
  expect(withOwner(inPartnerView), 'partner view should name none').toBe(0);

  // And the param still works as the way in.
  await page.goto('/?view=partner', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('nav a', { timeout: 90_000 });
  await expect(page.locator('main p').first()).toContainText('Performance only');
  console.log('    ?view=partner still seeds the mode on load');
});
