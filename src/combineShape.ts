// Shaping for /combine and /xref responses.
//
// Extracted from index.ts for the same reason as runQueryShape: importing
// index.ts starts a server as a module side effect, so nothing in it can be
// reached from a test process.
//
// ---------------------------------------------------------------------------
// /combine
// ---------------------------------------------------------------------------
// Boolean set algebra over the rows of two or more queries, compared on term
// id. The response is unusual in that most of it is explanation rather than
// data: `as_read` (the grouping actually parsed), `plain_english`, a per-step
// trace with the size of every intermediate set, the operand counts it worked
// from, and warnings for the three ways a combination is silently wrong. That
// material is the reason to prefer this endpoint over intersecting two
// run_query results by hand, so it must survive shaping and must be ordered
// ahead of the rows — a caveat printed after 220 rows is a caveat that gets
// skimmed past.
//
// Two defaults need changing on the way through:
//
//   1. `limit` upstream defaults to 0, meaning every row. A 220-row answer
//      carrying thumbnails is 428 KB. This is the ListAllAvailableImages
//      problem again, so the tool sends an explicit limit and strips the image
//      columns unless asked for them: 428 KB -> 9.5 KB on the same query.
//   2. There is no `offset`. Upstream reserves the name but does not implement
//      it and warns that it was ignored, so the paging note must tell the
//      caller to raise `limit` rather than advance an offset that does nothing.
//
// ---------------------------------------------------------------------------
// /xref
// ---------------------------------------------------------------------------
// The two directions of the id <-> accession mapping do NOT mean the same
// thing when they come back empty, and the difference decides what a model is
// allowed to say:
//
//   id_to_accession    one document fetch against the term's own xref list.
//                      Empty is authoritative: this term has no cross-refs.
//   accession_to_id    a search for the accession followed by an exact
//                      confirmation against each candidate's xref list. Empty
//                      means the search index did not reach a term carrying
//                      that accession — NOT that no such term exists. An
//                      accession is only searchable because VFB writes it into
//                      the label, so a bare numeric id from a link-out-only
//                      site is unfindable by construction.
//
// Left unannotated, both render as `"rows": [], "count": 0`, and the second one
// reads as a confident "there is no such neuron". This is the same class of
// mistake as reading a run_query -1 as "no results".

import { RUN_QUERY_IMAGE_COLUMNS } from './runQueryShape.js';

export const IMAGES_EXCLUDED_NOTE =
  'Image columns (thumbnail) were excluded to reduce size - re-run with include_images=true to include them.';

export const COMBINE_NO_OFFSET_NOTE =
  '/combine has no offset: it returns the strongest-first head of the result set, so raise limit (or use ' +
  'limit=0 for every row) rather than paging.';

export const XREF_REVERSE_EMPTY_NOTE =
  'NO CONFIRMED MATCH: no indexed VFB term was found carrying this accession. This is NOT proof that no such ' +
  'term exists. Cross-references are not an indexed field - the reverse lookup can only confirm a term the ' +
  'text search reached, and an accession is searchable only because VFB writes it into the term label (e.g. ' +
  '"DA1_lPN_R (FlyEM-HB:1734350908)"). Connectome bodyIds normally resolve; an accession from a site VFB only ' +
  'links out to will not. Say that the accession could not be confirmed, and do NOT fall back to a free-text ' +
  'search result as though it were a match - ranking a near-miss first is the failure this tool exists to avoid.';

export const XREF_FORWARD_EMPTY_NOTE =
  'This term carries no cross-references. Unlike the reverse direction this is authoritative: the forward ' +
  'lookup reads the term\'s own xref list directly rather than searching for it.';

export const XREF_DB_FILTERED_NOTE =
  'A db filter was applied, so an empty result means "none from this site", not "none at all" - re-run ' +
  'without db to see every cross-reference.';

/** Remove the image columns from rows and headers. Returns whether anything was
 *  actually dropped, so the caller only adds the note when it is true. */
export function stripImageColumns(
  rows: any[], headers: any,
): { rows: any[]; headers: any; excluded: boolean } {
  let excluded = false;
  const outRows = rows.map((r) => {
    if (r && typeof r === 'object' && !Array.isArray(r)) {
      const c: Record<string, any> = { ...r };
      for (const k of RUN_QUERY_IMAGE_COLUMNS) { if (k in c) { delete c[k]; excluded = true; } }
      return c;
    }
    return r;
  });
  let outHeaders = headers;
  if (headers && typeof headers === 'object') {
    outHeaders = { ...headers };
    for (const k of RUN_QUERY_IMAGE_COLUMNS) { if (k in outHeaders) { delete outHeaders[k]; } }
  }
  return { rows: outRows, headers: outHeaders, excluded };
}

export interface CombineCtx {
  includeImages: boolean;
  limit: number;
}

export function shapeCombineResult(data: any, ctx: CombineCtx): any {
  // explain_only returns the parse and no rows at all. There is nothing to
  // shape and nothing to warn about — hand it back exactly as sent.
  if (!data || !Array.isArray(data.rows)) { return data; }

  const { rows, headers, excluded } =
    ctx.includeImages
      ? { rows: data.rows, headers: data.headers, excluded: false }
      : stripImageColumns(data.rows, data.headers);

  const returned = rows.length;
  const total = (typeof data.count === 'number' && Number.isFinite(data.count) && data.count >= 0)
    ? data.count : undefined;

  const notes: string[] = [];
  if (typeof data._note === 'string' && data._note.trim()) { notes.push(data._note.trim()); }
  if (excluded) { notes.push(IMAGES_EXCLUDED_NOTE); }
  if (total !== undefined && total > returned) {
    notes.push(`Showing ${returned} of ${total} rows. ${COMBINE_NO_OFFSET_NOTE}`);
  }

  // Every key the upstream sent survives — `steps`, `operands`, `universe`,
  // `capped`, `warnings` and anything added later — with the explanation
  // ordered ahead of the bulk rows.
  const {
    headers: _h, rows: _r, count: _c, limit: _l, _note: _n,
    expression, as_read, plain_english, ...extra
  } = data;

  const shaped: Record<string, any> = {};
  // Named explicitly and first: what the server decided the question was. A
  // model that reports an answer without checking `as_read` against what the
  // user asked has skipped the only check this endpoint offers.
  if (expression !== undefined) { shaped.expression = expression; }
  if (as_read !== undefined) { shaped.as_read = as_read; }
  if (plain_english !== undefined) { shaped.plain_english = plain_english; }
  shaped.count = total !== undefined ? total : returned;
  shaped.returned = returned;
  shaped.limit = ctx.limit;
  Object.assign(shaped, extra);
  if (notes.length) { shaped._note = notes.join(' '); }
  shaped.headers = headers;
  shaped.rows = rows;
  return shaped;
}

export function shapeXrefResult(data: any): any {
  if (!data || !Array.isArray(data.rows)) { return data; }

  const notes: string[] = [];
  if (typeof data._note === 'string' && data._note.trim()) { notes.push(data._note.trim()); }
  if (data.rows.length === 0) {
    // `direction` is set by the endpoint on every successful response. If it is
    // ever absent, the reverse note is the safe one: it warns against
    // overclaiming, and the forward note asserts authority we could not verify.
    notes.push(data.direction === 'id_to_accession'
      ? XREF_FORWARD_EMPTY_NOTE
      : XREF_REVERSE_EMPTY_NOTE);
    if (data.db_matched !== undefined || data.available_dbs !== undefined) {
      notes.push(XREF_DB_FILTERED_NOTE);
    }
  }

  if (!notes.length) { return data; }
  const { rows, ...rest } = data;
  return { ...rest, _note: notes.join(' '), rows };
}
