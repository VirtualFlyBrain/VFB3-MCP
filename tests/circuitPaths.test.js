// Request building for find_circuit_paths (VFBquery /circuit_paths).
//
// Run: npm test   (compiles first — this exercises dist/, not src/)

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildCircuitParams } = require('../dist/circuitPaths.js');

const LC12 = 'FBbt_00100484';
const GF = 'FBbt_00004020';

function params(args) {
  const out = buildCircuitParams(args);
  assert.ok(!('error' in out), `unexpected error: ${out.error}`);
  return Object.fromEntries(out.params);
}

test('only the ends are sent when nothing else is given, so the endpoint defaults apply', () => {
  assert.deepEqual(params({ source: LC12, target: GF }), { source: LC12, target: GF });
});

test('several ids per end are accepted as an array or a comma-separated string', () => {
  const p = params({ source: [LC12, ' FBbt_00003686 '], target: `${GF}, VFB_fw011554` });
  assert.equal(p.source, `${LC12},FBbt_00003686`);
  assert.equal(p.target, `${GF},VFB_fw011554`);
});

test('labels are refused with a pointer to search_terms, not sent', () => {
  const out = buildCircuitParams({ source: 'Kenyon cell', target: GF });
  assert.match(out.error, /ids only/);
  assert.match(out.error, /"Kenyon cell"/);
  assert.match(out.error, /search_terms/);
});

test('both ends are required', () => {
  assert.match(buildCircuitParams({ source: LC12 }).error, /both source and target/);
  assert.match(buildCircuitParams({ source: [], target: GF }).error, /both source and target/);
});

test('exclude_dbs: omitted keeps the default, [] searches every dataset', () => {
  assert.equal('exclude_dbs' in params({ source: LC12, target: GF }), false);
  assert.equal(params({ source: LC12, target: GF, exclude_dbs: [] }).exclude_dbs, '');
  assert.equal(params({ source: LC12, target: GF, exclude_dbs: ['hb', ' mc '] }).exclude_dbs, 'hb,mc');
});

test('options are passed through in the endpoint\'s spelling', () => {
  const p = params({
    source: LC12, target: GF, k: 10, min_synapses: 0, min_inprop: 0.01,
    normalise: 'Output', instance_graph: true, instance_k: 2,
  });
  assert.deepEqual(p, {
    source: LC12, target: GF, k: '10', min_synapses: '0', min_inprop: '0.01',
    normalise: 'output', instance_graph: 'true', instance_k: '2',
  });
});

test('out-of-range options are refused before the request', () => {
  const base = { source: LC12, target: GF };
  assert.match(buildCircuitParams({ ...base, k: 0 }).error, /k must be/);
  assert.match(buildCircuitParams({ ...base, k: 21 }).error, /k must be/);
  assert.match(buildCircuitParams({ ...base, k: 2.5 }).error, /k must be/);
  assert.match(buildCircuitParams({ ...base, min_synapses: -1 }).error, /min_synapses/);
  assert.match(buildCircuitParams({ ...base, min_inprop: 2 }).error, /min_inprop/);
  assert.match(buildCircuitParams({ ...base, normalise: 'both' }).error, /normalise/);
  assert.match(buildCircuitParams({ ...base, instance_k: 11 }).error, /instance_k/);
});
