import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PiiLeakError,
  scrubOrThrow,
  scrubTranscript,
  verifyScrubbed,
} from '../lib/content/transcript-scrub.ts';

// The transcript scrubber.
//
// WP07's acceptance criterion, near enough word for word: a fixture transcript produces
// insights with zero PII, and the test asserts none of the seeded names, emails or IDs
// survive. These are recordings of named clients discussing their tax affairs, so this is
// the one module in the codebase where a miss is a disclosure rather than a bug.

// A call that carries every shape the scrubber is supposed to know about.
const TRANSCRIPT = `
Priya Sharma: Hi, thanks for taking the call. I'm from Nandini Exports Pvt Ltd.
Advisor: Of course. Can I take your email?
Priya Sharma: It's priya.sharma@nandiniexports.com, and my mobile is +91 98765 43210.
Advisor: And the US entity's EIN?
Priya Sharma: 47-1234567. My husband's SSN is 123-45-6789 and my PAN is ABCDE1234F.
Advisor: Great. What made you start looking at this now?
Priya Sharma: We opened a Delaware C-corp last year and nobody told us about Form 5471.
`.trim();

const KNOWN = {
  names: ['Priya Sharma', 'Nandini Exports Pvt Ltd', 'Nandini Exports'],
  emails: ['priya.sharma@nandiniexports.com'],
};

// ── the acceptance criterion ─────────────────────────────────────────────────────────

test('nothing identifying survives a realistic call', () => {
  const { text } = scrubTranscript(TRANSCRIPT, KNOWN);

  assert.ok(!text.includes('priya.sharma@nandiniexports.com'), 'email survived');
  assert.ok(!/Priya/i.test(text), 'first name survived');
  assert.ok(!/Sharma/i.test(text), 'surname survived');
  assert.ok(!/Nandini/i.test(text), 'company survived');
  assert.ok(!text.includes('98765 43210'), 'phone survived');
  assert.ok(!text.includes('47-1234567'), 'EIN survived');
  assert.ok(!text.includes('123-45-6789'), 'SSN survived');
  assert.ok(!text.includes('ABCDE1234F'), 'PAN survived');
});

// The verification is the half that matters. A scrubber is only as trustworthy as its own
// check, so the check re-reads the output rather than trusting what the scrub reported.
test('the verifier agrees the output is clean', () => {
  const { text } = scrubTranscript(TRANSCRIPT, KNOWN);
  assert.deepEqual(verifyScrubbed(text, KNOWN), []);
});

test('the verifier catches a leak the scrubber would have missed', () => {
  // Nothing scrubbed at all: the verifier must not report this as clean.
  const leaks = verifyScrubbed(TRANSCRIPT, KNOWN);
  assert.ok(leaks.length > 0);
  assert.ok(leaks.some((l) => l.includes('email')));
  assert.ok(leaks.some((l) => l.includes('Priya Sharma')));
});

test('the buyer language itself is left intact — that is the point of the exercise', () => {
  const { text } = scrubTranscript(TRANSCRIPT, KNOWN);
  assert.match(text, /opened a Delaware C-corp last year/);
  assert.match(text, /nobody told us about Form 5471/);
  assert.match(text, /What made you start looking at this now/);
});

// ── the shapes ───────────────────────────────────────────────────────────────────────

test('emails go, whatever the domain', () => {
  const { text } = scrubTranscript('write to a.b+tag@sub.example.co.in please');
  assert.equal(text, 'write to [email] please');
});

test('US and Indian phone formats both go', () => {
  for (const phone of ['+1 (415) 555-0134', '+91 98765 43210', '9876543210', '415-555-0134']) {
    const { text } = scrubTranscript(`call me on ${phone}`);
    assert.ok(!text.includes(phone.replace(/^\+/, '')), `${phone} survived`);
  }
});

test('government identifiers go, and are labelled as such', () => {
  assert.match(scrubTranscript('SSN 123-45-6789').text, /\[tax id\]/);
  assert.match(scrubTranscript('EIN 47-1234567').text, /\[tax id\]/);
  assert.match(scrubTranscript('PAN ABCDE1234F').text, /\[tax id\]/);
  assert.match(scrubTranscript('Aadhaar 1234 5678 9012').text, /\[tax id\]/);
});

// Ordering, and the reason it is not arbitrary. A loose phone pattern will happily eat an
// EIN, and "[phone]" where a tax id stood hides what kind of thing was removed — which is
// exactly what somebody auditing a scrub needs to know.
test('a tax id is labelled a tax id, not swallowed by the phone pattern', () => {
  const { text, removed } = scrubTranscript('the EIN is 47-1234567');
  assert.match(text, /\[tax id\]/);
  assert.ok(!text.includes('[phone]'));
  assert.equal(removed.taxIds, 1);
  assert.equal(removed.phones, undefined);
});

// An address contains a name. Scrubbing names first leaves "[name].[name]@..." fragments
// and a domain that still identifies the company.
test('an email is removed whole, not left as fragments of a name', () => {
  const { text } = scrubTranscript('reach me at priya.sharma@nandiniexports.com', KNOWN);
  assert.equal(text, 'reach me at [email]');
});

// ── known names ──────────────────────────────────────────────────────────────────────

test('the longest known name wins, so a company is not half-replaced', () => {
  const { text } = scrubTranscript('I work at Nandini Exports Pvt Ltd today', KNOWN);
  assert.equal(text, 'I work at [name] today');
  assert.ok(!text.includes('Pvt Ltd'), 'the tail of the company name was left behind');
});

test('names are matched whatever the casing', () => {
  const { text } = scrubTranscript('PRIYA SHARMA and priya sharma', KNOWN);
  assert.ok(!/priya/i.test(text));
});

test('a name is matched on word boundaries, not inside another word', () => {
  // "Priyanka" is a different person and must not be half-scrubbed into "[name]nka".
  const { text } = scrubTranscript('Priyanka called', { names: ['Priya'] });
  assert.equal(text, 'Priyanka called');
});

test('a local part spoken without its domain is still caught', () => {
  const { text } = scrubTranscript('her handle is priya.sharma on the portal', KNOWN);
  assert.ok(!text.includes('priya.sharma'));
});

// Stated as a passing test so the limit is visible rather than discovered. This is why the
// caller must pass every name Zoho holds, and why the module says so at the top.
test('a name nobody declared is NOT caught, and that is the known limit', () => {
  const { text } = scrubTranscript('I spoke to Rajesh about it', {});
  assert.match(
    text,
    /Rajesh/,
    'pattern-matching catches shapes, not people — the known-names list is what catches people',
  );
});

test('very short known names are ignored, or every "Jo" scrubs half the transcript', () => {
  const { text } = scrubTranscript('Jo and Al discussed it', { names: ['Jo', 'Al'] });
  assert.equal(text, 'Jo and Al discussed it');
});

// ── the gate ─────────────────────────────────────────────────────────────────────────

test('scrubOrThrow returns clean text', () => {
  const { text, removed } = scrubOrThrow(TRANSCRIPT, KNOWN);
  assert.ok(!text.includes('Priya'));
  assert.ok(removed.emails >= 1);
  assert.ok(removed.taxIds >= 3);
});

// The decision belongs here, not at every call site — one of them would get it wrong.
// scrubOrThrow can only throw when the scrub and the verify disagree, and today they
// cannot: both halves share the same patterns and the same minimum name length, which is
// the point — the gate is a net for a FUTURE divergence, not for a case that exists now.
// So what is tested is that the net reports usefully when it catches something, rather
// than a disagreement fabricated to force it.
test('a leak is reported with what leaked, not just that something did', () => {
  const error = new PiiLeakError(['email address (2)', 'the name "Priya Sharma"']);
  assert.match(error.message, /still contains identifying data/);
  assert.match(error.message, /email address \(2\)/);
  assert.match(error.message, /Priya Sharma/);
  assert.equal(error.name, 'PiiLeakError');
});

test('clean text passes the gate untouched', () => {
  const { text } = scrubOrThrow('We opened a Delaware C-corp last year.', KNOWN);
  assert.equal(text, 'We opened a Delaware C-corp last year.');
});

test('an empty transcript is clean, not an error', () => {
  const { text, removed } = scrubOrThrow('', KNOWN);
  assert.equal(text, '');
  assert.deepEqual(removed, {});
});
