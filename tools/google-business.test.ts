import { test } from 'node:test';
import assert from 'node:assert/strict';
import { googleBusiness, locationName, readSeries } from '../lib/integrations/providers/google-business.ts';
import { youtube, channelHandle, readCursor } from '../lib/integrations/providers/youtube.ts';
import { getProvider } from '../lib/integrations/registry.ts';

// ── Google Business Profile ──────────────────────────────────────────────────────────

// The trap in this API: a day with no activity comes back with the `value` key ABSENT
// rather than present as 0. Read carelessly that is `Number(undefined)` — NaN — which
// would either fail the insert or store a metric nothing can plot.
//
// This is also the one place in this codebase where an absent number is written as zero
// rather than left unset. The distinction is real: Google is reporting that the day
// happened and nothing was counted, which is a measurement, not a gap.
test('a day Google omits a value for is zero, not NaN and not missing', () => {
  const rows = readSeries({
    timeSeries: {
      datedValues: [
        { date: { year: 2026, month: 9, day: 1 }, value: '42' },
        { date: { year: 2026, month: 9, day: 2 } },
        { date: { year: 2026, month: 9, day: 3 }, value: '7' },
      ],
    },
  });

  assert.equal(rows.length, 3, 'the quiet day is still a day and must not vanish from the series');
  assert.equal(rows[1].value, 0);
  assert.ok(!Number.isNaN(rows[1].value));
  assert.equal(rows[0].value, 42, 'Google sends these as strings');
});

test('dates are built in UTC so a series cannot shift by a day', () => {
  const [row] = readSeries({ timeSeries: { datedValues: [{ date: { year: 2026, month: 1, day: 1 }, value: 5 }] } });
  assert.equal(row.date.toISOString(), '2026-01-01T00:00:00.000Z');
});

test('a malformed date is dropped rather than becoming an epoch row', () => {
  const rows = readSeries({
    timeSeries: {
      datedValues: [{ date: { year: 2026, month: 9 }, value: 3 }, { value: 4 }, { date: { year: 2026, month: 9, day: 4 }, value: 1 }],
    },
  });
  assert.equal(rows.length, 1);
});

test('an empty or unexpected payload yields no rows rather than throwing', () => {
  assert.deepEqual(readSeries({}), []);
  assert.deepEqual(readSeries({ timeSeries: {} }), []);
  assert.deepEqual(readSeries({ timeSeries: { datedValues: 'not an array' } }), []);
});

test('a location is normalised to the resource name Google expects back', () => {
  assert.equal(locationName('1234567890'), 'locations/1234567890');
  assert.equal(locationName('locations/1234567890'), 'locations/1234567890');
  assert.equal(locationName('  locations/1234567890  '), 'locations/1234567890');

  const normalise = googleBusiness.configFields?.find((f) => f.name === 'locationId')?.normalise;
  assert.ok(normalise);
  assert.equal(normalise(''), '', 'blank means "the only listing there is"');
  assert.equal(normalise('1234567890'), 'locations/1234567890');
  assert.throws(() => normalise('USA India CFO'), /digits/);
});

// Reviews sit on an older API host behind a separate Google approval. Promising them on
// the card would be promising a column that stays empty.
test('the card does not promise reviews', () => {
  assert.ok(!googleBusiness.provides.some((p) => /review/i.test(p)));
  assert.equal(getProvider('google_business')?.name, 'Google Business Profile');
});

// ── YouTube ──────────────────────────────────────────────────────────────────────────

test('the channel handle prefers @name and falls back to the stable id', () => {
  assert.equal(channelHandle({ id: 'UC123', snippet: { customUrl: '@usaindiacfo' } }), '@usaindiacfo');
  // Google is inconsistent about whether customUrl carries the @.
  assert.equal(channelHandle({ id: 'UC123', snippet: { customUrl: 'usaindiacfo' } }), '@usaindiacfo');
  // A handle can be changed by its owner; the id cannot, so it is what a rename falls
  // back to rather than the account quietly becoming a second row.
  assert.equal(channelHandle({ id: 'UC123', snippet: {} }), 'UC123');
  assert.equal(channelHandle({}), null);
});

test('a YouTube cursor survives a round trip and a damaged one is refused', () => {
  const good = { channelId: 'UC1', handle: '@h', uploads: 'UU1', pageToken: 'tok', seen: 50 };
  assert.deepEqual(readCursor(good), good);

  assert.equal(readCursor(null), null);
  assert.equal(readCursor({ channelId: 'UC1', handle: '@h' }), null, 'no uploads playlist means nothing to resume');
  assert.equal(readCursor({ ...good, seen: -5 })?.seen, 0);
  // A finished pass has no page token, and null must survive as null rather than "null".
  assert.equal(readCursor({ ...good, pageToken: null })?.pageToken, null);
});

test('YouTube writes into the social tables that already have a slot for it', () => {
  assert.equal(youtube.category, 'social');
  assert.equal(getProvider('youtube')?.id, 'youtube');
  // Both providers reuse the existing Google client rather than asking for a new one —
  // Google scopes per authorisation, so this cannot disturb GA4 or Search Console.
  assert.deepEqual(
    youtube.requiredEnv.map((e) => e.name),
    ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  );
});
