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
            },
            required: ['id'],
          },
        },
        {
          name: 'run_query',
          description: 'Run a pre-computed query on a VFB entity. REQUIRED WORKFLOW: (1) call get_term_info on the ID first; (2) read the response\'s "Queries" array; (3) pass one of those values as query_type. Calling run_query with a guessed query_type will return an error. If a query returns empty rows or an error, the entity does not support that query_type or has no data for it — try a different query_type from the Queries array, or try a related entity (e.g. its parent class via get_hierarchy). Empty results do NOT mean the answer is unknown — only that this call did not return it. NEVER fabricate results from training data when a query is empty; tell the user clearly what was tried. NEVER pass tool names like "get_term_info" or "search_terms" as query_type — those are separate tools. Common query_types by entity kind: PaintedDomains, AllAlignedImages, AlignedDatasets, AllDatasets (templates); SimilarMorphologyTo, NeuronInputsTo, NeuronNeuronConnectivityQuery, NeuronRegionConnectivityQuery (individual neurons); ListAllAvailableImages, SubclassesOf, PartsOf, NeuronsPartHere, NeuronsSynaptic, ExpressionOverlapsHere, DownstreamClassConnectivity, UpstreamClassConnectivity (classes). Supports batch — pass an array of IDs (same query_type) or a "queries" array of {id, query_type} pairs; batch results are keyed by "ID::query_type". Results are PAGED: the first 25 rows by default (change with limit/offset) plus the true total as "count". Image/thumbnail columns are excluded by default to save space - pass include_images=true to include them. FlyBase integration is via query_types too: FindStocks (fly stocks for a FlyBase feature ID - FBgn/FBal/FBti/FBtp/FBco/FBst) and FindComboPublications (publications for an FBco split-GAL4 combination). Get those IDs from resolve_entity / resolve_combination first, then run_query with the ID and the query_type. Include FlyBase links in output: https://flybase.org/reports/{ID}.',
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
            },
          },
        },
        {
          name: 'search_terms',
          description: 'Search VFB terms (Solr). USE filter_types BY DEFAULT — unfiltered searches return deprecated terms, scRNAseq artifacts, and developmental stages mixed in with the entity the user wants.\n\nCommon filter_types recipes:\n- Neuron classes: ["neuron", "class"]\n- Individual neurons with images: ["neuron", "has_image"]\n- Neurons with connectome data: ["neuron", "has_neuron_connectivity"]\n- Brain regions / neuropils: ["anatomy"]\n- Genes: ["gene"]\n- Driver lines / expression patterns: ["expression_pattern"]\n- Datasets: ["dataset"]\nAdd exclude_types: ["deprecated"] to almost any search to remove obsolete entities.\n\nStage filtering: VFB covers adult, larval, and embryonic data, and many anatomical FBbt classes are stage-agnostic. Do NOT add "adult" or "larva" to filter_types by default — only add them when the user is explicit about a stage (e.g. "adult Kenyon cells", "larval mushroom body"). Default searches should leave stage out so stage-agnostic classes and all life stages are visible.\n\nUseful flags:\n- minimize_results=true → top 10 + truncation metadata, for exploratory searches.\n- auto_fetch_term_info=true → if an exact label match is found, returns get_term_info in the same response.\n- boost_types=["has_image", "has_neuron_connectivity"] → soft-rank data-rich entities first without excluding others.\n\nIf the search returns no good matches, do NOT fall back to training-data answers — try alternative spellings, synonyms, broader terms, or different filter_types.\n\nMultiple filter_types are ANDed (results must match ALL). Multiple exclude_types are ORed (any match excludes). boost_types soft-rank without excluding.\n\nAvailable filter types: entity, anatomy, nervous_system, individual, has_image, adult, cell, neuron, vfb, has_neuron_connectivity, nblast, visual_system, cholinergic, class, secondary_neuron, expression_pattern, gabaergic, expression_pattern_fragment, glutamatergic, feature, sensory_neuron, neuronbridge, deprecated, larva, has_region_connectivity, nblastexp, gene, primary_neuron, flycircuit, mechanosensory_system, histaminergic, lineage_mbp, peptidergic, hasscrnaseq, chemosensory_system, split, has_subclass, olfactory_system, dopaminergic, fafb, l1em, pub, enzyme, motor_neuron, cluster, lineage_6, lineage_3, serotonergic, lineage_19, lineage_cm3, lineage_dm6, proprioceptive_system, gustatory_system, sense_organ, lineage_mbp4, lineage_mbp1, lineage_1, lineage_mbp2, lineage_all1, lineage_balc, lineage_cm4, lineage_dm4, muscle, lineage_13, lineage_8, lineage_mbp3, lineage_12, lineage_dm1, lineage_dpmm1, lineage_9, lineage_cp2, lineage_dl1, fanc, lineage_7, lineage_vpnd2, lineage_dm3, lineage_dpmpm2, lineage_14, lineage_4, lineage_blp1, lineage_dalv2, lineage_eba1, lineage_dm2, lineage_dpmpm1, auditory_system, lineage_16, lineage_blvp1, lineage_blav2, lineage_vlpl2, lineage_alad1, lineage_bamv3, lineage_bld6, lineage_vpnd1, synaptic_neuropil, lineage_23, lineage_17, lineage_10, lineage_dplpv, lineage_21, lineage_alv1\n\nMultiple filter_types are ANDed (results must match ALL). Multiple exclude_types are ORed (any match excludes). boost_types soft-rank matching results higher without excluding others.',
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
                description: 'Filter results to only include items matching ALL of these facets_annotation types (AND logic)',
              },
              exclude_types: {
                type: 'array',
                items: { type: 'string' },
                description: 'Exclude results matching ANY of these facets_annotation types (OR logic)',
              },
              boost_types: {
                type: 'array',
                items: { type: 'string' },
                description: 'Boost ranking of results matching these facets_annotation types without excluding others',
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
                description: 'When true, limit results to top 10 for initial searches and add truncation metadata. For exact matches, return only the matching result.',
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
          description: 'Query synaptic connectivity between Drosophila neuron classes across ALL connectome datasets simultaneously for comparative connectomics. This is NOT pre-cached — it runs live queries, so expect slow responses (up to several minutes). Set both upstream_type AND downstream_type to filter connections between two specific neuron classes (e.g., "What Tm1→T3 connections exist across all datasets?"). At least one of upstream_type or downstream_type is required. CONSTRAINTS: Only accepts neuron class terms (OWL IDs like FBbt_00003789 or labels like "transmedullary neuron Tm1") — anatomical regions or neuropils (e.g., "lobula", "medulla") are NOT accepted. NOT suitable for individual neuron-to-neuron connections — for pre-computed connections of a single individual neuron, use run_query with NeuronNeuronConnectivityQuery instead. NOT for muscle/sense organ connections. RECOMMENDED DEFAULTS: weight=5, exclude_dbs=["hb","fafb"] unless user specifies otherwise. For both-ends queries, start with weight≥50 to avoid timeouts. WORKFLOW: Confirm parameters with user before querying. Use search_terms with filter_types ["neuron","class"] to validate/canonicalize neuron type labels. If zero results, try relaxation: lower weight to 1, then remove exclude_dbs filter, then try group_by_class=true — report what worked and let user decide. Present large results (>50 rows) as top 20 by weight with summary stats.',
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
                description: 'Dataset symbols to exclude (recommended default: ["hb", "fafb"] to focus on newer datasets). Pass empty array [] to include all datasets. Use list_connectome_datasets to see valid symbols.',
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
          return await handleGetTermInfo(args as { id: string | string[] });
        case 'run_query':
          return await handleRunQuery(args as { id?: string | string[]; query_type?: string; queries?: Array<{ id: string; query_type: string }>; limit?: number; offset?: number; include_images?: boolean });
        case 'search_terms':
          return await handleSearchTerms(args as { query: string; filter_types?: string[]; exclude_types?: string[]; boost_types?: string[]; start?: number; rows?: number; minimize_results?: boolean; auto_fetch_term_info?: boolean });
        case 'resolve_entity':
          return await handleResolveEntity(args as { name: string });
        case 'resolve_combination':
          return await handleResolveCombination(args as { name: string });
        case 'list_connectome_datasets':
          return await handleListConnectomeDatasets();
        case 'query_connectivity':
          return await handleQueryConnectivity(args as { upstream_type?: string; downstream_type?: string; weight?: number; group_by_class?: boolean; exclude_dbs?: string[] });
        case 'get_hierarchy':
          return await handleGetHierarchy(args as { id: string; relationship: string; direction?: string; max_depth?: number });
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

async function fetchSingleTermInfo(id: string): Promise<{ data?: any; error?: string }> {
  const url = `https://v3-cached.virtualflybrain.org/get_term_info?id=${id}`;
  console.error(`MCP Debug: Fetching term info for id=${id}`);
  try {
    const response = await axios.get(url);
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

async function handleGetTermInfo(args: { id: string | string[] }) {
  const { id } = args;

  // Single ID — preserve original response format
  if (typeof id === 'string') {
    const result = await fetchSingleTermInfo(id);
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
    const result = await fetchSingleTermInfo(singleId);
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

const RUN_QUERY_IMAGE_COLUMNS = ['thumbnail', 'thumbnail_transparent'];

function shapeRunQueryResult(data: any, ctx: { includeImages: boolean; limit: number; offset: number }): any {
  if (!data || !Array.isArray(data.rows)) { return data; }
  const total = typeof data.count === 'number' ? data.count : data.rows.length;
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
  if (imagesExcluded) { notes.push('Image columns (thumbnail) were excluded to reduce size - re-run this query with include_images=true to include them.'); }
  if (total > ctx.offset + returned) {
    const nextOffset = ctx.offset + (ctx.limit > 0 ? ctx.limit : returned);
    notes.push(`Showing rows ${ctx.offset}-${ctx.offset + returned} of ${total}. To see more, re-run with offset=${nextOffset} (same limit).`);
  } else if (ctx.offset > 0) {
    notes.push(`Showing rows ${ctx.offset}-${ctx.offset + returned} of ${total}.`);
  }
  const shaped: Record<string, any> = { count: total, offset: ctx.offset, limit: ctx.limit, returned };
  if (notes.length) { shaped._note = notes.join(' '); }
  shaped.headers = headers;
  shaped.rows = rows;
  return shaped;
}

async function fetchSingleQuery(id: string, query_type: string, opts: { limit?: number; offset?: number; includeImages?: boolean } = {}): Promise<{ data?: any; error?: string; redirect?: string }> {
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
  console.error(`MCP Debug: Running query id=${id} query_type=${query_type} limit=${limit} offset=${offset} includeImages=${includeImages}`);
  try {
    const response = await axios.get(url);
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

async function handleRunQuery(args: { id?: string | string[]; query_type?: string; queries?: Array<{ id: string; query_type: string }>; limit?: number; offset?: number; include_images?: boolean }) {
  const { id, query_type, queries, limit, offset, include_images } = args;
  const opts = { limit, offset, includeImages: include_images };

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

async function handleSearchTerms(args: { query: string; filter_types?: string[]; exclude_types?: string[]; boost_types?: string[]; start?: number; rows?: number; minimize_results?: boolean; auto_fetch_term_info?: boolean }) {
  const { query, filter_types, exclude_types, boost_types, start = 0, rows = 150, minimize_results = false, auto_fetch_term_info = false } = args;
  const baseUrl = 'https://solr.virtualflybrain.org/solr/ontology/select';

  const fq: string[] = [
    '(short_form:VFB* OR short_form:FB* OR facets_annotation:DataSet OR facets_annotation:pub) AND NOT short_form:VFBc_*',
  ];

  if (filter_types && filter_types.length > 0) {
    for (const ft of filter_types) {
      fq.push(`facets_annotation:${ft}`);
    }
  }

  if (exclude_types && exclude_types.length > 0) {
    const excludeClause = exclude_types.map(et => `facets_annotation:${et}`).join(' OR ');
    fq.push(`NOT (${excludeClause})`);
  }

  let bq = 'short_form:VFBexp*^10.0 short_form:VFB*^100.0 short_form:FBbt*^100.0 short_form:FBbt_00003982^2 facets_annotation:Deprecated^0.001';
  if (boost_types && boost_types.length > 0) {
    const boostClauses = boost_types.map(bt => `facets_annotation:${bt}^1000.0`).join(' ');
    bq = `${bq} ${boostClauses}`;
  }

  const params = {
    q: `${query} OR ${query}* OR *${query}*`,
    'q.op': 'OR',
    defType: 'edismax',
    mm: '45%',
    qf: 'label^110 synonym^100 label_autosuggest synonym_autosuggest shortform_autosuggest',
    indent: 'true',
    fl: 'short_form,label,synonym,id,facets_annotation,unique_facets',
    start: start.toString(),
    pf: 'true',
    fq,
    rows: Math.min(rows, 1000).toString(), // Cap at 1000 max
    wt: 'json',
    bq,
  };

  try {
    const response = await axios.get(baseUrl, { params });
    let resultData = response.data;

    // Handle minimization and auto-fetch logic
    if (minimize_results || auto_fetch_term_info) {
      if (resultData?.response?.docs) {
        const originalCount = resultData.response.numFound;
        const queryLower = query.toLowerCase();
        const isPaginatedRequest = start > 0 || rows !== 150;

        // Check for exact label match first (only for non-paginated requests)
        let exactMatch = null;
        if (!isPaginatedRequest) {
          exactMatch = resultData.response.docs.find((doc: any) =>
            doc.label?.toLowerCase() === queryLower
          );
        }

        let minimizedDocs = resultData.response.docs;
        let truncationInfo: any = {};

        if (exactMatch) {
          // If exact match found, return only that one
          minimizedDocs = [exactMatch];
          truncationInfo = { exactMatch: true, totalAvailable: originalCount };
        } else if (minimize_results && !isPaginatedRequest) {
          // For initial searches without pagination, limit to top 10
          minimizedDocs = resultData.response.docs.slice(0, 10);
          truncationInfo = {
            truncated: originalCount > 10,
            shown: minimizedDocs.length,
            totalAvailable: originalCount,
            canRequestMore: originalCount > 10
          };
        } else if (isPaginatedRequest) {
          // For paginated requests, return all requested results
          truncationInfo = {
            paginated: true,
            requested: rows,
            returned: minimizedDocs.length,
            totalAvailable: originalCount
          };
        }

        // Keep only essential fields if minimizing
        if (minimize_results) {
          minimizedDocs = minimizedDocs.map((doc: any) => ({
            short_form: doc.short_form,
            label: doc.label,
            synonym: Array.isArray(doc.synonym) ? doc.synonym.slice(0, 1) : doc.synonym // Keep only first synonym
          }));
        }

        resultData.response.docs = minimizedDocs;
        resultData.response.numFound = minimizedDocs.length; // Update count

        // Add truncation metadata
        if (Object.keys(truncationInfo).length > 0) {
          resultData.response._truncation = truncationInfo;
        }

        // Auto-fetch term info for exact match
        if (auto_fetch_term_info && exactMatch) {
          try {
            const termInfoResult = await handleGetTermInfo({ id: exactMatch.short_form });
            if (termInfoResult.content && termInfoResult.content[0]?.text) {
              resultData._term_info = JSON.parse(termInfoResult.content[0].text);
            }
          } catch (termInfoError) {
            console.error('Error auto-fetching term info:', termInfoError);
            // Don't fail the search if term info fetch fails
          }
        }
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(resultData, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error searching terms: ${error}`,
        },
      ],
    };
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

async function handleQueryConnectivity(args: {
  upstream_type?: string;
  downstream_type?: string;
  weight?: number;
  group_by_class?: boolean;
  exclude_dbs?: string[];
}): Promise<{ content: Array<{ type: string; text: string }> }> {
  const params = new URLSearchParams();
  if (args.upstream_type) params.set('upstream_type', args.upstream_type);
  if (args.downstream_type) params.set('downstream_type', args.downstream_type);
  if (args.weight !== undefined) params.set('weight', String(args.weight));
  if (args.group_by_class !== undefined) params.set('group_by_class', String(args.group_by_class));
  if (args.exclude_dbs) params.set('exclude_dbs', args.exclude_dbs.join(','));
  const url = `${VFBQUERY_BASE}/query_connectivity?${params.toString()}`;
  console.error(`MCP Debug: query_connectivity params=${params.toString()}`);
  try {
    const response = await axios.get(url, { timeout: 300000 }); // 5 min — live cross-dataset query
    return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
  } catch (error) {
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
  params.set('relationship', args.relationship);
  if (args.direction) params.set('direction', args.direction);
  if (args.max_depth !== undefined) params.set('max_depth', String(args.max_depth));
  const url = `${VFBQUERY_BASE}/get_hierarchy?${params.toString()}`;
  console.error(`MCP Debug: get_hierarchy params=${params.toString()}`);
  try {
    const response = await axios.get(url, { timeout: 120000 }); // 2 min
    return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
  } catch (error) {
    return { content: [{ type: 'text', text: `Error getting hierarchy: ${error}` }] };
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
    <li><code>search_terms</code> - Search for VFB terms using the Solr search server with filtering options</li>
    <li><code>resolve_entity</code> - Resolve an unresolved query string (e.g., P{VT054895-GAL4.DBD} or a driver line / cell type label) to VFB/FlyBase IDs and metadata</li>
    <li><code>resolve_combination</code> - Resolve an unresolved split-GAL4 combination name or synonym to its underlying IDs</li>
    <li><code>list_connectome_datasets</code> - List available connectome datasets (e.g., Hemibrain, FAFB)</li>
    <li><code>query_connectivity</code> - Query connectivity across connectome datasets using upstream/downstream filters</li>
  </ul>

  <h2>🧠 About VirtualFlyBrain</h2>
  <p>VirtualFlyBrain (VFB) is a comprehensive knowledge base about <em>Drosophila melanogaster</em> neurobiology, integrating neuroanatomical 3D images and models, gene expression data, neural connectivity, and standardized terminology.</p>

  <h2>📖 Documentation</h2>
  <ul>
    <li><a href="https://github.com/Robbie1977/VFB3-MCP#readme">Full Documentation on GitHub</a></li>
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
