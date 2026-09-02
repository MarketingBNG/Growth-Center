import { expect, test } from '@playwright/test';
import { signIn } from './auth';

test('choosing an option drives the filter and the form value', async ({ page, context, baseURL }) => {
  test.setTimeout(180_000);
  await signIn(context, baseURL!, 'marketing@usaindiacfo.com');

  await page.goto('/tasks', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('nav a', { timeout: 120_000 });

  // Synthesized onChange -> filter bar -> query string.
  await page.getByRole('combobox').first().click();
  await page.getByRole('option', { name: 'done', exact: true }).click();
  await expect(page).toHaveURL(/status=done/, { timeout: 20_000 });
  await expect(page.getByRole('combobox').first()).toContainText('done');

  // And back to the "all" row, which is the reserved empty value.
  await page.getByRole('combobox').nth(1).click();
  const all = page.getByRole('option').first();
  await all.click();
  await page.waitForTimeout(1000);

  // Form field: the hidden input must carry the real value, not the sentinel.
  await page.goto('/content', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('nav a', { timeout: 120_000 });
  await page.getByRole('button', { name: /new piece/i }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox').first().click();
  await page.getByRole('option', { name: 'draft', exact: true }).click();
  await expect(dialog.getByRole('combobox').first()).toContainText('draft');
  expect(await dialog.locator('input[name="status"]').inputValue()).toBe('draft');
  expect(await dialog.locator('input[name="format"]').inputValue()).toBe('blog');
});
