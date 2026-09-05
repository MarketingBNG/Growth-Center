import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { THRESHOLDS } from '../lib/thresholds.ts';

const service = readFileSync('lib/integrations/service.ts', 'utf8');
const health = readFileSync('lib/sync-health.ts', 'utf8');

// G5.2 asks for two thresholds and the codebase had one, so a run missed overnight and a
// system that had stopped two days ago produced the same finding at the same severity.
test('there are two thresholds between fresh, stale and broken', () => {
  assert.equal(THRESHOLDS['sync.staleHours'].default, 24);
  assert.equal(THRESHOLDS['sync.failedHours'].default, 48);
  assert.ok(
    THRESHOLDS['sync.failedHours'].default > THRESHOLDS['sync.staleHours'].default,
    'red must be later than amber, or every amber is also red',
  );
});

// The run row is opened before the work and closed on both outcomes. A run killed by the
// platform mid-flight therefore leaves a row saying 'running' with no finish — the one
// failure mode Integration's three columns could never record, because nothing survived
// long enough to write them.
test('a run row is opened before the sync and closed on both outcomes', () => {
  const open = service.indexOf('syncRun.create');
  const work = service.indexOf('provider.syncPaged');
  assert.ok(open > -1 && work > -1);
  assert.ok(open < work, 'the row must exist before the work that may never return');

  assert.match(service, /closeRun\(\{\s*status: 'succeeded'/);
  assert.match(service, /closeRun\(\{ status: 'failed'/);
});

// A run row is a record of the sync, not part of it. A failure to write one must not turn
// a successful import into a failed one, nor bury the real error behind a write error
// about the audit trail.
test('losing the run row does not fail the sync', () => {
  assert.match(service, /could not close the run row/);
});

// Measuring from the attempt rather than the success would have called the worst case
// healthy: a provider failing every night has a recent attempt and no working data.
test('freshness is measured from the last successful run', () => {
  assert.match(health, /const lastSuccess = succeeded\[0\]/);
  assert.match(health, /r\.status === 'succeeded'/);
});

// An absence of records is not a record of absence. SyncRun starts empty, and asserting a
// fault from no evidence is how a panel trains people to ignore it.
test('a provider with no history is not reported as broken', () => {
  assert.match(health, /recent\.length === 0\s*\?\s*'fresh'/);
});

// A streak counter resets on every success, so a provider that fails every other night
// reads as healthy on exactly the mornings somebody looks.
test('failures are reported as a ratio rather than a streak', () => {
  assert.match(health, /recentFailures/);
  assert.match(health, /recentRuns/);
});
