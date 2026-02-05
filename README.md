# VFB3-MCP Server

A Model Context Protocol (MCP) server for interacting with VirtualFlyBrain (VFB) APIs. This server provides tools to query VFB data, run queries, and search for terms.

## 🚀 Live Service

**Production Endpoint**: `https://vfb3-mcp.virtualflybrain.org/mcp`

The VFB3-MCP service is running live on VFB's Rancher/Cattle infrastructure with HTTPS support and automatic SSL certificate management.

### Quick Start for MCP Clients

For Claude Desktop:

```json
{
  "mcpServers": {
    "vfb3-mcp": {
      "url": "https://vfb3-mcp.virtualflybrain.org/mcp"
    }
  }
}
```

## Features

- **get_term_info**: Retrieve detailed information about VFB terms using their IDs
- **run_query**: Execute predefined queries on VFB data
- **search_terms**: Search for VFB terms using the Solr search server with autocomplete functionality

## About VirtualFlyBrain

VirtualFlyBrain (VFB) is a comprehensive knowledge base about *Drosophila melanogaster* neurobiology, integrating:

- **Neuroanatomical data**: 3D images and models of fly brain structures
- **Gene expression data**: Spatial patterns of gene activity in the brain
- **Neural connectivity**: Wiring diagrams and circuit information
- **Standardized terminology**: Controlled vocabularies for brain regions and cell types
- **High-resolution imaging**: Microscopy data from multiple sources
- **Pre-computed analyses**: Similarity searches, expression domains, and connectivity queries

VFB enables researchers to explore the complete fly brain at single-neuron resolution, making it an essential resource for neuroscience research, particularly for understanding neural circuits, gene function, and brain evolution.

## Prerequisites

- Node.js 18 or higher
- npm or yarn

## Installation

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

## Usage

### Production Service

The recommended way to use VFB3-MCP is through the live production service:

**Endpoint**: `https://vfb3-mcp.virtualflybrain.org/mcp`

#### MCP Client Configuration

**For Claude Desktop** - Add to your MCP server configuration:
```json
{
  "mcpServers": {
    "vfb3-mcp": {
      "url": "https://vfb3-mcp.virtualflybrain.org/mcp"
    }
  }
}
```

**For Claude Code** - Add to your `claude.json`:
```json
{
  "mcpServers": {
    "vfb3-mcp": {
      "url": "https://vfb3-mcp.virtualflybrain.org/mcp"
    }
  }
}
```

**For GitHub Copilot** - Configure the MCP server URL in your Copilot settings to point to `https://vfb3-mcp.virtualflybrain.org/mcp`.

### Local Development

For development or testing, you can run the server locally:

### HTTP Server Mode

The production service runs in HTTP mode using the MCP SDK's Express transport with Server-Sent Events (SSE) for bidirectional communication.

**Production Details**:
- **Protocol**: HTTPS with automatic SSL certificates
- **Transport**: Server-Sent Events (SSE) for real-time communication
- **Authentication**: Open server (no authentication required) - OAuth endpoints return 404
- **Infrastructure**: Kubernetes deployment on VFB Rancher/Cattle
- **MCP Endpoint**: `/mcp` (mounted at root level for compatibility)

### Local Development

For development or testing, you can run the server locally in stdio mode:

Start the MCP server:
```bash
npm start
```

For Claude Desktop local development:
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

For HTTP mode locally:
```bash
# Run in HTTP mode
MCP_MODE=http PORT=3000 node dist/index.js
```

The HTTP server will be available at `http://localhost:3000` with MCP endpoint at `/mcp`.

## Docker

### Production Deployment

The live service at `https://vfb3-mcp.virtualflybrain.org/mcp` runs these Docker images on Kubernetes.

### Build and Run Locally

```bash
docker-compose up --build
```

### Build Docker Image

```bash
docker build -t vfb3-mcp .
```

The Dockerfile automatically builds the TypeScript source code during the container build process, so no separate compilation step is needed.

### Production Deployment

The VFB3-MCP service is currently deployed and running at:

**Live Endpoint**: `https://vfb3-mcp.virtualflybrain.org/mcp`

This production deployment runs in HTTP mode on the VFB Rancher/Cattle infrastructure with:
- Kubernetes orchestration
- Automatic SSL certificate management
- Load balancing and high availability
- Resource limits and security hardening
- MCP endpoint mounted at `/mcp` for Claude Desktop compatibility

### Docker Hub

Pre-built images are available on Docker Hub:

```bash
docker pull virtualflybrain/vfb3-mcp:latest
```

Images are built for multiple architectures (AMD64 and ARM64) and are automatically tagged based on the branch/PR that triggered the build.

**Production Deployment**: The live service at `https://vfb3-mcp.virtualflybrain.org/mcp` uses these published Docker images deployed via Kubernetes on the VFB Rancher/Cattle infrastructure.

## CI/CD

This project uses GitHub Actions for automated building and deployment of the Docker images that power the production service at `https://vfb3-mcp.virtualflybrain.org/mcp`.

- **Automated Builds**: Docker images are built on every push to any branch
- **TypeScript Compilation**: Source code is compiled during the Docker build process
- **Docker Hub Publishing**: Images are automatically published to `virtualflybrain/vfb3-mcp`
- **Smart Tagging**: 
  - Branch names for development builds
  - Pull request numbers for PR builds
  - `latest` tag for main branch builds
- **Build Caching**: Faster builds using GitHub Actions cache
- **Modern Actions**: Uses latest Docker GitHub Actions for reliability

### Workflow Configuration

The CI/CD pipeline is defined in `.github/workflows/docker.yml` and includes:

- **Buildx Setup**: Multi-platform build support
- **Multi-Architecture**: Builds for both AMD64 and ARM64 platforms
- **Security**: Proper Docker Hub authentication
- **Caching**: Layer caching for faster builds
- **Metadata**: Automatic tagging based on branch/PR context

### Testing Locally

Before pushing, you can test the Docker build locally:

```bash
# Build the image
docker build -t vfb3-mcp .

# Test the container
docker run -it vfb3-mcp
```

## API Tools

### get_term_info

Retrieves term information from VFB.

**Parameters:**
- `id` (string): VFB ID (e.g., "VFB_jrcv0i43")

**Example:**
```json
{
  "id": "VFB_jrcv0i43"
}
```

### run_query

Runs a query on VFB data.

**Parameters:**
- `id` (string): VFB ID (e.g., "VFB_00101567")
- `query_type` (string): Type of query (e.g., "PaintedDomains")

**Example:**
```json
{
  "id": "VFB_00101567",
  "query_type": "PaintedDomains"
}
```

### search_terms

Searches for VFB terms using the Solr search server.

**Parameters:**
- `query` (string): Search query (e.g., "medulla")

**Example:**
```json
{
  "query": "medulla"
}
```

## Development

### Development Mode

Run in development mode with auto-rebuild:
```bash
npm run dev
```

### Project Structure

```
VFB3-MCP/
├── src/
│   └── index.ts          # Main server implementation
├── dist/                 # Compiled JavaScript
├── Dockerfile            # Docker configuration
├── docker-compose.yml    # Docker Compose setup
├── k8s-deployment.yml    # Kubernetes deployment for Rancher/Cattle
├── package.json          # Node.js dependencies
├── tsconfig.json         # TypeScript configuration
└── README.md             # This file
```

## VFB API Endpoints

This server interacts with the following VFB APIs:

- Term Info: `https://v3-cached.virtualflybrain.org/get_term_info`
- Run Query: `https://v3-cached.virtualflybrain.org/run_query`
- Solr Search: `https://solr.virtualflybrain.org/solr/ontology/select`

## License

ISC

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## Documentation

- **[LLM Guidance](LLM_GUIDANCE.md)**: Comprehensive guide for AI assistants on when to use this MCP and how to interpret VFB data
- **[Examples](examples.md)**: Usage examples and integration guides