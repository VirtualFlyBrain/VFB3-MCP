# VFB3-MCP Server

A Model Context Protocol (MCP) server for interacting with VirtualFlyBrain (VFB) APIs. This server provides tools to query VFB data, run queries, and search for terms. In HTTP mode it runs statelessly (no session tracking), so any replica can handle any request and standard load balancing works.

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

Implementation: Use a streamable HTTP transport in JSON response mode (e.g. `enableJsonResponse: true`) to connect to the VFB URL, list its tools, and pass their schemas to the Gemini model as Function Declarations.

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

## 🛠️ Available Tools

The MCP server exposes the following tools (available to assistants like Claude and Copilot):

- `get_term_info` — Get detailed metadata for a VFB ID
- `run_query` — Run a precomputed analysis query for a VFB ID (see the `Queries` field from `get_term_info`)
- `search_terms` — Search VFB entities by text with filtering / boosting options. This is the same search virtualflybrain.org itself runs
- `list_search_facets` — List the `facets_annotation` type names that `search_terms`' `filter_types` / `exclude_types` / `boost_types` / `demote_types` accept, optionally filtered by substring
- `resolve_entity` — Resolve an unresolved FlyBase-related query string (e.g., `P{VT054895-GAL4.DBD}` or a driver line / cell type label) to VFB/FlyBase IDs and metadata (not the same as VFB term search)
- `resolve_combination` — Resolve an unresolved split-GAL4 combination name or synonym into its component IDs
- `list_connectome_datasets` — List available connectome datasets (e.g., Hemibrain, FAFB)
- `query_connectivity` — Query connectivity across connectome datasets using upstream/downstream filters, returned as a strongest-first page plus a summary computed over every connection found
- `get_hierarchy` — Traverse the ontology hierarchy for a VFB ID: `part_of` (region/tissue structure) and/or `subclass_of` (cell-type taxonomy), ancestors and/or descendants

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
- `id` (string or array): One or more VFB IDs (e.g., "VFB_00101567")
- `query_type` (string): Query type from the entity's `Queries` array (e.g., "PaintedDomains")
- `queries` (array, optional): `{id, query_type}` pairs for mixed batch queries
- `limit` (number, optional): Max rows per call (default 25). The true total is always returned as `count`; use 0 for all rows (still capped ~25000)
- `offset` (number, optional): Row offset for paging (default 0); re-run with `offset += limit` for the next page
- `include_images` (boolean, optional): Include the `thumbnail` column (default false — it is stripped to save space, and the response `_note` says how to re-add it)

FlyBase stocks and split-GAL4 combination publications are run_query query_types too: `FindStocks` and `FindComboPublications`.

### search_terms
Search for VFB terms. This calls VFBquery's `/search`, which is the search virtualflybrain.org itself runs — the same Solr query, the same filters and boosts, the same final sort — so a result here is the result a user would see on the site. Deprecated terms are already excluded server-side; there is no need to ask for that.

**Parameters:**
- `query` (string): Search query (e.g., "medulla")
- `filter_types` (array, optional): Keep only results matching ALL of these facets_annotation types (AND logic)
- `exclude_types` (array, optional): Drop results matching ANY of these facets_annotation types (OR logic)
- `boost_types` (array, optional): Lift results matching these types up the ranking without excluding others
- `demote_types` (array, optional): Sink results matching these types to the bottom of the ranking without excluding them. Ignored for a type that also appears in `boost_types`
- `unique` (boolean, optional): One row per term (default true). Set false for one row per matching synonym, which shows *which* name matched at the cost of repeating IDs
- `start` (number, optional): Page start index (default 0)
- `rows` (number, optional): Rows to return (default 150, max 1000)
- `minimize_results` (boolean, optional): Return only the top 10 with reduced fields, for a first look (default false)
- `auto_fetch_term_info` (boolean, optional): When the query matches one term's name exactly, also fetch that term's info (default false)

Type names come from the live vocabulary — there are over 200 of them and they change as data is added, so call `list_search_facets` rather than guessing. The response reports `returned` (rows given), `total` (length of the ranked list), `distinct_terms` and `solr_matches` (terms Solr matched before ranking) separately, so a truncated page never looks like a small result set.

### list_search_facets
List the valid `facets_annotation` type names for the four type filters above, read from the live vocabulary.

**Parameters:**
- `contains` (string, optional): Case- and separator-insensitive substring filter (e.g., "neuron", "nervous system")

If the deployed VFBquery predates the `/facets` endpoint, this falls back to a snapshot bundled with the server and says so — names absent from a snapshot result may still be valid.

### query_connectivity
Query synaptic connectivity between neuron classes across all connectome datasets. At least one of `upstream_type` or `downstream_type` is required. Results are ranked strongest-first and paged: you get `limit` rows plus a `summary` computed over **every** connection found — weight min/max/total/mean, per-dataset counts, distinct neuron counts, and the top class pairs — so the totals stay true even though the rows are truncated. A broad query can find tens of thousands of connections, which is why paging is on by default.

**Parameters:**
- `upstream_type` / `downstream_type` (string, optional): Neuron class OWL ID or label. Anatomical regions are not accepted
- `weight` (number, optional): Minimum synapse count (recommended 5; use ≥50 when both ends are specified)
- `group_by_class` (boolean, optional): Aggregate to class pairs instead of neuron pairs — usually the better first call on a broad query
- `exclude_dbs` (array, optional): Dataset symbols to exclude (recommended `["hb","fafb"]`); see `list_connectome_datasets`
- `limit` (number, optional): Rows to return, strongest first (default 50; `0` for all)
- `offset` (number, optional): Row to start from within the ranking (default 0)

## 🧠 About VirtualFlyBrain

VirtualFlyBrain (VFB) is a comprehensive knowledge base about *Drosophila melanogaster* neurobiology, providing 3D images, gene expression data, neural connectivity information, and standardized terminology for fly brain research.

## 📖 Documentation

- **[LLM Guidance](LLM_GUIDANCE.md)**: Guide for AI assistants on using this MCP effectively
- **[Examples](examples.md)**: Usage examples and integration guides
- **[Technical Documentation](TECHNICAL.md)**: Infrastructure, deployment, and development details

## 📄 License

MIT
