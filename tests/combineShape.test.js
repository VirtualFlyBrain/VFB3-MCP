// Semantics of a shaped /combine and /xref response.
//
// As with runQueryShape, every assertion here is about what a language model is
// allowed to conclude from the JSON it receives. The failure modes that matter:
//
//   /combine — reporting an answer without checking the grouping the server
//              actually parsed, and losing the step trace or the warnings that
//              say the answer is unsound.
//   /xref    — reading an empty reverse lookup as "no such neuron exists". The
//              forward direction is authoritative when empty; the reverse one
//              is not, and they are indistinguishable without a note.
//
// Run: npm test   (compiles first — this exercises dist/, not src/)

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  shapeCombineResult, shapeXrefResult, stripImageColumns,
  IMAGES_EXCLUDED_NOTE, COMBINE_NO_OFFSET_NOTE,
  XREF_REVERSE_EMPTY_NOTE, XREF_FORWARD_EMPTY_NOTE, XREF_DB_FILTERED_NOTE,
} = require('../dist/combineShape.js');

const CTX = { includeImages: false, limit: 25 };
const row = (id) => ({
  id, label: `label ${id}`,
  thumbnail: '![img](https://example.org/x.png)',
  thumbnail_transparent: '![img](https://example.org/t.png)',
});
const combined = (over) => ({
  expression: 'calyx AND lh',
  as_read: '(calyx AND lh)',
  plain_english: 'only the things found by BOTH calyx and lh',
  steps: [{ operation: 'AND', input_counts: [574, 1661], result_count: 220 }],
  operands: { calyx: { rows_returned: 574 }, lh: { rows_returned: 1661 } },
  universe: { source: 'operands', size: 2015 },
  headers: { id: {}, label: {}, thumbnail: {} },
  rows: [row('A'), row('B')],
  count: 220,
  limit: 0,
  capped: false,
  ...over,
});

// ------------------------------------------------------------------- combine

test('the parsed grouping is presented before the rows', () => {
  // A model that reports an answer without checking `as_read` against what the
  // user asked has skipped the only check this endpoint offers, so the parse
  // must not be buried under a page of data.
  const keys = Object.keys(shapeCombineResult(combined(), CTX));
  assert.deepEqual(keys.slice(0, 3), ['expression', 'as_read', 'plain_english']);
  assert.equal(keys[keys.length - 1], 'rows');
  assert.ok(keys.indexOf('_note') < keys.indexOf('rows'));
  assert.ok(keys.indexOf('steps') < keys.indexOf('rows'));
});

test('the step trace, operands, universe and unknown keys all survive', () => {
  const out = shapeCombineResult(combined({ warnings: ['operand truncated'], future_key: 7 }), CTX);
  assert.equal(out.steps[0].result_count, 220);
  assert.equal(out.operands.lh.rows_returned, 1661);
  assert.equal(out.universe.size, 2015);
  assert.deepEqual(out.warnings, ['operand truncated']);
  assert.equal(out.future_key, 7, 'a key added upstream later must not be dropped');
  assert.equal(out.capped, false);
});

test('count stays the true size of the result set, not the page', () => {
  const out = shapeCombineResult(combined(), CTX);
  assert.equal(out.count, 220);
  assert.equal(out.returned, 2);
});

test('a partial result says to raise the limit, never to page', () => {
  // /combine reserves `offset` upstream but does not implement it, so telling a
  // model to advance one would send it round a loop that returns the same rows.
  const out = shapeCombineResult(combined(), CTX);
  assert.match(out._note, /Showing 2 of 220 rows/);
  assert.ok(out._note.includes(COMBINE_NO_OFFSET_NOTE));
  assert.doesNotMatch(out._note, /offset=/);
});

test('a complete result gets no paging note', () => {
  const out = shapeCombineResult(combined({ count: 2 }), CTX);
  assert.doesNotMatch(out._note || '', /Showing/);
});

test('image columns are stripped by default and the fact is stated', () => {
  const out = shapeCombineResult(combined(), CTX);
  assert.ok(!('thumbnail' in out.rows[0]));
  assert.ok(!('thumbnail_transparent' in out.rows[0]));
  assert.ok(!('thumbnail' in out.headers), 'a header for a dropped column is a lie about the rows');
  assert.ok(out._note.includes(IMAGES_EXCLUDED_NOTE));
});

test('include_images leaves the rows untouched and adds no exclusion note', () => {
  const out = shapeCombineResult(combined(), { includeImages: true, limit: 25 });
  assert.equal(out.rows[0].thumbnail, '![img](https://example.org/x.png)');
  assert.ok('thumbnail' in out.headers);
  assert.doesNotMatch(out._note || '', /excluded/);
});

test('an upstream _note is kept rather than replaced', () => {
  const out = shapeCombineResult(combined({ _note: 'operand lh was truncated at 1000 rows' }), CTX);
  assert.match(out._note, /operand lh was truncated/);
  assert.match(out._note, /Showing 2 of 220/);
});

test('an explain_only response is passed through untouched', () => {
  // No rows at all: there is nothing to strip and no result to qualify, and
  // inventing a count for it would be worse than saying nothing.
  const explain = {
    expression: 'a AND b', as_read: '(a AND b)', plain_english: 'both',
    operands: { a: 'X:1', b: 'X:2' }, unused_operands: [], universe_note: 'a note',
  };
  assert.deepEqual(shapeCombineResult(explain, CTX), explain);
});

test('a non-result payload is returned untouched', () => {
  assert.equal(shapeCombineResult(null, CTX), null);
  assert.deepEqual(shapeCombineResult({ error: 'bad expr' }, CTX), { error: 'bad expr' });
});

// ---------------------------------------------------------------------- xref

test('an empty reverse lookup is never presented as proof of absence', () => {
  const out = shapeXrefResult({ query: '999', direction: 'accession_to_id', rows: [], count: 0 });
  assert.ok(out._note.includes(XREF_REVERSE_EMPTY_NOTE));
  assert.match(out._note, /NOT proof that no such term exists/);
  assert.match(out._note, /do NOT fall back to a free-text search result/);
});

test('an empty forward lookup is allowed to be authoritative', () => {
  // The forward direction reads the term's own xref list, so "none" really is
  // none — the opposite conclusion to the reverse direction on the same shape.
  const out = shapeXrefResult({ query: 'VFB_00101567', direction: 'id_to_accession', rows: [], count: 0 });
  assert.ok(out._note.includes(XREF_FORWARD_EMPTY_NOTE));
  assert.doesNotMatch(out._note, /NOT proof/);
});

test('an unknown direction falls back to the cautious note', () => {
  const out = shapeXrefResult({ query: '?', rows: [], count: 0 });
  assert.ok(out._note.includes(XREF_REVERSE_EMPTY_NOTE),
    'asserting authority we cannot verify is the worse of the two errors');
});

test('an empty result under a db filter says the filter may be the cause', () => {
  const out = shapeXrefResult({
    query: 'VFB_x', direction: 'id_to_accession', rows: [], count: 0,
    db_matched: 'hb', available_dbs: ['hb', 'fw'],
  });
  assert.ok(out._note.includes(XREF_DB_FILTERED_NOTE));
});

test('a non-empty result is passed through unchanged', () => {
  const hit = {
    query: '1734350908', direction: 'accession_to_id', count: 1, candidates_checked: 1,
    rows: [{ id: 'VFB_jrchjtdb', label: 'DA1_lPN_R (FlyEM-HB:1734350908)', db: 'hb' }],
  };
  assert.deepEqual(shapeXrefResult(hit), hit);
});

test('rows stay last so the explanation is read first', () => {
  const keys = Object.keys(shapeXrefResult({ query: 'x', direction: 'accession_to_id', rows: [], count: 0 }));
  assert.equal(keys[keys.length - 1], 'rows');
  assert.ok(keys.indexOf('_note') < keys.indexOf('rows'));
});

// -------------------------------------------------------------------- shared

test('stripImageColumns reports whether it actually dropped anything', () => {
  const withImages = stripImageColumns([row('A')], { id: {}, thumbnail: {} });
  assert.equal(withImages.excluded, true);
  const without = stripImageColumns([{ id: 'A' }], { id: {} });
  assert.equal(without.excluded, false, 'no note should be added when there was nothing to strip');
});

test('stripImageColumns leaves non-object rows alone', () => {
  const out = stripImageColumns(['a string row', 42, null], {});
  assert.deepEqual(out.rows, ['a string row', 42, null]);
});
