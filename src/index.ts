import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import cors from 'cors';

class VFBMCPServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'vfb3-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
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

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      console.error('MCP Debug: Received CallTool request for tool:', name, 'with args:', JSON.stringify(args));

      try {
        switch (name) {
          case 'get_term_info':
            return await this.handleGetTermInfo(args as { id: string });
          case 'run_query':
            return await this.handleRunQuery(args as { id: string; query_type: string });
          case 'search_terms':
            return await this.handleSearchTerms(args as { query: string });
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

    // Auth handlers - removed as not valid
  }

  private async handleGetTermInfo(args: { id: string }) {
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

  private async handleRunQuery(args: { id: string; query_type: string }) {
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

  private async handleSearchTerms(args: { query: string }) {
    const { query } = args;
    const baseUrl = 'https://solr.virtualflybrain.org/solr/ontology/select';
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
      fq: ['(short_form:VFB* OR short_form:FB* OR facets_annotation:DataSet OR facets_annotation:pub) AND NOT short_form:VFBc_*'],
      rows: '150',
      wt: 'json',
      bq: 'short_form:VFBexp*^10.0 short_form:VFB*^100.0 short_form:FBbt*^100.0 short_form:FBbt_00003982^2 facets_annotation:Deprecated^0.001',
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

  async run() {
    const port = process.env.PORT || '3000';
    const mode = process.env.MCP_MODE || 'stdio';

    if (mode === 'http') {
      // HTTP mode using Express
      console.error('MCP Debug: Starting server in HTTP mode on port', port);
      const app = createMcpExpressApp({
        host: process.env.HOST || '0.0.0.0'
      });

      // Enable CORS for MCP over HTTP
      app.use(cors());

      // Debug logging for HTTP requests
      app.use((req: any, res: any, next: any) => {
        console.error('MCP Debug: HTTP request:', req.method, req.url, 'from', req.ip, 'headers:', JSON.stringify(req.headers));
        next();
      });

      app.listen(parseInt(port), () => {
        console.error(`MCP Debug: VFB MCP Server running on HTTP port ${port}`);
      });
    } else {
      // Default stdio mode
      console.error('MCP Debug: Starting server in stdio mode');
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      console.error('MCP Debug: VFB MCP Server running on stdio');
    }
  }
}

const server = new VFBMCPServer();
server.run().catch(console.error);