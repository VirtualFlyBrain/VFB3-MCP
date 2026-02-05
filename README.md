# VFB3-MCP Server

A Model Context Protocol (MCP) server for interacting with VirtualFlyBrain (VFB) APIs. This server provides tools to query VFB data, run queries, and search for terms.

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

### Running Locally

Start the MCP server:
```bash
npm start
```

### Using with Claude Code

Add the server to your Claude Code configuration. In your `claude.json` or MCP configuration:

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

### Using with GitHub Copilot

Configure the MCP server in your GitHub Copilot settings to point to the built server.

## Docker

### Build and Run with Docker

```bash
docker-compose up --build
```

### Build Docker Image

```bash
docker build -t vfb3-mcp .
```

### Run Docker Container

```bash
docker run -it vfb3-mcp
```

### Docker Hub

Pre-built images are available on Docker Hub:

```bash
docker pull virtualflybrain/vfb3-mcp:latest
```

## CI/CD

This project uses GitHub Actions for automated building and deployment:

- **Automated Builds**: Docker images are built on every push to any branch
- **Docker Hub Publishing**: Images are automatically published to `virtualflybrain/vfb3-mcp`
- **Branch Tagging**: Images are tagged with the branch name (e.g., `main`, `feature-branch`)

### Required Secrets

To enable Docker Hub publishing, set these repository secrets:
- `DOCKER_HUB_USER`: Your Docker Hub username
- `DOCKER_HUB_PASSWORD`: Your Docker Hub password or access token

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