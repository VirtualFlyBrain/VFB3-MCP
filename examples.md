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
      "downstream_type": "FBbt_00003730",
      "weight": 5,
      "group_by_class": true,
      "exclude_dbs": ["mc"]
    }
  }
}
```

Tm1 → T3 across every connectome dataset except male-CNS: 11,916 connections
unfiltered, 7,309 with `mc` excluded. At least one of `upstream_type` /
`downstream_type` is required.

`exclude_dbs` takes dataset **symbols**, and an unrecognised symbol is silently
ignored rather than reported — `exclude_dbs: ["male-cns"]` or `["hemibrain"]` excludes
nothing and says nothing. Call `list_connectome_datasets` and use the `symbol` field:
`BANC`, `fw`, `ol`, `mv`, `hb`, `mc`, `fafb`, `l1em`.

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

### 14. Resolve an External Accession to a VFB Term

The user gives you a connectome bodyId. Do **not** put it through `search_terms` — a bare number ranks a plausible near-miss first.

```json
{
  "name": "lookup_xref",
  "arguments": {
    "accession": "1734350908"
  }
}
```

```json
{
  "query": "1734350908",
  "direction": "accession_to_id",
  "rows": [
    {
      "id": "VFB_jrchjtdb",
      "label": "DA1_lPN_R (FlyEM-HB:1734350908)",
      "db": "hb",
      "db_label": "Neuprint web interface - hemibrain:v1.2.1",
      "site_id": "neuprint_JRC_Hemibrain_1point2point1",
      "accession": "1734350908",
      "is_data_source": true,
      "link": "https://neuprint.janelia.org/results?dataset=hemibrain:v1.2.1&..."
    }
  ],
  "count": 1,
  "candidates_checked": 1
}
```

The row is returned only because that term's own cross-reference list was checked and really does carry `1734350908`. An empty `accession_to_id` result arrives with a `_note` saying it is "could not confirm", not "does not exist".

### 14b. List a Term's External Links

The other direction, optionally filtered to one site:

```json
{
  "name": "lookup_xref",
  "arguments": {
    "id": "VFB_jrchjtdb",
    "db": "neuprint"
  }
}
```

An empty result here *is* authoritative — the forward lookup reads the term's own cross-reference list — but under a `db` filter it means "none from this site". The response says which.

### 15. Combine Two Queries with Set Algebra

"Which neurons have a part in both the calyx and the lateral horn?" The two operands are 574 and 1661 rows; do not fetch both and intersect them by hand.

```json
{
  "name": "combine_queries",
  "arguments": {
    "expr": "calyx AND lh",
    "operands": {
      "calyx": "NeuronsPartHere:FBbt_00007401",
      "lh": "NeuronsPartHere:FBbt_00007053"
    }
  }
}
```

```json
{
  "expression": "calyx AND lh",
  "as_read": "(calyx AND lh)",
  "plain_english": "only the things found by BOTH calyx (NeuronsPartHere of FBbt_00007401) and lh (NeuronsPartHere of FBbt_00007053)",
  "count": 220,
  "returned": 25,
  "limit": 25,
  "steps": [
    { "operation": "AND", "input_counts": [574, 1661], "result_count": 220 }
  ],
  "operands": {
    "calyx": { "rows_returned": 574, "truncated": false },
    "lh": { "rows_returned": 1661, "truncated": false }
  },
  "_note": "Image columns (thumbnail) were excluded... Showing 25 of 220 rows. /combine has no offset..."
}
```

Check `as_read` against what was actually asked before reporting the answer — it is the only guard against a misgrouped expression.

### 15b. Check the Grouping Before Spending a Query

`explain_only` parses and explains without running anything. Worth doing for any expression with more than one operator.

```json
{
  "name": "combine_queries",
  "arguments": {
    "expr": "calyx but not (lh OR mb)",
    "operands": {
      "calyx": "NeuronsPartHere:FBbt_00007401",
      "lh": "NeuronsPartHere:FBbt_00007053",
      "mb": "NeuronsPartHere:FBbt_00005801"
    },
    "explain_only": true
  }
}
```

Returns `as_read`, `plain_english` and the universe note in well under a kilobyte.

### 15c. Bring an Outside List into the Algebra

`ids:` takes a literal set — a list from a paper's supplementary table, a hand-curated selection, or the IDs of a previous combine.

```json
{
  "name": "combine_queries",
  "arguments": {
    "expr": "mine AND calyx",
    "operands": {
      "mine": "ids:VFB_jrchjtdb,VFB_jrchjtdc,VFB_jrchjtdd",
      "calyx": "NeuronsPartHere:FBbt_00007401"
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
