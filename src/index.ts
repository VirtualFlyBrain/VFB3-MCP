import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  isInitializeRequest,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import cors from 'cors';
import express from 'express';
import { randomUUID } from 'node:crypto';

const VERSION = '1.2.1';

function setupToolHandlers(server: Server) {
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    console.error('MCP Debug: Received ListTools request');
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
          description: 'Search for VFB terms using the Solr search server. Results can be filtered, excluded, or boosted by entity type using facets_annotation values.\n\nAvailable filter types: entity, anatomy, nervous_system, individual, has_image, adult, cell, neuron, vfb, has_neuron_connectivity, nblast, visual_system, cholinergic, class, secondary_neuron, expression_pattern, gabaergic, expression_pattern_fragment, glutamatergic, feature, sensory_neuron, neuronbridge, deprecated, larva, has_region_connectivity, nblastexp, gene, primary_neuron, flycircuit, mechanosensory_system, histaminergic, lineage_mbp, peptidergic, hasscrnaseq, chemosensory_system, split, has_subclass, olfactory_system, dopaminergic, fafb, l1em, pub, enzyme, motor_neuron, cluster, lineage_6, lineage_3, serotonergic, lineage_19, lineage_cm3, lineage_dm6, proprioceptive_system, gustatory_system, sense_organ, lineage_mbp4, lineage_mbp1, lineage_1, lineage_mbp2, lineage_all1, lineage_balc, lineage_cm4, lineage_dm4, muscle, lineage_13, lineage_8, lineage_mbp3, lineage_12, lineage_dm1, lineage_dpmm1, lineage_9, lineage_cp2, lineage_dl1, fanc, lineage_7, lineage_vpnd2, lineage_dm3, lineage_dpmpm2, lineage_14, lineage_4, lineage_blp1, lineage_dalv2, lineage_eba1, lineage_dm2, lineage_dpmpm1, auditory_system, lineage_16, lineage_blvp1, lineage_blav2, lineage_vlpl2, lineage_alad1, lineage_bamv3, lineage_bld6, lineage_vpnd1, synaptic_neuropil, lineage_23, lineage_17, lineage_10, lineage_dplpv, lineage_21, lineage_alv1\n\nMultiple filter_types are ANDed (results must match ALL). Multiple exclude_types are ORed (any match excludes). boost_types soft-rank matching results higher without excluding others.',
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
            },
            required: ['query'],
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    console.error('MCP Debug: Received CallTool request for tool:', name, 'with args:', JSON.stringify(args));

    try {
      switch (name) {
        case 'get_term_info':
          return await handleGetTermInfo(args as { id: string });
        case 'run_query':
          return await handleRunQuery(args as { id: string; query_type: string });
        case 'search_terms':
          return await handleSearchTerms(args as { query: string; filter_types?: string[]; exclude_types?: string[]; boost_types?: string[] });
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

async function handleGetTermInfo(args: { id: string }) {
  const { id } = args;
  const url = `https://v3-cached.virtualflybrain.org/get_term_info?id=${id}`;

  try {
    const response = await axios.get(url);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response.data, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error fetching term info: ${error}`,
        },
      ],
    };
  }
}

async function handleRunQuery(args: { id: string; query_type: string }) {
  const { id, query_type } = args;
  const url = `https://v3-cached.virtualflybrain.org/run_query?id=${id}&query_type=${query_type}`;

  try {
    const response = await axios.get(url);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response.data, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error running query: ${error}`,
        },
      ],
    };
  }
}

async function handleSearchTerms(args: { query: string; filter_types?: string[]; exclude_types?: string[]; boost_types?: string[] }) {
  const { query, filter_types, exclude_types, boost_types } = args;
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
    start: '0',
    pf: 'true',
    fq,
    rows: '150',
    wt: 'json',
    bq,
  };

  try {
    const response = await axios.get(baseUrl, { params });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response.data, null, 2),
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

function createServer(): Server {
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
  setupToolHandlers(server);
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
  </style>
</head>
<body>
  <h1>Virtual Fly Brain MCP Server v${VERSION}</h1>
  <p>This is a Model Context Protocol (MCP) server providing access to Virtual Fly Brain (VFB) data and APIs.</p>

  <div class="endpoint">
    <strong>MCP Endpoint:</strong> <code>https://vfb3-mcp.virtualflybrain.org</code>
  </div>

  <h2>Available Tools</h2>
  <ul>
    <li><code>get_term_info</code> - Get term information from VirtualFlyBrain using a VFB ID</li>
    <li><code>run_query</code> - Run a query on VirtualFlyBrain using a VFB ID and query type</li>
    <li><code>search_terms</code> - Search for VFB terms using the Solr search server with filtering options</li>
  </ul>

  <h2>Quick Start for MCP Clients</h2>

  <h3>Claude Desktop</h3>
  <p>Add to your MCP server configuration:</p>
  <pre><code>{
"mcpServers": {
  "vfb3-mcp": {
    "url": "https://vfb3-mcp.virtualflybrain.org"
  }
}
}</code></pre>

  <h3>Claude Code</h3>
  <p>Add to your <code>claude.json</code>:</p>
  <pre><code>{
"mcpServers": {
  "vfb3-mcp": {
    "url": "https://vfb3-mcp.virtualflybrain.org"
  }
}
}</code></pre>

  <h3>GitHub Copilot</h3>
  <p>Configure the MCP server URL in your Copilot settings to point to <code>https://vfb3-mcp.virtualflybrain.org</code>.</p>

  <h2>About VirtualFlyBrain</h2>
  <p>VirtualFlyBrain (VFB) is a comprehensive knowledge base about <em>Drosophila melanogaster</em> neurobiology, integrating neuroanatomical 3D images and models, gene expression data, neural connectivity, and standardized terminology.</p>

  <h2>Documentation</h2>
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
  console.error(`MCP Debug: Starting VFB3-MCP server v${VERSION} in HTTP mode on port ${port}`);

  const app = express();
  app.use(cors());
  app.use(express.json());

  // Store active transports by session ID
  const transports: Record<string, StreamableHTTPServerTransport> = {};

  // Handle GET requests: browser HTML page or SSE streams
  app.get('/', async (req: any, res: any) => {
    // Serve HTML page for browser requests
    if (req.headers.accept && req.headers.accept.includes('text/html')) {
      res.send(getHtmlPage());
      return;
    }

    // SSE stream for existing MCP sessions
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: Invalid or missing session ID' },
        id: null,
      });
      return;
    }

    const transport = transports[sessionId];
    await transport.handleRequest(req, res);
  });

  // Handle POST requests: MCP JSON-RPC messages
  app.post('/', async (req: any, res: any) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    try {
      if (sessionId && transports[sessionId]) {
        // Existing session — reuse transport
        const transport = transports[sessionId];
        await transport.handleRequest(req, res, req.body);
        return;
      }

      if (!sessionId && isInitializeRequest(req.body)) {
        // New initialization request — create transport and server
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid: string) => {
            console.error(`MCP Debug: Session initialized: ${sid}`);
            transports[sid] = transport;
          },
        });

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && transports[sid]) {
            console.error(`MCP Debug: Session closed: ${sid}`);
            delete transports[sid];
          }
        };

        // Connect a new MCP server to this transport
        const server = createServer();
        await server.connect(transport);

        // Handle the initialization request
        await transport.handleRequest(req, res, req.body);
        return;
      }

      // Invalid request
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
        id: null,
      });
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

  // Handle DELETE requests: session termination
  app.delete('/', async (req: any, res: any) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: Invalid or missing session ID' },
        id: null,
      });
      return;
    }

    try {
      const transport = transports[sessionId];
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error('MCP Debug: Error handling DELETE request:', error);
      if (!res.headersSent) {
        res.status(500).send('Error processing session termination');
      }
    }
  });

  app.listen(parseInt(port), () => {
    console.error(`MCP Debug: VFB MCP Server running on HTTP port ${port}`);
  });
}

async function runStdioMode() {
  console.error('MCP Debug: Starting server in stdio mode');
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
