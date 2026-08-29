import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  companyDomainFromEmail,
  isFreeEmailDomain,
  normalizeCompanyName,
  normalizeDomain,
  normalizeEmail,
} from '../lib/dedupe.ts';

test('normalizeEmail lowercases and trims', () => {
  assert.equal(normalizeEmail('  Alice@Acme.COM '), 'alice@acme.com');
});

test('normalizeEmail strips +tags on every provider', () => {
  assert.equal(normalizeEmail('alice+webinar@acme.com'), 'alice@acme.com');
  assert.equal(normalizeEmail('alice+ads@gmail.com'), 'alice@gmail.com');
});

// Gmail ignores dots; other providers do not. Dropping dots everywhere would merge
// two genuinely different people at the same company.
test('normalizeEmail removes dots for gmail only', () => {
  assert.equal(normalizeEmail('alice.smith@gmail.com'), 'alicesmith@gmail.com');
  assert.equal(normalizeEmail('alice.smith@googlemail.com'), 'alicesmith@googlemail.com');
  assert.equal(normalizeEmail('alice.smith@acme.com'), 'alice.smith@acme.com');
});

test('normalizeEmail returns null for anything unusable', () => {
  for (const bad of ['', '   ', 'not-an-email', '@acme.com', 'alice@', 'alice@localhost', null, undefined]) {
    assert.equal(normalizeEmail(bad), null, `accepted ${JSON.stringify(bad)}`);
  }
});

test('companyDomainFromEmail returns the domain for a work address', () => {
  assert.equal(companyDomainFromEmail('alice@northwindlogistics.com'), 'northwindlogistics.com');
});

// Treating gmail.com as a company would collapse every consumer lead into one account.
test('companyDomainFromEmail returns null for free providers', () => {
  for (const email of ['a@gmail.com', 'b@outlook.com', 'c@yahoo.co.in', 'd@proton.me', 'e@icloud.com']) {
    assert.equal(companyDomainFromEmail(email), null, `treated ${email} as a company`);
  }
});

test('the regional consumer providers this business actually receives are covered', () => {
  // Every one of these appears on real leads here, and each was creating an account
  // named after a mail provider with unrelated people merged into it. The original list
  // was US-centric; the leads are not.
  for (const email of [
    'a@yahoo.in',
    'b@ymail.com',
    'c@live.in',
    'd@outlook.in',
    'e@zohomail.in',
    'f@rediff.com',
    'g@myyahoo.com',
    'h@email.com',
    'i@yahoo.co.uk',
  ]) {
    assert.equal(companyDomainFromEmail(email), null, `treated ${email} as a company`);
  }
});

test('a real company domain is still a company', () => {
  // The guard must not swallow everything: these are the accounts the CRM exists for.
  assert.equal(companyDomainFromEmail('a@transactionsquare.in'), 'transactionsquare.in');
  assert.equal(companyDomainFromEmail('b@usaindiacfo.com'), 'usaindiacfo.com');
});

test('isFreeEmailDomain is case insensitive', () => {
  assert.equal(isFreeEmailDomain('GMAIL.COM'), true);
  assert.equal(isFreeEmailDomain('acme.com'), false);
});

test('normalizeDomain strips scheme, www, path, port and query', () => {
  assert.equal(normalizeDomain('https://www.acme.com/pricing?ref=x'), 'acme.com');
  assert.equal(normalizeDomain('http://acme.com'), 'acme.com');
  assert.equal(normalizeDomain('www.acme.com'), 'acme.com');
  assert.equal(normalizeDomain('acme.com:8080'), 'acme.com');
});

test('normalizeDomain rejects a value with no dot', () => {
  assert.equal(normalizeDomain('localhost'), null);
  assert.equal(normalizeDomain(''), null);
  assert.equal(normalizeDomain(null), null);
});

test('normalizeCompanyName ignores suffixes, punctuation and case', () => {
  assert.equal(normalizeCompanyName('Acme, Inc.'), 'acme');
  assert.equal(normalizeCompanyName('ACME LLC'), 'acme');
  assert.equal(normalizeCompanyName('Acme Private Limited'), 'acme');
  assert.equal(normalizeCompanyName('  Acme   Corp  '), 'acme');
});

test('normalizeCompanyName keeps distinct names distinct', () => {
  assert.notEqual(normalizeCompanyName('Acme Foods'), normalizeCompanyName('Acme Robotics'));
});

test('normalizeCompanyName returns null when nothing survives', () => {
  assert.equal(normalizeCompanyName('Inc.'), null);
  assert.equal(normalizeCompanyName(''), null);
});

test('normalizeCompanyName collapses the variations that make duplicate accounts', () => {
  // The reason the column exists: these are one account, and matching on the raw name
  // case-insensitively made three.
  const key = normalizeCompanyName('Acme, Inc.');
  assert.equal(normalizeCompanyName('acme inc'), key);
  assert.equal(normalizeCompanyName('ACME Inc'), key);
  assert.equal(normalizeCompanyName('Acme Limited'), key);
  assert.equal(normalizeCompanyName('Acme Pvt Ltd'), key);
});

test('normalizeCompanyName keeps different companies apart', () => {
  assert.notEqual(normalizeCompanyName('Acme'), normalizeCompanyName('Acme Digital'));
  assert.equal(normalizeCompanyName(''), null);
  assert.equal(normalizeCompanyName(null), null);
});
