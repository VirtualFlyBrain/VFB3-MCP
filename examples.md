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
      "boost_types": ["has_image"]
    }
  }
}
```

Deprecated terms are already excluded server-side, so there is no need to list them in
`exclude_types`. Get valid type names from `list_search_facets` rather than guessing.

### 4b. List Valid Facet Type Names
```json
{
  "method": "tools/call",
  "params": {
    "name": "list_search_facets",
    "arguments": {
      "contains": "neuron"
    }
  }
}
```

### 4c. One Row Per Matching Synonym
```json
{
  "method": "tools/call",
  "params": {
    "name": "search_terms",
    "arguments": {
      "query": "Kenyon cell",
      "unique": false
    }
  }
}
```

Useful when you need to know *which* name matched. The same `short_form` will repeat
across rows; the default `unique: true` gives one row per term instead.

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
      "name": "P{VT054895-GAL4.DBD}"
    }
  }
}
```

### 8. Find Stocks for a Feature ID
```json
{
  "method": "tools/call",
  "params": {
    "name": "run_query",
    "arguments": {
      "id": "FBst123456",
      "query_type": "FindStocks"
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
    "name": "run_query",
    "arguments": {
      "id": "FBco_0001234",
      "query_type": "FindComboPublications"
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
      "upstream_type": "FBbt_00003789",
      "downstream_type": "FBbt_00047727",
      "weight": 5,
      "group_by_class": true,
      "exclude_dbs": ["hb", "fafb"]
    }
  }
}
```

Tm1 → T3 across every connectome dataset except Hemibrain and FAFB. At least one of
`upstream_type` / `downstream_type` is required, and `exclude_dbs` takes dataset
*symbols* (`hb`, `fafb`) — see `list_connectome_datasets` for the valid set.

Results come back as a strongest-first page plus a `summary` computed over every
connection found, so `count` is the true total and `returned` is only what you were
given. Broad queries find tens of thousands of connections.

### 12b. Paging Through Connectivity Results
```json
{
  "method": "tools/call",
  "params": {
    "name": "query_connectivity",
    "arguments": {
      "upstream_type": "FBbt_00003789",
      "weight": 50,
      "limit": 25,
      "offset": 25
    }
  }
}
```

Rows 25–50 of the strongest-first ranking. The `summary` is identical on every page
because it always covers the full result set — answer from it rather than from the rows.

### 13. Get Ontology Hierarchy

Traverse `part_of` (region structure) or `subclass_of` (cell-type taxonomy) for a VFB term. `relationship` is required; `direction` defaults to `both` and `max_depth` to `1`.

```json
{
  "name": "get_hierarchy",
  "arguments": {
    "id": "FBbt_00005801",
    "relationship": "part_of",
    "direction": "descendants",
    "max_depth": 1
  }
}
```

Returns the direct parts of the mushroom body (`FBbt_00005801`). Use `relationship: "subclass_of"` for cell-type taxonomies (e.g. `FBbt_00003686`, Kenyon cell), and increase `max_depth` to expand deeper.

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
