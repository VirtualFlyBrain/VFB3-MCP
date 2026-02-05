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
import express from 'express';
import { mcpAuthMetadataRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { OAuthMetadata } from '@modelcontextprotocol/sdk/shared/auth.js';

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
    const version = '1.0.0'; // From package.json

    if (mode === 'http') {
      // HTTP mode using Express
      console.error('MCP Debug: Starting VFB3-MCP server v' + version + ' in HTTP mode on port', port);

      const mainApp = express();

      // Enable CORS for MCP over HTTP
      mainApp.use(cors());

      // Configure OAuth metadata (even though we don't require auth)
      // Use HTTPS issuer URL for MCP SDK compatibility (server runs behind reverse proxy)
      const issuerUrl = process.env.ISSUER_URL || `https://${process.env.HOST || 'vfb3-mcp.virtualflybrain.org'}`;
      const mcpServerUrl = new URL(issuerUrl);
      const oauthMetadata: OAuthMetadata = {
        issuer: issuerUrl,
        authorization_endpoint: `${issuerUrl}/oauth/authorize`,
        token_endpoint: `${issuerUrl}/oauth/token`,
        response_types_supported: ['code'],
      };

      // Add MCP auth metadata router (provides OAuth discovery endpoints)
      mainApp.use(
        mcpAuthMetadataRouter({
          oauthMetadata,
          resourceServerUrl: mcpServerUrl,
          scopesSupported: ['mcp:tools'],
          resourceName: 'VFB3-MCP Server',
        }),
      );

      // Handle browser requests to root
      mainApp.get('/', (req: any, res: any, next: any) => {
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
              <h1>Virtual Fly Brain MCP Server v${version}</h1>
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
          next(); // Let MCP handle it
        }
      });

      // Create MCP app
      const mcpApp = createMcpExpressApp({
        host: process.env.HOST || '0.0.0.0',
        allowedHosts: ['vfb3-mcp.virtualflybrain.org', 'localhost', '127.0.0.1']
      });

      // Mount MCP at root (/) - Claude Desktop expects MCP at the server root
      mainApp.use('/', mcpApp);

      // Add OAuth discovery proxy for Claude Desktop compatibility
      mainApp.get('/.well-known/oauth-protected-resource/mcp', async (req: any, res: any) => {
        try {
          // Return the same OAuth metadata
          res.json({
            resource: issuerUrl,
            authorization_servers: [issuerUrl],
            scopes_supported: ['mcp:tools']
          });
        } catch (error) {
          console.error('MCP Debug: Error returning OAuth discovery:', error);
          res.status(500).json({ error: 'OAuth discovery failed' });
        }
      });

      mainApp.get('/.well-known/oauth-authorization-server/mcp', async (req: any, res: any) => {
        try {
          // Return the OAuth authorization server metadata
          res.json(oauthMetadata);
        } catch (error) {
          console.error('MCP Debug: Error returning OAuth auth server:', error);
          res.status(500).json({ error: 'OAuth auth server discovery failed' });
        }
      });

      // Debug logging for HTTP requests
      mainApp.use((req: any, res: any, next: any) => {
        console.error('MCP Debug: HTTP request:', req.method, req.url, 'from', req.ip, 'headers:', JSON.stringify(req.headers));
        next();
      });

      mainApp.listen(parseInt(port), () => {
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