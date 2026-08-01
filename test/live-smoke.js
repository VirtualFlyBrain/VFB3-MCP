#!/usr/bin/env node
/**
 * Drives the built server over stdio and exercises the four fixes:
 *   A/B  a rejected run_query must surface the server's reason and the valid
 *        query_type names, not "AxiosError: ... status code 400"
 *   C    the available-query hint must be a comma list of names, not a blob of
 *        JSON-stringified query objects
 *   D    get_hierarchy must drop `html` and the duplicate `display_full`
 *   E    get_term_info must trim Queries and image entries, and `verbose: true`
 *        must give the untouched response back
 *
 * One call per check, run in sequence with a pause between, per the standing
 * rule about load on VFBquery. Every call goes to v3-cached.
 */
const { spawn } = require('child_process');

const child = spawn('node', [__dirname + '/../dist/index.js'], {
  stdio: ['pipe', 'pipe', 'inherit'],
});

let buffer = '';
const pending = new Map();
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  let nl;
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    const resolve = pending.get(msg.id);
    if (resolve) { pending.delete(msg.id); resolve(msg); }
  }
});

let nextId = 1;
function send(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => { if (pending.delete(id)) reject(new Error(`timeout on ${method}`)); }, 120000);
  });
}
const call = (name, args) => send('tools/call', { name, arguments: args })
  .then((r) => r.result?.content?.[0]?.text ?? JSON.stringify(r));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) { failures++; if (detail) console.log('      ' + String(detail).slice(0, 400)); }
}

(async () => {
  await send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'fix-test', version: '0' },
  });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  // --- A/B + C: rejected run_query -----------------------------------------
  const bad = await call('run_query', { id: 'FBbt_00003686', query_type: 'NotARealQueryType' });
  check('run_query surfaces the server reason', /Unknown query_type/i.test(bad), bad);
  check('run_query lists the valid values', /SimilarMorphologyTo/.test(bad), bad);
  check('run_query no longer leaks a bare AxiosError', !/AxiosError/.test(bad), bad);
  check('available-query hint is names, not objects', !/"preview_results"|"output_format"/.test(bad), bad);
  console.log(`      [${bad.length} chars]`);
  await sleep(8000);

  // --- D: hierarchy ---------------------------------------------------------
  const hier = await call('get_hierarchy', { id: 'FBbt_00003686', relationship: 'subclass_of', max_depth: 1 });
  check('get_hierarchy drops the html blob', !/"html"/.test(hier), hier.slice(0, 200));
  check('get_hierarchy drops duplicate display_full', !/"display_full"/.test(hier), hier.slice(0, 200));
  check('get_hierarchy keeps the tree', /"descendants"/.test(hier), hier.slice(0, 200));
  console.log(`      [${hier.length} chars]`);
  await sleep(8000);

  const hierHtml = await call('get_hierarchy', { id: 'FBbt_00003686', relationship: 'subclass_of', max_depth: 1, include_html: true });
  check('include_html=true returns the html', /"html"/.test(hierHtml), hierHtml.slice(0, 200));
  console.log(`      [${hierHtml.length} chars]`);
  await sleep(8000);

  // --- E: term info ---------------------------------------------------------
  const slim = await call('get_term_info', { id: 'FBbt_00100249' });
  check('get_term_info drops empty preview blocks', !/"preview_results"/.test(slim), slim.slice(0, 200));
  check('get_term_info drops the argument schema', !/"takes"/.test(slim), slim.slice(0, 200));
  // Match a real URL, not the trim note, which names the omitted filenames.
  check('get_term_info drops the extra file URLs', !/https:\S+volume\.nrrd/.test(slim),
    (slim.match(/.{60}volume\.nrrd/) || [''])[0]);
  check('get_term_info keeps query names', /ListAllAvailableImages/.test(slim), slim.slice(0, 200));
  check('get_term_info keeps thumbnails', /thumbnail\.png/.test(slim), slim.slice(0, 200));
  await sleep(8000);

  const full = await call('get_term_info', { id: 'FBbt_00100249', verbose: true });
  check('verbose=true restores the raw response', /"takes"/.test(full) && /volume\.nrrd/.test(full), full.slice(0, 200));
  console.log(`      get_term_info: ${slim.length} chars slim vs ${full.length} verbose ` +
    `(${Math.round(100 - (100 * slim.length) / full.length)}% smaller)`);

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  child.kill();
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => { console.error(err); child.kill(); process.exit(1); });
