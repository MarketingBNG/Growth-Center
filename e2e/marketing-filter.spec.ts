import { expect, test } from '@playwright/test';
import { signIn } from './auth';

// The channel filter is supposed to scope the whole page, not just the campaign table.
// It used to narrow the table while the band above it still showed the whole business, so
// a blended ROAS of 225x sat over a table of Meta campaigns that had earned none of it.
test('the channel filter scopes the band and the trend, not just the table', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(120_000);
  await signIn(context, baseURL!, 'marketing@usaindiacfo.com');

  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

  await page.goto('/marketing', { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForSelector('nav a', { timeout: 60_000 });
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });

  const main = page.locator('main');
  // Unfiltered: the channel comparison chart is on the page.
  await expect(page.getByText('Revenue by channel')).toBeVisible();
  const unfiltered = await main.innerText();

  // Clicked once and then waited out, rather than retried. The chip is a client component
  // whose handler router.replace()s, and in dev the server recompiles the route on the new
  // search params — about fifteen seconds here. Clicking again while that is in flight
  // restarts it, so a retry loop never finishes and reads as a dead button.
  const chip = page.getByRole('button', { name: 'Meta Ads', exact: true });
  await expect(chip).toBeVisible();
  // Give hydration a moment; a click landing before it is attached is simply dropped.
  await page.waitForTimeout(3000);
  await chip.click();

  await expect(page).toHaveURL(/channelId=/, { timeout: 60_000 });
  await expect(chip).toHaveAttribute('aria-pressed', 'true', { timeout: 30_000 });

  // Scoped: the page says so, and the comparison chart is gone because the question it
  // answers has been answered.
  await expect(page.getByText('Every figure on this page covers Meta Ads only.')).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText('Revenue by channel')).toHaveCount(0);

  // And the numbers actually moved. Without this the three assertions above would still
  // pass if the band were left reading the whole business.
  expect(await main.innerText()).not.toEqual(unfiltered);

  await page.screenshot({ path: 'screenshots/marketing-filtered.png', fullPage: true, timeout: 30_000 });

  expect(problems, problems.join('\n')).toEqual([]);
});
