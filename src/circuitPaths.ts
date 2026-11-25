// Request building for find_circuit_paths (VFBquery /circuit_paths, VFBquery#114).
//
// Kept out of index.ts so it can be unit tested: importing index.ts starts a
// server as a module side effect.
//
// /circuit_paths takes ids only: FBbt class ids, or VFB ids for individual
// neurons. A label would be reported as "not found in any searched dataset",
// which a model is likely to read as "no connection". So labels are refused
// here, before the request, with a pointer to search_terms.

export const CIRCUIT_ID_PATTERN = /^(?:FBbt_\d{8}|VFB_[A-Za-z0-9]+)$/;

export const CIRCUIT_DEFAULTS = {
  k: 5,
  min_synapses: 5,
  min_inprop: 0,
  normalise: 'input',
  instance_k: 3,
} as const;

export const CIRCUIT_MAX_K = 20;
export const CIRCUIT_MAX_INSTANCE_K = 10;

// instance_graph searches the neuron graph along every class path and takes
// tens of seconds on the large connectomes (22 s for LC12 -> giant fiber at the
// defaults; k=20, instance_k=10 ran past the handler's 60 s timeout). The server
// carries on after the client gives up, so keep requests small until it has a
// time limit (VFBquery#114).
export const CIRCUIT_INSTANCE_MAX_K = 5;
export const CIRCUIT_INSTANCE_MAX_INSTANCE_K = 3;

export interface CircuitPathsArgs {
  source?: string | string[];
  target?: string | string[];
  k?: number;
  min_synapses?: number;
  min_inprop?: number;
  normalise?: string;
  exclude_dbs?: string[];
  instance_graph?: boolean;
  instance_k?: number;
}

export type CircuitRequest = { params: URLSearchParams } | { error: string };

function terms(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return raw.map((t) => String(t).trim()).filter((t) => t.length > 0);
}

function wholeNumber(name: string, value: unknown, min: number, max?: number): string | null {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || (max !== undefined && n > max)) {
    return `${name} must be a whole number ${max !== undefined ? `from ${min} to ${max}` : `of at least ${min}`} (got ${JSON.stringify(value)}).`;
  }
  return null;
}

export function buildCircuitParams(args: CircuitPathsArgs): CircuitRequest {
  const sources = terms(args.source);
  const targets = terms(args.target);
  if (!sources.length || !targets.length) {
    return { error: 'find_circuit_paths needs both source and target: FBbt class ids (e.g. "FBbt_00100484") or VFB neuron ids (e.g. "VFB_fw011554").' };
  }
  const notIds = [...sources, ...targets].filter((t) => !CIRCUIT_ID_PATTERN.test(t));
  if (notIds.length) {
    return {
      error: `find_circuit_paths takes ids only, not labels: ${notIds.map((t) => JSON.stringify(t)).join(', ')}. `
        + 'Use search_terms with filter_types ["neuron","class"] to find the FBbt id of a neuron type, '
        + 'then call find_circuit_paths with that id.',
    };
  }

  if (args.instance_graph) {
    const tooBig = ([['k', CIRCUIT_INSTANCE_MAX_K], ['instance_k', CIRCUIT_INSTANCE_MAX_INSTANCE_K]] as const)
      .filter(([name, max]) => args[name] !== undefined && args[name] !== null && Number(args[name]) > max)
      .map(([name, max]) => `${name} at most ${max}`);
    if (tooBig.length) {
      return {
        error: `With instance_graph=true, use ${tooBig.join(' and ')}: neuron chains take tens of seconds `
          + 'on the large connectomes. For more class paths, call again without instance_graph.',
      };
    }
  }

  const params = new URLSearchParams();
  params.set('source', sources.join(','));
  params.set('target', targets.join(','));

  const checks: Array<[keyof CircuitPathsArgs, number, number?]> = [
    ['k', 1, CIRCUIT_MAX_K],
    ['min_synapses', 0],
    ['instance_k', 1, CIRCUIT_MAX_INSTANCE_K],
  ];
  for (const [name, min, max] of checks) {
    if (args[name] === undefined || args[name] === null) continue;
    const problem = wholeNumber(name, args[name], min, max);
    if (problem) return { error: problem };
    params.set(name, String(Number(args[name])));
  }
  if (args.min_inprop !== undefined && args.min_inprop !== null) {
    const p = Number(args.min_inprop);
    if (!Number.isFinite(p) || p < 0 || p > 1) {
      return { error: `min_inprop must be a number from 0 to 1 (got ${JSON.stringify(args.min_inprop)}).` };
    }
    params.set('min_inprop', String(p));
  }
  if (args.normalise !== undefined && args.normalise !== null && args.normalise !== '') {
    const n = String(args.normalise).trim().toLowerCase();
    if (n !== 'input' && n !== 'output') {
      return { error: `normalise must be "input" or "output" (got ${JSON.stringify(args.normalise)}).` };
    }
    params.set('normalise', n);
  }
  // Omitted -> the endpoint's default (hb, fafb); [] -> every dataset.
  if (Array.isArray(args.exclude_dbs)) {
    params.set('exclude_dbs', args.exclude_dbs.map((s) => String(s).trim()).filter(Boolean).join(','));
  }
  if (args.instance_graph !== undefined && args.instance_graph !== null) {
    params.set('instance_graph', args.instance_graph ? 'true' : 'false');
  }
  return { params };
}
