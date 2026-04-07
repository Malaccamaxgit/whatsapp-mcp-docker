# ENH-001-B: Tool Documentation via `get_tool_info` Meta-Tool + Lean Descriptions

**Status:** Proposed  
**Priority:** High  
**Component:** MCP Server Tool Definitions  
**Requested:** 2026-04-07  
**Source:** E2E Interactive Testing Session - 2026-04-07  
**Supersedes:** [ENH-001](./ENH-001-rich-tool-documentation.md) (replaces multi-option analysis with single recommended approach)

---

## Summary

Implement a two-layer documentation strategy for the WhatsApp MCP server:

1. **Layer 1 (Lean Descriptions):** Short, focused tool descriptions with a one-line hint pointing to `get_tool_info`
2. **Layer 2 (Deep Docs on Demand):** A new `get_tool_info` meta-tool that returns comprehensive usage examples, response formats, error codes, and related tools when called

This approach minimizes context window usage while making deep documentation available exactly when the agent needs it.

---

## Problem Statement

During E2E testing, the AI agent frequently needed to consult external files:
- `whatsapp-mcp-docker-server.yaml` for parameter names
- Source code in `src/tools/` for expected behavior
- README.md for usage examples

**Example from testing:**
```
Agent needed to call download_media:
  1. First attempt: Used "messageId" parameter → validation error
  2. Had to grep server YAML to find correct parameter: "message_id"
  3. Second attempt: Success with correct parameter name

Time lost: ~2 minutes of tool calls and file searches
```

**Current tool description (insufficient):**
```yaml
- name: download_media
  description: Download media from a message to persistent storage
  arguments:
    - name: message_id
      type: string
      desc: The message ID containing media
```

**What's missing:**
- ❌ Example usage with real values
- ❌ Expected response format
- ❌ Error cases (media expired, invalid ID, etc.)
- ❌ Related tools (list_messages to find message IDs)

---

## Decision Record: Why Option B + Lean C

This document consolidates the analysis from ENH-001 and recommends a single approach based on:

### 1. Docker MCP Gateway Schema Constraints

The Docker MCP Gateway `Tool` struct (from [`pkg/catalog/types.go`](https://github.com/docker/mcp-gateway/blob/main/pkg/catalog/types.go)) only supports:

```go
type Tool struct {
    Name        string          `yaml:"name" json:"name"`
    Description string          `yaml:"description" json:"description"`
    Arguments   *[]ToolArgument `yaml:"arguments,omitempty"`
    Annotations *ToolAnnotations `yaml:"annotations,omitempty"`
    // ... POCI-only fields
}
```

**No support for:** `examples`, `response_schema`, `related_tools`, `pitfalls`, or any custom metadata fields.

**Implication:** Option A (Extended YAML Schema) is **blocked** until Docker MCP Gateway adds schema support.

### 2. MCP Protocol Specification (2025-11-25)

The MCP protocol `tools/list` response supports:
- `name`, `title`, `description`, `inputSchema`
- `outputSchema` (new, for response validation)
- `annotations` (behavior hints only: readOnly, destructive, idempotent, openWorld)
- `icons`, `execution` (display/task support)

**No support for:** `examples`, `errors`, `related_tools`, `pitfalls`.

**Implication:** The protocol itself doesn't provide fields for rich documentation. Any solution must work within the existing `description` field or use a separate tool call.

### 3. Context Window Economics

| Approach | Lines per tool | Total (33 tools) | Context cost per turn |
|----------|---------------|------------------|----------------------|
| Option C (verbose descriptions) | ~20 lines | ~660 lines | High (constant tax) |
| Option B + Lean C | ~1 line + 1 tool | ~34 lines | Low (on-demand only) |

**Implication:** Option C burns ~660 lines of context on **every** conversation turn where the tool list is present. For a long-lived Docker daemon server, this is a constant token tax. Option B + Lean C costs ~34 lines/turn and only pays the full documentation cost when `get_tool_info` is explicitly called.

### 4. Third-Party Dependencies

- **Option A:** Blocked by Docker MCP Gateway roadmap
- **Option C:** Works today, but creates maintenance burden (verbose descriptions must be kept in sync with code)
- **Option B + Lean C:** Zero external dependencies, works with current MCP SDK

### Rejected Alternatives

| Alternative | Why Rejected |
|-------------|--------------|
| Option A (Extended YAML) | Blocked by Docker MCP Gateway schema; no timeline for support |
| Option C alone (verbose descriptions) | High context window cost; maintenance burden; harder to parse programmatically |
| Do nothing | Agent continues to waste time searching external files |

---

## Approach: Layered Documentation

### Layer 1: Lean Descriptions with Hint Line

Every tool's `description` field ends with a standardized hint:

```
Use get_tool_info({tool_name: '<name>'}) for examples, errors, and response format.
```

**Example (`download_media`):**
```typescript
description: 'Download media (image, video, audio, document) from a WhatsApp message. ' +
  'Provide the message ID and chat identifier. The media is saved to persistent storage ' +
  'and the local file path is returned. Only works for messages that have media metadata stored. ' +
  'Use get_tool_info({tool_name: \'download_media\'}) for examples, errors, and response format.'
```

**Cost:** ~1 extra line per tool (~33 lines total) added to the standard tool list.

### Layer 2: `get_tool_info` Meta-Tool

A new tool that returns comprehensive documentation on demand:

```typescript
registerTool(server, 'get_tool_info', {
  description: 'Get detailed help for a WhatsApp MCP tool: usage examples, response format, error codes, pitfalls, and related tools. Call before using an unfamiliar tool.',
  inputSchema: {
    tool_name: z.string().describe('Name of the tool to get documentation for')
  },
  annotations: { readOnlyHint: true, idempotentHint: true }
}, async ({ tool_name }) => {
  const docs = toolDocs[tool_name];
  if (!docs) {
    return {
      content: [{ type: 'text', text: `Unknown tool: ${tool_name}. Call list_tools to see available tools.` }],
      isError: true
    };
  }
  return {
    content: [{ type: 'text', text: formatDocumentation(docs) }]
  };
});
```

**Return format (structured plain text):**
```
TOOL: download_media

USAGE:
  message_id (required): The message ID containing media (from list_messages output)
  chat (optional): Chat name, phone number, or JID to disambiguate

EXAMPLES:
  1. Download image:
     download_media({
       message_id: "AC8E7D7E0AAAE3822594E4343B32C468",
       chat: "Benjamin"
     })

  2. Download with explicit chat context:
     download_media({
       message_id: "3EB05639EFDF4EBD87B40B",
       chat: "128819088347371@lid"
     })

RESPONSE:
  Success:
    Media downloaded successfully.
      Type: {media_type}
      Path: {local_file_path}
      Chat: {chat_jid}
  
  Example:
    Media downloaded successfully.
      Type: image
      Path: /data/sessions/media/image/AC8E7D7E0AAAE3822594E4343B32C468.jpg
      Chat: 128819088347371@lid

ERRORS:
  - MEDIA_EXPIRED: Media no longer available (expired after 30 days on WhatsApp servers)
  - INVALID_MESSAGE_ID: No message found with ID {message_id}
  - NO_MEDIA: Message does not contain media attachment
  - CHAT_MISMATCH: Message {message_id} does not belong to specified chat

RELATED TOOLS:
  - list_messages: Find message IDs in a chat
  - search_messages: Find messages by content
  - send_file: Send media files (reverse operation)

PITFALLS:
  - Media expires on WhatsApp servers after 30 days
  - Only media received after server installation can be downloaded
  - Message IDs are case-sensitive
  - Provide chat parameter when message ID may exist in multiple chats
```

---

## Implementation Plan

### File: `src/tools/tool-info.ts` (NEW)

Create a new file with the following structure:

```typescript
/**
 * Tool Information Meta-Tool
 *
 * Provides on-demand documentation for WhatsApp MCP tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PermissionManager } from '../security/permissions.js';
import { registerTool, type ToolInput, type McpResult } from '../utils/mcp-types.js';

export interface ToolDocumentation {
  summary: string;
  usage: Array<{
    param: string;
    required: boolean;
    description: string;
  }>;
  examples: Array<{
    name: string;
    parameters: Record<string, string>;
    description: string;
  }>;
  response: {
    success: {
      format: string;
      example: string;
    };
    errors: Array<{
      code: string;
      message: string;
    }>;
  };
  relatedTools: Array<{
    name: string;
    description: string;
  }>;
  pitfalls: string[];
}

export const toolDocs: Record<string, ToolDocumentation> = {
  download_media: {
    summary: 'Download media (image, video, audio, document) from a WhatsApp message to persistent storage.',
    usage: [
      { param: 'message_id', required: true, description: 'The message ID containing media (from list_messages output)' },
      { param: 'chat', required: false, description: 'Chat name, phone number, or JID to disambiguate' }
    ],
    examples: [
      {
        name: 'Download image',
        parameters: { message_id: 'AC8E7D7E0AAAE3822594E4343B32C468', chat: 'Benjamin' },
        description: 'Download media from a specific message ID'
      },
      {
        name: 'Download with explicit chat context',
        parameters: { message_id: '3EB05639EFDF4EBD87B40B', chat: '128819088347371@lid' },
        description: 'Download media when message ID may be ambiguous'
      }
    ],
    response: {
      success: {
        format: 'Media downloaded successfully.\\n  Type: {media_type}\\n  Path: {local_file_path}\\n  Chat: {chat_jid}',
        example: 'Media downloaded successfully.\\n  Type: image\\n  Path: /data/sessions/media/image/AC8E7D7E0AAAE3822594E4343B32C468.jpg\\n  Chat: 128819088347371@lid'
      },
      errors: [
        { code: 'MEDIA_EXPIRED', message: 'Media no longer available (expired after 30 days on WhatsApp servers)' },
        { code: 'INVALID_MESSAGE_ID', message: 'No message found with ID {message_id}' },
        { code: 'NO_MEDIA', message: 'Message does not contain media attachment' },
        { code: 'CHAT_MISMATCH', message: 'Message {message_id} does not belong to specified chat' }
      ]
    },
    relatedTools: [
      { name: 'list_messages', description: 'Find message IDs in a chat' },
      { name: 'search_messages', description: 'Find messages by content' },
      { name: 'send_file', description: 'Send media files (reverse operation)' }
    ],
    pitfalls: [
      'Media expires on WhatsApp servers after 30 days',
      'Only media received after server installation can be downloaded',
      'Message IDs are case-sensitive',
      'Provide chat parameter when message ID may exist in multiple chats'
    ]
  },
  // ... add entries for all 33 tools
};

function formatDocumentation(docs: ToolDocumentation): string {
  const sections: string[] = [];
  
  // USAGE section
  const usageLines = docs.usage.map(u => 
    `  ${u.param} (${u.required ? 'required' : 'optional'}): ${u.description}`
  );
  sections.push(`USAGE:\\n${usageLines.join('\\n')}`);
  
  // EXAMPLES section
  const examples = docs.examples.map((ex, i) => 
    `  ${i + 1}. ${ex.name}:\\n     ${JSON.stringify(ex.parameters, null, 2)}`
  );
  sections.push(`EXAMPLES:\\n${examples.join('\\n\\n')}`);
  
  // RESPONSE section
  sections.push(`RESPONSE:\\n  Success:\\n    ${docs.response.success.format}\\n\\n  Example:\\n    ${docs.response.success.example}`);
  sections.push(`\\n  Errors:\\n${docs.response.errors.map(e => `    - ${e.code}: ${e.message}`).join('\\n')}`);
  
  // RELATED TOOLS section
  const related = docs.relatedTools.map(t => `  - ${t.name}: ${t.description}`);
  sections.push(`\\nRELATED TOOLS:\\n${related.join('\\n')}`);
  
  // PITFALLS section
  sections.push(`\\nPITFALLS:\\n${docs.pitfalls.map(p => `  - ${p}`).join('\\n')}`);
  
  return sections.join('\\n\\n');
}

export function registerToolInfoTool(
  server: McpServer,
  permissions: PermissionManager
): void {
  const inputSchema = {
    tool_name: z.string().describe('Name of the tool to get documentation for')
  };

  const handler = async ({ tool_name }: ToolInput<typeof inputSchema>): Promise<McpResult> => {
    const toolCheck = permissions.isToolEnabled('get_tool_info');
    if (!toolCheck.allowed) {
      return { content: [{ type: 'text', text: toolCheck.error ?? 'Tool disabled' }], isError: true };
    }

    const docs = toolDocs[tool_name];
    if (!docs) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${tool_name}. Call list_tools to see available tools.` }],
        isError: true
      };
    }

    return {
      content: [{ type: 'text', text: formatDocumentation(docs) }]
    };
  };

  registerTool(server, 'get_tool_info', {
    description: 'Get detailed help for a WhatsApp MCP tool: usage examples, response format, error codes, pitfalls, and related tools. Call before using an unfamiliar tool.',
    inputSchema,
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, handler);
}
```

### File: `src/server.ts` (MODIFY)

Add the import and registration call:

```typescript
import { registerToolInfoTool } from './tools/tool-info.js';

// ... existing imports

export function createServer ({
  // ... existing params
}: CreateServerOptions = {} as CreateServerOptions): CreateServerResult {
  // ... existing setup

  registerAuthTools(mcpServer, waClient, resolvedPermissions, resolvedAudit);
  registerStatusTools(mcpServer, waClient, resolvedStore, resolvedPermissions);
  registerMessagingTools(mcpServer, waClient, resolvedStore, resolvedPermissions, resolvedAudit);
  registerChatTools(mcpServer, waClient, resolvedStore, resolvedPermissions, resolvedAudit);
  registerApprovalTools(mcpServer, waClient, resolvedStore, resolvedPermissions, resolvedAudit);
  registerMediaTools(mcpServer, waClient, resolvedStore, resolvedPermissions, resolvedAudit);
  registerGroupTools(mcpServer, waClient, resolvedStore, resolvedPermissions, resolvedAudit);
  registerReactionTools(mcpServer, waClient, resolvedStore, resolvedPermissions, resolvedAudit);
  registerContactTools(mcpServer, waClient, resolvedStore, resolvedPermissions, resolvedAudit);
  registerWaitTools(mcpServer, waClient, resolvedStore, resolvedPermissions, resolvedAudit);
  registerToolInfoTool(mcpServer, resolvedPermissions); // NEW

  return {
    mcpServer,
    store: resolvedStore,
    audit: resolvedAudit,
    permissions: resolvedPermissions
  };
}
```

### Files: `src/tools/*.ts` (MODIFY all 10 tool files)

Append the hint line to every tool's `description` string. Example for `download_media` in [`src/tools/media.ts`](../src/tools/media.ts):

**Before:**
```typescript
description: 'Download media (image, video, audio, document) from a WhatsApp message. Provide the message ID and chat identifier. The media is saved to persistent storage and the local file path is returned. Only works for messages that have media metadata stored.',
```

**After:**
```typescript
description: 'Download media (image, video, audio, document) from a WhatsApp message. Provide the message ID and chat identifier. The media is saved to persistent storage and the local file path is returned. Only works for messages that have media metadata stored. Use get_tool_info({tool_name: \'download_media\'}) for examples, errors, and response format.',
```

**Files to modify:**
- `src/tools/auth.ts` (3 tools: disconnect, authenticate, get_connection_status)
- `src/tools/messaging.ts` (3 tools: send_message, list_messages, search_messages)
- `src/tools/chats.ts` (5 tools: list_chats, mark_messages_read, export_chat_data, catch_up, search_contacts)
- `src/tools/media.ts` (2 tools: download_media, send_file)
- `src/tools/groups.ts` (9 tools: create_group, get_group_info, get_joined_groups, get_group_invite_link, join_group, leave_group, update_group_participants, set_group_name, set_group_topic)
- `src/tools/reactions.ts` (4 tools: send_reaction, edit_message, delete_message, create_poll)
- `src/tools/contacts.ts` (5 tools: get_user_info, is_on_whatsapp, get_profile_picture, sync_contact_names, set_contact_name)
- `src/tools/approvals.ts` (2 tools: request_approval, check_approvals)
- `src/tools/wait.ts` (1 tool: wait_for_message)
- `src/tools/status.ts` (already has get_connection_status, may need hint line)

### File: `whatsapp-mcp-docker-server.yaml` (MODIFY)

Add the new tool entry and update all existing tool descriptions:

```yaml
tools:
  # ... existing tools with updated descriptions (add hint line to each)
  
  - name: get_tool_info
    description: Get detailed help for a WhatsApp MCP tool: usage examples, response format, error codes, pitfalls, and related tools. Call before using an unfamiliar tool.
    arguments:
      - name: tool_name
        type: string
        desc: Name of the tool to get documentation for (e.g. download_media, send_message)
        required: true
```

### File: `test/unit/tool-info.test.ts` (NEW)

Create unit tests:

```typescript
/**
 * Tool Info Meta-Tool Tests
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestServer } from './helpers/test-server.js';
import { createMockWaClient } from './helpers/mock-wa-client.js';
import { MessageStore } from '../../src/whatsapp/store.js';
import { toolDocs } from '../../src/tools/tool-info.js';

describe('get_tool_info tool', () => {
  let ctx: Awaited<ReturnType<typeof createTestServer>>;

  before(async () => {
    const store = new MessageStore(':memory:');
    ctx = await createTestServer({
      waClient: createMockWaClient(),
      store
    });
  });

  after(async () => {
    await ctx.cleanup();
  });

  it('returns documentation for known tool', async () => {
    const result = await ctx.client.callTool({
      name: 'get_tool_info',
      arguments: { tool_name: 'download_media' }
    });

    assert.ok(!result.isError);
    assert.ok(result.content.length > 0);
    const text = result.content[0].text;
    assert.ok(text.includes('USAGE:'));
    assert.ok(text.includes('EXAMPLES:'));
    assert.ok(text.includes('RESPONSE:'));
    assert.ok(text.includes('ERRORS:'));
    assert.ok(text.includes('RELATED TOOLS:'));
    assert.ok(text.includes('PITFALLS:'));
  });

  it('returns error for unknown tool', async () => {
    const result = await ctx.client.callTool({
      name: 'get_tool_info',
      arguments: { tool_name: 'nonexistent_tool' }
    });

    assert.ok(result.isError);
    assert.ok(result.content[0].text.includes('Unknown tool'));
  });

  it('has hint line in all tool descriptions', async () => {
    const tools = await ctx.client.listTools();
    
    for (const tool of tools.tools) {
      if (tool.name === 'get_tool_info') continue; // skip itself
      
      assert.ok(
        tool.description.includes('get_tool_info'),
        `Tool ${tool.name} missing get_tool_info hint line`
      );
      assert.ok(
        tool.description.includes(`tool_name: '${tool.name}'`),
        `Tool ${tool.name} hint line doesn't reference its own name`
      );
    }
  });
});
```

---

## Error Recovery: Proactive Documentation Hints

When a tool call fails validation (wrong parameter name, missing required arg, type mismatch), append the `get_tool_info` hint to the error message:

**Example modification to `src/tools/media.ts`:**

**Before:**
```typescript
if (!resolved) {
  return { 
    content: [{ type: 'text', text: error ?? `Could not resolve chat "${chat}".` }], 
    isError: true 
  };
}
```

**After:**
```typescript
if (!resolved) {
  return { 
    content: [{ 
      type: 'text', 
      text: `${error ?? `Could not resolve chat "${chat}".`} Call get_tool_info({tool_name: 'download_media'}) for correct usage.` 
    }], 
    isError: true 
  };
}
```

This pattern should be applied to validation errors across all tool files. The highest-ROI locations are:
- Parameter name mismatches (e.g., `messageId` vs `message_id`)
- Missing required parameters
- Type validation failures
- Ambiguous recipient errors

---

## Implementation Checklist

### Phase 1: Core Implementation

- [ ] Create `src/tools/tool-info.ts` with `ToolDocumentation` interface and `toolDocs` map
- [ ] Add documentation entries for all 33 tools in `toolDocs`
- [ ] Implement `formatDocumentation()` helper function
- [ ] Implement `registerToolInfoTool()` function
- [ ] Update `src/server.ts` to import and call `registerToolInfoTool`
- [ ] Add `get_tool_info` tool entry to `whatsapp-mcp-docker-server.yaml`

### Phase 2: Lean Description Updates

- [ ] Update `src/tools/auth.ts` (3 tools) - append hint line to each description
- [ ] Update `src/tools/messaging.ts` (3 tools)
- [ ] Update `src/tools/chats.ts` (5 tools)
- [ ] Update `src/tools/media.ts` (2 tools)
- [ ] Update `src/tools/groups.ts` (9 tools)
- [ ] Update `src/tools/reactions.ts` (4 tools)
- [ ] Update `src/tools/contacts.ts` (5 tools)
- [ ] Update `src/tools/approvals.ts` (2 tools)
- [ ] Update `src/tools/wait.ts` (1 tool)
- [ ] Update `src/tools/status.ts` (1 tool)
- [ ] Update `whatsapp-mcp-docker-server.yaml` to match code descriptions

### Phase 3: Error Recovery

- [ ] Add `get_tool_info` hint to validation errors in `src/tools/media.ts`
- [ ] Add hints to validation errors in `src/tools/messaging.ts`
- [ ] Add hints to validation errors in `src/tools/groups.ts`
- [ ] Add hints to validation errors in `src/tools/reactions.ts`
- [ ] Add hints to validation errors in other tool files as needed

### Phase 4: Testing

- [ ] Create `test/unit/tool-info.test.ts`
- [ ] Test that `get_tool_info` returns documentation for known tools
- [ ] Test that `get_tool_info` returns error for unknown tool names
- [ ] Test that all tool descriptions contain the hint line
- [ ] Run full test suite to ensure no regressions
- [ ] Test from MCP client (Cursor, Claude Desktop, etc.)

### Phase 5: Validation

- [ ] Verify `get_tool_info` appears in tool list from MCP client
- [ ] Test that AI agent can successfully call `get_tool_info` and use returned docs
- [ ] Measure context window usage before/after (should be ~34 lines vs ~660 lines)
- [ ] Document time savings in E2E testing sessions

---

## Future: Extended YAML Schema

If the Docker MCP Gateway adds support for extended tool metadata fields (`examples`, `response_schema`, `related_tools`, `pitfalls`), the `toolDocs` data structure in `src/tools/tool-info.ts` can be migrated to the YAML catalog. This would enable:

- UI rendering in Docker Desktop
- Structured parsing by MCP clients
- Single source of truth (YAML instead of TypeScript)

Until then, the `get_tool_info` meta-tool provides the same functionality with zero external dependencies.

---

## Impact

### Benefits

- ✅ **Minimal context cost:** ~34 lines/turn vs ~660 lines for verbose descriptions
- ✅ **On-demand depth:** Full documentation available exactly when needed
- ✅ **Zero dependencies:** Works with current MCP SDK and Docker MCP Gateway
- ✅ **Error recovery:** Proactive hints guide agents to documentation when they hit errors
- ✅ **Self-documenting:** Server becomes single source of truth for tool usage
- ✅ **Dynamic info:** Can include runtime data (rate limits, quotas) in future

### Estimated Time Savings

From E2E testing session analysis:
- **Time spent searching docs:** ~15 minutes across 29 tests
- **Tool call retries due to wrong parameters:** ~5 instances
- **Potential savings:** 10-15 minutes per testing session

### Context Window Comparison

| Approach | Tool list size | `get_tool_info` call | Total per session |
|----------|---------------|---------------------|-------------------|
| Verbose descriptions (Option C) | ~660 lines/turn | N/A | ~660 lines × turns |
| Lean + meta-tool (B + Lean C) | ~34 lines/turn | ~200 lines (on demand) | ~34 lines × turns + 200 lines × calls |

For a typical 20-turn session with 3 `get_tool_info` calls:
- Option C: 13,200 lines
- B + Lean C: 1,280 lines (**90% reduction**)

---

## References

- **Source:** E2E Interactive Testing Session - 2026-04-07
- **Trigger:** Agent needed to consult server YAML for parameter names
- **Related:** MCP SDK tool description field limitations
- **Docker MCP Gateway Schema:** https://github.com/docker/mcp-gateway/blob/main/pkg/catalog/types.go
- **MCP Protocol Spec:** https://modelcontextprotocol.io/specification/2025-11-25/server/tools
- **Inspired by:** Stripe API docs, Twilio API reference

---

## AI Author Notes

This enhancement makes the server **self-documenting** while respecting context window economics. The key insight: AI agents have access to tool descriptions via the MCP protocol, but not to project files. Therefore, all necessary usage information should be available via MCP tools themselves.

The `get_tool_info` pattern is scalable: as the server grows to 50+ tools, the context cost remains low (~1 line per tool) while deep documentation is always one tool call away.
