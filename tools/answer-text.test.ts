import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAnswer } from '../lib/answer-format.ts';

// The grouping half of the renderer, which is where the decisions are. The inline half
// produces React elements and is checked in the browser instead.
//
// Every input below is a real shape gpt-5.6-luna returned while this was being built.

test('a bold line and a paragraph are separate blocks', () => {
  const blocks = parseAnswer('**Landing Page** appears to produce the highest-quality customers.\n\nEvents is next at 5 customers.');

  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].kind, 'para');
  assert.equal(blocks[1].kind, 'para');
});

test('hard-wrapped prose becomes one paragraph', () => {
  // The model wraps at its own width. Kept as separate lines, the answer broke mid-sentence
  // wherever the model happened to stop.
  const blocks = parseAnswer('Unattributed reports 146 customers from 18 leads, but that\nexceeds the lead count, so it cannot reliably indicate quality.');

  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0], {
    kind: 'para',
    lines: [
      'Unattributed reports 146 customers from 18 leads, but that',
      'exceeds the lead count, so it cannot reliably indicate quality.',
    ],
  });
});

test('bullets group into one list', () => {
  const blocks = parseAnswer('The biggest leak is follow-up:\n\n- 2,001 untouched leads sit with vidhi\n- 11,729 leads are lost\n- Meta Ads spent INR 1,295,976');

  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].kind, 'para');
  assert.deepEqual(blocks[1], {
    kind: 'list',
    ordered: false,
    items: ['2,001 untouched leads sit with vidhi', '11,729 leads are lost', 'Meta Ads spent INR 1,295,976'],
  });
});

test('a blank line between bullets does not start a second list', () => {
  // Two lists render two sets of markers for what the reader sees as one, and the models
  // do space their bullets out.
  const blocks = parseAnswer('- first\n\n- second\n\n- third');

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, 'list');
  assert.deepEqual((blocks[0] as { items: string[] }).items, ['first', 'second', 'third']);
});

test('numbered and bulleted lists stay apart', () => {
  const blocks = parseAnswer('1. first\n2. second\n- a bullet');

  assert.equal(blocks.length, 2);
  assert.equal((blocks[0] as { ordered: boolean }).ordered, true);
  assert.equal((blocks[1] as { ordered: boolean }).ordered, false);
});

test('both numbering styles are recognised', () => {
  for (const text of ['1. one\n2. two', '1) one\n2) two']) {
    const blocks = parseAnswer(text);
    assert.equal(blocks.length, 1, text);
    assert.deepEqual((blocks[0] as { items: string[] }).items, ['one', 'two']);
  }
});

test('a bullet written with * or • is still a bullet', () => {
  const blocks = parseAnswer('* star\n• dot');

  assert.equal(blocks.length, 1);
  assert.deepEqual((blocks[0] as { items: string[] }).items, ['star', 'dot']);
});

test('a paragraph after a list is its own block', () => {
  const blocks = parseAnswer('- a\n- b\n\nSo the channel is underperforming.');

  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].kind, 'list');
  assert.equal(blocks[1].kind, 'para');
});

test('empty and whitespace-only answers produce nothing to render', () => {
  assert.deepEqual(parseAnswer(''), []);
  assert.deepEqual(parseAnswer('   \n\n  \n'), []);
});

test('windows line endings are handled', () => {
  const blocks = parseAnswer('- a\r\n- b');

  assert.equal(blocks.length, 1);
  assert.deepEqual((blocks[0] as { items: string[] }).items, ['a', 'b']);
});

test('a line that is only bold survives as text, not an empty block', () => {
  // "**Where the funnel leaks**" on its own line is how the model writes a heading.
  const blocks = parseAnswer('**Where the funnel leaks**\n\nQualified fell from 154 to 80.');

  assert.equal(blocks.length, 2);
  assert.deepEqual((blocks[0] as { lines: string[] }).lines, ['**Where the funnel leaks**']);
});

test('an asterisk inside a sentence is not mistaken for a bullet', () => {
  // Only a leading marker followed by a space starts a list.
  const blocks = parseAnswer('ROAS is 0.05 (spend*revenue mismatch).');

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, 'para');
});
