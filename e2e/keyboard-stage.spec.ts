import { expect, test } from '@playwright/test';
import { signIn } from './auth';

// The board moves deals by dragging, which no keyboard can do. This drives the table
// view's stage control with keys only — no click on the control itself — so it proves the
// move is reachable, not merely that a dropdown is in the DOM.
test('a deal can be moved to another stage with the keyboard alone', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(180_000);
  await signIn(context, baseURL!, 'marketing@usaindiacfo.com');
  await page.goto('/pipeline', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('nav a', { timeout: 90_000 });

  await page.getByRole('button', { name: 'Table' }).click();

  const triggers = page.getByRole('combobox', { name: /^Stage for / });
  await expect(triggers.first()).toBeVisible({ timeout: 30_000 });
  expect(await triggers.count(), 'every row should offer the move').toBeGreaterThan(1);

  const first = triggers.first();
  const label = (await first.getAttribute('aria-label')) ?? '';
  const before = (await first.textContent())?.trim() ?? '';

  // Focus, open, move, commit — the sequence a keyboard user actually performs.
  await first.focus();
  await expect(first).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('listbox')).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');

  // The same control now reads a different stage, and it survives the round trip.
  const moved = page.getByRole('combobox', { name: label });
  await expect(moved).not.toHaveText(before, { timeout: 30_000 });
  const after = (await moved.textContent())?.trim() ?? '';

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Table' }).click();
  await expect(page.getByRole('combobox', { name: label })).toHaveText(after, { timeout: 30_000 });
  // Put it back. This runs against the real database, not a fixture, so a test that
  // leaves a deal in a stage nobody moved it to is corrupting the data it checks.
  const restore = page.getByRole('combobox', { name: label });
  await restore.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('listbox')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('option', { name: before, exact: true }).click();
  await expect(page.getByRole('combobox', { name: label })).toHaveText(before, {
    timeout: 30_000,
  });

  console.log(`    keyboard moved "${label}" ${before} -> ${after}, held, and was put back`);
});
