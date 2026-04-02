---
name: add-new-tool
description: Add a new MCP tool to the WhatsApp MCP Docker server. Covers creating the tool file, wiring it into server.js, updating the YAML catalog, and updating the README. Use when the user wants to add, create, or implement a new MCP tool or command.
---

# Add a New MCP Tool

Four steps: tool file → server.js → YAML → README.

## Step 1 — Create or extend a tool file in `src/tools/`

```javascript
// src/tools/example.js
import { z } from 'zod';

export function registerExampleTools(server, waClient, store, permissions, audit) {
  server.tool(
    'my_tool',
    'Clear description of what this tool does and when to use it.',
    {
      param: z.string().describe('What this parameter is for')
    },
    async ({ param }) => {
      const rateCheck = permissions.checkRateLimit();
      if (!rateCheck.allowed) {
        return { content: [{ type: 'text', text: rateCheck.error }], isError: true };
      }

      const result = /* ... */;

      audit.log('my_tool', 'action', { param });

      return {
        content: [{ type: 'text', text: `Result: ${result}` }]
      };
    },
    {
      annotations: {
        readOnlyHint: true,      // true if tool only reads data
        destructiveHint: false,  // true if tool deletes/modifies irreversibly
        idempotentHint: true,
        openWorldHint: false
      }
    }
  );
}
```

Key patterns:
- Always call `permissions.checkRateLimit()` for outbound actions
- Log every action via `audit.log(toolName, action, details)`
- Use Zod schemas for all parameters
- Log to `stderr`, never `stdout` (stdout is reserved for MCP stdio transport)

## Step 2 — Wire into `src/server.js`

```javascript
import { registerExampleTools } from './tools/example.js';
// ...
registerExampleTools(mcpServer, waClient, store, permissions, audit);
```

## Step 3 — Add to both YAML files

In `whatsapp-mcp-docker-server.yaml` and `catalog.yaml`:

```yaml
  - name: my_tool
    description: "Clear description"
    arguments:
      - name: param
        type: string
        desc: "What this parameter is for"
```

## Step 4 — Update `README.md` tool table

Add a row to the tools table in the README.

## Existing tool files for reference

| File | Tools registered |
|------|-----------------|
| `src/tools/auth.js` | `authenticate` |
| `src/tools/status.js` | `get_connection_status` |
| `src/tools/messaging.js` | `send_message`, `list_messages`, `search_messages` |
| `src/tools/chats.js` | `list_chats`, `search_contacts`, `catch_up`, `mark_messages_read` |
| `src/tools/media.js` | `download_media`, `send_file` |
| `src/tools/approvals.js` | `request_approval`, `check_approvals` |

## Rebuild and test after adding

```bash
# Rebuild image
docker compose up -d --build

# Run integration tests to verify wiring
docker compose --profile test build tester-container
docker compose --profile test run --rm tester-container node --test test/integration/*.test.js
```
