import assert from 'node:assert/strict';
import test from 'node:test';

import { insightHealth } from '../lib/insight-health.ts';

// The database is not reachable here, so these exercise the shape and the one behaviour
// that must hold before any figure is computed: a metric that cannot be measured says so
// rather than reporting zero.
//
// §21.6 is explicit about why that matters for one of the four: "Zero means the model has
// stopped admitting uncertainty — treat as a defect, not a win." A 0% rendered where
// nothing was measured is therefore not a harmless placeholder; it is the alarm going off
// for the wrong reason.

test('reading health without a database fails loudly rather than returning zeros', async () => {
  // A silent fall-through to an all-zero health report is the failure this asserts
  // against: it would put "0% closure, 0% dismissal, 0% deferral" on the weekly pack and
  // read as a team that has stopped working.
  await assert.rejects(() => insightHealth(new Date('2026-01-01'), new Date('2026-09-01')), /DATABASE_URL is not set/);
});
