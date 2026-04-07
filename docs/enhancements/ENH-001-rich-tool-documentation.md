# ENH-001: Rich Tool Documentation with Examples and Response Schemas

**Status:** Proposed  
**Priority:** High  
**Component:** MCP Server Tool Definitions  
**Requested:** 2026-04-07  
**Source:** E2E Interactive Testing Session - 2026-04-07

---

## Summary

Enhance MCP tool definitions to include comprehensive inline documentation: usage examples, response schemas, error cases, and related tools. This would make the server self-documenting and reduce dependency on external documentation.

---

## Problem Statement

During E2E testing, the AI agent frequently needed to consult:
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

## Proposed Solution

Extend tool metadata to include:

### 1. Usage Examples
```yaml
examples:
  - name: Download image from message
    parameters:
      message_id: "AC8E7D7E0AAAE3822594E4343B32C468"
    description: Download media from a specific message ID
  - name: Download with chat context
    parameters:
      message_id: "3EB05639EFDF4EBD87B40B"
      chat: "Benjamin"
    description: Download media when message ID may be ambiguous
```

### 2. Response Schema
```yaml
response:
  success:
    format: |
      Media downloaded successfully.
        Type: {media_type}
        Path: {local_file_path}
        Chat: {chat_jid}
    example: |
      Media downloaded successfully.
        Type: image
        Path: /data/sessions/media/image/AC8E7D7E0AAAE3822594E4343B32C468.jpg
        Chat: 128819088347371@lid
  errors:
    - code: MEDIA_EXPIRED
      message: Media no longer available (expired after 30 days)
    - code: INVALID_MESSAGE_ID
      message: No message found with ID {message_id}
    - code: NO_MEDIA
      message: Message does not contain media
```

### 3. Related Tools
```yaml
related_tools:
  - list_messages: Find message IDs in a chat
  - search_messages: Find messages by content
  - send_file: Send media files (reverse operation)
```

### 4. Common Pitfalls
```yaml
pitfalls:
  - Media expires on WhatsApp servers after 30 days
  - Only media received after server installation can be downloaded
  - Message IDs are case-sensitive
```

---

## Implementation Options

### Option A: Extended YAML Schema (Recommended)
Add optional fields to `whatsapp-mcp-docker-server.yaml`:

```yaml
- name: download_media
  description: Download media from a message to persistent storage
  arguments:
    - name: message_id
      type: string
      desc: The message ID containing media
      required: true
    - name: chat
      type: string
      desc: The chat name, phone, or JID (optional)
      required: false
  
  # NEW: Rich documentation fields
  examples:
    - parameters:
        message_id: "AC8E7D7E0AAAE3822594E4343B32C468"
      description: Download image from message
  response_schema:
    success_format: "Media downloaded successfully.\n  Type: {type}\n  Path: {path}"
    errors:
      - MEDIA_EXPIRED: "Media no longer available"
      - INVALID_MESSAGE_ID: "No message found"
  related_tools: ["list_messages", "search_messages"]
  pitfalls:
    - "Media expires after 30 days on WhatsApp servers"
```

**Pros:**
- Centralized in server definition
- Easy to maintain alongside tool implementation
- Docker MCP Toolkit can surface this in UI

**Cons:**
- Requires Docker MCP Toolkit to support extended schema
- May need YAML schema validation updates

---

### Option B: Tool Help Meta-Tool
Add a new tool `get_tool_info` that returns rich documentation:

```typescript
server.registerTool('get_tool_info', {
  description: 'Get detailed documentation for a tool including examples and response format',
  inputSchema: {
    tool_name: z.string().describe('The tool name to get documentation for')
  }
}, async ({ tool_name }) => {
  const docs = toolDocumentation[tool_name];
  return {
    content: [{
      type: 'text',
      text: formatDocumentation(docs)
    }]
  };
});
```

**Usage:**
```
User: "How do I use download_media?"
AI: Calls get_tool_info({ tool_name: "download_media" })
Response: Returns full documentation with examples
```

**Pros:**
- Works with current MCP SDK
- Can include dynamic information (e.g., current quotas)
- No changes to YAML schema needed

**Cons:**
- Requires an extra tool call
- Documentation not visible in tool list

---

### Option C: Enhanced Tool Descriptions
Embed examples in the description field (works today):

```yaml
- name: download_media
  description: |
    Download media from a message to persistent storage.
    
    USAGE:
      message_id (required): The message ID from list_messages or search_messages
      chat (optional): Chat name to disambiguate
    
    EXAMPLE:
      download_media({
        message_id: "AC8E7D7E0AAAE3822594E4343B32C468",
        chat: "Benjamin"
      })
    
    RESPONSE:
      Success: "Media downloaded successfully.\n  Type: image\n  Path: /data/..."
      Errors: MEDIA_EXPIRED, INVALID_MESSAGE_ID, NO_MEDIA
    
    RELATED:
      - list_messages: Find message IDs
      - send_file: Send media files
    
    PITFALLS:
      - Media expires after 30 days
      - Only works for media received after server installation
```

**Pros:**
- Works immediately with current MCP SDK
- Visible in tool descriptions
- No infrastructure changes needed

**Cons:**
- Less structured than Options A or B
- Harder to parse programmatically
- Description field may have length limits

---

## Recommended Approach

**Implement Option C immediately** (quick win), then **add Option A** for long-term maintainability.

### Phase 1: Enhanced Descriptions (Week 1)
- Update all 33 tool descriptions in `whatsapp-mcp-docker-server.yaml`
- Include examples, response format, and pitfalls
- Test that descriptions render correctly in Docker Desktop UI

### Phase 2: Tool Help Meta-Tool (Week 2)
- Implement `get_tool_info` tool
- Create documentation database in `src/tools/documentation.ts`
- Add to server.ts tool registration

### Phase 3: Extended YAML Schema (Future)
- Propose schema extension to Docker MCP Toolkit
- Add examples and response schemas to YAML
- Work with Docker team on UI rendering

---

## Impact

### Benefits
- ✅ **Faster development:** AI agents can discover tool usage without file searches
- ✅ **Better UX:** Users see examples directly in tool descriptions
- ✅ **Reduced errors:** Clear parameter names and formats prevent validation errors
- ✅ **Self-documenting:** Server becomes single source of truth
- ✅ **Easier onboarding:** New developers can learn tools from within MCP client

### Estimated Time Savings
From E2E testing session:
- **Time spent searching docs:** ~15 minutes across 29 tests
- **Tool call retries due to wrong parameters:** ~5 instances
- **Potential savings:** 10-15 minutes per testing session

---

## Example: Before vs After

### Before (Current)
```yaml
- name: send_reaction
  description: React to a message with an emoji, or remove an existing reaction
  arguments:
    - name: message_id
      type: string
      desc: The message to react to
    - name: emoji
      type: string
      desc: Emoji character (👍, ❤️, etc.)
    - name: chat
      type: string
      desc: Chat name or JID
```

### After (Enhanced)
```yaml
- name: send_reaction
  description: |
    React to a message with an emoji, or remove an existing reaction.
    
    USAGE:
      message_id (required): Message ID from list_messages
      emoji (required): Emoji character (👍, ❤️, 😂, 😮, 😢, 🙏)
      chat (required): Chat name to locate message
    
    EXAMPLES:
      1. Add reaction:
         send_reaction({
           message_id: "3EB031DE9AE47622992AFB",
           emoji: "👍",
           chat: "Benjamin"
         })
      
      2. Remove reaction:
         send_reaction({
           message_id: "3EB031DE9AE47622992AFB",
           emoji: "",
           chat: "Benjamin"
         })
    
    RESPONSE:
      Success: "Reaction "👍" on message 3EB031DE9AE47622992AFB."
      Errors: 
        - INVALID_MESSAGE_ID: Message not found
        - ALREADY_REACTED: You already reacted with this emoji
    
    RELATED:
      - list_messages: Find message IDs
      - send_message: Send messages to react to
    
    PITFALLS:
      - Reactions may not appear immediately on phone (sync delay)
      - Some emoji may not render correctly on all devices
      - Must specify chat where message exists
```

---

## Implementation Checklist

**Phase 1: Enhanced Descriptions**
- [ ] Update descriptions for authentication tools (3 tools)
- [ ] Update descriptions for messaging tools (3 tools)
- [ ] Update descriptions for chat tools (5 tools)
- [ ] Update descriptions for media tools (2 tools)
- [ ] Update descriptions for group tools (9 tools)
- [ ] Update descriptions for reaction tools (4 tools)
- [ ] Update descriptions for contact tools (5 tools)
- [ ] Update descriptions for approval tools (2 tools)
- [ ] Update descriptions for workflow tools (1 tool)
- [ ] Test in Docker Desktop UI
- [ ] Verify AI agent can use improved docs

**Phase 2: Tool Help Meta-Tool**
- [ ] Create `src/tools/documentation.ts`
- [ ] Implement `get_tool_info` tool
- [ ] Wire into `src/server.ts`
- [ ] Add to `whatsapp-mcp-docker-server.yaml`
- [ ] Test from MCP client

---

## References

- **Source:** E2E Interactive Testing Session - 2026-04-07
- **Trigger:** Agent needed to consult server YAML for parameter names
- **Related:** MCP SDK tool description field limitations
- **Inspired by:** Stripe API docs, Twilio API reference

---

## AI Author Notes

This enhancement would significantly improve the developer experience for AI agents using the MCP server. The goal is to make the server **self-documenting** so that AI agents can discover and use tools correctly without external file access.

**Key insight:** AI agents have access to tool descriptions via the MCP protocol, but not to project files. Therefore, all necessary usage information should be embedded in tool metadata.
