# Technical Documentation

This document contains technical details about the VFB3-MCP server infrastructure, deployment, development setup, and internal workings.

## Architecture

### Server Modes

The VFB3-MCP server supports two operational modes:

#### Stdio Mode (Development/Local)
- Direct stdin/stdout communication
- Used for local development and testing
- Compatible with Claude Desktop local MCP configuration

#### HTTP Mode (Production)
- Express.js server with Server-Sent Events (SSE) for bidirectional communication
- RESTful endpoints for MCP protocol
- OAuth 2.0 metadata endpoints (returns 404 - no authentication required)
- CORS enabled for web client access

### MCP Protocol Implementation

- Built using the official `@modelcontextprotocol/sdk`
- Express transport for HTTP mode with SSE
- Stdio transport for local development
- Session management with UUID-based session IDs

## Infrastructure

### Production Deployment

**Live Endpoint**: `https://vfb3-mcp.virtualflybrain.org`

The production deployment runs on VFB's Rancher/Cattle Kubernetes infrastructure with:

- **Protocol**: HTTPS with automatic SSL certificate management
- **Transport**: Server-Sent Events (SSE) for real-time bidirectional communication
- **Authentication**: Open server (no authentication required)
- **Load Balancing**: Kubernetes service with automatic scaling
- **Resource Limits**: 512Mi memory, 500m CPU
- **Security**: Non-root user (UID 1000), read-only filesystem
- **MCP Endpoint**: `/` (root path)

### Docker

#### Multi-Architecture Images
- **AMD64** and **ARM64** support
- Published to Docker Hub: `virtualflybrain/vfb3-mcp`
- TypeScript compilation during build process

#### Local Development with Docker

```bash
# Build and run with Docker Compose
docker-compose up --build

# Build image manually
docker build -t vfb3-mcp .

# Pull pre-built image
docker pull virtualflybrain/vfb3-mcp:latest
```

### Kubernetes Deployment

The production service uses `k8s-deployment.yml` for Rancher/Cattle deployment:

- **Namespace**: VFB infrastructure
- **Resource Limits**: Memory and CPU constraints
- **Health Checks**: Readiness and liveness probes
- **Security Context**: Non-root execution
- **ConfigMaps**: Environment variable management

## CI/CD Pipeline

### GitHub Actions Workflow

Located in `.github/workflows/docker.yml`:

- **Triggers**: Push to any branch, pull requests
- **Buildx Setup**: Multi-platform Docker builds
- **Smart Tagging**:
  - Branch names for development
  - PR numbers for pull requests
  - `latest` for main branch
- **Caching**: Layer caching for faster builds
- **Security**: Docker Hub authentication via secrets

### Build Process

1. TypeScript compilation during Docker build
2. Multi-architecture image creation
3. Automated publishing to Docker Hub
4. Kubernetes deployment triggers (manual/auto)

### Development Setup

#### Prerequisites
- Node.js 18 or higher
- npm or yarn

#### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/Robbie1977/VFB3-MCP.git
   cd VFB3-MCP
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the project:
   ```bash
   npm run build
   ```

4. Start the server:
   ```bash
   npm start
   ```

### Development Commands

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Start production server
npm start

# Development mode with auto-rebuild
npm run dev

# HTTP mode for testing
MCP_MODE=http PORT=3000 node dist/index.js
```

### Local Testing

#### Stdio Mode
```json
{
  "mcpServers": {
    "vfb3-mcp": {
      "command": "node",
      "args": ["/path/to/VFB3-MCP/dist/index.js"]
    }
  }
}
```

#### HTTP Mode
```bash
# Start server
MCP_MODE=http PORT=3000 node dist/index.js

# Server available at http://localhost:3000
```

## API Integration

### VFB API Endpoints

The server integrates with VirtualFlyBrain APIs:

- **Term Info API**: `https://v3-cached.virtualflybrain.org/get_term_info`
- **Query API**: `https://v3-cached.virtualflybrain.org/run_query`
- **Solr Search API**: `https://solr.virtualflybrain.org/solr/ontology/select`

### MCP Tools Implementation

#### get_term_info
- **Input**: VFB ID string
- **Output**: Term metadata, classifications, images, publications
- **API Call**: POST to term info endpoint

#### run_query
- **Input**: VFB ID and query type
- **Output**: Tabular data with headers, rows, thumbnails
- **API Call**: POST to query endpoint

#### search_terms
- **Input**: Search query with optional filters
- **Output**: Search results with metadata
- **API Call**: GET to Solr search endpoint

### Error Handling

- Axios HTTP client with timeout configuration
- Graceful fallback for API unavailability
- Structured error responses following MCP protocol
- Logging for debugging and monitoring

## Client Integration Examples

### Gemini Setup

To use the Virtual Fly Brain (VFB) Model Context Protocol (MCP) server with AI on Google Search, connect through the Gemini CLI or a custom Python/Node.js client. 

The Gemini web interface does not directly support custom MCP integration. Developer tools are needed to connect the two. 

**Option 1: Using Gemini CLI**

The Gemini CLI allows direct registration of remote MCP servers. 

Install the CLI: Ensure Node.js is installed, then run:
```bash
npm install -g @google/gemini-cli
```

Add the VFB Server: Use the add command with the VFB URL.
```bash
gemini mcp add vfb https://vfb3-mcp.virtualflybrain.org
```

Verify & Use: Run the CLI by typing `gemini`. Check the connection with `/mcp`. AI on Google Search will then call VFB's neuroanatomy and connectivity tools when questions about Drosophila are asked. 

**Option 2: Using Python**

For application development, use the `mcp` and `google-genai` libraries to connect. 

Setup: `pip install google-genai mcp`

Implementation: Use an `SSEClientTransport` to connect to the VFB URL, list its tools, and pass their schemas to the Gemini model as Function Declarations.

## Security

### Production Security Measures

- **HTTPS Only**: Automatic SSL certificate management
- **No Authentication**: Open access design (VFB data is public)
- **CORS Configuration**: Controlled cross-origin access
- **Resource Limits**: Memory and CPU constraints
- **Non-root Execution**: Security hardening in containers
- **Read-only Filesystem**: Immutable container design

### OAuth Implementation

While the server includes OAuth metadata endpoints for MCP SDK compatibility, authentication is not required:

- OAuth endpoints return 404 (Not Found)
- No token validation or user authentication
- Open access to VFB public data

## Monitoring and Logging

### Application Logging

- **Console Output**: Structured logging to stdout/stderr
- **Debug Mode**: Verbose logging with `MCP_DEBUG=true`
- **Error Handling**: Comprehensive error logging with context
- **Request Tracking**: Session and request ID logging

### Infrastructure Monitoring

- **Kubernetes Probes**: Readiness and liveness checks
- **Resource Monitoring**: Memory and CPU usage tracking
- **Log Aggregation**: Container logs collected by Rancher/Cattle
- **Health Endpoints**: Basic health check responses

## Performance

### Optimization Strategies

- **API Caching**: VFB provides cached endpoints for performance
- **Connection Pooling**: Axios configuration for efficient HTTP requests
- **Memory Management**: Node.js memory limits and garbage collection
- **Concurrent Requests**: Support for multiple simultaneous MCP sessions

### Scalability

- **Horizontal Scaling**: Kubernetes deployment supports multiple replicas
- **Load Balancing**: Automatic distribution of requests
- **Resource Scaling**: CPU/memory-based autoscaling capabilities
- **Stateless Design**: No session persistence requirements

## Troubleshooting

### Common Issues

#### Build Failures
- Ensure Node.js 18+ is installed
- Check TypeScript compilation errors
- Verify Docker build context

#### Runtime Errors
- Check VFB API availability
- Verify network connectivity
- Review environment variables

#### MCP Client Issues
- Confirm correct endpoint URL
- Check JSON configuration syntax
- Verify MCP client compatibility

### Debug Mode

Enable verbose logging:
```bash
DEBUG=* npm start
# or
MCP_DEBUG=true npm start
```

## Contributing

### Development Workflow

1. Fork the repository
2. Create a feature branch from `main`
3. Make changes with tests
4. Ensure TypeScript compilation
5. Test with Docker locally
6. Submit pull request

### Code Standards

- **TypeScript**: Strict mode enabled
- **ESLint**: Code linting (if configured)
- **Prettier**: Code formatting (if configured)
- **Testing**: Unit tests for critical functions

## License

MIT License - See main README for details.