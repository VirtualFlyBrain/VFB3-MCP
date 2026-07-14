# VFB3-MCP: Comprehensive LLM Guidance

## ⚠️ READ THIS FIRST — Three Rules

These three rules apply to every VFB question. Re-read them whenever a tool call returns empty or unexpected results.

### Rule 1 — Discover queries before running them

For any VFB or anatomy ontology ID (`VFB_*`, `FBbt_*`), the workflow is **always**:

1. **`search_terms`** — find the ID (skip if the user already provided one).
2. **`get_term_info`** — read the `Queries` array. This lists the valid `query_type` values for this entity.
3. **`run_query`** — pass `id` and a `query_type` taken from that `Queries` array.

DO NOT call `run_query` with a guessed `query_type`. If a `query_type` is not in the entity's `Queries` array, that query is not available for that entity, and `run_query` will return an error.

`get_term_info` also returns a **`RelatedTools`** array listing other MCP tools (not `run_query`) that are useful for this entity. Each entry has:

- `tool` — the MCP tool name to call (e.g. `get_hierarchy`).
- `label` — short human description.
- `default_args` — arguments ready to copy into the tool call.

Currently `get_term_info` surfaces:

- `get_hierarchy` — for cell-type classes (`subclass_of`) and nervous-system regions (`part_of`).

FlyBase stocks and split-GAL4 combination publications are NOT RelatedTools — they are `run_query` query_types (`FindStocks` for FlyBase feature IDs FBgn/FBal/FBti/FBtp/FBco/FBst, and `FindComboPublications` for FBco combinations), offered in the `Queries` array of those terms. Get the FlyBase/FBco ID from `resolve_entity` / `resolve_combination` first, then call `run_query` with that ID and the query_type.

Call the named tool directly with `default_args` — do not pass these values via `run_query`.

### Rule 2 — Empty results ≠ no data exists

If `run_query` returns empty rows or an error:

- The `query_type` may not be supported for this entity → re-check the `Queries` array from `get_term_info`.
- The entity may have no data for that specific question → try a different `query_type` from the same `Queries` array, or try a related entity (e.g. its parent class via `get_hierarchy`).
- It does **NOT** mean the answer is unknown to science. It means this MCP call did not return it.

If `search_terms` returns no good matches:

- Try alternative spellings, synonyms, or a broader term.
- Try with different `filter_types` (see the cookbook below).

### Rule 3 — Never substitute training knowledge for missing data

If the MCP cannot answer, tell the user clearly:

> "VFB does not return data for X via [tool]. I tried [list of attempts]. You could try [alternative search strategy]."

DO NOT fabricate any of the following from training data:

- FlyBase IDs (`FBgn`, `FBal`, `FBti`, `FBco`, `FBst`, `FBrf`)
- Anatomy ontology IDs (`FBbt_*`)
- VFB IDs (`VFB_*`)
- Driver line names, allele names, or split-GAL4 combination names
- Paper citations, DOIs, or PMIDs
- Connectivity counts, synapse weights, or expression results

Naming a real ID that you have not seen in a tool result this conversation counts as fabrication. If in doubt, say so and ask the user how they would like to proceed.

---

## Search Filter Cookbook

Unfiltered `search_terms` calls return deprecated terms, scRNAseq artifacts, and unrelated entity types mixed in with what the user wants. Use `filter_types` from the start. Common recipes:

| User asks about | `filter_types` | `exclude_types` |
|---|---|---|
| Neuron types/classes | `["neuron", "class"]` | `["deprecated"]` |
| Individual neurons (with images) | `["neuron", "has_image"]` | `["deprecated"]` |
| Neurons with connectome data | `["neuron", "has_neuron_connectivity"]` | `["deprecated"]` |
| Brain regions / neuropils | `["anatomy"]` | `["deprecated"]` |
| Genes | `["gene"]` | `["deprecated"]` |
| Expression patterns / driver lines | `["expression_pattern"]` | `["deprecated"]` |
| Datasets | `["dataset"]` | — |

**Stage filtering — only when the user is specific.** VFB covers adult, larval, and embryonic data, and many anatomical FBbt terms are stage-agnostic (the "antennal lobe" class covers all life stages). Do NOT add `"adult"` by default — you will hide the generic class and any larval/embryonic results.

- Add `"adult"` to `filter_types` only if the user explicitly asks about the adult fly (e.g. "adult Kenyon cells", "in the adult brain").
- Add `"larva"` if the user asks about larval anatomy.
- If the user does not specify a stage, leave stage filters out and let the user pick from the results.

Other useful options on `search_terms`:

- `boost_types: ["has_image", "has_neuron_connectivity"]` — soft-ranks the most data-rich entities first without excluding others.
- `minimize_results: true` — limits to top 10 and adds truncation metadata. Use for exploratory searches to avoid filling context with irrelevant matches.
- `auto_fetch_term_info: true` — when an exact label match is found, folds `get_term_info` into the same response, saving a round trip.

---

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
  "count": 1,
  "offset": 0,
  "limit": 25,
  "returned": 1,
  "_note": "Image columns (thumbnail) were excluded to reduce size - re-run this query with include_images=true to include them.",
  "headers": {
    "id": {"title": "ID", "type": "selection_id"},
    "name": {"title": "Domain", "type": "markdown"},
    "type": {"title": "Type", "type": "text"}
  },
  "rows": [
    {
      "id": "VFB_00102141",
      "name": "[AOTU on JRC2018Unisex adult brain](https://v2.virtualflybrain.org/...)",
      "type": "Expression_pattern"
    }
  ]
}
```

**Interpretation:**
- **count**: The TRUE total number of results — may be far larger than the rows returned.
- **offset / limit / returned**: Paging state. Only the current page (default 25 rows) is returned; to get the next page re-run with `offset` increased by `limit`.
- **_note**: Present when rows were paged and/or images excluded — states how to page further and how to re-add images (`include_images: true`).
- **Headers / Rows**: Column definitions and the current page of data. The `thumbnail` column is EXCLUDED by default; pass `include_images: true` to include it.

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
**Important:** `resolve_entity` is for unresolved user text only. Pass the raw query string exactly as written (for example `P{VT054895-GAL4.DBD}`); do not pass a resolved FlyBase/VFB ID to `resolve_entity`.

### Workflow

1. **Parse input** — Identify whether the user provides a name, synonym, or FlyBase ID:
   - `FBgn\d+` → gene ID (use `run_query` with `query_type` `FindStocks`)
   - `FBal\d+` → allele ID (use `run_query` with `query_type` `FindStocks`)
   - `FBti\d+` → insertion ID (use `run_query` with `query_type` `FindStocks`)
   - `FBco\d+` → combination ID (use `run_query` with `query_type` `FindStocks`)
   - `FBst\d+` → stock ID (use `run_query` with `query_type` `FindStocks`)
   - Any other string → resolve first with `resolve_entity`

2. **Resolve entity** — If user provides a name (not an ID), call `resolve_entity` with the raw unresolved string exactly as written. It uses tiered resolution:
   - Exact match on feature name
   - Synonym match (case-insensitive)
   - Broad pattern match (ILIKE)

3. **Confirm with user** — **Critical:**
   - If match was via **SYNONYM or BROAD**, show the resolved entity and ask user to confirm before proceeding. Example: *"Your search for 'CG9885' matched **dpp** (FBgn0000490, gene) via synonym. Shall I find stocks for this gene?"*
   - If **multiple matches**, show a disambiguation list (name, ID, type) and ask user to choose.
   - **Wait for user reply** — do NOT assume confirmation.

4. **Find stocks** — Call `run_query` with `query_type` `FindStocks` and `id` = the resolved FlyBase feature ID.

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

2. **Resolve combination** — If input is not an FBco ID, call `resolve_combination` with the raw unresolved string exactly as written. Uses tiered resolution: exact name → synonym → broad pattern match.

3. **Confirm with user** — **Critical:**
   - If match was via **synonym**, show the resolved formal name and FBco ID, ask user to confirm. Example: *"Your search for 'MB002B' matched **Scer\GAL4[DBD.R14C08]∩Hsap\RELA[AD.R12C11]** (FBco0000052) via synonym. Shall I find publications for this combination?"*
   - If **multiple matches**, show disambiguation list and ask user to choose.
   - **Wait for user reply** — do NOT assume confirmation.

4. **Find publications** — Call `run_query` with `query_type` `FindComboPublications` and `id` = the FBco ID.

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

## Connectivity Queries

**When to use:** User asks about synaptic connections, upstream/downstream partners, connectivity patterns, or where a neuron connects.

**DO NOT USE for:** Connections between muscles and neurons, or sense organs and neurons.

There are **six** connectivity query types. Pick the right one using the decision rules below.

### Step 1: Pick the Right Query

**Rule 1 — User has an individual neuron ID (starts with `VFB_`):**
- To see all synaptic partners of that neuron → use `run_query` with query_type `NeuronNeuronConnectivityQuery`
- To see which brain regions that neuron connects to → use `run_query` with query_type `NeuronRegionConnectivityQuery`
- To see presynaptic inputs with neurotransmitter types → use `run_query` with query_type `NeuronInputsTo`
- If the user specifically asks for a class-level query (e.g. "what classes connect to neurons like this one?"), first call `get_term_info` on the VFB ID to find its neuron class (`FBbt_...` ID), then use that class ID with the queries in Rule 2.

**Rule 2 — User has a neuron class (starts with `FBbt_`) or a neuron type name (e.g. "Kenyon cell"):**
- To see downstream partner classes → use `run_query` with query_type `DownstreamClassConnectivity` (fast, pre-indexed)
- To see upstream partner classes → use `run_query` with query_type `UpstreamClassConnectivity` (fast, pre-indexed)
- To see region connectivity or neurotransmitter inputs for a neuron class → use the instance batch workflow described below
- To filter by **both** upstream AND downstream class at the same time, or to retrieve results that include data from multiple connectome datasets → use `query_connectivity` (slow, live query)
- Call `list_connectome_datasets` first when you need the available connectome dataset labels/IDs (e.g. to populate `query_connectivity`'s dataset filters, or to tell the user which connectomes exist).

**Instance batch workflow — running individual neuron queries at the class level:**

Some queries (`NeuronRegionConnectivityQuery`, `NeuronInputsTo`) only work on individual neurons, not classes. To use them for a whole neuron class:

1. Get instances of the class: `run_query(id="FBbt_00003686", query_type="ListAllAvailableImages")`
2. Extract the VFB IDs from the results.
3. If there are many instances, tell the user how many there are and ask whether to query all of them or a subset.
4. Batch-query the instances: `run_query(id=["VFB_xxx", "VFB_yyy", ...], query_type="NeuronRegionConnectivityQuery")`

The `run_query` tool accepts an array of IDs and runs the query on all of them in parallel. Results are returned as a JSON object keyed by `"ID::query_type"`.

**Rule 3 — User asks about a brain region (e.g. "What connects to the lobula?"):**
- First use `search_terms` with `filter_types: ["neuron", "class"]` to find neuron classes in that region.
- Then apply Rule 2 for the neuron classes found.

**If unsure**, start with the `run_query` options listed in Rules 1–2. They are fast and cached. Only use `query_connectivity` when dual-end class filtering is specifically needed.

### Summary Table

| Query | Input | What it returns | Speed |
|-------|-------|----------------|-------|
| `NeuronNeuronConnectivityQuery` | Individual neuron VFB ID | All partner neurons with input/output weights | Fast (cached) |
| `NeuronRegionConnectivityQuery` | Individual neuron VFB ID | Brain regions with pre/postsynaptic terminal counts | Fast (cached) |
| `NeuronInputsTo` | Individual neuron VFB ID | Presynaptic partners with neurotransmitter types and weights | Fast (cached) |
| `DownstreamClassConnectivity` | Neuron class FBbt ID | Downstream partner classes with % connected, avg weight (includes data from all datasets) | Fast (pre-indexed) |
| `UpstreamClassConnectivity` | Neuron class FBbt ID | Upstream partner classes with % connected, avg weight (includes data from all datasets) | Fast (pre-indexed) |
| `query_connectivity` | Neuron class names or FBbt IDs | Connections between two neuron classes (includes data from all datasets) | Slow (1–5 min, live) |

### Step 2: Run the Query

#### For `run_query` connectivity queries (fast path)

1. Get the VFB ID or FBbt ID. If the user gave a name, use `search_terms` to find the ID first.
2. Call `get_term_info` on the ID. Check that the relevant query_type appears in the `Queries` array. If it does not, either the entity does not support that query type, or there are no results for it.
3. Call `run_query` with the ID and query_type.

**Example — individual neuron partners:**
```
run_query(id="VFB_00104glj", query_type="NeuronNeuronConnectivityQuery")
```

**Example — class downstream partners:**
```
run_query(id="FBbt_00003686", query_type="DownstreamClassConnectivity")
```

**Example — neuron region connectivity:**
```
run_query(id="VFB_00104glj", query_type="NeuronRegionConnectivityQuery")
```

**Example — neuron inputs with neurotransmitter types:**
```
run_query(id="VFB_00104glj", query_type="NeuronInputsTo")
```

#### For `query_connectivity` (slow path — dual-end class-to-class)

1. **Check if you really need `query_connectivity`.** If the user asks about only one direction (e.g. "what is downstream of X?" or "what are the inputs to X?"), use `DownstreamClassConnectivity` or `UpstreamClassConnectivity` via `run_query` instead — they are much faster. Only use `query_connectivity` when the user specifies **both** upstream and downstream types.

2. **Parse the user's request** using this table:

   | User says | Action |
   |-----------|--------|
   | "upstream of X", "inputs to X", "presynaptic to X" | Use `run_query` with `UpstreamClassConnectivity` on X. |
   | "downstream of X", "outputs from X", "postsynaptic to X" | Use `run_query` with `DownstreamClassConnectivity` on X. |
   | "between X and Y", "X to Y connections" | Use `query_connectivity` with `upstream_type` = X, `downstream_type` = Y |
   | "summarise by class", "aggregated" | Use `query_connectivity` with `group_by_class` = true (this option is specific to `query_connectivity`) |

   **Defaults for `query_connectivity`:** `weight` = 5, `exclude_dbs` = ["hb", "fafb"]

3. **Validate neuron type names.** Use `search_terms` with `filter_types: ["neuron", "class"]` to check the name is correct. If ambiguous, show candidates and ask user to pick.

4. **Confirm parameters with the user before running.** This query is slow. Show:
   ```
   I'll query connectivity with these parameters:
   - Upstream type:   transmedullary neuron Tm1
   - Downstream type: T3 neuron
   - Min. weight:     5
   - Excluded DBs:    hb, fafb
   - Group by class:  No
   This query may take several minutes. Shall I proceed?
   ```

5. **Execute** — Call `query_connectivity` with confirmed parameters.

**Performance rules for `query_connectivity`:**
- Always start with the default `weight = 5`. There is no universal "good" weight — it varies by cell type.
- Single-end queries (only upstream or only downstream set) are **slower** than both-ends queries because they return more results. If the user only cares about one direction, prefer `DownstreamClassConnectivity` or `UpstreamClassConnectivity` via `run_query` instead — they are pre-indexed and fast.
- Use `group_by_class=true` for faster aggregated results.
- Only use `query_connectivity` when you need both ends filtered by class.

### Step 3: Present Results

**Always start with a query summary:**
```
Query: NeuronNeuronConnectivityQuery for VFB_00104glj
Results: 42 partner neurons (23 upstream, 19 downstream)
```

Or for `query_connectivity`:
```
Query:
- Upstream type:   transmedullary neuron Tm1 (FBbt_00003789)
- Downstream type: T3 neuron (FBbt_00047727)
- Min. weight:     5
- Excluded DBs:    hb, fafb
Results: 142 connections across 28 upstream neurons → 85 downstream neurons
```

**Result formatting:**
- **≤50 rows:** Show full table.
- **>50 rows:** Show top 20 sorted by weight descending. Include summary stats (total connections, unique partners, weight range). Note that results are truncated.

**Column guide by query type:**

| Query type | Key columns |
|------------|------------|
| `NeuronNeuronConnectivityQuery` | partner label, outputs (synapses out), inputs (synapses in), tags |
| `NeuronRegionConnectivityQuery` | region, presynaptic terminals, postsynaptic terminals |
| `NeuronInputsTo` | presynaptic neuron name, neurotransmitter type, weight, neuron type |
| `DownstreamClassConnectivity` | downstream class, total N, connected N, % connected, avg weight |
| `UpstreamClassConnectivity` | upstream class, total N, connected N, % connected, avg weight |
| `query_connectivity` (per-neuron) | upstream class, upstream neuron, weight, downstream neuron, downstream class, data source |
| `query_connectivity` (grouped) | upstream class, downstream class, % connected, pairwise connections, avg weight |

**Zero results from `query_connectivity` — try these relaxation steps in order:**
1. Lower weight to 1.
2. Set `exclude_dbs` to `[]` to include all datasets.
3. Try `group_by_class=true`.
4. Tell the user what was tried and let them decide.

### Step 4: Follow-up Offers

- "To see full details on any neuron, I can look it up in VFB."
- "To see which brain regions this neuron connects to, I can run a region connectivity query."
- "To find what connects *back* to this type, I can swap upstream/downstream."
- "To aggregate by neuron class, I can re-run with group_by_class=true."
- "You can view any neuron at `https://v2.virtualflybrain.org/org.geppetto.frontend/geppetto?id={ID}`"

---

## Hierarchy Queries

**When to use:** User asks about the structure of a brain region, the types/subtypes of a cell class, or where something fits in the anatomical or cell type hierarchy.

Use the `get_hierarchy` tool.

### Choosing the Parameters

| User asks | `relationship` | `direction` |
|-----------|---------------|-------------|
| "What are the parts of the mushroom body?" | `part_of` | `descendants` |
| "What is the mushroom body part of?" | `part_of` | `ancestors` |
| "Where does the mushroom body fit in the brain?" | `part_of` | `both` |
| "What types of Kenyon cell are there?" | `subclass_of` | `descendants` |
| "What class of neuron is the Kenyon cell?" | `subclass_of` | `ancestors` |
| "Show me the Kenyon cell hierarchy" | `subclass_of` | `both` |

**Default:** Start with `max_depth=1` (direct parents/children only). If the user wants more detail, increase it. Use `max_depth=-1` with caution — broad terms can have thousands of descendants.

### Result Structure

- **Descendants** are returned as a **nested tree** for both relationship types (children contain their own children).
- **Ancestors** are returned as a **nested chain** for both relationship types.
- **`part_of` ancestors** are filtered to nervous system terms only (developmental lineage and generic structural terms are excluded).
- **`subclass_of` ancestors** are filtered to FBbt cell types only, stopping at "cell" (cross-ontology and non-cell ancestors are excluded).

### Examples

**Brain region structure:**
```
get_hierarchy(id="FBbt_00005801", relationship="part_of", direction="both", max_depth=1)
```

**Cell type hierarchy:**
```
get_hierarchy(id="FBbt_00003686", relationship="subclass_of", direction="both", max_depth=2)
```

### Presenting Results

The response includes:
- **`display`** — a pre-formatted text tree with large sibling groups shortened. Always present this directly to the user rather than reformatting the JSON.
- **`display_full`** — the same text tree with no shortening. Use this if the user asks to see all terms.

After showing the text tree, offer the user an interactive HTML version they can open in their browser. Construct the URL using this pattern:

```
https://v3-cached.virtualflybrain.org/get_hierarchy_html?id=<ID>&relationship=<RELATIONSHIP>&direction=<DIRECTION>&max_depth=<DEPTH>
```

For example: `https://v3-cached.virtualflybrain.org/get_hierarchy_html?id=FBbt_00003686&relationship=subclass_of&direction=both&max_depth=2`

The HTML page has a collapsible interactive tree with clickable links to VFB for every term.

---

## Cross-tool Patterns

These patterns apply across all the entity resolution and query tools:

### Tiered Resolution
All resolve tools (`resolve_entity`, `resolve_combination`) use cascading resolution: exact name → synonym → broad pattern match. These tools expect unresolved user text, not already resolved IDs. Always confirm non-exact matches (SYNONYM/BROAD) with the user before proceeding to further queries.

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

The core chain (see Rule 1 at the top) is **search → discover → query**:

`search_terms` → `get_term_info` (read the `Queries` array) → `run_query` (with a `query_type` from that array).

Specific patterns:
- `resolve_entity` → `run_query` with `query_type` `FindStocks`
- `resolve_combination` → `run_query` with `query_type` `FindComboPublications`
- `search_terms` (find neuron class) → `get_term_info` → `run_query` with `DownstreamClassConnectivity` or `UpstreamClassConnectivity`
- `search_terms` (validate neuron class) → `query_connectivity` (dual-end class-to-class)
- `search_terms` → `get_term_info` (get VFB ID) → `run_query` with `NeuronNeuronConnectivityQuery`, `NeuronRegionConnectivityQuery`, or `NeuronInputsTo`
- `search_terms` (find term) → `get_hierarchy` (explore structure or taxonomy)

If a chain step returns empty or an error, do not stop — try a different `query_type` from the `Queries` array, or a related entity. See Rule 2.

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
- **Standard Ontologies**: Consistent terminology using the Drosophila anatomy ontology (FBbt) and related ontologies

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
- Neurons with images: Search with `filter_types: ["neuron", "has_image"]`, `minimize_results: true` (add `"adult"` or `"larva"` only if the user specified a stage)
- Brain regions: Search for anatomical terms with `filter_types: ["anatomy"]` → explore hierarchical relationships
- Connectivity (individual neuron): Search with `filter_types: ["has_neuron_connectivity"]` → `get_term_info` → `run_query` with `NeuronNeuronConnectivityQuery`
- Connectivity (neuron class): Search with `filter_types: ["neuron", "class"]` → `run_query` with `DownstreamClassConnectivity` or `UpstreamClassConnectivity`
- Connectivity (class-to-class): Search with `filter_types: ["neuron", "class"]` → `query_connectivity` (both upstream and downstream types)
- Brain region structure: Search with `filter_types: ["anatomy"]` → `get_hierarchy` with `relationship: "part_of"`
- Cell type hierarchy: Search with `filter_types: ["neuron", "class"]` → `get_hierarchy` with `relationship: "subclass_of"`
- Datasets: Search with `filter_types: ["dataset"]` to find available datasets
- Exact term lookup: Use `auto_fetch_term_info: true` for immediate detailed information on exact matches
- Exclude noise: Always consider `exclude_types: ["deprecated"]` to remove obsolete entities

### **Error Handling**

See also: Rules 2 and 3 at the top of this document.

- If `search_terms` returns no good matches, try alternative spellings, synonyms, broader terms, or different `filter_types` from the cookbook.
- If `run_query` fails or returns empty, call `get_term_info` on the ID and pick a different `query_type` from the `Queries` array. The error message will list the valid query_types — use them.
- If no MCP call answers the question, tell the user clearly what you tried and what you found. Do **not** fall back to training-data answers (no fabricated FBbt/FBgn/FBst IDs, driver names, citations, or numbers).
- Network timeouts: suggest retrying. `query_connectivity` is the only slow tool — others should respond in seconds.

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
