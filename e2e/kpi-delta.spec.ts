import { expect, test } from '@playwright/test';
import { signIn } from './auth';

// The delta chip carries two encodings — the arrow says which way the number moved, the
// colour says whether that was good — so on a metric where a fall is the win they look
// like they disagree. This checks the word that reconciles them is there, and that a
// flat chip does not print a percentage at all.
const PAGES = ['/', '/leads', '/pipeline', '/marketing', '/analytics'];

test('a chip never contradicts itself', async ({ page, context, baseURL }) => {
  test.setTimeout(900_000);
  await signIn(context, baseURL!, 'marketing@usaindiacfo.com');

  const problems: string[] = [];
  let chips = 0;
  let worded = 0;

  for (const path of PAGES) {
    await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForSelector('nav a', { timeout: 90_000 });
    await page.waitForTimeout(1200);

    const found = await page.evaluate(() => {
      const rgb = (s: string) => (s.match(/\d+/g) ?? []).slice(0, 3).map(Number);
      const green = (c: string) => { const [r, g, b] = rgb(c); return g > r + 18 && g > b + 18; };
      const red = (c: string) => { const [r, g, b] = rgb(c); return r > g + 40 && r > b + 40; };

      const rows: { text: string; dir: string; tone: string }[] = [];
      for (const chip of Array.from(document.querySelectorAll<HTMLElement>('main span.rounded-full.tnum'))) {
        const svg = chip.querySelector('svg')?.outerHTML ?? '';
        if (!svg) continue;
        const dir = /19 12-7 7-7-7/.test(svg) ? 'down' : /m5 12 7-7 7 7/.test(svg) ? 'up' : 'flat';
        const col = getComputedStyle(chip).color;
        rows.push({
          text: chip.innerText.replace(/\s+/g, ' ').trim(),
          dir,
          tone: green(col) ? 'green' : red(col) ? 'red' : 'grey',
        });
      }
      return rows;
    });

    for (const c of found) {
      chips += 1;
      // A flat chip says so in words and prints no percentage.
      if (c.dir === 'flat' && /%/.test(c.text)) {
        problems.push(`${path}: flat chip still prints a percentage — "${c.text}"`);
      }
      // A green chip pointing down, or a red one pointing up, must carry the word.
      const needsWord =
        (c.dir === 'down' && c.tone === 'green') || (c.dir === 'up' && c.tone === 'red');
      if (needsWord) {
        if (/faster|lower|fewer|slower|higher|more/i.test(c.text)) worded += 1;
        else problems.push(`${path}: ${c.dir} arrow on a ${c.tone} chip with no word — "${c.text}"`);
      }
    }
  }

  console.log(`    ${chips} chips across ${PAGES.length} pages; ${worded} needed a word and had one`);
  expect(chips, 'found no delta chips — the selector is wrong').toBeGreaterThan(10);
  expect(worded, 'no inverted metric was exercised, so this proves nothing').toBeGreaterThan(0);
  expect([...new Set(problems)]).toEqual([]);
});
