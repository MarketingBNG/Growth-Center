import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysToAnniversary, flagsFor } from '../lib/lifecycle.ts';
import { jurisdictionWarning, entityTypeLabel } from '../lib/company-facts.ts';
import { PARTNER_TYPES, partnerInput } from '../lib/referrals.ts';
import { RULE_IDS } from '../lib/insight-rules.ts';
import { THRESHOLDS } from '../lib/thresholds.ts';

const at = (iso: string) => new Date(iso);

// ── §8.2 lifecycle ───────────────────────────────────────────────────────────────────

// Computed on the month and day rather than by adding 365, so an account won on 29
// February does not drift a day a year. An anniversary that moves is not an anniversary.
test('the anniversary is the same date every year', () => {
  assert.equal(daysToAnniversary(at('2023-03-15'), at('2026-03-01')), 14);
  assert.equal(daysToAnniversary(at('2023-03-15'), at('2026-03-15')), 0, 'today counts as today');
  // Just past it wraps to next year rather than going negative.
  assert.ok(daysToAnniversary(at('2023-03-15'), at('2026-03-16')) > 300);
});

// A client of three years who was asked once at signing is not a client who has been
// asked, so the window is measured from the last ask — or from the win where there has
// never been one.
test('an ask made three years ago is not an ask', () => {
  const base = {
    engagementType: 'one_time',
    renewalDueAt: null,
    wonAt: at('2023-01-01'),
    reviewRequestedAt: at('2023-02-01'),
    referralAskedAt: null,
    crossSellOfferedAt: null,
  };
  const flags = flagsFor(base, at('2026-09-05'));
  assert.deepEqual(flags.sort(), ['no_cross_sell', 'no_referral', 'no_review']);
});

test('a recent ask clears its flag', () => {
  const flags = flagsFor(
    {
      engagementType: 'one_time',
      renewalDueAt: null,
      wonAt: at('2023-01-01'),
      reviewRequestedAt: at('2026-08-20'),
      referralAskedAt: at('2026-08-20'),
      crossSellOfferedAt: at('2026-08-20'),
    },
    at('2026-09-05'),
  );
  assert.deepEqual(flags, []);
});

// A renewal that lapsed three weeks ago is more urgent than one due next month. Dropping
// it once the date passes is how a lapse becomes permanent.
test('a renewal that has already passed still counts', () => {
  const overdue = flagsFor(
    { engagementType: 'retainer', renewalDueAt: at('2026-08-01'), wonAt: at('2026-08-01'), reviewRequestedAt: at('2026-09-01'), referralAskedAt: at('2026-09-01'), crossSellOfferedAt: at('2026-09-01') },
    at('2026-09-05'),
  );
  assert.ok(overdue.includes('renewal_due'));

  const distant = flagsFor(
    { engagementType: 'retainer', renewalDueAt: at('2027-06-01'), wonAt: at('2026-08-01'), reviewRequestedAt: at('2026-09-01'), referralAskedAt: at('2026-09-01'), crossSellOfferedAt: at('2026-09-01') },
    at('2026-09-05'),
  );
  assert.equal(distant.includes('renewal_due'), false);
});

// The renewal date is entered by hand because the CRM records none. Flagging its absence
// would light the warning on all 1,372 retainers at once — a complaint about data entry
// wearing the costume of a business alert.
test('a retainer with no renewal date is not flagged for renewal', () => {
  const flags = flagsFor(
    { engagementType: 'retainer', renewalDueAt: null, wonAt: at('2026-09-01'), reviewRequestedAt: at('2026-09-01'), referralAskedAt: at('2026-09-01'), crossSellOfferedAt: at('2026-09-01') },
    at('2026-09-05'),
  );
  assert.deepEqual(flags, []);
});

// A one-off engagement has nothing to renew.
test('a one-off engagement never shows a renewal', () => {
  const flags = flagsFor(
    { engagementType: 'one_time', renewalDueAt: at('2026-09-10'), wonAt: at('2026-09-01'), reviewRequestedAt: at('2026-09-01'), referralAskedAt: at('2026-09-01'), crossSellOfferedAt: at('2026-09-01') },
    at('2026-09-05'),
  );
  assert.equal(flags.includes('renewal_due'), false);
});

// ── §8.4 company facts ───────────────────────────────────────────────────────────────

// A US state filing implies a federal one, so a state-only record drops out of every
// federal compliance list while looking complete on screen. Reported, never corrected:
// silently adding a jurisdiction nobody entered stops this being a record of what
// somebody actually said.
test('a state filing without a federal one is called out rather than fixed', () => {
  assert.match(jurisdictionWarning(['us_state']) ?? '', /federal/);
  assert.equal(jurisdictionWarning(['us_state', 'us_federal']), null);
  assert.equal(jurisdictionWarning(['india']), null);
  assert.equal(jurisdictionWarning([]), null);
});

test('an entity type with no value reads as unknown, not as blank', () => {
  assert.equal(entityTypeLabel('c_corp'), 'C-Corp');
  assert.equal(entityTypeLabel(null), '—');
  assert.equal(entityTypeLabel('something-else'), '—');
});

// ── §8.5 referral registry ───────────────────────────────────────────────────────────

test('§8.5’s five partner types are all offered', () => {
  for (const type of ['ca_firm', 'law_firm', 'incubator', 'bank', 'immigration_adviser']) {
    assert.ok(PARTNER_TYPES.includes(type as (typeof PARTNER_TYPES)[number]), type);
  }
});

test('a partner needs a name and nothing else', () => {
  assert.equal(partnerInput.parse({ name: 'N Gupta' }).partnerType, 'other');
  assert.throws(() => partnerInput.parse({ name: '  ' }));
  // A bad address is refused rather than stored, but a blank one is fine — most of these
  // relationships are held on the phone.
  assert.throws(() => partnerInput.parse({ name: 'N Gupta', email: 'not-an-address' }));
  assert.equal(partnerInput.parse({ name: 'N Gupta', email: '' }).email, '');
});

// ── the rules these unblocked ────────────────────────────────────────────────────────

// None of the three was ever blocked outside the repository. They were waiting on a table
// with rows in it, which is a different thing and is now recorded as such in the header.
test('the three rules the §7 and §8 work unblocked are registered', () => {
  for (const id of ['duplicate_backlog', 'referral_partner_silent', 'lead_quality_below_floor']) {
    assert.ok(RULE_IDS.includes(id), id);
  }
});

test('each of them reads a threshold rather than a literal', () => {
  assert.equal(THRESHOLDS['crm.duplicateBacklog'].default, 25);
  assert.equal(THRESHOLDS['crm.partnerSilentDays'].default, 60, '§8.5 names 60 days');
  assert.equal(THRESHOLDS['leads.qualityFloor'].default, 30);
});
