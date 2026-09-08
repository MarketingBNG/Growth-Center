import { expect, test } from '@playwright/test';
import { signIn } from './auth';

// The scale lives in @theme, so the classes only exist if Tailwind generated them, and
// they only survive if tailwind-merge knows they are font sizes rather than colours. Both
// failures are silent — the class is absent and the text inherits a size — so this
// measures rather than greps.
const STEPS: [string, string][] = [
  ['text-micro', '10px'],
  ['text-meta', '11px'],
  ['text-body', '12.5px'],
  ['text-label', '13px'],
  ['text-lead', '15px'],
  ['text-title', '17px'],
  ['text-figure', '30px'],
  ['text-display', '26px'],
];

const EXPECTED = new Map(STEPS);

test('every step of the type scale resolves', async ({ page, context, baseURL }) => {
  test.setTimeout(180_000);
  await signIn(context, baseURL!, 'marketing@usaindiacfo.com');
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('nav a', { timeout: 90_000 });

  const got = await page.evaluate((steps) => {
    const out: Record<string, string> = {};
    for (const [cls] of steps) {
      const el = document.createElement('span');
      el.className = cls;
      el.textContent = 'x';
      document.body.appendChild(el);
      out[cls] = getComputedStyle(el).fontSize;
      el.remove();
    }
    return out;
  }, STEPS);

  for (const [cls, px] of STEPS) {
    expect(got[cls], `${cls} did not resolve — Tailwind generated no utility for it`).toBe(px);
  }
  console.log('    ' + STEPS.map(([c, p]) => `${c}=${p}`).join('  '));
});

// The one that matters. A bare span carries no colour class, so it has no conflict to
// lose and passes even when tailwind-merge is stripping the size off every real
// component — which is exactly what happened: every badge in the app rendered at the
// browser's default 16px while the test above was green.
const PAGES = ['/', '/integrations', '/leads', '/pipeline', '/crm', '/seo', '/settings'];

test('elements that ask for a step actually get it', async ({ page, context, baseURL }) => {
  test.setTimeout(600_000);
  await signIn(context, baseURL!, 'marketing@usaindiacfo.com');

  const wrong: string[] = [];
  let checked = 0;

  for (const path of PAGES) {
    await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForSelector('nav a', { timeout: 90_000 });
    await page.waitForTimeout(1200);

    const found = await page.evaluate((steps) => {
      const names = steps.map(([c]) => c);
      const bad: { cls: string; got: string; want: string; text: string }[] = [];
      let n = 0;
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
        const classes = el.className;
        if (typeof classes !== 'string') continue;
        const hit = names.find((c) => classes.split(/\s+/).includes(c));
        if (!hit) continue;
        n += 1;
        const want = steps.find(([c]) => c === hit)![1];
        const got = getComputedStyle(el).fontSize;
        if (got !== want) {
          bad.push({ cls: hit, got, want, text: (el.textContent ?? '').trim().slice(0, 30) });
        }
      }
      return { bad, n };
    }, STEPS);

    checked += found.n;
    for (const b of found.bad) {
      wrong.push(`${path}: .${b.cls} rendered ${b.got}, wanted ${b.want} — "${b.text}"`);
    }
  }

  console.log(`    measured ${checked} elements across ${PAGES.length} pages`);
  expect(checked, 'found nothing carrying a scale class — the selector is wrong').toBeGreaterThan(100);
  expect([...new Set(wrong)]).toEqual([]);
});

// The invariant that cannot be evaded.
//
// A stripped class leaves nothing to look for, so the test above skips exactly the
// elements that are broken — it passed while every badge in the app rendered at 16px.
// This works the other way round: the scale has no 16px step, so any text rendering at
// the browser's default means a size was lost or never asked for. It reads what the page
// renders, not what it claims.
test('nothing renders at the browser default size', async ({ page, context, baseURL }) => {
  test.setTimeout(600_000);
  await signIn(context, baseURL!, 'marketing@usaindiacfo.com');

  const offenders: string[] = [];
  for (const path of PAGES) {
    await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForSelector('nav a', { timeout: 90_000 });
    await page.waitForTimeout(1200);

    const bad = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('main *'))) {
        // Only elements that print text of their own — a wrapper inherits a size it
        // never uses, and flagging those would be noise.
        const own = Array.from(el.childNodes)
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => (n.textContent ?? '').trim())
          .join('');
        if (!own) continue;
        if (getComputedStyle(el).fontSize === '16px') {
          out.push(`<${el.tagName.toLowerCase()} class="${el.className.toString().slice(0, 50)}"> "${own.slice(0, 30)}"`);
        }
      }
      return out;
    });
    for (const b of bad) offenders.push(`${path}: ${b}`);
  }

  expect([...new Set(offenders)]).toEqual([]);
  console.log(`    no 16px text on any of ${PAGES.length} pages`);
});

// Badges are the case that broke, because their variant string reads
// `text-meta … text-muted-foreground` and tailwind-merge kept the colour.
test('a badge is 11px wherever it appears', async ({ page, context, baseURL }) => {
  test.setTimeout(180_000);
  await signIn(context, baseURL!, 'marketing@usaindiacfo.com');
  await page.goto('/integrations', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('nav a', { timeout: 90_000 });
  await page.waitForTimeout(1200);

  const sizes = await page.evaluate(() => {
    const out: Record<string, string> = {};
    for (const el of Array.from(document.querySelectorAll('main *'))) {
      const t = (el.textContent ?? '').trim();
      if (t === 'Connected' || t === 'Not connected' || t === 'Demo data') {
        out[t] = getComputedStyle(el).fontSize;
      }
    }
    return out;
  });

  expect(Object.keys(sizes).length, 'needs a status badge to measure').toBeGreaterThan(0);
  for (const [label, size] of Object.entries(sizes)) {
    expect(size, `the "${label}" badge`).toBe(EXPECTED.get('text-meta'));
  }
  console.log('    ' + JSON.stringify(sizes));
});
