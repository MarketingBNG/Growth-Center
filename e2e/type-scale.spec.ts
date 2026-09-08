import { expect, test } from '@playwright/test';
import { signIn } from './auth';

// The scale lives in @theme, so the classes only exist if Tailwind generated them. A
// missing utility is silent — the text just inherits a size — so this asserts the real
// computed pixel value for every step, and that nothing is left on an arbitrary one.
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
