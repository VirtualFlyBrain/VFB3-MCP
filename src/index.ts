import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import cors from 'cors';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { shapeRunQueryResult, runQueryFailed } from './runQueryShape.js';
import { shapeCombineResult, shapeXrefResult } from './combineShape.js';

// Version is single-sourced from package.json so a release tag (forced into
// package.json by CI before the build) flows straight into serverInfo.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const VERSION: string = require('../package.json').version;

// GA4 Analytics configuration
const GA_MEASUREMENT_ID = process.env.GA_MEASUREMENT_ID || 'G-K7DDZVVXM7';
const GA_API_SECRET = process.env.GA_API_SECRET || '';
const GA_ENABLED = !!(GA_MEASUREMENT_ID && GA_API_SECRET);
const STDIO_CLIENT_ID = randomUUID(); // fallback client_id for stdio mode

function trackToolCall(
  toolName: string,
  toolArgs: Record<string, unknown>,
  sessionId?: string,
  clientIp?: string
): void {
  if (!GA_ENABLED) return;

  const clientId = sessionId || STDIO_CLIENT_ID;

  // Flatten tool args into GA4 params with arg_ prefix, truncated to 100 chars
  const argSummary: Record<string, string> = {};
  for (const [key, value] of Object.entries(toolArgs)) {
    const strValue = typeof value === 'string' ? value : JSON.stringify(value);
    argSummary[`arg_${key}`] = strValue.slice(0, 100);
  }

  const payload = {
    client_id: clientId,
    events: [
      {
        name: 'mcp_tool_call',
        params: {
          session_id: clientId,
          engagement_time_msec: '100',
          tool_name: toolName,
          server_version: VERSION,
          mcp_mode: process.env.MCP_MODE || 'stdio',
          ...(clientIp ? { client_ip: clientIp } : {}),
          ...argSummary,
        },
      },
    ],
  };

  // Fire-and-forget: do not await, swallow all errors
  axios
    .post(
      `https://www.google-analytics.com/mp/collect?measurement_id=${GA_MEASUREMENT_ID}&api_secret=${GA_API_SECRET}`,
      payload
    )
    .catch(() => {});
}

/**
 * Expand batch tool calls into individual tracking events so every
 * ID / query pair gets its own GA4 row with batch_size + batch_index.
 */
function trackBatchToolCalls(
  toolName: string,
  toolArgs: Record<string, unknown>,
  sessionId?: string,
  clientIp?: string
): void {
  if (toolName === 'get_term_info') {
    const id = toolArgs.id;
    if (Array.isArray(id)) {
      for (let i = 0; i < id.length; i++) {
        trackToolCall(toolName, { id: id[i], batch_size: id.length, batch_index: i }, sessionId, clientIp);
      }
      return;
    }
  }

  if (toolName === 'run_query') {
    const queries = toolArgs.queries as Array<{ id: string; query_type: string }> | undefined;
    const id = toolArgs.id;
    const queryType = toolArgs.query_type as string | undefined;

    if (queries && Array.isArray(queries) && queries.length > 0) {
      for (let i = 0; i < queries.length; i++) {
        trackToolCall(toolName, { id: queries[i].id, query_type: queries[i].query_type, batch_size: queries.length, batch_index: i }, sessionId, clientIp);
      }
      return;
    }
    if (Array.isArray(id) && queryType) {
      for (let i = 0; i < id.length; i++) {
        trackToolCall(toolName, { id: id[i], query_type: queryType, batch_size: id.length, batch_index: i }, sessionId, clientIp);
      }
      return;
    }
  }

  // Single call — pass through as-is
  trackToolCall(toolName, toolArgs, sessionId, clientIp);
}

interface RequestContext {
  id?: string;
  clientIp?: string;
}

function setupToolHandlers(server: Server, sessionIdHolder?: RequestContext) {
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    console.error('MCP Debug: Received ListTools request');
    return {
      tools: [
        {
          name: 'get_term_info',
          description: 'Get term info for a VFB or anatomy ontology entity (VFB_*, FBbt_*, etc.). THIS IS THE QUERY DISCOVERY TOOL: the response\'s "Queries" array lists the valid query_type values that run_query accepts for this entity. ALWAYS call get_term_info before run_query unless you already obtained the query_type from a previous get_term_info call in this conversation. Returns: SuperTypes (classification), Tags (data flags like has_image, has_neuron_connectivity), Queries (valid query_types for run_query), RelatedTools (other MCP tools applicable to this entity, with default_args ready to copy — e.g. get_hierarchy with subclass_of for cell types or part_of for nervous-system regions), Images (keyed by template brain ID), Publications, Synonyms. Supports batch — pass an array of IDs to fetch in parallel; batch results are returned as a JSON object keyed by ID. To build VFB browser URLs from the Images field: https://v2.virtualflybrain.org/org.geppetto.frontend/geppetto?id=<VFB_ID>&i=<TEMPLATE_ID>,<IMAGE_ID1>,<IMAGE_ID2> — id= sets the focus term and i= lists images for the 3D viewer (template ID must be first in i= to set the coordinate space).',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                oneOf: [
                  { type: 'string', description: 'A single VFB ID (e.g., VFB_jrcv0i43)' },
                  { type: 'array', items: { type: 'string' }, description: 'An array of VFB IDs to fetch in batch (e.g., ["VFB_jrcv0i43", "VFB_00101567"])' },
                ],
                description: 'One or more VFB IDs to look up',
              },
              force_refresh: {
                type: 'boolean',
                description: 'Bypass the response cache and recompute this result. Expensive — leave it unset on a first call. Set it ONLY to re-try a call that, earlier in this same conversation, returned a result that was clearly wrong, stale, or reported as failed. Never set it on more than one retry of the same call.',
              },
            },
            required: ['id'],
          },
        },
        {
          name: 'run_query',
          description: 'Run a pre-computed query on a VFB entity. REQUIRED WORKFLOW: (1) call get_term_info on the ID first; (2) read the response\'s "Queries" array; (3) pass one of those values as query_type. Calling run_query with a guessed query_type will return an error. If a query returns empty rows or an error, the entity does not support that query_type or has no data for it — try a different query_type from the Queries array, or try a related entity (e.g. its parent class via get_hierarchy). Empty results do NOT mean the answer is unknown — only that this call did not return it. NEVER fabricate results from training data when a query is empty; tell the user clearly what was tried. NEVER pass tool names like "get_term_info" or "search_terms" as query_type — those are separate tools. Common query_types by entity kind: PaintedDomains, AllAlignedImages, AlignedDatasets, AllDatasets (templates); SimilarMorphologyTo, NeuronInputsTo, NeuronNeuronConnectivityQuery, NeuronRegionConnectivityQuery (individual neurons); ListAllAvailableImages, SubclassesOf, PartsOf, NeuronsPartHere, NeuronsSynaptic, ExpressionOverlapsHere, DownstreamClassConnectivity, UpstreamClassConnectivity (classes). Supports batch — pass an array of IDs (same query_type) or a "queries" array of {id, query_type} pairs; batch results are keyed by "ID::query_type". Results are PAGED: the first 25 rows by default (change with limit/offset) plus the true total as "count". ALWAYS read "count_status" before quoting "count": "exact" means count is the true total; "unavailable" means the query FAILED upstream and count is -1, which is NOT zero and must never be reported as "no results" — read "_note" and tell the user the query could not be run. Image/thumbnail columns are excluded by default to save space - pass include_images=true to include them. FlyBase integration is via query_types too: FindStocks (fly stocks for a FlyBase feature ID - FBgn/FBal/FBti/FBtp/FBco/FBst) and FindComboPublications (publications for an FBco split-GAL4 combination). Get those IDs from resolve_entity / resolve_combination first, then run_query with the ID and the query_type. Include FlyBase links in output: https://flybase.org/reports/{ID}.',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                oneOf: [
                  { type: 'string', description: 'A single VFB ID (e.g., VFB_00101567)' },
                  { type: 'array', items: { type: 'string' }, description: 'An array of VFB IDs — all will use the same query_type' },
                ],
                description: 'One or more VFB IDs to query',
              },
              query_type: {
                type: 'string',
                description: 'A valid query type from the Queries array returned by get_term_info. Used for single id or array of ids.',
              },
              queries: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', description: 'VFB ID' },
                    query_type: { type: 'string', description: 'Query type for this ID' },
                  },
                  required: ['id', 'query_type'],
                },
                description: 'Array of {id, query_type} pairs for mixed batch queries. When provided, id and query_type params are ignored.',
              },
              limit: {
                type: 'number',
                description: 'Max rows returned per call (default 25). The true total is always returned as "count"; broad queries (e.g. ListAllAvailableImages, or NeuronsSynaptic on a whole region) can have thousands to hundreds of thousands of rows. Use 0 for all rows (still capped server-side ~25000 - avoid for broad queries).',
              },
              offset: {
                type: 'number',
                description: 'Row offset for paging (default 0). To get the next page, re-run with offset increased by limit; "count" gives the total.',
              },
              include_images: {
                type: 'boolean',
                description: 'Include the image/thumbnail column in result rows. Default false: the thumbnail is a long markdown image string that is rarely useful to reason over and greatly inflates every row, so it is stripped and the response says so in _note. Set true to include it (e.g. to build image URLs).',
              },
              force_refresh: {
                type: 'boolean',
                description: 'Bypass the response cache and recompute this result. Expensive — leave it unset on a first call. Set it ONLY to re-try a call that, earlier in this same conversation, returned a result that was clearly wrong, stale, or reported as failed. Never set it on more than one retry of the same call. A failed query (count -1) is already retried once automatically, so you do not need this for that case.',
              },
            },
          },
        },
        {
          name: 'search_terms',
          description: 'Search VFB terms. This is the search virtualflybrain.org itself runs — the same Solr query, the same ranking — so what comes back first here is what a user would see first on the site.\n\nUSE filter_types BY DEFAULT. Unfiltered searches mix scRNAseq artifacts and developmental stages in with the entity the user wants.\n\nCommon filter_types recipes:\n- Neuron classes: ["neuron", "class"]\n- Individual neurons with images: ["neuron", "has_image"]\n- Neurons with connectome data: ["neuron", "has_neuron_connectivity"]\n- Brain regions / neuropils: ["anatomy"]\n- Genes: ["gene"]\n- Driver lines / expression patterns: ["expression_pattern"]\n- Datasets: ["dataset"]\n\nThere are over 200 type names and they change as data is added, so do NOT guess them: call list_search_facets to see the current vocabulary (optionally filtered, e.g. contains="lineage"). Names are matched case- and separator-insensitively, and a name that does not exist is an error with suggestions rather than a silently empty result.\n\nDeprecated terms are excluded by the search itself — you do not need exclude_types: ["deprecated"], and adding it is harmless but pointless.\n\nStage filtering: VFB covers adult, larval, and embryonic data, and many anatomical FBbt classes are stage-agnostic. Do NOT add "adult" or "larva" to filter_types by default — only add them when the user is explicit about a stage (e.g. "adult Kenyon cells", "larval mushroom body"). Default searches should leave stage out so stage-agnostic classes and all life stages are visible.\n\nUseful flags:\n- unique=true (the default) → one row per term. Turn it OFF only when you need to see WHICH synonym matched; with unique=false a term appears once per matching synonym, so "Kenyon cell" can return the same ID several times.\n- minimize_results=true → top 10, essential fields only, for exploratory searches.\n- auto_fetch_term_info=true → if an exact label match is found, returns get_term_info in the same response.\n- boost_types=["has_image", "has_neuron_connectivity"] → float data-rich entities to the top of the list without excluding anything else.\n- demote_types=["expression_pattern_fragment"] → sink noisy types to the bottom of the list instead of removing them.\n\nIf the search returns no good matches, do NOT fall back to training-data answers — try alternative spellings, synonyms, broader terms, or different filter_types.\n\nMultiple filter_types are ANDed (results must match ALL). Multiple exclude_types are ORed (any match excludes). boost_types and demote_types re-order without excluding; boost wins if a term matches both.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search query (e.g., medulla)',
              },
              filter_types: {
                type: 'array',
                items: { type: 'string' },
                description: 'Filter results to only include items matching ALL of these facets_annotation types (AND logic). Use list_search_facets for valid names.',
              },
              exclude_types: {
                type: 'array',
                items: { type: 'string' },
                description: 'Exclude results matching ANY of these facets_annotation types (OR logic). Deprecated terms are already excluded.',
              },
              boost_types: {
                type: 'array',
                items: { type: 'string' },
                description: 'Float results matching these facets_annotation types to the top of the ranked list without excluding others',
              },
              demote_types: {
                type: 'array',
                items: { type: 'string' },
                description: 'Sink results matching these facets_annotation types to the bottom of the ranked list without excluding them. Ignored for a type that also appears in boost_types.',
              },
              unique: {
                type: 'boolean',
                description: 'One row per term (default true). Set false to get a row per matching synonym, which shows WHICH name matched at the cost of repeating IDs.',
                default: true,
              },
              start: {
                type: 'number',
                description: 'Pagination start index (default 0) - use to get results beyond the first page',
                default: 0,
              },
              rows: {
                type: 'number',
                description: 'Number of results to return (default 150, max 1000) - use smaller numbers for focused searches',
                default: 150,
                maximum: 1000,
              },
              minimize_results: {
                type: 'boolean',
                description: 'When true, return at most 10 results with only the essential fields. For exact matches, return only the matching result.',
                default: false,
              },
              auto_fetch_term_info: {
                type: 'boolean',
                description: 'When true and an exact label match is found, automatically fetch and include term info in the response.',
                default: false,
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'list_search_facets',
          description: 'List the type names search_terms can filter, exclude, boost or demote by, with the number of terms carrying each one. Call this instead of guessing: there are over 200 names, they are the index\'s own annotations rather than a curated list, and they change as data is added. Use contains to narrow (e.g. contains="lineage" for the ~120 lineage clones, contains="connectivity" to find the connectome facets). The counts tell you whether a name is broad or niche — "entity" covers everything, a single lineage covers a handful.',
          inputSchema: {
            type: 'object',
            properties: {
              contains: {
                type: 'string',
                description: 'Only return type names containing this text. Matched case- and separator-insensitively, so "nervous system" finds "Nervous_system".',
              },
            },
          },
        },
        {
          name: 'resolve_entity',
          description: 'Resolve an unresolved FlyBase-related query string into VFB/FlyBase IDs and metadata. Pass the raw text exactly as the user wrote it (for example "P{VT054895-GAL4.DBD}", "Hb9-GAL4", "SS04495", "MB002B", "PAM cluster", or "dpp"). Do NOT pass resolved IDs such as FBgn/FBal/FBti/FBco/FBst or VFB IDs; if you already have an ID, use the downstream tool directly. Uses tiered resolution: exact name → synonym → broad pattern match. Returns match_type (EXACT/SYNONYM/BROAD), feature ID, name, type, and synonyms. IMPORTANT: When match_type is SYNONYM or BROAD, always confirm the resolved entity with the user before proceeding to further queries. If multiple matches are returned, show a disambiguation list and ask the user to choose. This tool queries FlyBase Chado — for VFB ontology lookups (anatomical terms, neuron class IDs) use search_terms instead.',
          inputSchema: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Unresolved FlyBase-related query string from the user. Pass the raw name/synonym exactly as written (e.g., "P{VT054895-GAL4.DBD}", "Hb9-GAL4", "SS04495", "MB002B", "PAM cluster", "dpp"). Do NOT pass an already resolved FlyBase or VFB ID.',
              },
            },
            required: ['name'],
          },
        },
        {
          name: 'resolve_combination',
          description: 'Resolve an unresolved split-GAL4 combination name or synonym into its FBco ID and component hemidrivers. Pass the raw combination text exactly as the user wrote it (for example "MB002B" or "SS04495"). Do NOT pass an FBco ID; if you already have one, use the downstream tool directly. Uses tiered resolution: exact name → synonym → broad pattern match. Returns FBco ID, combination name, matched synonym (if applicable), and component allele IDs/names. IMPORTANT: When match is via synonym, confirm the resolved combination with the user before proceeding (e.g., "Your search for \'MB002B\' matched [formal name] (FBco...) via synonym. Shall I proceed?"). If multiple matches, show disambiguation list and ask user to choose.',
          inputSchema: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Unresolved split-GAL4 combination name or synonym exactly as written by the user (e.g., "MB002B", "SS04495"). Do NOT pass an FBco ID here.',
              },
            },
            required: ['name'],
          },
        },
        {
          name: 'list_connectome_datasets',
          description: 'List available connectome datasets with their labels and symbols. Use the returned symbols when constructing exclude_dbs arguments for query_connectivity. Common datasets include Hemibrain (hb), FAFB (fafb), MANC, and others. Call this tool if unsure which dataset symbols are valid.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'query_connectivity',
          description: 'Query synaptic connectivity between Drosophila neuron classes across ALL connectome datasets simultaneously for comparative connectomics. This is NOT pre-cached — it runs live queries, so expect slow responses (up to several minutes). Set both upstream_type AND downstream_type to filter connections between two specific neuron classes (e.g., "What Tm1→T3 connections exist across all datasets?"). At least one of upstream_type or downstream_type is required. CONSTRAINTS: Only accepts neuron class terms (OWL IDs like FBbt_00003789 or labels like "transmedullary neuron Tm1") — anatomical regions or neuropils (e.g., "lobula", "medulla") are NOT accepted. NOT suitable for individual neuron-to-neuron connections — for pre-computed connections of a single individual neuron, use run_query with NeuronNeuronConnectivityQuery instead. NOT for muscle/sense organ connections. RECOMMENDED DEFAULTS: weight=5, exclude_dbs=["hb","fafb"] unless user specifies otherwise. For both-ends queries, start with weight≥50 to avoid timeouts. RESULT SIZE: a broad query is enormous (a single class at weight=5 can be over 50,000 connections), so results are ranked strongest-first and paged — you get limit rows (default 50) plus a summary computed over ALL of them: totals, per-dataset counts, distinct neuron counts, and the top class pairs. Answer from the summary and quote a handful of rows; only page with offset if the user asks for specific further rows. WORKFLOW: Confirm parameters with user before querying. Use search_terms with filter_types ["neuron","class"] to validate/canonicalize neuron type labels. If zero results, try relaxation: lower weight to 1, then remove exclude_dbs filter, then try group_by_class=true — report what worked and let user decide. group_by_class=true is usually the better first call on a broad query: it aggregates to class pairs instead of returning every neuron pair.',
          inputSchema: {
            type: 'object',
            properties: {
              upstream_type: {
                type: 'string',
                description: 'Upstream (presynaptic) neuron class — OWL ID (e.g., "FBbt_00003789") or full label (e.g., "transmedullary neuron Tm1"). Must be a neuron type/class, NOT an anatomical region. Use search_terms with filter_types ["neuron","class"] to validate/canonicalize labels before querying.',
              },
              downstream_type: {
                type: 'string',
                description: 'Downstream (postsynaptic) neuron class — OWL ID or full label. Must be a neuron type/class, NOT an anatomical region. If user asks about connectivity to a brain region, first find neuron classes in that region using search_terms, then query for those classes.',
              },
              weight: {
                type: 'number',
                description: 'Minimum synapse count threshold (recommended default: 5). Lower to 1 if initial query returns zero results as first relaxation step.',
              },
              group_by_class: {
                type: 'boolean',
                description: 'If true, aggregate results by neuron class — returns total_weight, average_weight, percent_connected per class pair, ranked by pairwise_connections. If false (default), returns individual neuron-to-neuron rows.',
              },
              exclude_dbs: {
                type: 'array',
                items: { type: 'string' },
                description: 'Dataset symbols to exclude (recommended default: ["hb", "fafb"] to focus on newer datasets). Pass empty array [] to include all datasets. Must be the exact `symbol` field from list_connectome_datasets — currently BANC, fw, ol, mv, hb, mc, fafb, l1em. An unrecognised symbol is silently ignored by the server rather than reported, so a dataset name ("hemibrain", "male-cns", "flywire") excludes nothing and gives no warning. Call list_connectome_datasets rather than guessing.',
              },
              limit: {
                type: 'number',
                description: 'How many connection rows to return, strongest first (default 50). The summary always covers every connection found, not just the returned rows. Pass 0 for all rows — only do this on a query you already know is small, as broad queries return tens of thousands.',
                default: 50,
              },
              offset: {
                type: 'number',
                description: 'Row to start from within the strongest-first ranking (default 0). Re-running with the same limit and the next offset walks down the list.',
                default: 0,
              },
            },
          },
        },
        {
          name: 'get_hierarchy',
          description: 'Build a hierarchy tree for a VFB term, showing ancestors (parents) and/or descendants (children). Use relationship "part_of" for brain region structure (e.g. "what are the parts of the mushroom body?") and "subclass_of" for cell type hierarchies (e.g. "what types of Kenyon cell are there?"). Descendants are returned as a nested tree for both relationship types. Ancestors are returned as a nested chain, filtered to nervous system terms for part_of. Start with max_depth=1 for direct parents/children, and offer to go deeper if the user wants more detail.',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'VFB term ID (e.g. FBbt_00005801 for mushroom body, FBbt_00003686 for Kenyon cell)',
              },
              relationship: {
                type: 'string',
                enum: ['part_of', 'subclass_of'],
                description: 'Type of hierarchy: "part_of" for brain region structure, "subclass_of" for cell type taxonomies',
              },
              direction: {
                type: 'string',
                enum: ['descendants', 'ancestors', 'both'],
                description: 'Which direction to explore (default: "both")',
                default: 'both',
              },
              max_depth: {
                type: 'number',
                description: 'Number of levels to expand. 1 = direct children/parents only. Higher values go deeper. -1 = full tree (use with caution on broad terms). Default: 1.',
                default: 1,
              },
            },
            required: ['id', 'relationship'],
          },
        },
        {
          name: 'lookup_xref',
          description: 'Map a VFB ID to its external database accessions, or an external accession back to the VFB term that carries it. USE THIS INSTEAD OF search_terms FOR ANY EXTERNAL ACCESSION — a hemibrain/FAFB/MANC bodyId, a CATMAID skeleton id, a neuprint id. Free-text search on a bare number ranks a plausible near-miss first and gives you no way to tell a real match from a good guess; this tool confirms the accession against each candidate term\'s own cross-reference list and returns a row only if that term really carries it. Each row gives the VFB id, label, site (db, db_label, site_id), the accession and a resolved deep link into the external site. Pass exactly one of id or accession. THE TWO DIRECTIONS DIFFER WHEN EMPTY: an empty id->accession result is authoritative (the term has no cross-references); an empty accession->id result means the search index did not reach a term carrying that accession, NOT that no such term exists — report it as "could not confirm", never as "does not exist", and do not substitute a search_terms guess.',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'A VFB ID to list external accessions for (e.g. VFB_jrchjtdb). Mutually exclusive with accession.',
              },
              accession: {
                type: 'string',
                description: 'An external accession to resolve back to a VFB term (e.g. 1734350908 for a hemibrain bodyId). Mutually exclusive with id.',
              },
              db: {
                type: 'string',
                description: 'Optional site filter. Matches a site symbol ("hb"), short_form ("neuprint_JRC_Hemibrain_1point2point1") or label, ignoring case, punctuation and spacing, and also accepts whole words from those names — "flywire", "hemibrain", "neuprint", "catmaid", "male-cns" all work. When set, the response carries db_matched and available_dbs; a filtered empty result means "none from this site", not "none at all".',
              },
            },
          },
        },
        {
          name: 'combine_queries',
          description: 'Boolean set algebra over the results of two or more VFB queries, compared on term ID. USE THIS INSTEAD OF RUNNING THE QUERIES SEPARATELY AND INTERSECTING THEM YOURSELF — the operands are often hundreds or thousands of rows each, so doing it by hand is both slow and a common source of wrong answers. Answers questions of the form "which neurons are in both X and Y", "in X but not Y", "in either but not both". Operators: AND OR NOT XOR NAND NOR XNOR, unary NOT, brackets, symbol aliases (& | - ^) and plain-English aliases ("but not", "in both", "either but not both"). Precedence loosest-first: OR/NOR, then XOR/XNOR, then AND/NAND/NOT, all left-associative. The response explains itself — as_read gives the grouping actually parsed, plain_english reads the whole expression back, steps traces the size of every intermediate set, and warnings flag the three ways a combination is silently wrong (a truncated operand, two sides in different ID namespaces, a complement against an implicit universe). ALWAYS CHECK as_read AGAINST WHAT THE USER ASKED before reporting the answer; use explain_only=true to see the parse for free before spending a query. Query-type operands must name a real query_type — get it from get_term_info\'s Queries array for the term in question, exactly as for run_query.',
          inputSchema: {
            type: 'object',
            properties: {
              expr: {
                type: 'string',
                description: 'The boolean expression over your operand names, e.g. "calyx AND lh", "calyx but not lh", "(a OR b) AND NOT c". Max 2000 characters.',
              },
              operands: {
                type: 'object',
                description: 'Named sets referenced by expr. Each value takes one of three forms: "<QueryType>:<id>" to run a query (e.g. "NeuronsPartHere:FBbt_00007401" — any run_query query_type), "search:<text>" for a free-text search, or "ids:<id>,<id>" for a literal set (useful for a list from a paper or the ids of a previous combine). Max 12 operands.',
                additionalProperties: { type: 'string' },
              },
              universe: {
                type: 'string',
                description: 'Optional operand spec, same three forms, defining what "everything" means for a complement (NOT, NAND, NOR, XNOR). Defaults to the union of the operands in the expression, because VFB holds around 750,000 terms and returning most of them is never the intended answer.',
              },
              limit: {
                type: 'number',
                description: 'Rows to return (default 25). count is always the true size of the result set. There is no offset — raise limit, or pass 0 for every row, only on a result you already know is small.',
                default: 25,
              },
              include_images: {
                type: 'boolean',
                description: 'Include the thumbnail column (default false — it is stripped to save space; on a 220-row result it is the difference between 428 KB and 9.5 KB).',
                default: false,
              },
              explain_only: {
                type: 'boolean',
                description: 'Parse and explain the expression without running any query (default false). Returns as_read, plain_english and the universe note in well under a kilobyte. Use it to confirm the grouping of anything more complicated than a single operator before spending real work.',
                default: false,
              },
              require_complete: {
                type: 'boolean',
                description: 'Fail rather than answer if any operand was truncated (default false). A set operation over a truncated operand is silently wrong, so set this when the answer matters more than getting one.',
                default: false,
              },
            },
            required: ['expr', 'operands'],
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const batchSize = name === 'get_term_info' && Array.isArray(args?.id) ? args.id.length
      : name === 'run_query' && Array.isArray(args?.queries) ? args.queries.length
      : name === 'run_query' && Array.isArray(args?.id) ? args.id.length
      : 1;
    console.error(`MCP Debug: Received CallTool request for tool: ${name} (batch_size=${batchSize}) client_ip=${sessionIdHolder?.clientIp || 'unknown'} with args:`, JSON.stringify(args));

    const sid = sessionIdHolder?.id;
    const cip = sessionIdHolder?.clientIp;
    trackBatchToolCalls(name, args || {}, sid, cip);

    try {
      switch (name) {
        case 'get_term_info':
          return await handleGetTermInfo(args as { id: string | string[]; force_refresh?: boolean });
        case 'run_query':
          return await handleRunQuery(args as { id?: string | string[]; query_type?: string; queries?: Array<{ id: string; query_type: string }>; limit?: number; offset?: number; include_images?: boolean; force_refresh?: boolean });
        case 'search_terms':
          return await handleSearchTerms(args as { query: string; filter_types?: string[]; exclude_types?: string[]; boost_types?: string[]; demote_types?: string[]; unique?: boolean; start?: number; rows?: number; minimize_results?: boolean; auto_fetch_term_info?: boolean });
        case 'list_search_facets':
          return await handleListSearchFacets(args as { contains?: string });
        case 'resolve_entity':
          return await handleResolveEntity(args as { name: string });
        case 'resolve_combination':
          return await handleResolveCombination(args as { name: string });
        case 'list_connectome_datasets':
          return await handleListConnectomeDatasets();
        case 'query_connectivity':
          return await handleQueryConnectivity(args as { upstream_type?: string; downstream_type?: string; weight?: number; group_by_class?: boolean; exclude_dbs?: string[]; limit?: number; offset?: number });
        case 'get_hierarchy':
          return await handleGetHierarchy(args as { id: string; relationship: string; direction?: string; max_depth?: number });
        case 'lookup_xref':
          return await handleLookupXref(args as { id?: string; accession?: string; db?: string });
        case 'combine_queries':
          return await handleCombineQueries(args as { expr: string; operands: Record<string, string>; universe?: string; limit?: number; include_images?: boolean; explain_only?: boolean; require_complete?: boolean });
        default:
          console.error('MCP Debug: Unknown tool requested:', name);
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${name}`
          );
      }
    } catch (error) {
      console.error('MCP Debug: Error calling tool', name, ':', error);
      throw new McpError(
        ErrorCode.InternalError,
        `Error calling tool ${name}: ${error}`
      );
    }
  });
}

// v3-cached is an nginx cache in front of VFBquery. Its cache key is
// "$request_method$request_uri", so adding a query parameter does NOT refresh
// the entry a normal call reads — it writes a different slot and leaves the
// canonical one stale. The only mechanism that refreshes the entry the service
// actually serves is the X-Force-Refresh request header:
//
//   * nginx (owl_cache nginx.conf.template) maps it to proxy_cache_bypass, so
//     the request reaches VFBquery and the fresh response is written back into
//     the canonical slot;
//   * VFBquery then honours the same header itself (ha_api.py
//     `_force_refresh_requested`) and skips its own SOLR cache.
//
// This matters beyond staleness: VFBquery answers an upstream Owlery failure
// with HTTP 200 and count -1, and nginx caches 200s for months. A single
// transient failure can therefore be served as a "result" long after the
// service recovered. Forcing a refresh is what heals that slot.
//
// IMPORTANT DEPLOYMENT DEPENDENCY: nginx only honours the header from a
// whitelisted client IP (`map "$is_whitelisted_ip:$http_x_force_refresh"`).
// From a non-whitelisted host the header is silently ignored and the cached
// entry is served unchanged — the call still succeeds, it just does nothing.
// So this MCP's egress IP must be on v3-cached's whitelist for force_refresh
// to have any effect. `logCacheStatus` below makes a non-whitelisted
// deployment visible in the logs instead of leaving it as a silent no-op.
//
// A forced call is expensive — it bypasses the cache and recomputes — so it is
// used sparingly: once, automatically, only after a failed result, or when a
// caller explicitly asks for it.
const FORCE_REFRESH_HEADERS = { 'X-Force-Refresh': 'true' } as const;

function requestConfig(forceRefresh?: boolean) {
  return forceRefresh ? { headers: { ...FORCE_REFRESH_HEADERS } } : undefined;
}

/** Report whether a force-refreshed call actually bypassed the cache. A HIT
 *  means nginx ignored the header, which in practice means this host is not
 *  whitelisted — worth saying out loud once per occurrence rather than leaving
 *  operators to wonder why forcing a refresh changes nothing. */
function logCacheStatus(response: any, what: string): void {
  const status = response?.headers?.['x-cache-status'];
  if (!status) { return; }
  if (String(status).toUpperCase() === 'HIT') {
    console.error(`MCP Debug: force-refresh for ${what} returned X-Cache-Status: HIT — the cache did NOT recompute. This host is probably not whitelisted for X-Force-Refresh on v3-cached.`);
  } else {
    console.error(`MCP Debug: force-refresh for ${what} returned X-Cache-Status: ${status}`);
  }
}

async function fetchSingleTermInfo(id: string, opts: { forceRefresh?: boolean } = {}): Promise<{ data?: any; error?: string }> {
  const url = `https://v3-cached.virtualflybrain.org/get_term_info?id=${id}`;
  console.error(`MCP Debug: Fetching term info for id=${id}${opts.forceRefresh ? ' (force_refresh)' : ''}`);
  try {
    const response = await axios.get(url, requestConfig(opts.forceRefresh));
    if (opts.forceRefresh) { logCacheStatus(response, `get_term_info id=${id}`); }
    if (response.data === null || response.data === undefined) {
      console.error(`MCP Debug: No term info found for id=${id}`);
      return { error: `No term info found for ID "${id}". This ID may not exist, may be deprecated, or may not yet be indexed in the term info API. Try using the search_terms tool to verify the ID exists.` };
    }
    console.error(`MCP Debug: Successfully fetched term info for id=${id}`);
    return { data: response.data };
  } catch (error) {
    console.error(`MCP Debug: Error fetching term info for id=${id}:`, error);
    return { error: `Error fetching term info for "${id}": ${error}` };
  }
}

async function handleGetTermInfo(args: { id: string | string[]; force_refresh?: boolean }) {
  const { id, force_refresh } = args;
  const opts = { forceRefresh: force_refresh === true };

  // Single ID — preserve original response format
  if (typeof id === 'string') {
    const result = await fetchSingleTermInfo(id, opts);
    return {
      content: [
        {
          type: 'text',
          text: result.error || JSON.stringify(result.data, null, 2),
        },
      ],
    };
  }

  // Batch IDs — run in parallel, return keyed object
  const ids = id;
  const results = await Promise.all(ids.map(async (singleId) => {
    const result = await fetchSingleTermInfo(singleId, opts);
    return { id: singleId, ...result };
  }));

  const keyed: Record<string, any> = {};
  for (const r of results) {
    keyed[r.id] = r.error ? { error: r.error } : r.data;
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(keyed, null, 2),
      },
    ],
  };
}

/**
 * Fetch the available query_types for an ID by calling get_term_info and
 * extracting its "Queries" array. Used to enrich run_query error messages so
 * the LLM sees the valid options without an extra round trip.
 *
 * Returns null on any failure — callers should fall back to a generic message.
 */
async function fetchAvailableQueryTypes(id: string): Promise<string[] | null> {
  try {
    const result = await fetchSingleTermInfo(id);
    if (!result.data) return null;
    const queries = result.data.Queries;
    if (Array.isArray(queries)) return queries;
    return null;
  } catch {
    return null;
  }
}

function formatAvailableQueriesHint(id: string, queries: string[] | null): string {
  if (queries && queries.length > 0) {
    return `\n\nAvailable query_types for "${id}" (from get_term_info Queries array): ${JSON.stringify(queries)}\nPick one of these for run_query, or call get_term_info("${id}") for full details.`;
  }
  if (queries && queries.length === 0) {
    return `\n\nget_term_info("${id}") reports no available queries for this entity. The ID may be deprecated, the entity may not support pre-computed queries, or you may need to query a related entity (e.g. its parent class via get_hierarchy).`;
  }
  return `\n\nCould not retrieve the Queries array for "${id}". Call get_term_info("${id}") to verify the ID exists and to see its available query_types.`;
}

async function fetchSingleQuery(id: string, query_type: string, opts: { limit?: number; offset?: number; includeImages?: boolean; forceRefresh?: boolean } = {}): Promise<{ data?: any; error?: string; redirect?: string }> {
  // If the LLM accidentally passes a tool name as query_type, redirect
  if (query_type === 'get_term_info') {
    return { redirect: `Note: "get_term_info" is a separate tool, not a query_type for run_query. Use the get_term_info tool directly next time.` };
  }
  if (query_type === 'search_terms') {
    return { redirect: `Note: "search_terms" is a separate tool, not a query_type for run_query. Use the search_terms tool directly with a query parameter.` };
  }

  const limit = (opts.limit === undefined || opts.limit === null || Number.isNaN(opts.limit)) ? 25 : opts.limit;
  const offset = (opts.offset === undefined || opts.offset === null || Number.isNaN(opts.offset)) ? 0 : opts.offset;
  const includeImages = opts.includeImages === true;
  const params = new URLSearchParams({ id, query_type });
  if (limit > 0) { params.set('offset', String(offset)); params.set('limit', String(limit)); }
  const url = `https://v3-cached.virtualflybrain.org/run_query?${params.toString()}`;
  console.error(`MCP Debug: Running query id=${id} query_type=${query_type} limit=${limit} offset=${offset} includeImages=${includeImages}${opts.forceRefresh ? ' (force_refresh)' : ''}`);
  try {
    let response = await axios.get(url, requestConfig(opts.forceRefresh));
    if (opts.forceRefresh) { logCacheStatus(response, `run_query id=${id} query_type=${query_type}`); }
    // count -1 is an upstream failure, and nginx will have cached it with a
    // 200. Retry exactly once past the cache so a stale failed slot cannot be
    // served as an answer for months. Capped at one retry: if the service is
    // genuinely down, hammering it makes things worse, and the shaped result
    // says plainly that the query failed.
    if (!opts.forceRefresh && runQueryFailed(response.data)) {
      console.error(`MCP Debug: count -1 for id=${id} query_type=${query_type} — retrying once with X-Force-Refresh`);
      try {
        const retry = await axios.get(url, requestConfig(true));
        logCacheStatus(retry, `run_query id=${id} query_type=${query_type}`);
        if (retry.data !== null && retry.data !== undefined) { response = retry; }
      } catch (retryError) {
        console.error(`MCP Debug: force-refresh retry failed for id=${id} query_type=${query_type}:`, retryError);
      }
    }
    if (response.data === null || response.data === undefined) {
      console.error(`MCP Debug: No results for query id=${id} query_type=${query_type}`);
      const available = await fetchAvailableQueryTypes(id);
      return {
        error: `No results for query "${query_type}" on ID "${id}". The query_type may not be supported for this entity, or there may be no data for this combination. Empty results do NOT mean the answer is unknown — only that this call did not return it. Try a different query_type from the Queries array below before concluding the data does not exist.${formatAvailableQueriesHint(id, available)}`,
      };
    }
    if (response.data.error) {
      console.error(`MCP Debug: API error for query id=${id} query_type=${query_type}: ${response.data.error}`);
      const available = await fetchAvailableQueryTypes(id);
      return {
        error: `${response.data.error}${formatAvailableQueriesHint(id, available)}`,
      };
    }
    console.error(`MCP Debug: Successfully ran query id=${id} query_type=${query_type}`);
    return { data: shapeRunQueryResult(response.data, { includeImages, limit, offset }) };
  } catch (error) {
    console.error(`MCP Debug: Error running query id=${id} query_type=${query_type}:`, error);
    return { error: `Error running query "${query_type}" on "${id}": ${error}` };
  }
}

async function handleRunQuery(args: { id?: string | string[]; query_type?: string; queries?: Array<{ id: string; query_type: string }>; limit?: number; offset?: number; include_images?: boolean; force_refresh?: boolean }) {
  const { id, query_type, queries, limit, offset, include_images, force_refresh } = args;
  const opts = { limit, offset, includeImages: include_images, forceRefresh: force_refresh === true };

  // Build the list of {id, query_type} pairs to execute
  let queryPairs: Array<{ id: string; query_type: string }>;

  if (queries && queries.length > 0) {
    // Explicit queries array takes precedence
    queryPairs = queries;
  } else if (id && query_type) {
    // Single or array of IDs with shared query_type
    const ids = Array.isArray(id) ? id : [id];
    queryPairs = ids.map(singleId => ({ id: singleId, query_type }));
  } else {
    return {
      content: [{ type: 'text', text: 'Error: Either provide id + query_type, or a queries array of {id, query_type} pairs.' }],
    };
  }

  // Single query — preserve original response format
  if (queryPairs.length === 1) {
    const pair = queryPairs[0];
    const result = await fetchSingleQuery(pair.id, pair.query_type, opts);

    if (result.redirect) {
      // Tool name was passed as query_type — try to be helpful
      const termResult = await fetchSingleTermInfo(pair.id);
      const termText = termResult.error || JSON.stringify(termResult.data, null, 2);
      return {
        content: [{ type: 'text', text: `${result.redirect}\n\n${termText}` }],
      };
    }

    return {
      content: [{ type: 'text', text: result.error || JSON.stringify(result.data, null, 2) }],
    };
  }

  // Batch queries — run in parallel, return keyed object
  const results = await Promise.all(queryPairs.map(async (pair) => {
    const result = await fetchSingleQuery(pair.id, pair.query_type, opts);
    const key = `${pair.id}::${pair.query_type}`;
    return { key, result };
  }));

  const keyed: Record<string, any> = {};
  for (const { key, result } of results) {
    if (result.redirect) {
      keyed[key] = { error: result.redirect };
    } else if (result.error) {
      keyed[key] = { error: result.error };
    } else {
      keyed[key] = result.data;
    }
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(keyed, null, 2) }],
  };
}

// ---------------------------------------------------------------------------
// search_terms
//
// This used to build its own Solr query — its own fq, its own bq, its own qf —
// against solr.virtualflybrain.org. That construction was a copy of the
// website's, made once and then left to drift, and because it skipped the
// website's refine/sort pass its ordering was never actually the website's
// either. It now calls VFBquery's /search, which IS the website's search: same
// filters, same boosts, same comparator. One ranking, one place to fix it.
// ---------------------------------------------------------------------------

// How many candidates /search asks Solr for. 500 is the website's value, and it
// affects *ranking* rather than page size — the comparator can only promote what
// was retrieved — so it is not something to shrink for a small page.
const SEARCH_CANDIDATE_POOL = 500;

// null until the first `unique` request answers it. The deployed service
// silently ignores query params it does not know, so the only way to tell
// whether it applied `unique` is whether it echoes the flag back.
//
// null is treated as "probably yes": every currently deployed VFBquery honours
// `unique`, so paying the un-truncated fetch on the first search of every
// process to re-prove that is a 600KB tax on the common case. A server that
// turns out not to echo the flag gets one refetch, then the answer is cached
// here.
//
// The answer can flip mid-process, which is why this is re-read rather than
// frozen: VFBQUERY_BASE sits behind an nginx cache, so a URL first requested
// before `unique` shipped keeps answering with the old body (no `unique`, no
// `distinct_terms`) while a novel URL answers with the new one.
let searchUniqueIsServerSide: boolean | null = null;

function dedupeSearchRows(rows: any[]): any[] {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const row of rows) {
    const sf = row?.short_form;
    // A row with no short_form cannot be proven a duplicate, so it is kept.
    if (typeof sf !== 'string' || sf === '') { out.push(row); continue; }
    if (seen.has(sf)) { continue; }
    seen.add(sf);
    out.push(row);
  }
  return out;
}

// VFBquery's handlers explain their own rejections in the body — an unknown type
// name with suggestions, "At least one of upstream_type or downstream_type", a
// bad `relationship`. Some return JSON and some plain text, and passing the bare
// AxiosError up says only "status code 400", which tells the caller nothing about
// what to change.
function rejectionDetail(error: any): string | null {
  const data = error?.response?.data;
  if (data == null) return null;
  if (typeof data === 'string') return data.trim() || null;
  return data.error ?? data.detail ?? null;
}

async function fetchSearch(params: URLSearchParams): Promise<any> {
  const url = `${VFBQUERY_BASE}/search?${params.toString()}`;
  console.error(`MCP Debug: search ${params.toString()}`);
  const response = await axios.get(url, { timeout: 120000 });
  return response.data;
}

async function handleSearchTerms(args: {
  query: string;
  filter_types?: string[];
  exclude_types?: string[];
  boost_types?: string[];
  demote_types?: string[];
  unique?: boolean;
  start?: number;
  rows?: number;
  minimize_results?: boolean;
  auto_fetch_term_info?: boolean;
}) {
  const { query, filter_types, exclude_types, boost_types, demote_types,
          minimize_results = false, auto_fetch_term_info = false } = args;

  const start = Math.max(0, Math.trunc(Number(args.start) || 0));
  const requestedRows = Number.isFinite(Number(args.rows)) && Number(args.rows) > 0
    ? Math.min(1000, Math.trunc(Number(args.rows)))
    : 150;
  const rows = minimize_results ? Math.min(requestedRows, 10) : requestedRows;
  const wantUnique = args.unique !== false;

  const params = new URLSearchParams({ query });
  // Grow the pool only when the caller pages past it, so an ordinary request
  // gets the website's ranking rather than a differently-ranked wider net.
  const pool = Math.min(1000, Math.max(SEARCH_CANDIDATE_POOL, start + rows));
  params.set('rows', String(pool));
  if (filter_types && filter_types.length) { params.set('filter_types', filter_types.join(',')); }
  if (exclude_types && exclude_types.length) { params.set('exclude_types', exclude_types.join(',')); }
  if (boost_types && boost_types.length) { params.set('boost_types', boost_types.join(',')); }
  if (demote_types && demote_types.length) { params.set('demote_types', demote_types.join(',')); }
  if (wantUnique) { params.set('unique', 'true'); }

  // Truncating server-side keeps the payload small, but only when the server
  // collapses synonym rows itself; otherwise the rows past the limit are
  // exactly the ones that would survive de-duplication here.
  if (!wantUnique || searchUniqueIsServerSide !== false) {
    params.set('limit', String(start + rows));
  }

  let data: any;
  try {
    data = await fetchSearch(params);
    if (wantUnique) {
      const echoed = typeof data?.unique === 'boolean';
      searchUniqueIsServerSide = echoed;
      if (!echoed && params.has('limit')) {
        // Deployed VFBquery predates `unique`. Page over the whole ranked list
        // and collapse it here instead of guessing how far the duplicates run.
        params.delete('limit');
        data = await fetchSearch(params);
      }
    }
  } catch (error: any) {
    // A 400 from /search carries the reason and, for a misspelled type name,
    // the suggestions — far more useful to pass through than the status code.
    const detail = error?.response?.data?.error;
    if (detail) {
      return { content: [{ type: 'text', text: `Search rejected: ${detail}` }] };
    }
    return { content: [{ type: 'text', text: `Error searching terms: ${error}` }] };
  }

  const allRows: any[] = Array.isArray(data?.rows) ? data.rows : [];
  const serverUnique = data?.unique === true;
  const collapsed = wantUnique && !serverUnique ? dedupeSearchRows(allRows) : allRows;
  const haveWholeList = !params.has('limit');

  // `count` is the length of the list the server was paging through, so it
  // already reflects `unique` when the server applied it.
  let total: number;
  if (wantUnique && !serverUnique) {
    total = collapsed.length;
  } else {
    total = typeof data?.count === 'number' ? data.count : collapsed.length;
  }
  const distinctTerms = typeof data?.distinct_terms === 'number'
    ? data.distinct_terms
    : (haveWholeList ? dedupeSearchRows(allRows).length : undefined);
  const solrMatches = typeof data?.solr_num_found === 'number' ? data.solr_num_found : undefined;

  // The exact-match shortcut only fires on the first page: pages 2+ are a
  // caller walking the list, and collapsing that to one row loses their place.
  const queryLower = String(query || '').trim().toLowerCase();
  let exactMatch: any = null;
  if ((minimize_results || auto_fetch_term_info) && start === 0) {
    exactMatch = collapsed.find((row: any) =>
      typeof row?.original_label === 'string' && row.original_label.toLowerCase() === queryLower
    ) || null;
  }

  let page: any[] = exactMatch ? [exactMatch] : collapsed.slice(start, start + rows);
  if (minimize_results) {
    page = page.map((row: any) => ({
      short_form: row?.short_form,
      label: row?.label,
      original_label: row?.original_label,
    }));
  }

  const notes: string[] = [];
  if (exactMatch) {
    notes.push(`"${query}" is an exact label match, so only that term is shown out of ${total}. Re-run with minimize_results=false and auto_fetch_term_info=false to see the rest.`);
  } else if (total > start + page.length) {
    notes.push(`Showing results ${start}-${start + page.length} of ${total}. To see more, re-run with start=${start + rows} (same rows).`);
  } else if (start > 0) {
    notes.push(`Showing results ${start}-${start + page.length} of ${total}.`);
  }
  if (minimize_results) {
    notes.push('Only short_form, label and original_label are shown; re-run with minimize_results=false for facets and IDs.');
  }
  if (wantUnique && !serverUnique) {
    notes.push('The VFBquery response did not report server-side unique — either an older deployment, or a response cached from before it shipped — so duplicate synonym rows were collapsed by this MCP server instead. Ranking is unaffected; total counts terms.');
  }
  if (solrMatches !== undefined && solrMatches > pool) {
    notes.push(`Solr matched ${solrMatches} terms but only the top ${pool} were ranked, so this is not an exhaustive list. Narrow the query or add filter_types rather than paging past ${pool}.`);
  }
  // Under unique=false, total counts synonym rows while solr_matches counts terms, so
  // total can exceed solr_matches. Read side by side that looks like a contradiction;
  // it is just two different units, and saying so is cheaper than the reader guessing.
  if (!wantUnique && solrMatches !== undefined && total > solrMatches) {
    notes.push(`total (${total}) counts synonym rows because unique=false, while solr_matches (${solrMatches}) counts terms — ${solrMatches} terms matched under ${total} names between them. Re-run with unique=true (the default) for one row per term.`);
  }
  if (page.length === 0) {
    notes.push('No matches. Try alternative spellings, a synonym, a broader term, or fewer filter_types — an empty result does not mean the entity does not exist in VFB.');
  }

  const result: Record<string, any> = {
    query,
    unique: wantUnique,
    start,
    returned: page.length,
    total,
  };
  if (distinctTerms !== undefined) { result.distinct_terms = distinctTerms; }
  if (solrMatches !== undefined) { result.solr_matches = solrMatches; }
  result.candidate_pool = pool;
  if (notes.length) { result._note = notes.join(' '); }
  result.results = page;

  if (auto_fetch_term_info && exactMatch?.short_form) {
    try {
      const termInfoResult = await handleGetTermInfo({ id: exactMatch.short_form });
      if (termInfoResult.content && termInfoResult.content[0]?.text) {
        result.term_info = JSON.parse(termInfoResult.content[0].text);
      }
    } catch (termInfoError) {
      // A failed term-info fetch must not fail the search it was bolted onto.
      console.error('Error auto-fetching term info:', termInfoError);
    }
  }

  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

// ---------------------------------------------------------------------------
// list_search_facets
//
// The type names search_terms filters by are the index's own annotations, so
// the only honest source for them is the index. This list is what the tool
// description used to hardcode: a snapshot, already short of the live
// vocabulary by roughly half, kept solely as a fallback for services that
// predate /facets. It is not maintained.
// ---------------------------------------------------------------------------

const STATIC_FACET_SNAPSHOT: string[] = [
  'entity', 'anatomy', 'nervous_system', 'individual', 'has_image', 'adult', 'cell', 'neuron',
  'vfb', 'has_neuron_connectivity', 'nblast', 'visual_system', 'cholinergic', 'class',
  'secondary_neuron', 'expression_pattern', 'gabaergic', 'expression_pattern_fragment',
  'glutamatergic', 'feature', 'sensory_neuron', 'neuronbridge', 'deprecated', 'larva',
  'has_region_connectivity', 'nblastexp', 'gene', 'primary_neuron', 'flycircuit',
  'mechanosensory_system', 'histaminergic', 'lineage_mbp', 'peptidergic', 'hasscrnaseq',
  'chemosensory_system', 'split', 'has_subclass', 'olfactory_system', 'dopaminergic', 'fafb',
  'l1em', 'pub', 'enzyme', 'motor_neuron', 'cluster', 'lineage_6', 'lineage_3', 'serotonergic',
  'lineage_19', 'lineage_cm3', 'lineage_dm6', 'proprioceptive_system', 'gustatory_system',
  'sense_organ', 'lineage_mbp4', 'lineage_mbp1', 'lineage_1', 'lineage_mbp2', 'lineage_all1',
  'lineage_balc', 'lineage_cm4', 'lineage_dm4', 'muscle', 'lineage_13', 'lineage_8',
  'lineage_mbp3', 'lineage_12', 'lineage_dm1', 'lineage_dpmm1', 'lineage_9', 'lineage_cp2',
  'lineage_dl1', 'fanc', 'lineage_7', 'lineage_vpnd2', 'lineage_dm3', 'lineage_dpmpm2',
  'lineage_14', 'lineage_4', 'lineage_blp1', 'lineage_dalv2', 'lineage_eba1', 'lineage_dm2',
  'lineage_dpmpm1', 'auditory_system', 'lineage_16', 'lineage_blvp1', 'lineage_blav2',
  'lineage_vlpl2', 'lineage_alad1', 'lineage_bamv3', 'lineage_bld6', 'lineage_vpnd1',
  'synaptic_neuropil', 'lineage_23', 'lineage_17', 'lineage_10', 'lineage_dplpv', 'lineage_21',
  'lineage_alv1',
];

function normaliseFacetName(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

async function handleListSearchFacets(args: { contains?: string }): Promise<{ content: Array<{ type: string; text: string }> }> {
  const contains = (args?.contains || '').trim();
  const params = new URLSearchParams();
  if (contains) { params.set('contains', contains); }
  const qs = params.toString();
  const url = `${VFBQUERY_BASE}/facets${qs ? `?${qs}` : ''}`;
  console.error(`MCP Debug: list_search_facets contains=${contains || '(none)'}`);
  try {
    const response = await axios.get(url, { timeout: 60000 });
    return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
  } catch (error: any) {
    const status = error?.response?.status;
    if (status === 404 || status === 503) {
      const needle = normaliseFacetName(contains);
      const names = needle
        ? STATIC_FACET_SNAPSHOT.filter((n) => normaliseFacetName(n).includes(needle))
        : STATIC_FACET_SNAPSHOT;
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            source: 'static snapshot bundled with this MCP server',
            _note: status === 404
              ? 'The deployed VFBquery does not serve /facets yet, so this is a stale snapshot of about 100 names rather than the live vocabulary of over 200, and it has no term counts. Names outside it may still be valid: search_terms will tell you if one is not.'
              : 'The live type-name vocabulary is temporarily unavailable, so this is a stale bundled snapshot. Search itself still works.',
            count: names.length,
            total: STATIC_FACET_SNAPSHOT.length,
            contains: contains || null,
            facets: names.map((name) => ({ name })),
          }, null, 2),
        }],
      };
    }
    return { content: [{ type: 'text', text: `Error listing search facets: ${error}` }] };
  }
}

// ---------------------------------------------------------------------------
// FlyBase & Connectivity handlers — call VFBquery REST endpoints directly
// ---------------------------------------------------------------------------

const VFBQUERY_BASE = 'https://v3-cached.virtualflybrain.org';
const RESOLVED_ID_PATTERN = /^(?:FB(?:gn|al|ti|co|st|tp|bt|rf)_?\d+|VFB[\w:-]+)$/i;
const FBCO_ID_PATTERN = /^FBco_?\d+$/i;

function looksLikeResolvedId(value: string): boolean {
  return RESOLVED_ID_PATTERN.test(value.trim());
}

function looksLikeFbcoId(value: string): boolean {
  return FBCO_ID_PATTERN.test(value.trim());
}

async function handleResolveEntity(args: { name: string }): Promise<{ content: Array<{ type: string; text: string }> }> {
  const rawName = args.name.trim();

  if (!rawName) {
    return {
      content: [{
        type: 'text',
        text: 'Error: resolve_entity expects an unresolved FlyBase-related query string, but the provided name was empty.',
      }],
    };
  }

  if (looksLikeResolvedId(rawName)) {
    return {
      content: [{
        type: 'text',
        text: `Error: resolve_entity expects unresolved user text such as "P{VT054895-GAL4.DBD}" or "Hb9-GAL4", not a resolved ID like "${rawName}". If you already have a FlyBase feature ID, call run_query with query_type "FindStocks" (id = the FlyBase feature ID). If you already have a VFB ID, use search_terms, get_term_info, or run_query as appropriate.`,
      }],
    };
  }

  const url = `${VFBQUERY_BASE}/resolve_entity?query=${encodeURIComponent(rawName)}`;
  console.error(`MCP Debug: resolve_entity name="${rawName}"`);
  try {
    const response = await axios.get(url);
    return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
  } catch (error) {
    return { content: [{ type: 'text', text: `Error resolving entity "${rawName}": ${error}` }] };
  }
}


async function handleResolveCombination(args: { name: string }): Promise<{ content: Array<{ type: string; text: string }> }> {
  const rawName = args.name.trim();

  if (!rawName) {
    return {
      content: [{
        type: 'text',
        text: 'Error: resolve_combination expects an unresolved split-GAL4 combination name or synonym, but the provided name was empty.',
      }],
    };
  }

  if (looksLikeFbcoId(rawName)) {
    return {
      content: [{
        type: 'text',
        text: `Error: resolve_combination expects unresolved user text such as "MB002B" or "SS04495", not an FBco ID like "${rawName}". If you already have an FBco ID, call run_query with query_type "FindComboPublications" (id = the FBco ID).`,
      }],
    };
  }

  const url = `${VFBQUERY_BASE}/resolve_combination?query=${encodeURIComponent(rawName)}`;
  console.error(`MCP Debug: resolve_combination name="${rawName}"`);
  try {
    const response = await axios.get(url);
    return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
  } catch (error) {
    return { content: [{ type: 'text', text: `Error resolving combination "${rawName}": ${error}` }] };
  }
}


async function handleListConnectomeDatasets(): Promise<{ content: Array<{ type: string; text: string }> }> {
  const url = `${VFBQUERY_BASE}/list_connectome_datasets`;
  console.error('MCP Debug: list_connectome_datasets');
  try {
    const response = await axios.get(url);
    return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
  } catch (error) {
    return { content: [{ type: 'text', text: `Error listing connectome datasets: ${error}` }] };
  }
}

// /query_connectivity has no paging of its own and returns every row it finds:
// a single class at weight=5 is over 50,000 connections, which is not something
// to hand an LLM whole. These shape it into a strongest-first page plus a
// summary computed over the full set, so the numbers stay true even though the
// rows are truncated.

const CONNECTIVITY_WEIGHT_KEYS = ['weight', 'total_weight', 'pairwise_connections'];
const CONNECTIVITY_DEFAULT_LIMIT = 50;
const CONNECTIVITY_TOP_PAIRS = 10;

function connectivityWeightKey(rows: any[]): string | null {
  for (const key of CONNECTIVITY_WEIGHT_KEYS) {
    if (rows.some((row) => row && typeof row[key] === 'number')) { return key; }
  }
  return null;
}

// Class labels come out of Neo4j as apoc.text.join(collect(distinct c.label),'|'),
// and the order inside that join is not deterministic — the same logical pair of
// classes comes back as "A|B" on one row and "B|A" on the next. Left alone that
// splits one class pair across several summary entries and inflates
// distinct_class_pairs. Sorting the parts gives one stable spelling per set.
function canonicaliseClassLabel(value: any): any {
  if (typeof value !== 'string' || !value.includes('|')) { return value; }
  return value
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .sort()
    .join('|');
}

function summariseConnectivity(rows: any[], weightKey: string | null): Record<string, any> {
  const summary: Record<string, any> = { connections: rows.length };

  if (weightKey) {
    let total = 0;
    let min = Infinity;
    let max = -Infinity;
    let counted = 0;
    for (const row of rows) {
      const w = row?.[weightKey];
      if (typeof w !== 'number') { continue; }
      total += w;
      if (w < min) { min = w; }
      if (w > max) { max = w; }
      counted++;
    }
    if (counted > 0) {
      summary[weightKey] = { min, max, total, mean: Math.round((total / counted) * 10) / 10 };
    }
  }

  const datasets: Record<string, number> = {};
  for (const row of rows) {
    const ds = row?.up_data_source || row?.down_data_source;
    if (typeof ds === 'string' && ds) { datasets[ds] = (datasets[ds] || 0) + 1; }
  }
  if (Object.keys(datasets).length) { summary.by_dataset = datasets; }

  const pairs = new Map<string, { upstream_class: any; downstream_class: any; connections: number; weight: number }>();
  for (const row of rows) {
    if (!row || (row.upstream_class === undefined && row.downstream_class === undefined)) { continue; }
    const up = canonicaliseClassLabel(row.upstream_class);
    const down = canonicaliseClassLabel(row.downstream_class);
    const key = JSON.stringify([up, down]);
    let entry = pairs.get(key);
    if (!entry) {
      entry = { upstream_class: up, downstream_class: down, connections: 0, weight: 0 };
      pairs.set(key, entry);
    }
    entry.connections++;
    const w = weightKey ? row[weightKey] : undefined;
    if (typeof w === 'number') { entry.weight += w; }
  }
  if (pairs.size) {
    summary.distinct_class_pairs = pairs.size;
    summary.top_class_pairs = [...pairs.values()]
      .sort((a, b) => (b.weight - a.weight) || (b.connections - a.connections))
      .slice(0, CONNECTIVITY_TOP_PAIRS);
  }

  const upstream = new Set<any>();
  const downstream = new Set<any>();
  for (const row of rows) {
    if (row?.upstream_neuron_id) { upstream.add(row.upstream_neuron_id); }
    if (row?.downstream_neuron_id) { downstream.add(row.downstream_neuron_id); }
  }
  if (upstream.size) { summary.distinct_upstream_neurons = upstream.size; }
  if (downstream.size) { summary.distinct_downstream_neurons = downstream.size; }

  return summary;
}

function shapeConnectivityResult(data: any, ctx: { limit: number; offset: number }): any {
  if (!data || !Array.isArray(data.connections)) { return data; }
  const all: any[] = data.connections;
  const total = typeof data.count === 'number' ? data.count : all.length;
  const weightKey = connectivityWeightKey(all);

  // Per-neuron rows arrive in Cypher's order, which is not ranked, so a
  // truncated page of them would be arbitrary. Sorting by weight makes the
  // first page the interesting end; class-aggregated rows are already ordered
  // this way, so for those it changes nothing. Index carried as a tiebreak to
  // keep the sort stable.
  const ranked = weightKey
    ? all
        .map((row, i): [any, number] => [row, i])
        .sort((a, b) => {
          const wa = typeof a[0]?.[weightKey] === 'number' ? a[0][weightKey] : -Infinity;
          const wb = typeof b[0]?.[weightKey] === 'number' ? b[0][weightKey] : -Infinity;
          return (wb - wa) || (a[1] - b[1]);
        })
        .map(([row]) => row)
    : all;

  const page = ctx.limit > 0 ? ranked.slice(ctx.offset, ctx.offset + ctx.limit) : ranked.slice(ctx.offset);

  const notes: string[] = [];
  if (total > ctx.offset + page.length) {
    const nextOffset = ctx.offset + (ctx.limit > 0 ? ctx.limit : page.length);
    notes.push(`Showing connections ${ctx.offset}-${ctx.offset + page.length} of ${total}, ranked by ${weightKey || "the endpoint's own order"} (strongest first). The summary covers ALL ${total} connections, not just this page, so answer from it rather than from the rows shown. To see further rows, re-run with offset=${nextOffset} (same limit).`);
  } else if (ctx.offset > 0) {
    notes.push(`Showing connections ${ctx.offset}-${ctx.offset + page.length} of ${total}.`);
  }

  const shaped: Record<string, any> = {
    count: total,
    offset: ctx.offset,
    limit: ctx.limit,
    returned: page.length,
    ranked_by: weightKey,
    summary: summariseConnectivity(all, weightKey),
  };
  if (notes.length) { shaped._note = notes.join(' '); }
  if (Array.isArray(data.warnings) && data.warnings.length) { shaped.warnings = data.warnings; }
  if (data.resolved !== undefined) { shaped.resolved = data.resolved; }
  shaped.connections = page;
  return shaped;
}

async function handleQueryConnectivity(args: {
  upstream_type?: string;
  downstream_type?: string;
  weight?: number;
  group_by_class?: boolean;
  exclude_dbs?: string[];
  limit?: number;
  offset?: number;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
  const params = new URLSearchParams();
  if (args.upstream_type) params.set('upstream_type', args.upstream_type);
  if (args.downstream_type) params.set('downstream_type', args.downstream_type);
  if (args.weight !== undefined) params.set('weight', String(args.weight));
  if (args.group_by_class !== undefined) params.set('group_by_class', String(args.group_by_class));
  if (args.exclude_dbs) params.set('exclude_dbs', args.exclude_dbs.join(','));
  // limit/offset are applied here, not sent: the endpoint has no paging.
  const limit = Number.isFinite(Number(args.limit)) && Number(args.limit) >= 0
    ? Math.trunc(Number(args.limit))
    : CONNECTIVITY_DEFAULT_LIMIT;
  const offset = Number.isFinite(Number(args.offset)) && Number(args.offset) > 0
    ? Math.trunc(Number(args.offset))
    : 0;
  const url = `${VFBQUERY_BASE}/query_connectivity?${params.toString()}`;
  console.error(`MCP Debug: query_connectivity params=${params.toString()} limit=${limit} offset=${offset}`);
  try {
    const response = await axios.get(url, { timeout: 300000 }); // 5 min — live cross-dataset query
    return { content: [{ type: 'text', text: JSON.stringify(shapeConnectivityResult(response.data, { limit, offset }), null, 2) }] };
  } catch (error) {
    const detail = rejectionDetail(error);
    if (detail) {
      return { content: [{ type: 'text', text: `Connectivity query rejected: ${detail}` }] };
    }
    return { content: [{ type: 'text', text: `Error querying connectivity: ${error}` }] };
  }
}

async function handleGetHierarchy(args: {
  id: string;
  relationship: string;
  direction?: string;
  max_depth?: number;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
  const params = new URLSearchParams();
  params.set('id', args.id);
  // Omit rather than send "undefined": the schema requires `relationship`, but a
  // caller that drops it should get the endpoint's own default (part_of) instead
  // of a 400 on a literal string.
  if (args.relationship) params.set('relationship', args.relationship);
  if (args.direction) params.set('direction', args.direction);
  if (args.max_depth !== undefined) params.set('max_depth', String(args.max_depth));
  const url = `${VFBQUERY_BASE}/get_hierarchy?${params.toString()}`;
  console.error(`MCP Debug: get_hierarchy params=${params.toString()}`);
  try {
    const response = await axios.get(url, { timeout: 120000 }); // 2 min
    return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
  } catch (error) {
    const detail = rejectionDetail(error);
    if (detail) {
      return { content: [{ type: 'text', text: `Hierarchy request rejected: ${detail}` }] };
    }
    return { content: [{ type: 'text', text: `Error getting hierarchy: ${error}` }] };
  }
}

// /xref and /combine are shaped in combineShape.ts; see that file for why an
// empty result from each direction of /xref means something different, and why
// /combine's upstream defaults (every row, thumbnails included) are wrong for a
// model.

const COMBINE_DEFAULT_LIMIT = 25;
// Upstream refuses more than 12 operands, deliberately: each one is a separate
// query against Neo4j or Solr and a single request that fans out to fifty is a
// denial of service against everyone else. Checking here turns a 400 into a
// message the model can act on.
const COMBINE_MAX_OPERANDS = 12;
// Reserved upstream, so an operand may not be named after one. `offset`,
// `order_by` and `force_refresh` are reserved but NOT implemented — this tool
// does not expose them at all rather than accept a parameter that is silently
// ignored.
const COMBINE_RESERVED_NAMES = new Set([
  'expr', 'expression', 'q', 'universe', 'limit', 'offset',
  'require_complete', 'explain_only', 'order_by', 'force_refresh',
]);

async function handleLookupXref(args: { id?: string; accession?: string; db?: string }):
  Promise<{ content: Array<{ type: string; text: string }> }> {
  const id = (args.id ?? '').trim();
  const accession = (args.accession ?? '').trim();
  // Caught here rather than upstream so the message names the tool's own
  // parameters and says which way round each direction runs.
  if (!!id === !!accession) {
    return { content: [{ type: 'text', text:
      'Provide exactly one of id or accession. Use id to list the external accessions a VFB term carries ' +
      '(e.g. id=VFB_jrchjtdb); use accession to find the VFB term that carries an external accession ' +
      '(e.g. accession=1734350908).' }] };
  }

  const params = new URLSearchParams();
  if (id) { params.set('id', id); } else { params.set('accession', accession); }
  if (args.db) { params.set('db', args.db); }
  const url = `${VFBQUERY_BASE}/xref?${params.toString()}`;
  console.error(`MCP Debug: xref params=${params.toString()}`);
  try {
    const response = await axios.get(url, { timeout: 120000 });
    const shaped = shapeXrefResult(response.data);
    return { content: [{ type: 'text', text: JSON.stringify(shaped, null, 2) }] };
  } catch (error) {
    const detail = rejectionDetail(error);
    if (detail) {
      return { content: [{ type: 'text', text: `Cross-reference lookup rejected: ${detail}` }] };
    }
    return { content: [{ type: 'text', text: `Error looking up cross-reference: ${error}` }] };
  }
}

async function handleCombineQueries(args: {
  expr: string;
  operands: Record<string, string>;
  universe?: string;
  limit?: number;
  include_images?: boolean;
  explain_only?: boolean;
  require_complete?: boolean;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
  const expr = (args.expr ?? '').trim();
  if (!expr) {
    return { content: [{ type: 'text', text:
      'combine_queries needs an expression, e.g. expr="calyx AND lh" with operands ' +
      '{"calyx": "NeuronsPartHere:FBbt_00007401", "lh": "NeuronsPartHere:FBbt_00007053"}.' }] };
  }

  const operands = (args.operands && typeof args.operands === 'object' && !Array.isArray(args.operands))
    ? args.operands : {};
  const names = Object.keys(operands);
  if (names.length === 0) {
    return { content: [{ type: 'text', text:
      'combine_queries needs at least one named operand. Each value is "<QueryType>:<id>", "search:<text>" ' +
      'or "ids:<id>,<id>" — e.g. {"calyx": "NeuronsPartHere:FBbt_00007401"}.' }] };
  }
  if (names.length > COMBINE_MAX_OPERANDS) {
    return { content: [{ type: 'text', text:
      `combine_queries accepts at most ${COMBINE_MAX_OPERANDS} operands (given ${names.length}). Each operand ` +
      'is a separate query against VFB, so the cap is a load limit rather than an expression limit. Combine ' +
      'in stages: run one combination, then feed its ids back in as "ids:<id>,<id>".' }] };
  }
  // An operand named `limit` would arrive upstream as the page size, not as a
  // set. Upstream skips reserved names silently, which turns the whole operand
  // into nothing and leaves the expression referring to a set that does not
  // exist — so refuse it here, where the name can be pointed at.
  const clashes = names.filter((n) => COMBINE_RESERVED_NAMES.has(n.toLowerCase()));
  if (clashes.length) {
    return { content: [{ type: 'text', text:
      `These operand names are reserved and would be discarded: ${clashes.join(', ')}. Rename them (e.g. ` +
      'set_a, calyx, lh) and use the same names in expr.' }] };
  }

  const includeImages = args.include_images === true;
  const explainOnly = args.explain_only === true;
  const rawLimit = Number(args.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit >= 0
    ? Math.trunc(rawLimit) : COMBINE_DEFAULT_LIMIT;

  const params = new URLSearchParams();
  params.set('expr', expr);
  for (const [name, spec] of Object.entries(operands)) { params.set(name, String(spec)); }
  if (args.universe) { params.set('universe', args.universe); }
  if (explainOnly) { params.set('explain_only', 'true'); }
  if (args.require_complete === true) { params.set('require_complete', 'true'); }
  // Sent even when it equals the default: upstream's own default is 0 (every
  // row), so leaving it off is not the same as asking for 25.
  if (!explainOnly) { params.set('limit', String(limit)); }

  const url = `${VFBQUERY_BASE}/combine?${params.toString()}`;
  console.error(`MCP Debug: combine expr=${expr} operands=${names.join(',')} limit=${limit} explain_only=${explainOnly}`);
  try {
    // Each operand is a full query, so a 12-operand expression is 12 queries
    // deep — the same 5-minute ceiling query_connectivity gets.
    const response = await axios.get(url, { timeout: 300000 });
    const shaped = shapeCombineResult(response.data, { includeImages, limit });
    return { content: [{ type: 'text', text: JSON.stringify(shaped, null, 2) }] };
  } catch (error) {
    // combine's 400s name the operand and say what shape was expected, which is
    // exactly what the model needs to fix its own call.
    const detail = rejectionDetail(error);
    if (detail) {
      return { content: [{ type: 'text', text: `Combine request rejected: ${detail}` }] };
    }
    return { content: [{ type: 'text', text: `Error combining queries: ${error}` }] };
  }
}

function createServer(sessionIdHolder?: RequestContext): Server {
  const server = new Server(
    {
      name: 'vfb3-mcp-server',
      version: VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );
  setupToolHandlers(server, sessionIdHolder);
  return server;
}

function getHtmlPage(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>VFB3-MCP Server</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; max-width: 800px; line-height: 1.6; }
    h1 { color: #333; }
    h2 { color: #555; margin-top: 30px; }
    h3 { color: #666; margin-top: 20px; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; }
    pre { background: #f4f4f4; padding: 15px; border-radius: 5px; overflow-x: auto; }
    ul { margin: 10px 0; }
    li { margin: 5px 0; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .endpoint { background: #e8f4fd; padding: 10px; border-left: 4px solid #0066cc; margin: 20px 0; }
    .step { margin: 10px 0; }
    .config-json { margin: 15px 0; }
  </style>
</head>
<body>
  <h1>Virtual Fly Brain MCP Server v${VERSION}</h1>
  <p>A Model Context Protocol (MCP) server for interacting with VirtualFlyBrain (VFB) APIs. This server provides tools to query VFB data, run queries, and search for terms.</p>

  <div class="endpoint">
    <strong>MCP Endpoint:</strong> <code>https://vfb3-mcp.virtualflybrain.org</code>
  </div>

  <h2>🚀 Quick Start</h2>

  <h3>Claude Desktop Setup</h3>
  <ol>
    <li class="step"><strong>Open Claude Desktop</strong> and go to Settings</li>
    <li class="step"><strong>Navigate to the MCP section</strong></li>
    <li class="step"><strong>Add a new MCP server</strong> with these settings:
      <ul>
        <li><strong>Server Name</strong>: <code>virtual-fly-brain</code> (or any name you prefer)</li>
        <li><strong>Type</strong>: HTTP</li>
        <li><strong>Server URL</strong>: <code>https://vfb3-mcp.virtualflybrain.org</code></li>
      </ul>
    </li>
  </ol>

  <p><strong>Configuration JSON</strong> (alternative method):</p>
  <div class="config-json">
    <pre><code>{
  "mcpServers": {
    "virtual-fly-brain": {
      "type": "http",
      "url": "https://vfb3-mcp.virtualflybrain.org",
      "tools": ["*"]
    }
  }
}</code></pre>
  </div>

  <h3>Claude Code Setup</h3>
  <ol>
    <li class="step"><strong>Locate your Claude configuration file</strong>:
      <ul>
        <li><strong>macOS/Linux</strong>: <code>~/.claude.json</code></li>
        <li><strong>Windows</strong>: <code>%USERPROFILE%\\.claude.json</code></li>
      </ul>
    </li>
    <li class="step"><strong>Add the VFB3-MCP server</strong> to your configuration:</li>
  </ol>
  <div class="config-json">
    <pre><code>{
  "mcpServers": {
    "virtual-fly-brain": {
      "type": "http",
      "url": "https://vfb3-mcp.virtualflybrain.org",
      "tools": ["*"]
    }
  }
}</code></pre>
  </div>
  <ol start="3">
    <li class="step"><strong>Restart Claude Code</strong> for changes to take effect</li>
  </ol>

  <h3>GitHub Copilot Setup</h3>
  <ol>
    <li class="step"><strong>Open VS Code</strong> with GitHub Copilot installed</li>
    <li class="step"><strong>Open Settings</strong> (<code>Ctrl/Cmd + ,</code>)</li>
    <li class="step"><strong>Search for "MCP"</strong> in the settings search</li>
    <li class="step"><strong>Find the MCP Servers setting</strong></li>
    <li class="step"><strong>Add the server URL</strong>: <code>https://vfb3-mcp.virtualflybrain.org</code></li>
    <li class="step"><strong>Give it a name</strong> like "Virtual Fly Brain"</li>
  </ol>

  <h3>Visual Studio Code (with MCP Extension)</h3>
  <ol>
    <li class="step"><strong>Install the MCP extension</strong> for VS Code from the marketplace</li>
    <li class="step"><strong>Open the Command Palette</strong> (<code>Ctrl/Cmd + Shift + P</code>)</li>
    <li class="step"><strong>Type "MCP: Add server"</strong> and select it</li>
    <li class="step"><strong>Choose "HTTP"</strong> as the server type</li>
    <li class="step"><strong>Enter the server details</strong>:
      <ul>
        <li><strong>Name</strong>: <code>virtual-fly-brain</code></li>
        <li><strong>URL</strong>: <code>https://vfb3-mcp.virtualflybrain.org</code></li>
      </ul>
    </li>
    <li class="step"><strong>Save and restart</strong> VS Code if prompted</li>
  </ol>

  <h3>Other MCP Clients</h3>
  <p>For any MCP-compatible client that supports HTTP servers:</p>
  <div class="config-json">
    <pre><code>{
  "mcpServers": {
    "virtual-fly-brain": {
      "type": "http",
      "url": "https://vfb3-mcp.virtualflybrain.org",
      "tools": ["*"]
    }
  }
}</code></pre>
  </div>

  <h3>Gemini Setup</h3>
  <p>To use the Virtual Fly Brain (VFB) Model Context Protocol (MCP) server with Google Gemini, you can connect through custom Python/Node.js clients that support MCP.</p>
  <p><strong>Note</strong>: Direct Gemini web interface integration with MCP is not currently supported. Developer tools are needed to connect the two.</p>
  
  <h4>Using Python</h4>
  <p>For application development, use the <code>mcp</code> and <code>google-genai</code> libraries to connect.</p>
  <ol>
    <li class="step"><strong>Setup</strong>: <code>pip install google-genai mcp</code></li>
    <li class="step"><strong>Implementation</strong>: Use an <code>SSEClientTransport</code> to connect to the VFB URL, list its tools, and pass their schemas to the Gemini model as Function Declarations.</li>
  </ol>

  <h2>🧪 Testing the Connection</h2>
  <p>Once configured, you can test that VFB3-MCP is working by asking your AI assistant questions like:</p>
  
  <h3>Basic Queries:</h3>
  <ul>
    <li>"Get information about the neuron VFB_jrcv0i43"</li>
    <li>"Search for terms related to medulla in the fly brain"</li>
    <li>"What neurons are in the antennal lobe?"</li>
  </ul>
  
  <h3>Advanced Queries:</h3>
  <ul>
    <li>"Find all neurons that connect to the mushroom body"</li>
    <li>"Show me expression patterns for gene repo"</li>
    <li>"What brain regions are involved in olfactory processing?"</li>
    <li>"Run a connectivity analysis for neuron VFB_00101567"</li>
  </ul>
  
  <h3>Search Examples:</h3>
  <ul>
    <li>"Search for adult neurons in the visual system"</li>
    <li>"Find genes expressed in the central complex"</li>
    <li>"Show me all templates available in VFB"</li>
  </ul>
  
  <p>If you see responses with VirtualFlyBrain data, including neuron names, brain regions, gene expressions, or connectivity information, the setup is successful!</p>
  
  <h3>Example Workflow</h3>
  <ol>
    <li><strong>Search for a term</strong>: "Search for neurons in the optic lobe"</li>
    <li><strong>Get detailed info</strong>: "Get information about VFB_00101567"</li>
    <li><strong>Run specific queries</strong>: "Show connectivity for VFB_00101567"</li>
    <li><strong>Explore relationships</strong>: "What neurons synapse in the mushroom body?"</li>
  </ol>

  <h2>🛠️ Available Tools</h2>
  <ul>
    <li><code>get_term_info</code> - Get term information from VirtualFlyBrain using a VFB ID</li>
    <li><code>run_query</code> - Run a query on VirtualFlyBrain using a VFB ID and query type</li>
    <li><code>search_terms</code> - Search VFB terms with the website's own ranking, plus type filters, boosts and demotions</li>
    <li><code>list_search_facets</code> - List the type names <code>search_terms</code> can filter, exclude, boost or demote by, with term counts</li>
    <li><code>resolve_entity</code> - Resolve an unresolved query string (e.g., P{VT054895-GAL4.DBD} or a driver line / cell type label) to VFB/FlyBase IDs and metadata</li>
    <li><code>resolve_combination</code> - Resolve an unresolved split-GAL4 combination name or synonym to its underlying IDs</li>
    <li><code>list_connectome_datasets</code> - List available connectome datasets (e.g., Hemibrain, FAFB)</li>
    <li><code>query_connectivity</code> - Query connectivity across connectome datasets using upstream/downstream filters, paged with summary statistics</li>
    <li><code>get_hierarchy</code> - Build a <code>part_of</code> or <code>subclass_of</code> hierarchy tree for a VFB term</li>
    <li><code>lookup_xref</code> - Map a VFB ID to its external database accessions, or a confirmed external accession (e.g. a hemibrain bodyId) back to the VFB term that carries it</li>
    <li><code>combine_queries</code> - Boolean set algebra (AND, OR, NOT, XOR&hellip;) over the results of two or more queries, with a step trace and a plain-English reading of the expression</li>
  </ul>

  <h2>🧠 About VirtualFlyBrain</h2>
  <p>VirtualFlyBrain (VFB) is a comprehensive knowledge base about <em>Drosophila melanogaster</em> neurobiology, integrating neuroanatomical 3D images and models, gene expression data, neural connectivity, and standardized terminology.</p>

  <h2>📖 Documentation</h2>
  <ul>
    <li><a href="https://github.com/VirtualFlyBrain/VFB3-MCP#readme">Full Documentation on GitHub</a></li>
    <li><a href="https://virtualflybrain.org">Virtual Fly Brain Website</a></li>
  </ul>

  <p>This server is designed for MCP clients like Claude Desktop, Claude Code, and GitHub Copilot.</p>
</body>
</html>`;
}

async function runHttpMode() {
  const port = process.env.PORT || '3000';
  console.error(`MCP Debug: Starting VFB3-MCP server v${VERSION} in STATELESS HTTP mode on port ${port}`);
  console.error(`MCP Debug: GA4 analytics ${GA_ENABLED ? 'enabled' : 'disabled (set GA_MEASUREMENT_ID and GA_API_SECRET to enable)'}`);
  console.error('MCP Debug: Stateless mode — no session tracking, safe for multi-replica deployment');

  const app = express();
  app.use(cors());
  app.use(express.json());

  // MCP Registry HTTP authentication endpoint
  app.get('/.well-known/mcp-registry-auth', (_req: any, res: any) => {
    const authProof = process.env.MCP_REGISTRY_AUTH;
    if (authProof) {
      res.type('text/plain').send(authProof);
    } else {
      res.status(404).send('Not configured');
    }
  });

  // Handle GET requests: browser HTML page (SSE not supported in stateless mode)
  app.get('/', async (req: any, res: any) => {
    // Serve HTML page for browser requests
    if (req.headers.accept && req.headers.accept.includes('text/html')) {
      res.send(getHtmlPage());
      return;
    }

    // SSE streams are not supported in stateless mode
    res.writeHead(405).end(JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed. SSE streams are not supported in stateless mode.' },
      id: null,
    }));
  });

  // Trust X-Forwarded-For from HA proxy
  app.set('trust proxy', true);

  // Handle POST requests: stateless — fresh server + transport per request
  app.post('/', async (req: any, res: any) => {
    try {
      // Extract client IP: X-Forwarded-For (first entry) > X-Real-IP > req.ip
      const xForwardedFor = req.headers['x-forwarded-for'];
      const clientIp = (typeof xForwardedFor === 'string' ? xForwardedFor.split(',')[0].trim() : undefined)
        || req.headers['x-real-ip']
        || req.ip
        || 'unknown';

      // Log the incoming MCP request on a single line for clean log ingestion
      const requestBody = req.body && typeof req.body === 'object' ? req.body : {};
      const requestJson = JSON.stringify(requestBody);
      const requestLine = requestJson.replace(/\s+/g, ' ').trim();
      console.error(`MCP Debug: HTTP request: POST / client_ip=${clientIp} - body: ${requestLine}`);

      // Create a fresh server and transport for every request.
      // sessionIdGenerator: undefined = stateless mode — no session ID is
      // generated, returned, or validated. Any replica can handle any request.
      const server = createServer({ clientIp });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      transport.onerror = (error) => {
        console.error('MCP transport error:', error);
      };

      // Clean up when the HTTP connection closes
      res.on('close', () => {
        transport.close();
        server.close();
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('MCP Debug: Error handling POST request:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  // DELETE not supported in stateless mode (no sessions to terminate)
  app.delete('/', async (_req: any, res: any) => {
    res.writeHead(405).end(JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed. Session termination is not supported in stateless mode.' },
      id: null,
    }));
  });

  app.listen(parseInt(port), () => {
    console.error(`MCP Debug: VFB MCP Server running on HTTP port ${port}`);
  });
}

async function runStdioMode() {
  console.error('MCP Debug: Starting server in stdio mode');
  console.error(`MCP Debug: GA4 analytics ${GA_ENABLED ? 'enabled' : 'disabled (set GA_MEASUREMENT_ID and GA_API_SECRET to enable)'}`);
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP Debug: VFB MCP Server running on stdio');
}

const mode = process.env.MCP_MODE || 'stdio';
if (mode === 'http') {
  runHttpMode().catch(console.error);
} else {
  runStdioMode().catch(console.error);
}
