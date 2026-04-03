# MCP Client Configuration Examples

Manual configuration snippets for connecting MCP clients to the WhatsApp MCP server via the MCP Gateway. Use these if `docker mcp client connect` doesn't support your client, or if you prefer to edit config files directly.

> **Tip:** The easiest path is `docker mcp client connect <client> --profile <your-profile>` — it writes the correct entry automatically and injects required environment variables (critical on Windows). Use the manual configs below only when you need full control.

Replace `default` with your actual profile name (`docker mcp profile ls` shows it).

---

## Cursor

**File:** `~/.cursor/mcp.json` (user-level) or `.cursor/mcp.json` (project-level)

```json
{
  "mcpServers": {
    "MCP_DOCKER": {
      "command": "docker",
      "args": ["mcp", "gateway", "run", "--profile", "default"]
    }
  }
}
```

**Windows users:** Add the `env` block below — the gateway needs these to locate credentials:

```json
{
  "mcpServers": {
    "MCP_DOCKER": {
      "command": "docker",
      "args": ["mcp", "gateway", "run", "--profile", "default"],
      "env": {
        "LOCALAPPDATA": "C:\\Users\\<you>\\AppData\\Local",
        "ProgramData": "C:\\ProgramData",
        "ProgramFiles": "C:\\Program Files"
      }
    }
  }
}
```

---

## Claude Desktop

**File:** `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)  
**File:** `%APPDATA%\Claude\claude_desktop_config.json` (Windows)

```json
{
  "mcpServers": {
    "MCP_DOCKER": {
      "command": "docker",
      "args": ["mcp", "gateway", "run", "--profile", "default"]
    }
  }
}
```

---

## Claude Code (CLI)

**File:** `~/.claude/settings.json`

```json
{
  "mcpServers": [
    {
      "name": "MCP_DOCKER",
      "command": "docker",
      "args": ["mcp", "gateway", "run", "--profile", "default"]
    }
  ]
}
```

Or via environment variable:

```bash
export CLAUDE_MCP_SERVERS='[{"name":"MCP_DOCKER","command":"docker","args":["mcp","gateway","run","--profile","default"]}]'
```

---

## VS Code (MCP Extension)

**File:** `.vscode/mcp.json` (workspace) or `~/.vscode/mcp.json` (user)

```json
{
  "servers": {
    "whatsapp-mcp": {
      "type": "stdio",
      "command": "docker",
      "args": ["mcp", "gateway", "run", "--profile", "default"]
    }
  }
}
```

---

## Gemini CLI

**File:** `~/.gemini/settings.json`

```json
{
  "mcp": {
    "servers": [
      {
        "name": "whatsapp",
        "command": "docker",
        "args": ["mcp", "gateway", "run", "--profile", "default"]
      }
    ]
  }
}
```

---

## Cline (VS Code Extension)

Configure via VS Code settings (`settings.json`):

```json
{
  "cline.mcpServers": [
    {
      "name": "WhatsApp MCP",
      "command": "docker",
      "args": ["mcp", "gateway", "run", "--profile", "default"]
    }
  ]
}
```

---

## Goose (CLI)

**File:** `~/.config/goose/config.yaml`

```yaml
mcp_servers:
  - name: whatsapp
    command: docker
    args:
      - mcp
      - gateway
      - run
      - --profile
      - default
```

---

## Direct Docker Compose (without MCP Toolkit)

For users who want to bypass Docker Desktop MCP Toolkit entirely and connect directly to the container via stdio:

**1. Build and start the container:**

```bash
docker compose up -d
```

**2. Create a wrapper script** (`scripts/whatsapp-mcp-stdio.sh`):

```bash
#!/bin/bash
docker exec -i whatsapp-mcp-docker node src/index.js
```

**3. Configure your MCP client:**

```json
{
  "mcpServers": {
    "whatsapp": {
      "command": "/path/to/scripts/whatsapp-mcp-stdio.sh"
    }
  }
}
```

> **Note:** This bypasses the MCP Gateway. You lose multi-client support (only one AI client can connect at a time) but can use the server without Docker Desktop's MCP Toolkit feature.

---

## Notes

1. **Replace `"default"`** with your actual profile name — run `docker mcp profile ls` to find it.
2. **All gateway-based configs share one server instance** — multiple AI clients (Cursor, Claude, VS Code) connect through the same gateway and the same WhatsApp session simultaneously.
3. **Windows requires env vars** in manual configs — `docker mcp client connect` adds these automatically; manual edits must include them explicitly (see Cursor example above).

---

**See also:** [Docker MCP Toolkit docs](https://docs.docker.com/ai/mcp-catalog-and-toolkit/profiles/#using-profiles-with-clients)
