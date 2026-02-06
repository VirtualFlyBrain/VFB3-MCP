import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  isInitializeRequest,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import cors from 'cors';

const VERSION = '1.1.1';

// Custom params serializer to handle array params as repeated keys (e.g. fq=a&fq=b)
// Axios defaults to bracket notation (fq[]=a&fq[]=b) which Solr doesn't understand
function serializeParams(params: Record<string, unknown>): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const v of value) {
        searchParams.append(key, String(v));
      }
    } else {
      searchParams.append(key, String(value));
    }
  }
  return searchParams.toString();
}

const FALLBACK_FACETS = [
  'adult', 'anatomy', 'cell', 'cholinergic', 'class', 'cluster', 'dataset',
  'deprecated', 'dopaminergic', 'expression_pattern', 'expression_pattern_fragment',
  'fafb', 'fanc', 'feature', 'flycircuit', 'gabaergic', 'gene', 'glutamatergic',
  'has_image', 'has_neuron_connectivity', 'has_region_connectivity', 'hasscrnaseq',
  'histaminergic', 'individual', 'l1em', 'larva', 'motor_neuron', 'muscle',
  'nblast', 'nblastexp', 'nervous_system', 'neuron', 'neuronbridge',
  'olfactory_system', 'peptidergic', 'primary_neuron', 'pub', 'secondary_neuron',
  'sensory_neuron', 'serotonergic', 'split', 'synaptic_neuropil',
  'visual_system', 'vfb',
];

async function fetchAvailableFacets(): Promise<string[]> {
  try {
    const response = await axios.get('https://solr.virtualflybrain.org/solr/ontology/select', {
      params: {
        q: '*:*',
        rows: '0',
        facet: 'true',
        'facet.field': 'facets_annotation',
        'facet.mincount': '1',
        wt: 'json',
      },
    });
    const facetArray = response.data?.facet_counts?.facet_fields?.facets_annotation;
    if (Array.isArray(facetArray)) {
      // Solr returns alternating [name, count, name, count, ...]
      const names: string[] = [];
      for (let i = 0; i < facetArray.length; i += 2) {
        names.push(facetArray[i]);
      }
      console.error(`Fetched ${names.length} available facet types from Solr`);
      return names;
    }
    console.error('Unexpected facet response format, using fallback list');
    return FALLBACK_FACETS;
  } catch (error) {
    console.error(`Failed to fetch facets from Solr, using fallback list: ${error}`);
    return FALLBACK_FACETS;
  }
}

function createServer(availableFacets: string[]): Server {
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

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'get_term_info',
          description: 'Get term information from VirtualFlyBrain using a VFB ID',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'VFB ID (e.g., VFB_jrcv0i43)',
              },
            },
            required: ['id'],
          },
        },
        {
          name: 'run_query',
          description: 'Run a query on VirtualFlyBrain using a VFB ID and query type',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'VFB ID (e.g., VFB_00101567)',
              },
              query_type: {
                type: 'string',
                description: 'Query type (e.g., PaintedDomains)',
              },
            },
            required: ['id', 'query_type'],
          },
        },
        {
          name: 'search_terms',
          description: `Search for VFB terms using the Solr search server. Results can be filtered, excluded, or boosted by entity type using facets_annotation values.

Available filter types: ${availableFacets.join(', ')}

Multiple filter_types are ANDed (results must match ALL). Multiple exclude_types are ORed (any match excludes). boost_types soft-rank matching results higher without excluding others.`,
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
                description: 'Facet types to require. Results must have ALL specified types. Example: ["neuron", "adult", "has_image"]',
              },
              exclude_types: {
                type: 'array',
                items: { type: 'string' },
                description: 'Facet types to exclude. Results must NOT have any of these. Example: ["deprecated", "larva"]',
              },
              boost_types: {
                type: 'array',
                items: { type: 'string' },
                description: 'Facet types to boost in ranking without hard filtering. Example: ["has_image", "has_neuron_connectivity"]',
              },
            },
            required: ['query'],
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case 'get_term_info': {
        const { id } = args as { id: string };
        try {
          const response = await axios.get(`https://v3-cached.virtualflybrain.org/get_term_info?id=${id}`);
          return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
        } catch (error) {
          return { content: [{ type: 'text', text: `Error fetching term info: ${error}` }] };
        }
      }
      case 'run_query': {
        const { id, query_type } = args as { id: string; query_type: string };
        try {
          const response = await axios.get(`https://v3-cached.virtualflybrain.org/run_query?id=${id}&query_type=${query_type}`);
          return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
        } catch (error) {
          return { content: [{ type: 'text', text: `Error running query: ${error}` }] };
        }
      }
      case 'search_terms': {
        const { query, filter_types, exclude_types, boost_types } = args as {
          query: string;
          filter_types?: string[];
          exclude_types?: string[];
          boost_types?: string[];
        };
        try {
          // Build filter query clauses - base filter always applies
          const fqClauses: string[] = [
            '(short_form:VFB* OR short_form:FB* OR facets_annotation:DataSet OR facets_annotation:pub) AND NOT short_form:VFBc_*',
          ];

          // Add inclusion filters (AND semantics - each is a separate fq clause)
          if (filter_types && filter_types.length > 0) {
            for (const ft of filter_types) {
              fqClauses.push(`facets_annotation:${ft}`);
            }
          }

          // Add exclusion filters
          if (exclude_types && exclude_types.length > 0) {
            for (const et of exclude_types) {
              fqClauses.push(`NOT facets_annotation:${et}`);
            }
          }

          // Build boost query - start with base boosts
          let bq = 'short_form:VFBexp*^10.0 short_form:VFB*^100.0 short_form:FBbt*^100.0 short_form:FBbt_00003982^2 facets_annotation:Deprecated^0.001';

          // Append user-requested boost types
          if (boost_types && boost_types.length > 0) {
            const boostClauses = boost_types.map(bt => `facets_annotation:${bt}^500.0`);
            bq = bq + ' ' + boostClauses.join(' ');
          }

          const response = await axios.get('https://solr.virtualflybrain.org/solr/ontology/select', {
            params: {
              q: `${query} OR ${query}* OR *${query}*`,
              'q.op': 'OR',
              defType: 'edismax',
              mm: '45%',
              qf: 'label^110 synonym^100 label_autosuggest synonym_autosuggest shortform_autosuggest',
              indent: 'true',
              fl: 'short_form,label,synonym,id,facets_annotation,unique_facets',
              start: '0',
              pf: 'true',
              fq: fqClauses,
              rows: '150',
              wt: 'json',
              bq: bq,
            },
            paramsSerializer: serializeParams,
          });
          return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
        } catch (error) {
          return { content: [{ type: 'text', text: `Error searching terms: ${error}` }] };
        }
      }
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  });

  return server;
}

async function main() {
  const port = process.env.PORT || '3000';
  const mode = process.env.MCP_MODE || 'stdio';

  // Fetch available facet types from Solr at startup
  const availableFacets = await fetchAvailableFacets();

  if (mode === 'http') {
    console.error(`Starting VFB3-MCP server v${VERSION} in HTTP mode on port ${port}`);

    const app = createMcpExpressApp({
      host: process.env.HOST || '0.0.0.0',
      allowedHosts: ['vfb3-mcp.virtualflybrain.org', 'localhost', '127.0.0.1'],
    });

    app.use(cors({
      exposedHeaders: ['mcp-session-id'],
    }));

    // Serve an info page for browser requests
    app.get('/', (req: any, res: any, next: any) => {
      if (req.headers.accept && req.headers.accept.includes('text/html')) {
        res.send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>VFB3-MCP Server</title>
            <style>
              body { font-family: Arial, sans-serif; margin: 40px; }
              h1 { color: #333; }
              p { line-height: 1.6; }
            </style>
          </head>
          <body>
            <h1>Virtual Fly Brain MCP Server v${VERSION}</h1>
            <p>This is a Model Context Protocol (MCP) server providing access to Virtual Fly Brain (VFB) data and APIs.</p>
            <p><strong>MCP Endpoint:</strong> <code>/</code> (server root)</p>
            <p><strong>Available Tools:</strong></p>
            <ul>
              <li><code>get_term_info</code> - Get term information from VirtualFlyBrain using a VFB ID</li>
              <li><code>run_query</code> - Run a query on VirtualFlyBrain using a VFB ID and query type</li>
              <li><code>search_terms</code> - Search for VFB terms using the Solr search server (supports type-based filtering via filter_types, exclude_types, and boost_types parameters)</li>
            </ul>
            
            <h2>MCP Client Configuration</h2>
            <p>To use this MCP server with your preferred MCP client, add the following configuration:</p>
            
            <h3>Claude Desktop</h3>
            <p>Add to your MCP server configuration:</p>
            <pre><code>{
  "mcpServers": {
    "vfb3-mcp": {
      "url": "https://vfb3-mcp.virtualflybrain.org/mcp"
    }
  }
}</code></pre>
            
            <h3>Claude Code</h3>
            <p>Add to your <code>claude.json</code>:</p>
            <pre><code>{
  "mcpServers": {
    "vfb3-mcp": {
      "url": "https://vfb3-mcp.virtualflybrain.org/mcp"
    }
  }
}</code></pre>
            
            <h3>GitHub Copilot</h3>
            <p>Configure the MCP server URL in your Copilot settings to point to:</p>
            <pre><code>https://vfb3-mcp.virtualflybrain.org/mcp</code></pre>
            
            <h3>Visual Studio Code</h3>
            <p>Add the server using the MCP extension:</p>
            <ol>
              <li>Press <code>Cmd + Shift + P</code> (macOS) or <code>Ctrl + Shift + P</code> (Windows/Linux) and select <strong>MCP: Add server…</strong></li>
              <li>Select <strong>HTTP</strong> and enter <code>https://vfb3-mcp.virtualflybrain.org</code></li>
              <li>Give the server a unique name (e.g., "virtual-fly-brain")</li>
            </ol>
            <p>In your <code>mcp.json</code> configuration file, you should now see an entry like this:</p>
            <pre><code>{
  "virtual-fly-brain": {
    "url": "https://vfb3-mcp.virtualflybrain.org",
    "type": "http"
  }
}</code></pre>
            
            <p>This server is designed for MCP clients like Claude Desktop. For more information, visit <a href="https://virtualflybrain.org">Virtual Fly Brain</a>.</p>
          </body>
          </html>
        `);
      } else {
        next();
      }
    });

    // Map of session ID -> transport for stateful connections
    const transports: Record<string, StreamableHTTPServerTransport> = {};

    // MCP POST handler: initialize new sessions or handle requests on existing ones
    app.post('/', async (req: any, res: any) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      try {
        if (sessionId && transports[sessionId]) {
          // Existing session — delegate to its transport
          await transports[sessionId].handleRequest(req, res, req.body);
        } else if (!sessionId && isInitializeRequest(req.body)) {
          // New session initialization
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id: string) => {
              transports[id] = transport;
            },
          });

          transport.onclose = () => {
            const sid = transport.sessionId;
            if (sid && transports[sid]) {
              delete transports[sid];
            }
          };

          const server = createServer(availableFacets);
          await server.connect(transport);
          await transport.handleRequest(req, res, req.body);
        } else {
          res.status(400).json({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
            id: null,
          });
        }
      } catch (error) {
        console.error('Error handling MCP request:', error);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null,
          });
        }
      }
    });

    // SSE stream for existing sessions
    app.get('/', async (req: any, res: any) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (!sessionId || !transports[sessionId]) {
        res.status(400).send('Invalid or missing session ID');
        return;
      }
      await transports[sessionId].handleRequest(req, res);
    });

    // Session termination
    app.delete('/', async (req: any, res: any) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (!sessionId || !transports[sessionId]) {
        res.status(400).send('Invalid or missing session ID');
        return;
      }
      try {
        await transports[sessionId].handleRequest(req, res);
      } catch (error) {
        console.error('Error handling session termination:', error);
        if (!res.headersSent) {
          res.status(500).send('Error processing session termination');
        }
      }
    });

    app.listen(parseInt(port), () => {
      console.error(`VFB MCP Server running on HTTP port ${port}`);
    });
  } else {
    // stdio mode
    const server = createServer(availableFacets);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('VFB MCP Server running on stdio');
  }
}

main().catch(console.error);
