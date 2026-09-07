import { test } from '@playwright/test';
import { signIn } from './auth';

// Walks every route and reports layout faults programmatically, so they can be found
// without eyeballing 22 screenshots. Needs `npm run dev` on 3000 and NEXTAUTH_SECRET.

const PAGES: [string, string][] = [
  ['dashboard', '/'],
  ['leads', '/leads'],
  ['crm', '/crm'],
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
  ['glossary', '/glossary'],
];

test('audit', async ({ page, context, baseURL }) => {
  test.setTimeout(900_000);
  await signIn(context, baseURL!, 'marketing@usaindiacfo.com');
  const out: string[] = [];

  for (const [name, path] of PAGES) {
    const errs: string[] = [];
    const onErr = (m: { type: () => string; text: () => string }) => {
      if (m.type() === 'error') errs.push(`console: ${m.text().slice(0, 160)}`);
    };
    page.on('console', onErr);
    const onPageErr = (e: Error) => errs.push(`pageerror: ${e.message.slice(0, 160)}`);
    page.on('pageerror', onPageErr);

    try {
      await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 120_000 });
      await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
      await page.waitForSelector('nav a', { timeout: 90_000 });
      await page.waitForTimeout(1500);
    } catch (e) {
      out.push(`${name}: LOAD FAILED ${(e as Error).message.slice(0, 120)}`);
      page.off('console', onErr);
      page.off('pageerror', onPageErr);
      continue;
    }

    const found = await page.evaluate(() => {
      const bad: string[] = [];
      const txt = (el: Element) => (el.textContent ?? '').trim().replace(/\s+/g, ' ');

      // 1. Horizontal overflow that nothing can scroll.
      if (document.documentElement.scrollWidth > window.innerWidth + 1)
        bad.push(`page scrolls sideways (${document.documentElement.scrollWidth} > ${window.innerWidth})`);

      for (const el of Array.from(document.querySelectorAll<HTMLElement>('main *'))) {
        const cs = getComputedStyle(el);
        const scrollable = /auto|scroll/.test(cs.overflowX);
        if (!scrollable && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
          const clipped = cs.overflow === 'hidden' || cs.textOverflow === 'ellipsis';
          if (!clipped && el.children.length > 0)
            bad.push(`overflows its box: <${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 40)}> ${el.scrollWidth}>${el.clientWidth}`);
        }
      }

      // 2. Ragged card rows: siblings in one grid whose heights disagree a lot.
      for (const grid of Array.from(document.querySelectorAll<HTMLElement>('main div'))) {
        if (getComputedStyle(grid).display !== 'grid') continue;
        const kids = Array.from(grid.children) as HTMLElement[];
        if (kids.length < 3) continue;
        const tops = new Set(kids.map((k) => Math.round(k.getBoundingClientRect().top)));
        if (tops.size !== 1) continue; // only judge a single row
        const hs = kids.map((k) => k.getBoundingClientRect().height);
        const inner = kids.map((k) => {
          const c = Array.from(k.children) as HTMLElement[];
          if (!c.length) return 0;
          const t = Math.min(...c.map((x) => x.getBoundingClientRect().top));
          const b = Math.max(...c.map((x) => x.getBoundingClientRect().bottom));
          return b - t;
        });
        const slack = Math.max(...hs) - Math.max(...inner);
        if (Math.max(...hs) > 0 && slack > 48)
          bad.push(`row of ${kids.length} cards is ${Math.round(slack)}px taller than its tallest content`);
      }

      // 3. Internal jargon leaking into rendered copy.
      // innerText of <main>, not textContent of <body>: textContent includes the RSC
      // payload Next inlines in a <script>, which mentions "undefined" on every page.
      const body = (document.querySelector('main') as HTMLElement | null)?.innerText ?? '';
      for (const m of body.match(/§[\d.]+/g) ?? []) bad.push(`renders manual reference "${m}"`);
      for (const m of body.match(/\bTODO\b|\bFIXME\b|\bXXX\b|undefined\b|\bNaN\b|\[object Object\]/g) ?? [])
        bad.push(`renders "${m}"`);

      // 4. Repeated identical rows in one list.
      for (const list of Array.from(document.querySelectorAll('main ul, main tbody'))) {
        const seen = new Map<string, number>();
        for (const li of Array.from(list.children)) {
          const t = txt(li);
          if (t.length < 12) continue;
          seen.set(t, (seen.get(t) ?? 0) + 1);
        }
        for (const [t, n] of seen) if (n > 1) bad.push(`${n} identical rows: "${t.slice(0, 70)}"`);
      }

      // 5. What is above the fold at 900px.
      const h1 = document.querySelector('main h1, main h2');
      const firstNum = Array.from(document.querySelectorAll<HTMLElement>('main .tnum'))[0];
      if (h1 && firstNum) {
        const y = firstNum.getBoundingClientRect().top + window.scrollY;
        if (y > 900) bad.push(`first number sits ${Math.round(y)}px down — below the fold`);
      }

      // 6. Tiny/empty main.
      const main = document.querySelector('main');
      if (main && txt(main).length < 40) bad.push('main is essentially empty');

      return bad;
    });

    page.off('console', onErr);
    page.off('pageerror', onPageErr);
    const all = [...new Set([...found, ...errs])];
    out.push(all.length ? `${name}:\n  - ${all.join('\n  - ')}` : `${name}: ok`);
  }

  console.log('\n===AUDIT===\n' + out.join('\n'));
});
