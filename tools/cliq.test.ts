import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cliqConfigured, renderCliqDigest, sendToCliq } from '../lib/cliq.ts';

const withEnv = async (value: string | undefined, fn: () => unknown) => {
  const before = process.env.CLIQ_WEBHOOK_URL;
  if (value === undefined) delete process.env.CLIQ_WEBHOOK_URL;
  else process.env.CLIQ_WEBHOOK_URL = value;
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env.CLIQ_WEBHOOK_URL;
    else process.env.CLIQ_WEBHOOK_URL = before;
  }
};

test('only a real Cliq https webhook counts as configured', async () => {
  await withEnv('https://cliq.zoho.in/api/v2/channelsbyname/growth/message?zapikey=abc', () =>
    assert.equal(cliqConfigured(), true),
  );
  await withEnv('https://cliq.zoho.com/company/123/api/v2/bots/x/message?zapikey=abc', () =>
    assert.equal(cliqConfigured(), true),
  );

  await withEnv(undefined, () => assert.equal(cliqConfigured(), false));
  await withEnv('', () => assert.equal(cliqConfigured(), false));
  // A half-pasted value is the commonest way this is misconfigured, and it must read as
  // "not set up" rather than being POSTed somewhere unexpected.
  await withEnv('paste-the-url-here', () => assert.equal(cliqConfigured(), false));
  // http, not https: credentials in a query string must not go over the clear.
  await withEnv('http://cliq.zoho.in/api/v2/x?zapikey=abc', () => assert.equal(cliqConfigured(), false));
});

test('an unconfigured or empty post fails without throwing', async () => {
  await withEnv(undefined, async () => {
    const r = await sendToCliq('anything');
    assert.equal(r.ok, false);
  });
  await withEnv('https://cliq.zoho.in/api/v2/x?zapikey=abc', async () => {
    // Refused before the network call: an empty digest posted to a team channel is worse
    // than no digest, because it trains people to ignore the channel.
    const r = await sendToCliq('   ');
    assert.equal(r.ok, false);
  });
});

test('the chat digest leads with the count and links to the page', () => {
  const text = renderCliqDigest(
    [
      { severity: 'critical', title: 'Attribution below threshold', ageHours: 76 },
      { severity: 'high', title: 'Leads never contacted', ageHours: 3 },
    ],
    9,
    'https://growth.example.com/',
  );

  const lines = text.split('\n');
  assert.match(lines[0], /11 findings waiting/, 'the count is items plus others, not items alone');
  // Whole days once past a day: "waiting 3d" is acted on, "waiting 76h" makes the reader
  // do the division.
  assert.match(lines[1], /waiting 3d/);
  assert.match(lines[2], /waiting 3h/);
  // 2 of the 11 are listed, so 9 remain — the two shown plus the nine others.
  assert.match(text, /…and 9 more/);
  // Trailing slash stripped, or the link reads https://host//ai.
  assert.ok(text.endsWith('https://growth.example.com/ai'));
});

test('one finding reads as one, and nothing claims "and more" when there is none', () => {
  const text = renderCliqDigest([{ severity: 'high', title: 'Only one', ageHours: 2 }], 0, 'https://x.test');
  assert.match(text, /1 finding waiting/);
  assert.ok(!text.includes('more'), 'nothing is being withheld, so nothing should say so');
});
