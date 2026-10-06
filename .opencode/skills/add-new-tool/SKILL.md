---
name: add-new-tool
description: Add a new MCP tool to the WhatsApp MCP Docker server. Covers creating the tool file, wiring it into server.ts, updating the server YAML, and updating the README. Use when the user wants to add, create, or implement a new MCP tool or command.
---

# Add a New MCP Tool

The change touches four files. Do them in this order:

1. The tool file.
2. `src/server.ts`.
3. The server YAML.
4. `README.md`.

## Step 1: create or extend a tool file in `src/tools/`

```typescript
// src/tools/example.ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { registerTool, type ToolInput, type McpResult } from '../utils/mcp-types.js';
import type { WhatsAppClient } from '../whatsapp/client.js';
import type { MessageStore } from '../whatsapp/store.js';
import type { PermissionManager } from '../security/permissions.js';
import type { AuditLogger } from '../security/audit.js';

const schema = {
  param: z.string().describe('What this parameter is for')
};

export function registerExampleTools (
  server: McpServer,
  waClient: WhatsAppClient,
  store: MessageStore,
  permissions: PermissionManager,
  audit: AuditLogger
): void {
  registerTool(server, 'my_tool', {
    description: 'Clear description of what this tool does and when to use it.',
    inputSchema: schema,
    annotations: {
      readOnlyHint: true,      // true if the tool only reads data
      destructiveHint: false,  // true if the tool deletes or modifies irreversibly
      idempotentHint: true,
      openWorldHint: false
    }
  }, async (args: ToolInput<typeof schema>): Promise<McpResult> => {
    const rateCheck = permissions.checkRateLimit();
    if (!rateCheck.allowed) {
      return { content: [{ type: 'text', text: rateCheck.error ?? 'Rate limited' }], isError: true };
    }

    const result = /* implementation */;

    audit.log('my_tool', 'action', { param: args.param });

    return { content: [{ type: 'text', text: `Result: ${result}` }] };
  });
}
```

Key patterns:

- Call `permissions.checkRateLimit()` for outbound actions.
- Log every action with `audit.log(toolName, action, details)`.
- Use Zod schemas for all parameters.
- Log to `stderr`, never `stdout`. `stdout` carries the MCP stdio transport.

## Step 2: wire into `src/server.ts`

```typescript
import { registerExampleTools } from './tools/example.js';
// ...
registerExampleTools(mcpServer, waClient, resolvedStore, resolvedPermissions, resolvedAudit);
```

Match the argument order of the neighbouring `registerXTools` calls. Some
functions take fewer arguments. For example, `registerStatusTools` takes no audit
logger.

## Step 3: add to `whatsapp-mcp-docker-server.yaml`

```yaml
  - name: my_tool
    description: "Clear description. Use get_tool_info({tool_name: 'my_tool'}) for examples, errors, and response format."
    arguments:
      - name: param
        type: string
        desc: "What this parameter is for"
```

The description ends with the `get_tool_info` hint. `server.ts` appends a hint
automatically. Keep the YAML line consistent with the other entries.

## Step 4: update the `README.md` tool table

Add a row to the tools table in the README.

## Existing tool files for reference

| File | Tools registered |
|------|-----------------|
| `src/tools/auth.ts` | `disconnect`, `authenticate` |
| `src/tools/status.ts` | `get_connection_status` |
| `src/tools/messaging.ts` | `send_message`, `list_messages`, `search_messages`, `get_poll_results`, `debug_poll_votes`, `list_polls` |
| `src/tools/chats.ts` | `list_chats`, `catch_up`, `search_contacts`, `mark_messages_read`, `export_chat_data` |
| `src/tools/media.ts` | `download_media`, `send_file` |
| `src/tools/approvals.ts` | `request_approval`, `check_approvals` |
| `src/tools/groups.ts` | group management tools |
| `src/tools/reactions.ts` | `send_reaction`, `edit_message`, `delete_message`, `create_poll` |
| `src/tools/contacts.ts` | contact tools |
| `src/tools/wait.ts` | `wait_for_message` |
| `src/tools/tool-info.ts` | `get_tool_info` |

## Rebuild and test after adding

```bash
# Rebuild the image
docker compose build --no-cache

# Run integration tests to verify the wiring
docker compose --profile test build tester-container
docker compose --profile test run --rm tester-container npx tsx --test test/integration/*.test.ts
```
