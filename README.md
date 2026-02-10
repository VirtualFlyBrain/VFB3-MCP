# VFB3-MCP Server

A Model Context Protocol (MCP) server for interacting with VirtualFlyBrain (VFB) APIs. This server provides tools to query VFB data, run queries, and search for terms.

## 🚀 Quick Start

### Use the Live Service (Recommended)

The easiest way to use VFB3-MCP is through our hosted service at `https://vfb3-mcp.virtualflybrain.org`. This requires no installation or setup on your machine.

#### Claude Desktop Setup

1. **Open Claude Desktop** and go to Settings
2. **Navigate to the MCP section**
3. **Add a new MCP server** with these settings:
   - **Server Name**: `virtual-fly-brain` (or any name you prefer)
   - **Type**: HTTP
   - **Server URL**: `https://vfb3-mcp.virtualflybrain.org`

**Configuration JSON** (alternative method):
```json
{
  "mcpServers": {
    "virtual-fly-brain": {
      "type": "http",
      "url": "https://vfb3-mcp.virtualflybrain.org",
      "tools": ["*"]
    }
  }
}
```

#### Claude Code Setup

1. **Locate your Claude configuration file**:
   - **macOS/Linux**: `~/.claude.json`
   - **Windows**: `%USERPROFILE%\.claude.json`

2. **Add the VFB3-MCP server** to your configuration:
```json
{
  "mcpServers": {
    "virtual-fly-brain": {
      "type": "http",
      "url": "https://vfb3-mcp.virtualflybrain.org",
      "tools": ["*"]
    }
  }
}
```

3. **Restart Claude Code** for changes to take effect

#### GitHub Copilot Setup

1. **Open VS Code** with GitHub Copilot installed
2. **Open Settings** (`Ctrl/Cmd + ,`)
3. **Search for "MCP"** in the settings search
4. **Find the MCP Servers setting**
5. **Add the server URL**: `https://vfb3-mcp.virtualflybrain.org`
6. **Give it a name** like "Virtual Fly Brain"

**Alternative JSON configuration** (in `mcp.json`):
```json
{
  "servers": {
    "virtual-fly-brain": {
      "type": "http",
      "url": "https://vfb3-mcp.virtualflybrain.org"
    }
  }
}
```

#### Visual Studio Code (with MCP Extension)

1. **Install the MCP extension** for VS Code from the marketplace
2. **Open the Command Palette** (`Ctrl/Cmd + Shift + P`)
3. **Type "MCP: Add server"** and select it
4. **Choose "HTTP"** as the server type
5. **Enter the server details**:
   - **Name**: `virtual-fly-brain`
   - **URL**: `https://vfb3-mcp.virtualflybrain.org`
6. **Save and restart** VS Code if prompted

#### Other MCP Clients

For any MCP-compatible client that supports HTTP servers:

```json
{
  "mcpServers": {
    "virtual-fly-brain": {
      "type": "http",
      "url": "https://vfb3-mcp.virtualflybrain.org",
      "tools": ["*"]
    }
  }
}
```

#### Gemini Setup

To use the Virtual Fly Brain (VFB) Model Context Protocol (MCP) server with Google Gemini, you can connect through custom Python/Node.js clients that support MCP.

**Note**: Direct Gemini web interface integration with MCP is not currently supported. Developer tools are needed to connect the two.

**Option 1: Using Python**

For application development, use the `mcp` and `google-genai` libraries to connect.

Setup: `pip install google-genai mcp`

Implementation: Use an `SSEClientTransport` to connect to the VFB URL, list its tools, and pass their schemas to the Gemini model as Function Declarations.

#### Testing the Connection

Once configured, you can test that VFB3-MCP is working by asking your AI assistant questions like:

**Basic Queries:**
- "Get information about the neuron VFB_jrcv0i43"
- "Search for terms related to medulla in the fly brain"
- "What neurons are in the antennal lobe?"

**Advanced Queries:**
- "Find all neurons that connect to the mushroom body"
- "Show me expression patterns for gene repo"
- "What brain regions are involved in olfactory processing?"
- "Run a connectivity analysis for neuron VFB_00101567"

**Search Examples:**
- "Search for adult neurons in the visual system"
- "Find genes expressed in the central complex"
- "Show me all templates available in VFB"

If you see responses with VirtualFlyBrain data, including neuron names, brain regions, gene expressions, or connectivity information, the setup is successful!

For more detailed usage examples and API calls, see **[examples.md](examples.md)**.

### Example Workflow

1. **Search for a term**: "Search for neurons in the optic lobe"
2. **Get detailed info**: "Get information about VFB_00101567"
3. **Run specific queries**: "Show connectivity for VFB_00101567"
4. **Explore relationships**: "What neurons synapse in the mushroom body?"

## 🛠️ Local Installation

### Prerequisites

- Node.js 18 or higher
- npm or yarn

### Step-by-Step Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/Robbie1977/VFB3-MCP.git
   cd VFB3-MCP
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Build the project**:
   ```bash
   npm run build
   ```

4. **Start the server**:
   ```bash
   npm start
   ```

### Platform-Specific Setup

#### Claude Desktop (Local Development)

For local development with Claude Desktop, add this to your MCP configuration:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "vfb3-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/VFB3-MCP/dist/index.js"]
    }
  }
}
```

#### Claude Code

Add to your `claude.json` file:
```json
{
  "mcpServers": {
    "vfb3-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/VFB3-MCP/dist/index.js"]
    }
  }
}
```

#### Visual Studio Code

1. Install the MCP extension for VS Code
2. Press `Cmd + Shift + P` (macOS) or `Ctrl + Shift + P` (Windows/Linux)
3. Select **MCP: Add server…**
4. Choose **Command** type
5. Enter:
   - **Name**: `vfb3-mcp`
   - **Command**: `node`
   - **Arguments**: `/absolute/path/to/VFB3-MCP/dist/index.js`

#### GitHub Copilot

Configure the MCP server URL in your Copilot settings to point to your local server:
```
http://localhost:3000
```

For HTTP mode testing:
```bash
MCP_MODE=http PORT=3000 node dist/index.js
```

### Docker Installation

**Using Docker Compose** (Recommended):
```bash
docker-compose up --build
```

**Manual Docker Build**:
```bash
# Build the image
docker build -t vfb3-mcp .

# Run the container
docker run -p 3000:3000 vfb3-mcp
```

**Pull Pre-built Image**:
```bash
docker pull virtualflybrain/vfb3-mcp:latest
docker run -p 3000:3000 virtualflybrain/vfb3-mcp:latest
```

##  Available Tools

### get_term_info
Retrieve detailed information about VFB terms using their IDs.

**Parameters:**
- `id` (string): VFB ID (e.g., "VFB_jrcv0i43")

### run_query
Execute predefined queries on VFB data.

**Parameters:**
- `id` (string): VFB ID (e.g., "VFB_00101567")
- `query_type` (string): Type of query (e.g., "PaintedDomains")

### search_terms
Search for VFB terms using the Solr search server with optional filtering and result control.

**Parameters:**
- `query` (string): Search query (e.g., "medulla")
- `filter_types` (array, optional): Filter results to only include items matching ALL of these facets_annotation types (AND logic)
- `exclude_types` (array, optional): Exclude results matching ANY of these facets_annotation types (OR logic)
- `boost_types` (array, optional): Boost ranking of results matching these facets_annotation types without excluding others
- `start` (number, optional): Pagination start index (default 0) - use to get results beyond the first page
- `rows` (number, optional): Number of results to return (default 150, max 1000) - use smaller numbers for focused searches
- `minimize_results` (boolean, optional): When true, limit results to top 10 for initial searches and add truncation metadata (default false)
- `auto_fetch_term_info` (boolean, optional): When true and an exact match is found, automatically fetch and include term info in the response (default false)

## 🧠 About VirtualFlyBrain

VirtualFlyBrain (VFB) is a comprehensive knowledge base about *Drosophila melanogaster* neurobiology, providing 3D images, gene expression data, neural connectivity information, and standardized terminology for fly brain research.

## 📖 Documentation

- **[LLM Guidance](LLM_GUIDANCE.md)**: Guide for AI assistants on using this MCP effectively
- **[Examples](examples.md)**: Usage examples and integration guides
- **[Technical Documentation](TECHNICAL.md)**: Infrastructure, deployment, and development details

## 📄 License

MIT