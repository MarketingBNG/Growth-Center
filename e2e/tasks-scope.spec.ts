import { expect, test } from '@playwright/test';
import { signIn } from './auth';

// The Tasks page shows work owned by people who have opened Growth Center. Zoho carries
// far more, owned by accounts that never sign in here, and the page must both hold those
// back by default and say that it is doing so.
test('tasks are scoped to people who have signed in', async ({ page, context, baseURL }) => {
  test.setTimeout(300_000);
  await signIn(context, baseURL!, 'marketing@usaindiacfo.com');

  const read = async () =>
    page.evaluate(() => {
      const main = document.querySelector('main') as HTMLElement;
      const pager = main.innerText.match(/1[–-]\d+ of ([\d,]+)/);
      const owners = Array.from(main.querySelectorAll('table'))
        .slice(0, 1)
        .flatMap((t) =>
          Array.from(t.querySelectorAll('tbody tr')).map((tr) =>
            (tr.querySelector('td')?.textContent ?? '').trim(),
          ),
        );
      const notice = Array.from(main.querySelectorAll('p'))
        .map((p) => p.innerText)
        .find((t) => t.includes('signed in to Growth Center')) ?? null;
      return { count: pager ? Number(pager[1].replace(/,/g, '')) : null, owners, notice };
    });

  await page.goto('/tasks', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('nav a', { timeout: 90_000 });
  await page.waitForTimeout(1200);
  const scoped = await read();

  await page.goto('/tasks?assigneeEmail=everyone', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('nav a', { timeout: 90_000 });
  await page.waitForTimeout(1200);
  const all = await read();

  console.log(`    default ${scoped.count} tasks, owners: ${scoped.owners.join(', ')}`);
  console.log(`    everyone ${all.count} tasks, ${all.owners.length} owners`);

  expect(scoped.count, 'the default should hold some back').toBeLessThan(all.count!);
  expect(scoped.count, 'but not all of them').toBeGreaterThan(0);

  // It must say so. A page quietly showing a thirtieth of the data is worse than one
  // showing all of it, because the reader cannot tell which they have.
  expect(scoped.notice, 'the default scope must be stated on the page').toContain(
    'signed in to Growth Center',
  );
  expect(all.notice, 'no scope notice when nothing is held back').toBeNull();

  // Every owner in the scoped view must be a real account, not a CRM-only one.
  expect(all.owners.length, 'everyone should list more owners').toBeGreaterThan(
    scoped.owners.length,
  );
});
