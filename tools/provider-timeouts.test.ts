import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { HTTP_TIMEOUT_MS } from '../lib/integrations/types.ts';

// Every vendor call must be able to give up.
//
// None of them could, once. `SYNC_BUDGET_MS` only checks the clock between page fetches,
// so a socket that stopped answering held the whole 300s function, got killed, left its
// provider marked `syncing` until the ten-minute lease expired, and took every provider
// queued behind it down with it — on a cron that runs once a day.
//
// Asserted against the source rather than by calling anything, because the failure this
// guards against is someone adding a seventeenth fetch and not knowing the rule.

const DIR = 'lib/integrations/providers';

const providers = readdirSync(DIR).filter((f) => f.endsWith('.ts'));

test('there are provider files to check', () => {
  assert.ok(providers.length >= 6, `expected the six providers, found ${providers.length}`);
});

for (const file of providers) {
  test(`every fetch in ${file} carries a timeout signal`, () => {
    // Read as bytes: zoho-crm.ts contains a stray NUL, which makes some tools treat it
    // as binary. It is still valid UTF-8.
    const source = readFileSync(`${DIR}/${file}`).toString('utf8');

    const fetches = source.split('fetch(').length - 1;
    const signalled = source.split('httpTimeout()').length - 1;

    assert.equal(
      signalled,
      fetches,
      `${file}: ${fetches} fetch call(s) but ${signalled} httpTimeout() — every vendor call needs one`,
    );
  });
}

test('the timeout is long enough to be a hang and short enough to matter', () => {
  // Well past any real response, well inside SYNC_BUDGET_MS (230s) so a stuck call is
  // abandoned while the run still has time to save its cursor and answer.
  assert.ok(HTTP_TIMEOUT_MS >= 30_000, 'too short — a slow page would look like a hang');
  assert.ok(HTTP_TIMEOUT_MS <= 120_000, 'too long — the sync budget would expire first');
});
