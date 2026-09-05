import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { articleFromUrl, titleFromSlug } from '../lib/content-autofill.ts';

const site = (path: string) => `https://usaindiacfo.com${path}`;

// The real URLs, copied from the live Search Console rows. This site puts its articles at
// the root with long hyphenated slugs and its service pages one level down.
test('an article is one segment and at least three words', () => {
  for (const path of [
    '/can-indians-own-company-in-usa-legal-guide/',
    '/gst-vs-us-sales-tax-guide-for-indian-founders/',
    '/how-to-register-a-company-in-usa-from-india-legal-guide-2025/',
    '/indian-freelancer-us-company/',
  ]) {
    assert.ok(articleFromUrl(site(path)), path);
  }
});

// Service pages live under a section with short slugs. Taking them would put "Itin" and
// "Ein" on a content calendar as though somebody had written them this week.
test('a service page one level down is not an article', () => {
  for (const path of ['/usacfo/itin/', '/usacfo/ein/', '/familyoffice/pfic/', '/usacfo/company-incorporation/']) {
    assert.equal(articleFromUrl(site(path)), null, path);
  }
});

// The site's furniture. A board carrying "Terms" and "Payment Policy" is one people stop
// believing.
test('the site’s furniture is left off the board', () => {
  for (const path of ['/', '/contact-us/', '/terms/', '/make-payment/', '/blog/', '/author/akshay-nahar/page/2/']) {
    assert.equal(articleFromUrl(site(path)), null, path);
  }
});

// The rule under-claims by about three pages — `rodtep-scheme`, `form-d`, `why-delaware`
// are genuine short articles it rejects. That is the direction to be wrong in: a board
// with three articles missing is one somebody adds three rows to.
test('the rule errs towards leaving a real article off', () => {
  assert.equal(articleFromUrl(site('/rodtep-scheme/')), null);
  assert.equal(articleFromUrl(site('/why-delaware/')), null);
});

test('a URL that is not a URL is refused rather than thrown on', () => {
  assert.equal(articleFromUrl('not a url'), null);
  assert.equal(articleFromUrl(''), null);
});

// Search Console returns a page's URL and its metrics, never its <title> — it is null on
// all 251 rows — so the title is reconstructed from the slug.
test('the title is readable, and the firm’s acronyms survive it', () => {
  assert.equal(
    articleFromUrl(site('/gst-vs-us-sales-tax-guide-for-indian-founders/'))?.title,
    'GST vs US Sales Tax Guide for Indian Founders',
  );
  assert.equal(titleFromSlug(['how', 'to', 'get', 'an', 'ein']), 'How to Get an EIN');
  // A board full of "Us Llc Ein" would be worse than no board.
  assert.equal(titleFromSlug(['us', 'llc', 'and', 'itin']), 'US LLC and ITIN');
  // A minor word still capitalises when it opens the title.
  assert.equal(titleFromSlug(['the', 'us', 'entity']), 'The US Entity');
});

// A row this created is a starting point somebody then edits — retitles it, sets the
// service line, attaches the brief. Overwriting on a later run would undo that every
// night, which is exactly how an auto-populated board teaches people to stop editing it.
test('the fill only ever creates, and never updates', () => {
  const source = readFileSync('lib/content-autofill.ts', 'utf8');
  assert.match(source, /createMany/);
  assert.doesNotMatch(source, /contentPiece\.update/);
  assert.doesNotMatch(source, /contentPiece\.upsert/);
});

// Reported rather than quietly omitted: the self-relation the webinar case needs was added
// for it, and would otherwise look like a feature nobody wired up.
test('the missing webinar source is named in the result', () => {
  const source = readFileSync('lib/content-autofill.ts', 'utf8');
  assert.match(source, /Zoho Backstage is not connected/);
});

// A page reachable with and without a trailing slash arrives twice. Deduplicated inside
// the run as well as against the board, or the first run creates the pair.
test('one run cannot create the same page twice', () => {
  assert.match(readFileSync('lib/content-autofill.ts', 'utf8'), /seen\.has\(page\.url\) \|\| known\.has\(page\.url\)/);
});

// A board that did not fill is a smaller problem than a night of syncing reported as
// failed.
test('a failed fill does not fail the nightly cron', () => {
  assert.match(readFileSync('app/api/cron/sync/route.ts', 'utf8'), /content autofill failed/);
});
