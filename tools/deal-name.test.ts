import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDealName } from '../lib/deal-name.ts';

// Every name below is a real one from the 8,072 deals in this workspace, or a shape taken
// from them. The convention is undocumented and lives only in the data, so the fixtures
// are the specification.

test('the full convention is read', () => {
  const p = parseDealName("Mosaic Wellness INC_46_Apr'26_One Time");
  assert.equal(p.account, 'Mosaic Wellness INC');
  assert.equal(p.sequenceNo, 46);
  assert.equal(p.period, "Apr'26");
  assert.equal(p.engagementType, 'one_time');
  assert.equal(p.origin, 'repeat');
});

test('a retainer is recognised', () => {
  const p = parseDealName("BHANU PRATAP SINGH_4_Feb'26_Retainer");
  assert.equal(p.engagementType, 'retainer');
  assert.equal(p.sequenceNo, 4);
  assert.equal(p.origin, 'repeat');
});

test('the first engagement for an account is new business', () => {
  const p = parseDealName("Hostin Services Corp._1_Apr'26_One Time");
  assert.equal(p.sequenceNo, 1);
  assert.equal(p.origin, 'new');
  assert.equal(p.account, 'Hostin Services Corp.');
});

test('an account name containing underscores survives', () => {
  // The counter and suffix are read from the right for exactly this reason.
  const p = parseDealName("A_B Trading_LLC_7_Jan'25_Retainer");
  assert.equal(p.account, 'A_B Trading_LLC');
  assert.equal(p.sequenceNo, 7);
});

test('a doubled engagement suffix is read once and stripped fully', () => {
  // "Golden Chariot LLC_One Time_One Time" is in the data. A single strip would leave
  // "_One Time" hanging on the account name.
  const p = parseDealName('Golden Chariot LLC_One Time_One Time');
  assert.equal(p.engagementType, 'one_time');
  assert.equal(p.account, 'Golden Chariot LLC');
  assert.equal(p.sequenceNo, null);
});

test('a suffix with no counter gives the engagement but no origin', () => {
  // 94 deals look like this. The engagement type is known; whether it is new business is
  // not, and must not be guessed.
  const p = parseDealName('Mathiverse Inc_One Time');
  assert.equal(p.engagementType, 'one_time');
  assert.equal(p.sequenceNo, null);
  assert.equal(p.origin, 'unknown');
  assert.equal(p.account, 'Mathiverse Inc');
});

test('a plain account name is unknown, not new', () => {
  // 2,343 deals — a quarter of the book. Filing these as new business would recreate the
  // overstatement G1.4 exists to remove.
  for (const name of ['Bitonic Technology Labs Inc', 'SIDDHARTH NAWAL', 'Yasho Inc']) {
    const p = parseDealName(name);
    assert.equal(p.origin, 'unknown', `${name} was classified`);
    assert.equal(p.sequenceNo, null);
    assert.equal(p.engagementType, null);
    // No account either: the name IS the account, but saying so would imply the
    // convention was found.
    assert.equal(p.account, null);
  }
});

test('empty and missing names do not throw', () => {
  for (const bad of ['', '   ', null, undefined]) {
    const p = parseDealName(bad);
    assert.equal(p.origin, 'unknown');
    assert.equal(p.account, null);
  }
});

test('a counter of zero is treated as a first engagement, not as repeat', () => {
  // Not in the data today, but the comparison is <= 1 rather than === 1 so a zero-indexed
  // entry cannot silently become "repeat".
  assert.equal(parseDealName("Some Co_0_Apr'26_One Time").origin, 'new');
});

test('case in the suffix does not matter', () => {
  assert.equal(parseDealName("Some Co_2_Apr'26_RETAINER").engagementType, 'retainer');
  assert.equal(parseDealName('Some Co_one time').engagementType, 'one_time');
});

test('a number in the account name is not mistaken for the counter', () => {
  // The counter is only a counter when it is followed by a period stamp.
  const p = parseDealName('7PI Innovations Inc');
  assert.equal(p.sequenceNo, null);
  assert.equal(p.origin, 'unknown');
});

test('a period stamp without a counter is not parsed as one', () => {
  const p = parseDealName("Some Co_Apr'26_One Time");
  assert.equal(p.sequenceNo, null);
  assert.equal(p.engagementType, 'one_time');
});

test('trailing whitespace does not defeat the match', () => {
  const p = parseDealName("Some Co_3_Apr'26_One Time   ");
  assert.equal(p.sequenceNo, 3);
  assert.equal(p.engagementType, 'one_time');
});
