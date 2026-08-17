# Technical Documentation

This document contains technical details about the VFB3-MCP server infrastructure, deployment, development setup, and internal workings.

## Architecture

### Server Modes

The VFB3-MCP server supports two operational modes:

#### Stdio Mode (Development/Local)
- Direct stdin/stdout communication
- Used for local development and testing
- Compatible with Claude Desktop local MCP configuration

#### HTTP Mode (Production)
- Express.js server with stateless JSON-over-HTTP request/response (no SSE)
- RESTful endpoints for MCP protocol (POST / for MCP requests, GET/DELETE return 405 unless requesting HTML)
- OAuth 2.0 metadata endpoints (returns 404 - no authentication required)
- CORS enabled for web client access

### MCP Protocol Implementation

- Built using the official `@modelcontextprotocol/sdk`
- Express transport for HTTP mode using stateless JSON-over-HTTP (no SSE)
- Stdio transport for local development
- Stateless HTTP mode (no session tracking / no session IDs)
- GA4 analytics use a stable server-side client ID in HTTP mode (no per-session IDs)

## Infrastructure

### Production Deployment

**Live Endpoint**: `https://vfb3-mcp.virtualflybrain.org`

The production deployment runs on VFB's Rancher/Cattle Kubernetes infrastructure with:

- **Protocol**: HTTPS with automatic SSL certificate management
- **Transport**: Stateless JSON-over-HTTP request/response (no SSE)
- **Authentication**: Open server (no authentication required)
- **Load Balancing**: Kubernetes service with automatic scaling (stateless; no sticky sessions required)
- **Resource Limits**: 512Mi memory, 500m CPU
- **Security**: Non-root user (UID 1000), read-only filesystem
- **MCP Endpoint**: `/` (root path)

### Docker

#### Multi-Architecture Images
- **AMD64** and **ARM64** support
- Published to Docker Hub: `virtualflybrain/vfb3-mcp`
- TypeScript compilation during build process

#### Local Development with Docker

```bash
# Build and run with Docker Compose
docker-compose up --build

# Build image manually
docker build -t vfb3-mcp .

# Pull pre-built image
docker pull virtualflybrain/vfb3-mcp:latest
```

### Kubernetes Deployment

The production service uses `k8s-deployment.yml` for Rancher/Cattle deployment:

- **Namespace**: VFB infrastructure
- **Resource Limits**: Memory and CPU constraints
- **Health Checks**: Readiness and liveness probes
- **Security Context**: Non-root execution
- **ConfigMaps**: Environment variable management

## CI/CD Pipeline

### GitHub Actions Workflow

Located in `.github/workflows/docker.yml`:

- **Triggers**: Push to any branch, pull requests
- **Buildx Setup**: Multi-platform Docker builds
- **Smart Tagging**:
  - Branch names for development
  - PR numbers for pull requests
  - `latest` for main branch
- **Caching**: Layer caching for faster builds
- **Security**: Docker Hub authentication via secrets

### Build Process

1. TypeScript compilation during Docker build
2. Multi-architecture image creation
3. Automated publishing to Docker Hub
4. Kubernetes deployment triggers (manual/auto)

### Development Setup

#### Prerequisites
- Node.js 18 or higher
- npm or yarn

#### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/VirtualFlyBrain/VFB3-MCP.git
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

4. Start the server:
   ```bash
   npm start
   ```

### Development Commands

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Unit tests (compiles first, then runs tests/*.test.js against dist/)
npm test

# Start production server
npm start

# Development mode with auto-rebuild
npm run dev

# HTTP mode for testing
MCP_MODE=http PORT=3000 node dist/index.js
```

Importing `dist/index.js` starts a server as a module side effect, so nothing defined in it is reachable from a test process. Logic worth unit testing therefore lives in its own module — currently `src/runQueryShape.ts`, which holds the `/run_query` response shaping and its count semantics — and `index.ts` imports it. Put new pure logic in a sibling module for the same reason.

### Local Testing

#### Stdio Mode
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

#### HTTP Mode
```bash
# Start server
MCP_MODE=http PORT=3000 node dist/index.js

# Server available at http://localhost:3000
```

## API Integration

### VFB API Endpoints

The server integrates with VirtualFlyBrain APIs:

- **Term Info API**: `https://v3-cached.virtualflybrain.org/get_term_info`
- **Query API**: `https://v3-cached.virtualflybrain.org/run_query`
- **Search API**: `https://v3-cached.virtualflybrain.org/search`
- **Facet vocabulary API**: `https://v3-cached.virtualflybrain.org/facets`
- **Connectivity API**: `https://v3-cached.virtualflybrain.org/query_connectivity`
- **Hierarchy API**: `https://v3-cached.virtualflybrain.org/get_hierarchy`
- **Entity resolution APIs**: `https://v3-cached.virtualflybrain.org/resolve_entity`, `/resolve_combination`
- **Connectome dataset list**: `https://v3-cached.virtualflybrain.org/list_connectome_datasets`
- **Cross-reference API**: `https://v3-cached.virtualflybrain.org/xref`
- **Set-algebra API**: `https://v3-cached.virtualflybrain.org/combine`

These are every path on VFBquery's `ALLOWED_PATHS` allowlist that is a query. The
remainder are deliberately not called: `/health` and `/status` are operational;
`/find_stocks` and `/find_combo_publications` are retired in favour of the
`FindStocks` and `FindComboPublications` `run_query` query types, which return the
standard `{headers, rows, count}` shape; and `/get_hierarchy_html` is off the
allowlist entirely, being the geppetto ROI browser's pre-rendered markup rather than
an API.

The server no longer talks to `solr.virtualflybrain.org` directly. It used to build
its own Solr query for search — its own `fq`, its own `bq`, its own `qf` — and that
construction was a copy of the website's, made once and then left to drift. Worse,
it skipped the website's refine/sort pass, so its ordering was never the website's
either. VFBquery's `/search` *is* the website's search, so search now goes through
it: one ranking, one place to fix it.

### MCP Tools Implementation

#### get_term_info
- **Input**: VFB ID string
- **Output**: Term metadata, classifications, images, publications
- **API Call**: POST to term info endpoint

#### run_query
- **Input**: VFB ID(s) and query type; optional `limit`/`offset` (paging) and `include_images`
- **Output**: A page of tabular data (default 25 rows) with `headers`, `rows`, the true total `count`, a `count_status` (`exact` | `row_count` | `unavailable`) qualifying it, and paging metadata (`offset`/`limit`/`returned`/`_note`). VFBquery signals an upstream Owlery failure as HTTP 200 with `count: -1` and no rows; that is surfaced as `count_status: "unavailable"` with an explicit `_note`, and retried once behind the scenes with `X-Force-Refresh` so a failure cached by nginx cannot be served as an answer. Top-level flags from VFBquery (`capped`, `truncated`, `warnings`) are passed through rather than dropped. The `thumbnail` column is excluded unless `include_images` is set. FlyBase `FindStocks` / `FindComboPublications` are query_types here.
- **API Call**: GET `run_query` with `offset`/`limit`

#### search_terms
- **Input**: Search query with optional `filter_types` / `exclude_types` / `boost_types` / `demote_types`, `unique`, `start`, `rows`, `minimize_results`, `auto_fetch_term_info`
- **Output**: `{query, unique, start, returned, total, distinct_terms?, solr_matches?, candidate_pool, _note?, results, term_info?}`. The counts are reported separately rather than collapsed into one number, so a truncated page cannot be mistaken for a small result set
- **API Call**: GET `/search`

Two details of `/search` shape the implementation:

- **`rows` on the wire is a candidate pool, not a page size.** It is how many documents
  Solr is asked for before ranking, so it affects *which* results come back, not just
  how many. The tool therefore sends `rows = min(1000, max(500, start + rows))` — an
  ordinary request gets the website's own 500-candidate pool and identical ranking, and
  only a caller paging past that widens the net. `/search` has no `offset`, so the page
  slice is taken client-side.
- **`original_label` is the raw label; `label` is the refined display form**
  (`"medulla (FBbt_00003748)"`, `"synonym (label)"`). Exact-match detection compares
  `original_label` — comparing the display form, as the old code did, could never match.

`unique` and `distinct_terms` are newer than some deployed VFBquery versions. Rather
than version-sniffing, the tool asks for `unique=true` and treats "did the response
echo `unique`?" as the capability probe, caching the answer for the process. Where the
server does not honour it, the tool refetches *without* `limit` and de-duplicates
locally — necessary because the rows past the limit are exactly the ones that survive
de-duplication — and says so in `_note`.

#### list_search_facets
- **Input**: optional `contains` substring
- **Output**: `{count, total, contains?, source?, _note?, facets}`
- **API Call**: GET `/facets`

On `404` (endpoint not deployed yet) or `503` (vocabulary unavailable) this falls back
to `STATIC_FACET_SNAPSHOT`, a snapshot of the names that used to be pasted into the
`search_terms` description. The snapshot is not maintained; the response labels its
source and warns that names missing from it may still be valid.

#### query_connectivity
- **Input**: `upstream_type` / `downstream_type` (at least one required), `weight`, `group_by_class`, `exclude_dbs`, `limit`, `offset`
- **Output**: `{count, offset, limit, returned, ranked_by, summary, _note?, warnings?, resolved?, connections}`
- **API Call**: GET `/query_connectivity`, 5-minute timeout (live cross-dataset query, not cached)

`/query_connectivity` has no paging of its own and returns every row it finds — a single
class at `weight=5` can be over 50,000 connections, which is not something to hand a
model whole. `limit`/`offset` are therefore applied client-side after ranking
strongest-first (stable, with the original index as tiebreak), and the `summary` is
computed over the **full** set so the totals remain true.

One subtlety in the summary: class labels arrive from Neo4j as
`apoc.text.join(collect(distinct c.label),'|')`, and the order within that join is not
deterministic — the same logical pair of classes comes back as `"A|B"` on one row and
`"B|A"` on the next. Left alone that splits one class pair across several summary rows
and inflates `distinct_class_pairs`. The parts are sorted before keying, which gives one
stable spelling per label set.

#### resolve_entity / resolve_combination
- **Input**: `name` — the raw, unresolved string as the user wrote it
- **Output**: VFB/FlyBase IDs and metadata from the endpoint's tiered resolution (exact name → synonym → broad pattern match), passed through unmodified
- **API Call**: GET `/resolve_entity`, GET `/resolve_combination`

Both are free-text → ID resolvers, not query types, which is why they remain dedicated
tools while `FindStocks` and `FindComboPublications` were folded into `run_query`. They
take unresolved text only; a caller that already has an `FBgn`/`FBco`/VFB ID should go
straight to the downstream query.

#### list_connectome_datasets
- **Input**: none
- **Output**: dataset labels and symbols, passed through unmodified
- **API Call**: GET `/list_connectome_datasets`

The symbols are what `query_connectivity`'s `exclude_dbs` accepts, so this stands in the
same relation to `query_connectivity` as `list_search_facets` does to `search_terms`.

#### get_hierarchy
- **Input**: `id`, `relationship` (`part_of` | `subclass_of`), optional `direction` and `max_depth`
- **Output**: nested descendant tree and/or ancestor chain, passed through unmodified
- **API Call**: GET `/get_hierarchy`, 2-minute timeout

`relationship` is required by the tool schema but omitted from the query string when
absent, so a caller that drops it gets the endpoint's own default (`part_of`) rather
than a 400 on the literal string `undefined`.

#### lookup_xref
- **Input**: exactly one of `id` or `accession`, plus optional `db`
- **Output**: `{query, direction, count, candidates_checked, db_matched?, available_dbs?, _note?, rows}`
- **API Call**: GET `/xref`, 2-minute timeout

The exactly-one check is done client-side so the message names the tool's own parameters
and says which direction each runs; upstream's own 400 is otherwise fine.

Shaping is confined to one thing, and it is the reason the tool exists. `rows: [], count: 0`
is returned for two situations that mean opposite things, distinguishable only by
`direction`:

- `id_to_accession` is a single document fetch against the term's own cross-reference
  list, so empty is authoritative — the term has no cross-references.
- `accession_to_id` is `/search` for the accession followed by an exact confirmation
  against each candidate's own xref list, so empty means the index did not reach a term
  carrying it. Cross-references are not an indexed field on either Solr core; an
  accession is searchable only because VFB writes it into the label
  (`DA1_lPN_R (FlyEM-HB:1734350908)`). Connectome bodyIds therefore resolve, and an
  accession from a link-out-only site cannot.

`shapeXrefResult` attaches the note that says which of the two happened. Without it a
model reads the second case as "no such neuron exists" — and reaching for `search_terms`
instead, which ranks a near-miss first with no confirmation step, is the failure that
prompted the endpoint. When `direction` is missing the cautious note is used: asserting
authority that cannot be verified is the worse error.

#### combine_queries
- **Input**: `expr`, `operands` (object), optional `universe`, `limit`, `include_images`, `explain_only`, `require_complete`
- **Output**: `{expression, as_read, plain_english, count, returned, limit, steps, operands, universe, capped?, warnings?, _note?, headers, rows}`
- **API Call**: GET `/combine`, 5-minute timeout (each operand is a separate live query)

Operands are passed as a JSON object rather than as arbitrary top-level parameters, which
is how the HTTP endpoint takes them. That keeps operand names out of the tool's own
parameter namespace — the reason upstream needs a `_COMBINE_RESERVED` list at all — and
lets the tool reject a clashing name (`limit`, `universe`, `expr`, …) by pointing at it.
Upstream skips a reserved name silently, which leaves the expression referring to a set
that does not exist.

Two upstream defaults are wrong for a model and are overridden on the way through:

- **`limit` defaults to 0 upstream, meaning every row.** A 220-row answer carrying
  thumbnails is 428 KB; stripped and cut to 25 rows it is 9.5 KB. An explicit `limit` is
  always sent, because omitting it is not the same as asking for the tool's default.
- **Rows carry `thumbnail`.** Stripped unless `include_images`, reusing
  `RUN_QUERY_IMAGE_COLUMNS` so `run_query` and `combine_queries` cannot drift apart on
  what counts as an image column.

`offset` is **not** exposed. Upstream reserves the name but does not implement it and
warns that it ignored it; a documented parameter that silently does nothing is worse than
an absent one. The paging note tells the caller to raise `limit` instead.

Key order is deliberate. `expression`, `as_read` and `plain_english` come first and
`rows` last, for the reason the 1.11.0 `run_query` shaping does it: a caveat printed after
220 rows is a caveat that gets skimmed past, and `as_read` is the only check available
against a misgrouped expression. An `explain_only` response has no `rows` at all and is
passed through untouched.

### Error Handling

- Axios HTTP client with timeout configuration
- Graceful fallback for API unavailability, including capability probing rather than
  version sniffing where a newer VFBquery adds a parameter or an endpoint
- Rejection bodies from `/search` and `/query_connectivity` are surfaced to the caller
  rather than reduced to a status code — both endpoints explain what to change (an
  unknown facet name comes back with suggestions), and that explanation is the useful part
- Structured error responses following MCP protocol
- Logging for debugging and monitoring

## Client Integration Examples

### Gemini Setup

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

## Security

### Production Security Measures

- **HTTPS Only**: Automatic SSL certificate management
- **No Authentication**: Open access design (VFB data is public)
- **CORS Configuration**: Controlled cross-origin access
- **Resource Limits**: Memory and CPU constraints
- **Non-root Execution**: Security hardening in containers
- **Read-only Filesystem**: Immutable container design

### OAuth Implementation

While the server includes OAuth metadata endpoints for MCP SDK compatibility, authentication is not required:

- OAuth endpoints return 404 (Not Found)
- No token validation or user authentication
- Open access to VFB public data

## Monitoring and Logging

### Application Logging

- **Console Output**: Structured logging to stdout/stderr
- **Debug Mode**: Verbose logging with `MCP_DEBUG=true`
- **Error Handling**: Comprehensive error logging with context
- **Request Tracking**: Request ID logging (no session IDs in HTTP mode)

### Infrastructure Monitoring

- **Kubernetes Probes**: Readiness and liveness checks
- **Resource Monitoring**: Memory and CPU usage tracking
- **Log Aggregation**: Container logs collected by Rancher/Cattle
- **Health Endpoints**: Basic health check responses

## Performance

### Optimization Strategies

- **API Caching**: VFB provides cached endpoints for performance
- **Connection Pooling**: Axios configuration for efficient HTTP requests
- **Memory Management**: Node.js memory limits and garbage collection
- **Concurrent Requests**: Support for multiple simultaneous MCP requests (stateless)

### Scalability

- **Horizontal Scaling**: Kubernetes deployment supports multiple replicas
- **Load Balancing**: Automatic distribution of requests
- **Resource Scaling**: CPU/memory-based autoscaling capabilities
- **Stateless Design**: No session persistence requirements

## Troubleshooting

### Common Issues

#### Build Failures
- Ensure Node.js 18+ is installed
- Check TypeScript compilation errors
- Verify Docker build context

#### Runtime Errors
- Check VFB API availability
- Verify network connectivity
- Review environment variables

#### MCP Client Issues
- Confirm correct endpoint URL
- Check JSON configuration syntax
- Verify MCP client compatibility

### Debug Mode

Enable verbose logging:
```bash
DEBUG=* npm start
# or
MCP_DEBUG=true npm start
```

## Contributing

### Development Workflow

1. Fork the repository
2. Create a feature branch from `main`
3. Make changes with tests
4. Ensure TypeScript compilation
5. Test with Docker locally
6. Submit pull request

### Code Standards

- **TypeScript**: Strict mode enabled
- **ESLint**: Code linting (if configured)
- **Prettier**: Code formatting (if configured)
- **Testing**: Unit tests for critical functions

## License

MIT License - See main README for details.