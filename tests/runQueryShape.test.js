// Semantics of a shaped /run_query response.
//
// The thing under test is a translation layer between VFBquery and a language
// model, so every assertion here is really about what the model is allowed to
// conclude from the JSON it receives. The two failure modes that matter:
// reading an upstream error (-1) as "no results", and losing a top-level flag
// the upstream sent.
//
// Run: npm test   (compiles first — this exercises dist/, not src/)

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  shapeRunQueryResult, runQueryFailed, QUERY_FAILED_NOTE, TRUNCATED_NOTE,
} = require('../dist/runQueryShape.js');

const CTX = { includeImages: false, limit: 25, offset: 0 };
const row = (id) => ({ id, label: `label ${id}`, thumbnail: '![img](https://example.org/x.png)' });

// ------------------------------------------------------------------ failures

test('an upstream failure is never presented as an empty result', () => {
  const out = shapeRunQueryResult({ headers: { id: {}, label: {} }, rows: [], count: -1 }, CTX);
  assert.equal(out.count_status, 'unavailable');
  assert.equal(out.count, -1, 'the raw -1 is passed through for existing count >= 0 guards');
  assert.equal(out.returned, 0);
  assert.match(out._note, /QUERY FAILED/);
  assert.match(out._note, /NOT an empty result/);
  // The old code emitted no note at all here, because -1 > 0 + 0 is false.
  assert.ok(out._note.length > 0, 'a failed query must always carry an explanation');
});

test('count 0 is a genuine empty result, not a failure', () => {
  // VFBquery returns count 0 for a 400 Bad Request and for a real empty set;
  // only a negative count means the query did not run.
  const out = shapeRunQueryResult({ headers: {}, rows: [], count: 0 }, CTX);
  assert.equal(out.count_status, 'exact');
  assert.equal(out.count, 0);
  assert.doesNotMatch(out._note || '', /QUERY FAILED/);
});

test('runQueryFailed identifies exactly the negative-count case', () => {
  assert.equal(runQueryFailed({ count: -1 }), true);
  assert.equal(runQueryFailed({ count: 0 }), false);
  assert.equal(runQueryFailed({ count: 12 }), false);
  assert.equal(runQueryFailed({}), false);
  assert.equal(runQueryFailed(null), false);
});

// --------------------------------------------------------------- key survival

test('unknown top-level keys survive shaping', () => {
  const out = shapeRunQueryResult({
    headers: {}, rows: [row('A')], count: 40000,
    capped: true, truncated: true, warnings: ['slow query'], some_future_key: 42,
  }, CTX);
  assert.equal(out.capped, true);
  assert.equal(out.truncated, true);
  assert.deepEqual(out.warnings, ['slow query']);
  assert.equal(out.some_future_key, 42);
});

test('a truncated result says its far pages are unreachable', () => {
  const out = shapeRunQueryResult({ headers: {}, rows: [row('A')], count: 90000, truncated: true }, CTX);
  assert.ok(out._note.includes(TRUNCATED_NOTE));
});

test('an upstream _note is kept, not replaced', () => {
  const out = shapeRunQueryResult({ headers: {}, rows: [row('A')], count: 1, _note: 'upstream says hello' }, CTX);
  assert.match(out._note, /^upstream says hello/);
});

test('the scalars and the note are ordered ahead of the bulk rows', () => {
  // The model reads the JSON top to bottom; a caveat after 25 rows of data is a
  // caveat that gets skimmed past.
  const keys = Object.keys(shapeRunQueryResult(
    { headers: {}, rows: [row('A')], count: 500, capped: true }, CTX));
  assert.deepEqual(keys.slice(0, 5), ['count', 'count_status', 'offset', 'limit', 'returned']);
  assert.deepEqual(keys.slice(-2), ['headers', 'rows']);
  assert.ok(keys.indexOf('_note') < keys.indexOf('rows'));
});

// ---------------------------------------------------------------- paging note

test('a partial page explains how to get the next one', () => {
  const out = shapeRunQueryResult({ headers: {}, rows: [row('A'), row('B')], count: 500 }, CTX);
  assert.equal(out.count_status, 'exact');
  assert.match(out._note, /Showing rows 0-2 of 500/);
  assert.match(out._note, /offset=25/);
});

test('a later page is described even when it is the last one', () => {
  const out = shapeRunQueryResult({ headers: {}, rows: [row('A')], count: 26 },
    { includeImages: false, limit: 25, offset: 25 });
  assert.match(out._note, /Showing rows 25-26 of 26/);
  assert.doesNotMatch(out._note, /re-run with offset/);
});

test('a failed query gets no paging arithmetic', () => {
  const out = shapeRunQueryResult({ headers: {}, rows: [], count: -1 },
    { includeImages: false, limit: 25, offset: 25 });
  assert.doesNotMatch(out._note, /Showing rows/);
  assert.doesNotMatch(out._note, /of -1/);
});

test('a countless payload falls back to the rows it has, and says so', () => {
  const out = shapeRunQueryResult({ headers: {}, rows: [row('A'), row('B')] }, CTX);
  assert.equal(out.count, 2);
  assert.equal(out.count_status, 'row_count');
});

// -------------------------------------------------------------------- images

test('image columns are stripped by default and flagged', () => {
  const out = shapeRunQueryResult(
    { headers: { id: {}, thumbnail: {} }, rows: [row('A')], count: 1 }, CTX);
  assert.equal('thumbnail' in out.rows[0], false);
  assert.equal('thumbnail' in out.headers, false);
  assert.match(out._note, /include_images=true/);
});

test('include_images leaves rows untouched', () => {
  const out = shapeRunQueryResult(
    { headers: { id: {}, thumbnail: {} }, rows: [row('A')], count: 1 },
    { includeImages: true, limit: 25, offset: 0 });
  assert.equal(typeof out.rows[0].thumbnail, 'string');
  assert.doesNotMatch(out._note || '', /include_images/);
});

test('a non-result payload is returned untouched', () => {
  const weird = { message: 'not a result set' };
  assert.equal(shapeRunQueryResult(weird, CTX), weird);
  assert.equal(shapeRunQueryResult(null, CTX), null);
});

// ------------------------------------------------------------------ the whole

test('nothing a model reads contains a bare -1 without an explanation', () => {
  // The tool serialises the shaped object with JSON.stringify and hands the
  // string to the model, so assert on what survives that round trip (quotes in
  // the note are escaped, hence the parse rather than a substring check).
  const text = JSON.stringify(shapeRunQueryResult({ headers: {}, rows: [], count: -1 }, CTX), null, 2);
  assert.match(text, /"count": -1/);
  const parsed = JSON.parse(text);
  assert.ok(parsed._note.includes(QUERY_FAILED_NOTE), 'the -1 must travel with its explanation');
  assert.equal(parsed.count_status, 'unavailable');
});
