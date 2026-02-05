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

## Integration with MCP Clients

### Claude Desktop
Add to your MCP server configuration:
```json
{
  "mcpServers": {
    "vfb3-mcp": {
      "url": "https://vfb3-mcp.virtualflybrain.org/mcp"
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
      "url": "https://vfb3-mcp.virtualflybrain.org/mcp"
    }
  }
}
```

### GitHub Copilot
Configure the MCP server URL in your Copilot settings pointing to `https://vfb3-mcp.virtualflybrain.org/mcp`.

## Docker Usage
```bash
# Build and run
docker-compose up --build

# Or manually
docker build -t vfb3-mcp .
docker run -it vfb3-mcp
```