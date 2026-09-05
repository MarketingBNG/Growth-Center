import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { capacityInput, CAPACITY_KEY } from '../lib/capacity.ts';
import { PARTNER_PARAM, PARTNER_VALUE, isPartnerView } from '../lib/partner-view.ts';

// ── §6.2 delivery capacity ───────────────────────────────────────────────────────────

// Blank clears the ceiling; zero is a real instruction. "Take on nothing this month" and
// "nobody has decided" are different statements and the dashboard says something
// different for each.
test('no ceiling and a ceiling of zero are different states', () => {
  assert.equal(capacityInput.parse({ monthlyConsultations: null }).monthlyConsultations, null);
  assert.equal(capacityInput.parse({ monthlyConsultations: 0 }).monthlyConsultations, 0);
  assert.throws(() => capacityInput.parse({ monthlyConsultations: -1 }));
  assert.throws(() => capacityInput.parse({ monthlyConsultations: 12.5 }));
});

// §22's audited config: a ceiling with no author is a ceiling nobody will defend when
// marketing wants to exceed it.
test('the ceiling records who set it', () => {
  const source = readFileSync('lib/capacity.ts', 'utf8');
  assert.match(source, /action: 'capacity\.set'/);
  assert.match(source, /setByEmail: actorEmail/);
  assert.equal(CAPACITY_KEY, 'delivery.capacity');
});

// The manual marks its own source as unconfirmed and was right to. Zoho Projects measures
// what delivery is already carrying; a ceiling is a judgement about what more it can take
// on, and inferring one from headcount would be an invented number on the one screen
// whose purpose is to stop marketing outrunning delivery.
test('nothing infers a ceiling from the load', () => {
  const source = readFileSync('lib/capacity.ts', 'utf8');
  assert.match(source, /const ceiling = setting\.monthlyConsultations;/);
  // Utilisation is null with no ceiling rather than being computed against the load.
  assert.match(source, /ceiling === null \|\| ceiling === 0 \? null/);
});

// ── §6.6 partner view ────────────────────────────────────────────────────────────────

// A URL parameter rather than a stored preference: the preset exists for the moment a
// laptop is turned round, and a setting somebody has to remember to switch back is one
// that leaks an owner scorecard the next time the screen is shared.
test('the partner preset lives in the URL', () => {
  assert.equal(PARTNER_PARAM, 'view');
  assert.equal(PARTNER_VALUE, 'partner');
  const page = readFileSync('app/(app)/page.tsx', 'utf8');
  assert.match(page, /isPartnerView\(params\)/);
  assert.ok(isPartnerView({ view: 'partner' }));
  assert.equal(isPartnerView({ view: 'anything-else' }), false);
  assert.equal(isPartnerView({}), false);
});

test('owner names are what the preset hides', () => {
  const page = readFileSync('app/(app)/page.tsx', 'utf8');
  assert.match(page, /!partnerView && t\.assigneeEmail/);
  assert.match(page, /!partnerView && l\.ownerEmail/);
});

// ── §6.4 hiding hiring ───────────────────────────────────────────────────────────────

// Hidden, never dropped. The recruitment campaigns are real money, and hiding them
// permanently would be the same class of error as leaving them in the CPL denominator —
// so the footer still totals every rupee and the note says which rows are missing.
test('the footer totals every campaign even when hiring is hidden', () => {
  const page = readFileSync('app/(app)/marketing/page.tsx', 'utf8');
  assert.match(page, /campaignTotals\(bySource\)/);
  assert.match(page, /hiddenCount/);
  assert.match(page, /hiring=show/);
});

// ── §17 delivery log ─────────────────────────────────────────────────────────────────

// One row per recipient, not per send. A digest that reached two of three admins is the
// case worth being able to see, and a single row carrying `sent: 2` hides which one
// missed it.
test('a delivery row is written for every recipient, on both outcomes', () => {
  const source = readFileSync('lib/digest.ts', 'utf8');
  const loop = source.indexOf('for (const to of ADMIN_EMAILS)');
  const log = source.indexOf('logDelivery', loop);
  assert.ok(loop > -1 && log > loop, 'the log call must be inside the recipient loop');
  assert.match(source, /status: result\.ok \? 'sent' : 'failed'/);
});

// A delivery log is a record of the send, not part of it. Losing a row must not turn a
// digest that went out into one that failed.
test('failing to record a delivery does not fail the send', () => {
  assert.match(readFileSync('lib/digest.ts', 'utf8'), /could not record the delivery/);
});

// The webhook URL carries a token. The channel name is what a reader needs; the secret is
// what a log must not keep.
test('the Cliq webhook token is never written to the log', () => {
  const source = readFileSync('lib/digest.ts', 'utf8');
  assert.match(source, /recipient: 'zoho-cliq'/);
  assert.doesNotMatch(source, /recipient: url\(\)/);
});

// SMTP reports that a server accepted the message. Open tracking needs an ESP that
// reports opens, and there is no column pretending otherwise.
test('there is no openedAt to be permanently null', () => {
  const schema = readFileSync('prisma/schema.prisma', 'utf8');
  const start = schema.indexOf('model ReportDelivery');
  const end = schema.indexOf('\n}', start);
  assert.doesNotMatch(schema.slice(start, end), /openedAt/);
});
