import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KPI_SERIES } from '../lib/kpi.ts';

const band = readFileSync('lib/band.ts', 'utf8');
const metrics = readFileSync('lib/metrics.ts', 'utf8');
const queue = readFileSync('app/(app)/ActionQueue.tsx', 'utf8');
const page = readFileSync('app/(app)/page.tsx', 'utf8');

// ── §6.1 the scorecard row ───────────────────────────────────────────────────────────

// "These are the five numbers the operating plan is managed by. Visitors is a vanity
// number for a firm whose constraint is senior delivery time."
test('the primary row is the plan’s scorecard, not the funnel', () => {
  assert.match(band, /const WANTED = \['consultations', 'cpql', 'newRevenue', 'attribution', 'cac', 'roas'\]/);
});

test('visitors and leads are demoted rather than deleted', () => {
  assert.match(band, /const SECONDARY = \[/);
  assert.match(band, /'visitors', 'leads', 'revenue'/);
});

// The three partition Revenue exactly. Leaving two of them in the primary row while
// Revenue sits in the secondary one is how a reader comes to add New business to Revenue.
test('the revenue partition stays with the total it partitions', () => {
  const secondary = band.slice(band.indexOf('const SECONDARY'), band.indexOf('const SECONDARY') + 300);
  for (const key of ['revenue', 'repeatRevenue', 'unclassifiedRevenue']) {
    assert.ok(secondary.includes(`'${key}'`), `${key} belongs with Revenue`);
  }
});

// The proxy is the whole difficulty and it must be stated on the card, not hidden: this
// CRM stamps qualifiedAt on conversion, so the consultation-booked event the manual's
// headline KPI divides by does not exist anywhere in the system.
test('the consultation proxy declares itself on the card', () => {
  assert.match(metrics, /records no consultation-booked event/);
  assert.match(metrics, /under-counts every consultation that led nowhere/);
});

// G4 again: money spent hiring did not book a consultation.
test('cost per consultation divides by acquisition spend', () => {
  assert.match(metrics, /costPer\(now\.acquisitionSpend, heldNow\.total\)/);
  assert.match(metrics, /costPer\(before\.acquisitionSpend, heldBefore\.total\)/);
});

// A card listing more than one series is only as trustworthy as its thinnest input, and a
// key missing from the registry silently skips that check.
test('the new cards declare the series they rest on', () => {
  assert.deepEqual(KPI_SERIES.consultations, ['deals']);
  assert.deepEqual(KPI_SERIES.cpql, ['spend', 'deals']);
  assert.deepEqual(KPI_SERIES.attribution, ['revenue']);
});

// Summed from separate grouped queries and converted at a rate, a fully classified book
// lands on -1.86e-9 — which formats as "-₹0" and reads as a negative amount of money
// nobody can account for.
test('a fully classified book reports zero unclassified, not minus zero', () => {
  assert.match(metrics, /Math\.abs\(unclassifiedRaw\) < 0\.01 \? 0 : unclassifiedRaw/);
});

// ── §6.3 the action queue ────────────────────────────────────────────────────────────

// "Each row an insight, a proposed action, an owner and a status. Not paragraphs."
test('the queue shows an action, an owner and a status', () => {
  assert.match(queue, /row\.proposedAction/);
  assert.match(queue, /row\.ownerEmail/);
  assert.match(queue, /STATUS_LABELS\[status\]/);
});

// "A paragraph is read once; a row with an owner is worked." The model's narration is on
// /ai, where somebody reading one finding closely wants it.
test('the queue renders no prose', () => {
  assert.doesNotMatch(queue, /\bbody\b/, 'the narration belongs on the detail page');
  assert.doesNotMatch(queue, /select: \{[^}]*body: true/s);
});

// "Move AI insights to the top."
test('the queue is above the numbers', () => {
  const q = page.indexOf('<ActionQueue');
  const b = page.indexOf('<MetricsBand');
  assert.ok(q > -1 && b > -1);
  assert.ok(q < b, 'the decisions come before the context for them');
});

// The old paragraph widget is gone rather than left beside its replacement.
test('the paragraph widget it replaces is removed', () => {
  assert.doesNotMatch(page, /<CardTitle>AI insights<\/CardTitle>/);
});

// The same order the digest and the weekly pack use, so the three cannot disagree about
// what matters this morning.
test('the queue orders worst first, then longest waiting', () => {
  assert.match(queue, /SEVERITY_RANK/);
  assert.match(queue, /firstSeenAt \?\? a\.createdAt/);
});
