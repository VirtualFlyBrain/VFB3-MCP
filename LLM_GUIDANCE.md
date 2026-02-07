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

Returns entity search results from SOLR. Supports optional type-based filtering:

- **`filter_types`**: Hard include — results must have ALL specified `facets_annotation` values (AND logic)
- **`exclude_types`**: Hard exclude — results must NOT have any of these types
- **`boost_types`**: Soft boost — results with these types rank higher without excluding others

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
    ]
  }
}
```

**Key Fields:**
- **short_form**: VFB/FlyBase identifier
- **label**: Primary display name
- **facets_annotation**: Categorization tags (also used for filtering)
- **id**: Full ontology IRI

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
- Adult neurons with images: Search with `filter_types: ["neuron", "adult", "has_image"]`
- Brain regions: Search for anatomical terms with `filter_types: ["anatomy"]` → explore hierarchical relationships
- Connectivity: Search with `filter_types: ["has_neuron_connectivity"]` → run Connectivity queries
- Datasets: Search with `filter_types: ["dataset"]` to find available datasets
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

Implementation: Use an `SSEClientTransport` to connect to the VFB URL, list its tools, and pass their schemas to the Gemini model as Function Declarations.

This MCP enables powerful neuroscience research by providing programmatic access to one of the most comprehensive neuroanatomical databases available.