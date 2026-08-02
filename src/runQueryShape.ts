// Shaping for /run_query responses.
//
// Extracted from index.ts so it can be unit tested: importing index.ts starts a
// server (stdio or HTTP) as a module side effect, so nothing in it is reachable
// from a test process.
//
// ---------------------------------------------------------------------------
// What `count` means on a /run_query response
// ---------------------------------------------------------------------------
// VFBquery returns a JSON body of {headers, rows, count, …} with HTTP 200 even
// when the query did not run. The distinction lives entirely in `count`:
//
//   count >= 0   the query ran; this is the authoritative total number of rows
//                that match, independent of how many were returned on this page.
//   count == -1  the query did NOT run. vfb_queries.py returns
//                {"headers": …, "rows": [], "count": -1} when Owlery fails
//                (5xx, connection error, retries exhausted). It is an error
//                indication, NOT "no matching rows" and NOT "too many to
//                count". (A 400 Bad Request is different: that returns
//                count: 0, a genuine empty result.)
//
// This is NOT the same `-1` that appears in get_term_info previews, where -1
// plus preview_results.status distinguishes "not counted yet" from "more than
// the preview cap". A /run_query -1 only ever means failure.
//
// Two things follow, and both are the point of this module:
//   1. A -1 must never reach the model as a bare number in a `count` field. It
//      reads as "0" or as a real total and gets reported to the user as fact.
//   2. The paging note used to be gated on `total > offset + returned`, which
//      for -1 is `-1 > 25` — false — so the failure case was also the case that
//      produced no explanatory note at all.
//
// The upstream also flags `capped`, `truncated` and `warnings` at the top
// level, so the shaped result is built by preserving every key it was given
// rather than by listing the ones we happen to know about today.

export const RUN_QUERY_IMAGE_COLUMNS = ['thumbnail', 'thumbnail_transparent'];

/** 'exact' — count is the true total. 'row_count' — no count was supplied, so
 *  the returned row count is standing in for it. 'unavailable' — the query
 *  failed upstream and no count exists. */
export type CountStatus = 'exact' | 'row_count' | 'unavailable';

export const QUERY_FAILED_NOTE =
  'QUERY FAILED: the VFB query service returned an error indication (count -1) instead of a result set. ' +
  'This is NOT an empty result: it does NOT mean there are no matching rows, and it must not be reported as ' +
  '"0", "none" or "no results". Retry this exact call once with force_refresh=true (the failure may have been ' +
  'cached); if it fails again, tell the user this VFB query is temporarily unavailable rather than answering ' +
  'from memory.';

export const TRUNCATED_NOTE =
  'The server holds only the first part of this result set; "count" is the true total but rows beyond the ' +
  'stored window cannot be paged to.';

export interface ShapeCtx {
  includeImages: boolean;
  limit: number;
  offset: number;
}

export function shapeRunQueryResult(data: any, ctx: ShapeCtx): any {
  if (!data || !Array.isArray(data.rows)) { return data; }

  const rawCount = (typeof data.count === 'number' && Number.isFinite(data.count)) ? data.count : undefined;
  const countStatus: CountStatus =
    rawCount === undefined ? 'row_count' : (rawCount < 0 ? 'unavailable' : 'exact');
  // The row total to reason about for paging. Undefined when the query failed:
  // there is no total, and pretending -1 is one is the bug this fixes.
  const total = countStatus === 'unavailable' ? undefined
    : (rawCount !== undefined ? rawCount : data.rows.length);

  let rows: any[] = data.rows;
  let headers = data.headers;
  let imagesExcluded = false;
  if (!ctx.includeImages) {
    rows = rows.map((r) => {
      if (r && typeof r === 'object' && !Array.isArray(r)) {
        const c: Record<string, any> = { ...r };
        for (const k of RUN_QUERY_IMAGE_COLUMNS) { if (k in c) { delete c[k]; imagesExcluded = true; } }
        return c;
      }
      return r;
    });
    if (headers && typeof headers === 'object') {
      headers = { ...headers };
      for (const k of RUN_QUERY_IMAGE_COLUMNS) { if (k in headers) { delete headers[k]; } }
    }
  }

  const returned = rows.length;
  const notes: string[] = [];
  // Anything the upstream already said comes first and is never dropped.
  if (typeof data._note === 'string' && data._note.trim()) { notes.push(data._note.trim()); }
  if (countStatus === 'unavailable') { notes.push(QUERY_FAILED_NOTE); }
  if (imagesExcluded) { notes.push('Image columns (thumbnail) were excluded to reduce size - re-run this query with include_images=true to include them.'); }
  if (total !== undefined) {
    if (total > ctx.offset + returned) {
      const nextOffset = ctx.offset + (ctx.limit > 0 ? ctx.limit : returned);
      notes.push(`Showing rows ${ctx.offset}-${ctx.offset + returned} of ${total}. To see more, re-run with offset=${nextOffset} (same limit).`);
    } else if (ctx.offset > 0) {
      notes.push(`Showing rows ${ctx.offset}-${ctx.offset + returned} of ${total}.`);
    }
  }
  if (data.truncated === true) { notes.push(TRUNCATED_NOTE); }

  // Keep every top-level key the upstream sent — `capped`, `truncated`,
  // `warnings` and anything added later — while preserving the field order the
  // model reads: the scalars and the note before the bulk rows.
  const { count: _count, headers: _headers, rows: _rows, offset: _offset, limit: _limit, _note: _upstreamNote, ...extra } = data;
  const shaped: Record<string, any> = {
    // -1 is passed through unaltered so existing consumers that test `count >= 0`
    // keep working; count_status is what new consumers should read.
    count: countStatus === 'unavailable' ? rawCount : total,
    count_status: countStatus,
    offset: ctx.offset,
    limit: ctx.limit,
    returned,
    ...extra,
  };
  if (notes.length) { shaped._note = notes.join(' '); }
  shaped.headers = headers;
  shaped.rows = rows;
  return shaped;
}

/** True when a shaped-or-raw run_query payload reports an upstream failure. */
export function runQueryFailed(data: any): boolean {
  return !!data && typeof data.count === 'number' && data.count < 0;
}
