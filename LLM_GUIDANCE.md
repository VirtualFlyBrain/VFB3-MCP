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
  "Images": ["https://v2.virtualflybrain.org/org.geppetto.frontend/geppetto?..."],
  "Publications": ["DOI:10.1101/2020.12.08.417884"],
  "Synonyms": ["IN02A032_T2_L", "MANC:23475"]
}
```

**Key Fields to Interpret:**
- **SuperTypes**: Classification hierarchy (Neuron, Anatomy, Cell, etc.)
- **Tags**: Special properties (has_image, has_neuron_connectivity, NBLAST)
- **Queries**: Available analyses for this entity
- **Images**: Links to 3D visualizations and microscopy images
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

## How to Interpret Image Links

VFB provides multiple types of images:

### **3D Brain Visualizations**
- URLs like: `https://v2.virtualflybrain.org/org.geppetto.frontend/geppetto?...`
- Interactive 3D models showing neuron morphology, expression patterns
- Can be viewed in VFB's web interface or downloaded

### **Microscopy Images**
- High-resolution confocal images of fly brain sections
- Show actual biological samples with fluorescent markers
- Essential for validating expression patterns

### **Thumbnails**
- Small preview images in query results
- Quick visual identification of brain regions or neuron types

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
6. **Suggest visualizations** - Direct to image links when relevant

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

This MCP enables powerful neuroscience research by providing programmatic access to one of the most comprehensive neuroanatomical databases available.