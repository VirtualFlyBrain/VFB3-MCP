# VFB3-MCP Examples

This file contains examples of how to use the VFB3-MCP server tools.

## Tool Examples

### 1. Get Term Info
```json
{
  "method": "tools/call",
  "params": {
    "name": "get_term_info",
    "arguments": {
      "id": "VFB_jrcv0i43"
    }
  }
}
```

### 2. Run Query
```json
{
  "method": "tools/call",
  "params": {
    "name": "run_query",
    "arguments": {
      "id": "VFB_00101567",
      "query_type": "PaintedDomains"
    }
  }
}
```

### 3. Search Terms
```json
{
  "method": "tools/call",
  "params": {
    "name": "search_terms",
    "arguments": {
      "query": "medulla"
    }
  }
}
```

### 4. Search Terms with Filtering
```json
{
  "method": "tools/call",
  "params": {
    "name": "search_terms",
    "arguments": {
      "query": "medulla",
      "filter_types": ["neuron", "adult"],
      "exclude_types": ["deprecated"]
    }
  }
}
```

### 5. Search Terms with Minimization
```json
{
  "method": "tools/call",
  "params": {
    "name": "search_terms",
    "arguments": {
      "query": "medulla",
      "minimize_results": true,
      "rows": 20
    }
  }
}
```

### 6. Search Terms with Auto Term Info
```json
{
  "method": "tools/call",
  "params": {
    "name": "search_terms",
    "arguments": {
      "query": "antennal lobe",
      "auto_fetch_term_info": true
    }
  }
}
```

### 7. Resolve an Entity Name
```json
{
  "method": "tools/call",
  "params": {
    "name": "resolve_entity",
    "arguments": {
      "name": "Hb9-GAL4"
    }
  }
}
```

### 8. Find Stocks for a Feature ID
```json
{
  "method": "tools/call",
  "params": {
    "name": "find_stocks",
    "arguments": {
      "feature_id": "FBst123456",
      "collection_filter": "Bloomington"
    }
  }
}
```

### 9. Resolve a Split-GAL4 Combination
```json
{
  "method": "tools/call",
  "params": {
    "name": "resolve_combination",
    "arguments": {
      "name": "SS04495" 
    }
  }
}
```

### 10. Find Publications for a Split-GAL4 Combination
```json
{
  "method": "tools/call",
  "params": {
    "name": "find_combo_publications",
    "arguments": {
      "fbco_id": "FBco_0001234"
    }
  }
}
```

### 11. List Connectome Datasets
```json
{
  "method": "tools/call",
  "params": {
    "name": "list_connectome_datasets",
    "arguments": {}
  }
}
```

### 12. Query Connectivity
```json
{
  "method": "tools/call",
  "params": {
    "name": "query_connectivity",
    "arguments": {
      "upstream_type": "FBbt_00000001",
      "downstream_type": "FBbt_00000002",
      "weight": 5,
      "group_by_class": true,
      "exclude_dbs": ["hemibrain"]
    }
  }
}
```

## Integration with MCP Clients

### Claude Desktop
Add to your MCP server configuration:
```json
{
  "mcpServers": {
    "vfb3-mcp": {
      "type": "http",
      "url": "https://vfb3-mcp.virtualflybrain.org",
      "tools": ["*"]
    }
  }
}
```

### Claude Code
Add to your `claude.json`:
```json
{
  "mcpServers": {
    "vfb3-mcp": {
      "type": "http",
      "url": "https://vfb3-mcp.virtualflybrain.org",
      "tools": ["*"]
    }
  }
}
```

### GitHub Copilot
Configure the MCP server URL in your Copilot settings pointing to `https://vfb3-mcp.virtualflybrain.org`.

### Gemini

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

Implementation: Use a streamable HTTP transport in JSON response mode (e.g. `enableJsonResponse: true`) to connect to the VFB URL, list its tools, and pass their schemas to the Gemini model as Function Declarations.

## Docker Usage
```bash
# Build and run
docker-compose up --build

# Or manually
docker build -t vfb3-mcp .
docker run -it vfb3-mcp
```