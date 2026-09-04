import assert from 'node:assert/strict';
import test from 'node:test';

import { notifyNewFindings } from '../lib/insight-notify.ts';

// §22: "One notification, never a queue." The tests that matter here are the ones about
// when NOT to send — a bell that fires on every run of every rule is a bell people turn
// off, and then the critical findings stop reaching anyone at all.
//
// No database, so anything that reaches a write throws with a recognisable message. That
// makes /DATABASE_URL is not set/ the signal that a notification WOULD have been sent,
// and a clean return the signal that it was correctly suppressed.

test('nothing at all sends nothing', async () => {
  assert.equal(await notifyNewFindings([]), 0);
});

test('medium and info findings do not interrupt anyone', async () => {
  assert.equal(
    await notifyNewFindings([
      { severity: 'medium', title: 'A page has a poor click-through rate' },
      { severity: 'info', title: 'Something happened' },
    ]),
    0,
  );
});

test('a critical finding does send', async () => {
  await assert.rejects(
    () => notifyNewFindings([{ severity: 'critical', title: 'Unresolved token in a template' }]),
    /DATABASE_URL is not set/,
  );
});

test('a high finding does send', async () => {
  await assert.rejects(
    () => notifyNewFindings([{ severity: 'high', title: '269 leads past the SLA' }]),
    /DATABASE_URL is not set/,
  );
});

// One critical among twenty medium ones must still get through — the filter is on
// severity, not on the run being mostly quiet.
test('a critical buried in noise still sends', async () => {
  const findings = [
    ...Array.from({ length: 20 }, (_, i) => ({ severity: 'medium' as const, title: `Noise ${i}` })),
    { severity: 'critical' as const, title: 'Suppression breach' },
  ];
  await assert.rejects(() => notifyNewFindings(findings), /DATABASE_URL is not set/);
});
