import { expect, test } from '@playwright/test';
import { signIn } from './auth';

// Captures every module so the pages can actually be looked at. One test per page: in
// dev each route compiles on first hit, and `networkidle` never settles because of the
// HMR websocket.

const PAGES: [string, string][] = [
  ['dashboard', '/'],
  ['leads', '/leads'],
  ['crm-companies', '/crm'],
  ['crm-contacts', '/crm?tab=contacts'],
  ['pipeline', '/pipeline'],
  ['marketing', '/marketing'],
  ['ads', '/ads'],
  ['analytics', '/analytics'],
  ['integrations', '/integrations'],
  ['seo', '/seo'],
  ['social', '/social'],
  ['outreach', '/outreach'],
  ['content', '/content'],
  ['reports', '/reports'],
  ['ai', '/ai'],
  ['tasks', '/tasks'],
  ['team', '/team'],
  ['settings', '/settings'],
];

for (const [name, path] of PAGES) {
  test(`capture ${name}`, async ({ page, context, baseURL }) => {
    test.setTimeout(120_000);
    await signIn(context, baseURL!, 'marketing@usaindiacfo.com');

    const problems: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(`console: ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    const missingAssets: string[] = [];
    page.on('response', (r) => {
      if (r.status() < 400) return;
      // A 404 on /_next/static means the dev server and a stale production build are
      // sharing .next: the HTML asks for chunk names that no longer exist, the page
      // renders with no CSS, and the screenshot is worthless. Fail loudly.
      if (r.url().includes('/_next/static/')) missingAssets.push(r.url());
      else problems.push(`${r.status()} ${r.url()}`);
    });

    // The dev-tools badge is fixed to the viewport, so a fullPage capture paints it as a
    // dark blob partway down the sidebar. Not part of the app.
    await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
    await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
    // The shell's sidebar is the last thing to hydrate, so it is a good "page is real"
    // signal without depending on any module's own content.
    await page.waitForSelector('nav a', { timeout: 60_000 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `screenshots/${name}.png`, fullPage: true, timeout: 30_000 });

    for (const p of [...new Set(problems)]) console.log(`    ${name}: ${p}`);

    expect(
      missingAssets,
      'Static assets 404ed, so this screenshot has no styling. Stop the dev server, delete .next, and start it again — a production build has left artifacts behind.',
    ).toEqual([]);

    // A styled page has a painted background. Unstyled, the body is transparent/white.
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg, `body background was ${bg} — stylesheet did not apply`).not.toBe('rgba(0, 0, 0, 0)');
  });
}
