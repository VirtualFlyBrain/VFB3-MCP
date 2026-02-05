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

const VERSION = '1.0.0';

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
          description: 'Search for VFB terms using the Solr search server',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search query (e.g., medulla)',
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
        const { query } = args as { query: string };
        try {
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
              fq: ['(short_form:VFB* OR short_form:FB* OR facets_annotation:DataSet OR facets_annotation:pub) AND NOT short_form:VFBc_*'],
              rows: '150',
              wt: 'json',
              bq: 'short_form:VFBexp*^10.0 short_form:VFB*^100.0 short_form:FBbt*^100.0 short_form:FBbt_00003982^2 facets_annotation:Deprecated^0.001',
            },
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

  if (mode === 'http') {
    console.error(`Starting VFB3-MCP server v${VERSION} in HTTP mode on port ${port}`);

    const app = createMcpExpressApp({
      host: process.env.HOST || '0.0.0.0',
      allowedHosts: ['vfb3-mcp.virtualflybrain.org', 'localhost', '127.0.0.1'],
    });

    app.use(cors());

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
              <li><code>search_terms</code> - Search for VFB terms using the Solr search server</li>
            </ul>
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

          const server = createServer();
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
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('VFB MCP Server running on stdio');
  }
}

main().catch(console.error);
