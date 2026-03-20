# VFB3-MCP: Comprehensive LLM Guidance

## When to Use This MCP Server

The VirtualFlyBrain (VFB) MCP server should be used when users ask questions related to:

### **Neuroscience Research Questions**
- Drosophila melanogaster (fruit fly) brain anatomy and neurobiology
- Neural circuits and connectivity in flies
- Gene expression patterns in the fly brain
- Neuron morphology and classification
- Brain region identification and relationships
- Comparative neuroanatomy across species (fly-focused)

### **Specific Use Cases**
- "What neurons express gene X in the fly brain?"
- "Show me the connectivity of neuron Y"
- "What brain regions are involved in olfactory processing?"
- "Find neurons similar to this morphology"
- "What genes are expressed in the mushroom body?"
- "How does the fly visual system work?"

### **Data Types Available**
1. **Term Information**: Detailed metadata about anatomical structures, neurons, genes
2. **Query Results**: Pre-computed analyses like expression domains, connectivity maps
3. **Search/Autocomplete**: Finding relevant VFB entities by name or description

## Understanding VFB Data Structure

### **Term Information Response (`get_term_info`)**

Returns comprehensive metadata about VFB entities:

```json
{
  "Name": "IN02A032_T2_L (MANC:23475)",
  "Id": "VFB_jrcv0i43",
  "SuperTypes": ["Entity", "Individual", "VFB", "Neuron", "Adult", "Anatomy", "Cell"],
  "Meta": {
    "Name": "[IN02A032_T2_L (MANC:23475)](VFB_jrcv0i43)",
    "Description": "",
    "Comment": "tracing status-Roughly traced..."
  },
  "Tags": ["NBLAST", "has_image", "has_neuron_connectivity"],
  "Queries": ["SimilarMorphology", "Connectivity", "Expression"],
  "Images": {
    "VFB_00101567": [{"id": "VFB_jrcv0i43", "label": "IN02A032_T2_L (MANC:23475)", "thumbnail": "...", "nrrd": "...", "obj": "..."}]
  },
  "IsTemplate": false,
  "Publications": ["DOI:10.1101/2020.12.08.417884"],
  "Synonyms": ["IN02A032_T2_L", "MANC:23475"]
}
```

**Key Fields to Interpret:**
- **SuperTypes**: Classification hierarchy (Neuron, Anatomy, Cell, etc.)
- **Tags**: Special properties (has_image, has_neuron_connectivity, NBLAST)
- **Queries**: Available analyses for this entity
- **Images**: Dictionary keyed by template brain ID, containing image objects with IDs, thumbnails, and 3D data files
- **Publications**: Scientific references

### **Query Results Response (`run_query`)**

Returns tabular data from pre-computed analyses:

```json
{
  "headers": {
    "id": {"title": "ID", "type": "selection_id"},
    "name": {"title": "Domain", "type": "markdown"},
    "type": {"title": "Type", "type": "text"},
    "thumbnail": {"title": "Thumbnail", "type": "markdown"}
  },
  "rows": [
    {
      "id": "VFB_00102141",
      "name": "[AOTU on JRC2018Unisex adult brain](https://v2.virtualflybrain.org/...)",
      "type": "Expression_pattern",
      "thumbnail": "![thumbnail](https://v2.virtualflybrain.org/...)"
    }
  ],
  "count": 1,
  "label": "Painted Domains",
  "Tags": ["Expression", "Anatomy"]
}
```

**Interpretation:**
- **Headers**: Column definitions with display types
- **Rows**: Actual data with IDs, names, and thumbnails
- **Count**: Total number of results
- **Label**: Query type description

### **Search Results Response (`search_terms`)**

Returns entity search results from SOLR. Supports optional type-based filtering and result control:

- **`filter_types`**: Hard include — results must have ALL specified `facets_annotation` values (AND logic)
- **`exclude_types`**: Hard exclude — results must NOT have any of these types
- **`boost_types`**: Soft boost — results with these types rank higher without excluding others
- **`start`**: Pagination start index (default 0)
- **`rows`**: Number of results to return (default 150, max 1000)
- **`minimize_results`**: When true, limits results and adds truncation metadata for reduced context
- **`auto_fetch_term_info`**: When true and exact match found, includes term info in response

Available filter types are loaded dynamically from Solr at server startup, so the tool description always lists current values.

**Basic search:**
```json
{
  "query": "medulla"
}
```

**Filtered search (only adult neurons with images):**
```json
{
  "query": "medulla",
  "filter_types": ["neuron", "adult", "has_image"],
  "exclude_types": ["deprecated"]
}
```

**Minimized search with pagination:**
```json
{
  "query": "medulla",
  "minimize_results": true,
  "start": 0,
  "rows": 20
}
```

**Auto-fetch term info for exact matches:**
```json
{
  "query": "antennal lobe",
  "auto_fetch_term_info": true
}
```

**Response:**
```json
{
  "response": {
    "numFound": 1234,
    "docs": [
      {
        "short_form": "FBbt_00007484",
        "label": "antennal lobe",
        "synonym": ["antennal lobe"],
        "id": "http://purl.obolibrary.org/obo/FBbt_00007484",
        "facets_annotation": ["Adult", "Nervous_system"],
        "unique_facets": ["adult antennal lobe", "nervous system"]
      }
    ],
    "_truncation": {
      "truncated": true,
      "shown": 10,
      "totalAvailable": 1234,
      "canRequestMore": true
    }
  },
  "_term_info": {
    "Id": "FBbt_00007484",
    "Name": "antennal lobe",
    "Types": ["Class"],
    "Definition": "The antennal lobe..."
  }
}
```

**Key Fields:**
- **short_form**: VFB/FlyBase identifier
- **label**: Primary display name
- **facets_annotation**: Categorization tags (also used for filtering)
- **id**: Full ontology IRI
- **_truncation**: Metadata when `minimize_results=true` indicating if results were limited
- **_term_info**: Automatically fetched term details when `auto_fetch_term_info=true` and exact match found

## FlyBase Entity Resolution & Stocks Workflow

**When to use:** User asks about fly stocks, driver lines, GAL4 lines, alleles, insertions, or split-GAL4 combinations and wants to find available stocks or resolve names to IDs.

**Important:** `resolve_entity` queries FlyBase Chado — for VFB ontology lookups (anatomical terms, neuron class IDs) use `search_terms` and `get_term_info` instead.

### Workflow

1. **Parse input** — Identify whether the user provides a name, synonym, or FlyBase ID:
   - `FBgn\d+` → gene ID (direct to `find_stocks`)
   - `FBal\d+` → allele ID (direct to `find_stocks`)
   - `FBti\d+` → insertion ID (direct to `find_stocks`)
   - `FBco\d+` → combination ID (direct to `find_stocks`)
   - `FBst\d+` → stock ID (direct to `find_stocks`)
   - Any other string → resolve first with `resolve_entity`

2. **Resolve entity** — If user provides a name (not an ID), call `resolve_entity`. It uses tiered resolution:
   - Exact match on feature name
   - Synonym match (case-insensitive)
   - Broad pattern match (ILIKE)

3. **Confirm with user** — **Critical:**
   - If match was via **SYNONYM or BROAD**, show the resolved entity and ask user to confirm before proceeding. Example: *"Your search for 'CG9885' matched **dpp** (FBgn0000490, gene) via synonym. Shall I find stocks for this gene?"*
   - If **multiple matches**, show a disambiguation list (name, ID, type) and ask user to choose.
   - **Wait for user reply** — do NOT assume confirmation.

4. **Find stocks** — Call `find_stocks` with the resolved FlyBase feature ID. Include `collection_filter` if user specified a stock centre.

5. **Present results:**
   - Always start with a **query summary block**:
     ```
     Query:
     - Entity:      dpp (FBgn0000490, gene)
     - Search mode: gene → alleles → stocks
     - Collection:  (all)
     Results: 45 stocks across 12 alleles from 3 stock centres
     ```
   - **≤30 rows:** Show full table
   - **>30 rows:** Show total stock count, allele count, breakdown by stock collection, top 20 rows sorted by collection then allele, note that results are truncated
   - For every stock, include FlyBase link: `https://flybase.org/reports/{FBst_ID}`
   - Include entity report link: `https://flybase.org/reports/{feature_id}`

6. **Follow-up offers:**
   - "I can filter these to show only stocks from a specific centre (Bloomington, Kyoto, VDRC, etc.)"
   - "To see stocks for a specific allele, give me the allele symbol or ID"
   - "I can look up the full genotype for any stock listed"
   - "I can look up this entity in VFB for anatomical and expression data"

### ID Type Routing Reference

| ID prefix | Query strategy |
|-----------|---------------|
| FBgn (gene) | 4-path UNION: direct allele, allele→construct→insertion, allele→associated insertion, regulatory region |
| FBal (allele) | 3-path UNION: direct, construct, associated insertion |
| FBti (insertion) | Direct feature_genotype path |
| FBco (combination) | Resolve component alleles first, then allele paths for each |
| FBst (stock) | Direct stock lookup |

---

## Split-GAL4 Combination Publications Workflow

**When to use:** User asks about publications for a split-GAL4 combination, or asks "what papers describe [combination name]?"

### Workflow

1. **Parse input** — Accept FBco IDs (e.g., `FBco0000052`), full combination names, or common synonyms (e.g., "MB002B", "SS04495").

2. **Resolve combination** — If input is not an FBco ID, call `resolve_combination` first. Uses tiered resolution: exact name → synonym → broad pattern match.

3. **Confirm with user** — **Critical:**
   - If match was via **synonym**, show the resolved formal name and FBco ID, ask user to confirm. Example: *"Your search for 'MB002B' matched **Scer\GAL4[DBD.R14C08]∩Hsap\RELA[AD.R12C11]** (FBco0000052) via synonym. Shall I find publications for this combination?"*
   - If **multiple matches**, show disambiguation list and ask user to choose.
   - **Wait for user reply** — do NOT assume confirmation.

4. **Find publications** — Call `find_combo_publications` with the FBco ID.

5. **Present results:**
   - **Query summary block:**
     ```
     Query:
     - Combination: Scer\GAL4[DBD.R14C08]∩Hsap\RELA[AD.R12C11] (FBco0000052)
     - Synonym used: MB002B
     Results: 6 publications (2014–2022)
     ```
   - For each publication show:
     - **Title** with year
     - **Citation** (miniref)
     - **Links** (only where identifier exists):
       - FlyBase: `https://flybase.org/reports/{FBrf_ID}`
       - DOI: `https://doi.org/{DOI}`
       - PubMed: `https://pubmed.ncbi.nlm.nih.gov/{PMID}/`
   - Include FlyBase report link for the combination: `https://flybase.org/reports/{FBco_ID}`

6. **Follow-up offers:**
   - "I can fetch the full text of any of these papers via Europe PMC"
   - "I can look up detailed metadata (authors, abstract) for any publication"
   - "I can search for other combinations that share a component allele"
   - "I can look up stocks for this combination"

---

## Connectivity Query Workflow

**When to use:** User asks about synaptic connections between neuron types, upstream/downstream partners, or connectivity patterns.

**DO NOT USE for:**
- Individual neuron-to-neuron connections (use `run_query` with `NeuronNeuronConnectivityQuery` instead)
- Connections between muscles and neurons or sense organs and neurons

### Workflow

1. **Parse input** — Extract parameters using this inference table:

   | User says | Mode |
   |-----------|------|
   | "upstream of X", "inputs to X", "presynaptic to X" | set `downstream_type` = X |
   | "downstream of X", "outputs from X", "postsynaptic to X" | set `upstream_type` = X |
   | "between X and Y", "X to Y connections" | set both `upstream_type` = X, `downstream_type` = Y |
   | "all connections from X" | set `upstream_type` = X only |
   | "summarise by class", "aggregated" | set `group_by_class` = true |

   **Defaults:** `weight` = 5, `exclude_dbs` = ["hb", "fafb"] (unless user specifies otherwise)

2. **Confirm parameters** — Unless user explicitly specified all parameters, show planned query and ask to confirm:
   ```
   I'll query connectivity with these parameters:
   - Upstream type:   transmedullary neuron Tm1
   - Downstream type: (any)
   - Min. weight:     5
   - Excluded DBs:    hb, fafb
   - Group by class:  No
   Shall I proceed, or would you like to change any of these?
   ```

3. **Validate neuron type names** — Use `search_terms` with `filter_types: ["neuron", "class"]` to validate/canonicalize labels. Skip if label is already clearly canonical (e.g., "GABAergic neuron"). If ambiguous or multiple candidates, show disambiguation list and ask user.

   > **Tip:** If user asks about a brain region (e.g., "What connects to the lobula?"), first find neuron classes in that region using `search_terms`, then query connectivity for those specific classes.

   > **Tip:** If you have a VFB neuron ID (e.g., `VFB_...`), run `get_term_info` on it and look for the `FBbt_...` class identifier; use that as `upstream_type`/`downstream_type`.

4. **Execute query** — Call `query_connectivity` with confirmed parameters.

5. **Handle results:**

   **Per-neuron mode** (`group_by_class=false`):
   - Columns: upstream_class, upstream_neuron_id, upstream_neuron_name, weight, downstream_neuron_id, downstream_neuron_name, downstream_class, data_source, accession
   - **>50 rows:** Show total connection count, top 20 sorted by weight descending, summary stats (unique upstream neurons, unique downstream neurons, weight range)
   - **≤50 rows:** Show full table

   **Class mode** (`group_by_class=true`):
   - Columns: upstream_class, downstream_class, total_upstream_count, connected_upstream_count, percent_connected, pairwise_connections, total_weight, average_weight
   - Present ranked by `pairwise_connections` descending

   **Zero results — relaxation loop:**
   1. Lower weight to 1 → report count
   2. Remove exclude_dbs (include all datasets) → report count
   3. Try `group_by_class=true` → report count
   4. Show user what was tried and let them decide which relaxation to apply

   **Error:** Confirm neuron types with user, suggest using `search_terms` to find correct terms, retry.

6. **Output format** — Always include a resolved terms block:
   ```
   Query:
   - Upstream type:   transmedullary neuron Tm1 (FBbt_00003789)
   - Downstream type: (any)
   - Min. weight:     5
   - Excluded DBs:    hb, fafb
   - Group by class:  No

   Results: 142 connections across 28 upstream neurons → 85 downstream neurons
   ```

7. **Follow-up offers:**
   - "To get full details on any neuron, I can look it up in VFB using its ID"
   - "To find what connects *back* to [type], I can swap upstream/downstream and re-run"
   - "To aggregate these results by neuron class, I can re-run with group_by_class=true"
   - "You can view any neuron at `https://v2.virtualflybrain.org/org.geppetto.frontend/geppetto?id={short_form}`"

---

## Cross-tool Patterns

These patterns apply across all the entity resolution and query tools:

### Tiered Resolution
All resolve tools (`resolve_entity`, `resolve_combination`) use cascading resolution: exact name → synonym → broad pattern match. Always confirm non-exact matches (SYNONYM/BROAD) with the user before proceeding to further queries.

### Disambiguation
When multiple matches are returned by any resolve tool, present a numbered list showing name, ID, and type for each match. Ask the user to pick one before continuing.

### Link Conventions
Always provide appropriate links in results:
- **FlyBase reports:** `https://flybase.org/reports/{ID}` (for FBgn, FBal, FBti, FBco, FBst, FBrf IDs)
- **VFB browser:** `https://v2.virtualflybrain.org/org.geppetto.frontend/geppetto?id={VFB_ID}` (for VFB IDs)
- **DOI:** `https://doi.org/{DOI}`
- **PubMed:** `https://pubmed.ncbi.nlm.nih.gov/{PMID}/`

### Error Recovery
- If an API call fails, explain the error clearly and suggest alternatives (check spelling, try a FlyBase ID directly, use `search_terms` to validate)
- If entity not found, suggest broader search or checking spelling
- If connectivity query returns error about unrecognized type, use `search_terms` to find the correct neuron class term

### Tool Chaining
The typical flow is: **resolve** (get IDs) → **query** (get data) → **present** (format for user):
- `resolve_entity` → `find_stocks`
- `resolve_combination` → `find_combo_publications`
- `search_terms` (validate neuron class) → `query_connectivity`

## How to Interpret Image Data

VFB provides multiple types of images:

### **3D Brain Visualizations**
- Interactive 3D models showing neuron morphology, expression patterns
- Can be viewed in VFB's web interface or downloaded as `.nrrd`, `.wlz`, or `.obj` files

### **Microscopy Images**
- High-resolution confocal images of fly brain sections
- Show actual biological samples with fluorescent markers

### **Thumbnails**
- Small preview images (URLs containing `/thumbnail.png` or `/thumbnailT.png`)
- Quick visual identification of brain regions or neuron types

## Constructing VFB Browser URLs

The VFB browser can be opened with specific terms and 3D scenes using URL parameters:

```
https://v2.virtualflybrain.org/org.geppetto.frontend/geppetto?id=<FOCUS_ID>&i=<IMAGE_ID1>,<IMAGE_ID2>,...
```

**Parameters:**
- **`id=`** — A single VFB ID for the **focus term** shown in the term info panel
- **`i=`** — A comma-separated list of VFB IDs for images to display together in the 3D viewer

### Understanding the Images Field

The `get_term_info` response contains an `Images` field that is a **dictionary keyed by template brain ID**:

```json
"Images": {
  "VFB_00101567": [{"id": "VFB_00000001", "label": "fru-M-200266", ...}],
  "VFB_00017894": [{"id": "VFB_00000001", "label": "fru-M-200266", ...}]
}
```

Each key is a template brain ID (e.g., `VFB_00101567` = JRC2018Unisex). The images under each key are registered to that template. Only images registered to the **same template** will align correctly in the 3D viewer.

### Rules for Constructing URLs

1. **Always put the template ID first** in the `i=` list to ensure the correct 3D brain coordinate space is loaded
2. **Only combine images registered to the same template** — check the `Images` dictionary keys to determine which template each image belongs to
3. **The `id=` parameter sets the focus term** — this is typically the entity the user asked about

### Examples

**View a single neuron on its template:**
```
https://v2.virtualflybrain.org/org.geppetto.frontend/geppetto?id=VFB_00000001&i=VFB_00101567,VFB_00000001
```
`VFB_00101567` (JRC2018Unisex template) is listed first in `i=`, followed by the neuron `VFB_00000001`. The `id=VFB_00000001` sets the focus to the neuron.

**View multiple neurons together in 3D:**
```
https://v2.virtualflybrain.org/org.geppetto.frontend/geppetto?id=VFB_00000001&i=VFB_00101567,VFB_00000333,VFB_00000001
```
Multiple image IDs after the template ID will all be rendered together, provided they are all registered to `VFB_00101567`.

**View just a term's info (no 3D scene):**
```
https://v2.virtualflybrain.org/org.geppetto.frontend/geppetto?id=FBbt_00003624
```
Omitting the `i=` parameter opens the term info panel without loading a 3D scene.

### Identifying Templates

A term is a template brain if its `SuperTypes` array from `get_term_info` includes `"Template"`. Common templates:
- `VFB_00101567` — JRC2018Unisex (adult brain)

## Crawling Through Data (Navigation Strategy)

### **1. Start with Search**
- Use `search_terms` to find relevant entities
- Use `filter_types` to narrow results by entity type (e.g., `["neuron"]`, `["gene"]`, `["expression_pattern"]`)
- Use `exclude_types` to remove unwanted results (e.g., `["deprecated"]`)
- Use `boost_types` to prioritize results with useful data (e.g., `["has_image", "has_neuron_connectivity"]`)
- For large result sets, use `minimize_results: true` to limit to top 10 and reduce context usage
- For exact term matches, use `auto_fetch_term_info: true` to get immediate detailed information
- Use `start` and `rows` for pagination when exploring large result sets
- Look for entities with useful Tags (has_image, has_neuron_connectivity)

### **2. Get Detailed Information**
- Use `get_term_info` on promising IDs
- Check SuperTypes for classification
- Look at Tags for available data types

### **3. Explore Related Data**
- Use `run_query` with different query_types based on Tags
- Common queries: PaintedDomains, SimilarMorphology, Connectivity

### **4. Follow References**
- Publications provide scientific context
- Images show visual data
- Related entities can be explored recursively

## Scientific Context and Data Power

### **Why VFB Data is Powerful**

1. **Complete Brain Coverage**: Unlike partial datasets, VFB covers entire fly brain
2. **Standardized Templates**: All data registered to common brain templates
3. **Multi-modal Integration**: Combines anatomy, gene expression, connectivity
4. **Large Scale**: Tens of thousands of neurons and expression patterns
5. **Open Access**: Freely available for research
6. **Community Curation**: Expert-validated data

### **Research Applications**

- **Circuit Analysis**: Understanding neural circuits at single-neuron resolution
- **Gene Function**: Where and when genes are expressed in the brain
- **Evolution**: Comparing fly brain to other species
- **Disease Models**: Fly models of human neurological disorders
- **Connectomics**: Complete wiring diagrams of brain regions

### **Data Quality Indicators**

- **Confidence Values**: Many datasets include confidence scores
- **Publication References**: Peer-reviewed sources
- **Multiple Imaging Modalities**: Cross-validation across techniques
- **Standard Ontologies**: Consistent terminology using FlyBase ontologies

## Best Practices for LLM Usage

### **Response Strategy**
1. **Identify the scientific question** - Map to VFB capabilities
2. **Search for relevant terms** - Use search_terms to find entities
3. **Get detailed information** - Use get_term_info for context
4. **Run relevant queries** - Use run_query for analyses
5. **Explain findings** - Provide scientific interpretation
6. **Suggest visualizations** - Construct VFB browser URLs to let users view results in 3D (see "Constructing VFB Browser URLs" section)

### **Common Query Patterns**
- Gene expression: Search for gene name with `filter_types: ["gene"]` → get_term_info → run PaintedDomains query
- Neuron morphology: Search for neuron type with `filter_types: ["neuron"]` → get_term_info → check for SimilarMorphology
- Adult neurons with images: Search with `filter_types: ["neuron", "adult", "has_image"]`, `minimize_results: true`
- Brain regions: Search for anatomical terms with `filter_types: ["anatomy"]` → explore hierarchical relationships
- Connectivity: Search with `filter_types: ["has_neuron_connectivity"]` → run Connectivity queries
- Datasets: Search with `filter_types: ["dataset"]` to find available datasets
- Exact term lookup: Use `auto_fetch_term_info: true` for immediate detailed information on exact matches
- Exclude noise: Always consider `exclude_types: ["deprecated"]` to remove obsolete entities

### **Error Handling**
- If search returns no results, try alternative spellings or broader terms
- If query fails, check if the entity supports that query type (via Tags)
- Network timeouts are common - suggest retrying or using cached results

## Gemini Integration

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

This MCP enables powerful neuroscience research by providing programmatic access to one of the most comprehensive neuroanatomical databases available.