import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pdfSafe, reportPdf } from '../lib/pdf.ts';

// The standard-14 fonts encode as WinAnsi, which has no ₹ (U+20B9) — and pdfkit does not
// fail on a character it cannot encode. It emits byte 0xB9, which in WinAnsi is ¹, so
// ₹138,445,497 printed as ¹138,445,497: a footnote marker against a number, in the export
// most likely to be sent outside the firm. Verified by reading the content stream.
test('the rupee is replaced by its ISO code rather than silently mangled', () => {
  assert.equal(pdfSafe('₹138,445,497'), 'INR 138,445,497');
  assert.equal(pdfSafe('₹1 and ₹2'), 'INR 1 and INR 2');
});

test('every other character these reports use is left alone', () => {
  // All present in WinAnsi, all verified to encode correctly — so substituting them would
  // be damage, not safety. $ especially: this workspace reports in both currencies.
  assert.equal(pdfSafe('$2,000 — 92.4% × 3 §20.5 – ok'), '$2,000 — 92.4% × 3 §20.5 – ok');
  assert.equal(pdfSafe(''), '');
});

test('a report renders to a real PDF', async () => {
  const pdf = await reportPdf({
    id: 'executive',
    name: 'Executive growth report',
    range: { from: new Date('2026-08-01'), to: new Date('2026-08-31') },
    sections: [
      { kind: 'stats', title: 'Money', rows: [{ label: 'New business', value: '₹138,445,497', hint: 'last 30 days' }] },
      { kind: 'table', title: 'Channels', columns: ['Channel', 'Spend'], rows: [['Meta', '₹1,018,768']] },
      { kind: 'note', title: 'What these are for', body: 'A note.' },
    ],
  } as never);

  assert.ok(Buffer.isBuffer(pdf));
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-', 'must be a PDF, not an error page');
  assert.ok(pdf.length > 800, 'a report with three sections is not a few hundred bytes');
  assert.ok(pdf.subarray(-1024).toString('latin1').includes('%%EOF'), 'must be a complete document');
});

// A truncated PDF still downloads and still opens to an error, which is the worst way for
// this to fail: the person finds out in front of whoever they sent it to.
test('the whole document is buffered before it is returned', async () => {
  const pdf = await reportPdf({
    id: 'leads',
    name: 'Leads',
    range: { from: new Date('2026-08-01'), to: new Date('2026-08-31') },
    // Enough rows to page, so the multi-page path is exercised rather than assumed.
    sections: [
      {
        kind: 'table',
        title: 'Rows',
        columns: ['A', 'B'],
        rows: Array.from({ length: 120 }, (_, i) => [`row ${i}`, `₹${i}`]),
      },
    ],
  } as never);

  const raw = pdf.toString('latin1');
  assert.ok((raw.match(/\/Type\s*\/Page[^s]/g) || []).length > 1, '120 rows must paginate');
  assert.ok(raw.includes('%%EOF'));
});
