import { expect, test } from '@playwright/test';
import { signIn } from './auth';

// Preview only. Never clicks Apply: that writes to the live Zoho account and reassigns
// real leads belonging to real people.

test('the Rebalance preview renders the real split', async ({ page, context, baseURL }) => {
  test.setTimeout(180_000);
  await signIn(context, baseURL!, 'marketing@usaindiacfo.com');

  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`);
  });

  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' }).catch(() => {});
  await page.goto('/leads', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
  await page.waitForSelector('nav a', { timeout: 90_000 });

  const button = page.getByRole('button', { name: 'Rebalance' });
  await expect(button).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: 'screenshots/rebalance-1-header.png', timeout: 30_000 });

  await button.click();

  // The dialog opens immediately and fills in when the preview lands.
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Working out the split…')).toBeVisible();

  // Fair share is the last of the three stats to have a value, so it standing in for
  // "the preview arrived" is enough.
  await expect(dialog.getByText('Fair share')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'screenshots/rebalance-2-preview.png', timeout: 30_000 });

  // The three headline figures, read back so the assertions below are about real values.
  const stat = async (label: string) =>
    dialog.locator('div', { has: page.getByText(label, { exact: true }) }).last().innerText();

  const untouched = await stat('Untouched');
  const people = await stat('People');
  const fair = await stat('Fair share');
  console.log(`    stats -> ${JSON.stringify({ untouched, people, fair })}`);

  // The roster is behind a disclosure; open it, because it is the input most likely to be
  // wrong and the screenshot should show it.
  await dialog.getByText('Sharing between everyone who currently holds an open lead').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'screenshots/rebalance-3-roster.png', timeout: 30_000 });

  // The apply button must name the count, not just say "Apply" — that number is the whole
  // consent. Read it, do NOT click it.
  const apply = dialog.getByRole('button', { name: /^Move \d+ leads$/ });
  await expect(apply).toBeVisible();
  console.log(`    apply button -> ${await apply.innerText()}`);

  // Dark is the other half of every screen here and the modal is new, so it gets looked
  // at too. Driven through the app's own toggle, because next-themes sets a class on
  // <html> and ignores prefers-color-scheme — emulateMedia changes nothing. The dialog has
  // to be closed first: Radix makes the rest of the page inert while it is open, so the
  // toggle is genuinely unclickable and not merely hidden.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);

  await button.click();
  await expect(dialog.getByText('Fair share')).toBeVisible({ timeout: 60_000 });
  await dialog.getByText('Sharing between everyone who currently holds an open lead').click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'screenshots/rebalance-4-dark.png', timeout: 30_000 });

  // The held-back figure is four digits on this data, so it must be separated like every
  // other number on the page.
  const note = await dialog.getByText(/leads move, oldest first/).innerText();
  console.log(`    note -> ${note.replace(/\s+/g, ' ')}`);
  expect(note, 'thousands separator missing').not.toMatch(/\d{4,}/);

  for (const p of [...new Set(problems)]) console.log(`    problem: ${p}`);
  expect(problems, 'page reported errors').toEqual([]);
});
