# ENHANCEMENT: Sync WhatsApp Profile Names

**Status: PROPOSED**  
**Priority: Low**  
**Created: 2026-04-05**

---

## Problem Statement

When contacts have privacy settings enabled (appearing as LID JIDs), or when users haven't exchanged messages recently, the `pushName` (display name) may not be available locally. This results in contacts displaying as raw JIDs like `138053771370743@lid` instead of their WhatsApp profile names.

The `get_user_info` tool already fetches profile information from WhatsApp, but:
1. It doesn't automatically store the retrieved names
2. It requires the user to manually call it for each contact
3. LID JIDs can't always be queried by `get_user_info` (requires phone number)

---

## Current Implementation

```typescript
// src/tools/contacts.ts - get_user_info already exists

const results = await waClient.getUserInfo(jids);
// Returns: { "jid": { name?: string; status?: string; isBusiness?: boolean } }

// But this data is NOT stored - it's just returned to the user
```

The `resolveContactName` method in the client can fetch names:

```typescript
// src/whatsapp/client.ts:1535
async resolveContactName (jid: string): Promise<string | null> {
  if (!this.isConnected()) {return null;}
  try {
    if (typeof this.client!.getContact !== 'function') {return null;}
    const contact = await this.client!.getContact(jid);
    return contact?.fullName || contact?.pushName || null;
  } catch {
    return null;
  }
}
```

But this is only called during message processing, not proactively.

---

## Proposed Solution

Add a new MCP tool `sync_contact_names` that:
1. Queries WhatsApp for profile names for contacts without names
2. Stores the retrieved names in the local database
3. Optionally resolves LID JIDs to phone numbers via the `contact_mappings` table before querying

---

## Implementation Details

### New Tool: `sync_contact_names`

```typescript
// src/tools/contacts.ts

server.registerTool(
  'sync_contact_names',
  {
    description: 'Fetch and store WhatsApp profile names for contacts. Syncs all unnamed contacts, or specific contacts by JID or phone number.',
    inputSchema: {
      contacts: z.array(z.string().max(200)).max(50).optional()
        .describe('Optional list of specific contacts to sync (JIDs or phone numbers). If omitted, syncs all unnamed contacts.'),
      force: z.boolean().default(false)
        .describe('Re-fetch names even for contacts that already have names')
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
  },
  
  async ({ contacts, force = false }: { contacts?: string[]; force?: boolean }) => {
    const toolCheck = permissions.isToolEnabled('sync_contact_names');
    if (!toolCheck.allowed) {
      return { content: [{ type: 'text', text: toolCheck.error ?? 'Tool disabled' }], isError: true };
    }
    
    if (!waClient.isConnected()) {
      return notConnected();
    }
    
    // Get contacts to sync
    const jidsToSync: string[] = [];
    
    if (contacts && contacts.length > 0) {
      // Specific contacts provided
      for (const c of contacts) {
        const jid = c.includes('@') ? c : toJid(c);
        if (jid) jidsToSync.push(jid);
      }
    } else {
      // Get all contacts without names
      const allChats = store.getAllChatsForMatching();
      for (const chat of allChats) {
        if (!chat.is_group && (!chat.name || chat.name === chat.jid)) {
          jidsToSync.push(chat.jid);
        }
      }
    }
    
    if (jidsToSync.length === 0) {
      return { content: [{ type: 'text', text: 'No contacts to sync.' }] };
    }
    
    const results: { jid: string; name: string | null; status: string }[] = [];
    
    for (const jid of jidsToSync) {
      try {
        // For LID JIDs, try to find the corresponding phone number
        const mapping = store.getJidMapping(jid);
        const queryJid = mapping?.phoneJid || jid;
        
        // Fetch profile info
        const info = await waClient.getUserInfo([queryJid]);
        const name = info?.[queryJid]?.name || info?.[jid]?.name || null;
        
        if (name) {
          store.updateChatName(jid, name);
          results.push({ jid, name, status: 'updated' });
        } else {
          results.push({ jid, name: null, status: 'no_name_available' });
        }
      } catch (err) {
        results.push({ 
          jid, 
          name: null, 
          status: `error: ${(err as Error).message}` 
        });
      }
    }
    
    audit.log('sync_contact_names', 'synced', { count: results.length });
    
    // Format output
    const updated = results.filter(r => r.status === 'updated');
    const noName = results.filter(r => r.status === 'no_name_available');
    const errors = results.filter(r => r.status.startsWith('error'));
    
    const lines = [
      `Synced ${results.length} contacts:`,
      `${updated.length} names updated`,
      `${noName.length} have no profile name`,
      errors.length > 0 ? `${errors.length} errors` : null
    ].filter(Boolean);
    
    if (updated.length > 0) {
      lines.push('', 'Updated:');
      for (const r of updated.slice(0, 10)) {
        lines.push(`  ${r.jid} → "${r.name}"`);
      }
      if (updated.length > 10) {
        lines.push(`  ... and ${updated.length - 10} more`);
      }
    }
    
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
);
```

### Enhanced: `get_user_info` with Store Option

```typescript
// src/tools/contacts.ts - enhance existing tool

server.registerTool(
  'get_user_info',
  {
    description: 'Get WhatsApp profile information for one or more phone numbers. Optionally store retrieved names locally.',
    inputSchema: {
      phones: PhoneArraySchema(1, 20).describe('Phone numbers in E.164 format'),
      save_names: z.boolean().default(false)
        .describe('If true, store retrieved names in the local contact database')
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true }
  },
  
  async ({ phones, save_names = false }: { phones: string[]; save_names?: boolean }) => {
    // ... existing logic ...
    
    const results = await waClient.getUserInfo(jids);
    
    // NEW: Optionally save names
    if (save_names) {
      for (const [jid, info] of Object.entries(results)) {
        if (info?.name) {
          store.updateChatName(jid, info.name);
        }
      }
    }
    
    // ... rest of existing logic ...
  }
);
```

### Rate Limiting Consideration

WhatsApp may rate-limit profile fetches. The tool should:
1. Process contacts in batches of 5-10
2. Add a small delay between requests
3. Handle rate-limit errors gracefully

```typescript
// Add delay between profile fetches
const RATE_LIMIT_DELAY_MS = 500;

for (let i = 0; i < jidsToSync.length; i++) {
  if (i > 0) {
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
  }
  // ... fetch profile ...
}
```

---

## Use Cases

### Use Case 1: Sync All Unnamed Contacts

```
User: sync_contact_names
Tool: Synced 12 contacts:
      5 names updated
      7 have no profile name
      
      Updated:
        138053771370743@lid → "Kapso AI Support"
        14384083030@s.whatsapp.net → "John Smith"
        12062078106@s.whatsapp.net → "Jane Doe"
        ...
```

### Use Case 2: Sync Specific Contact

```
User: sync_contact_names contacts: ["+14384083030"]
Tool: Synced 1 contact:
      1 name updated
      
      Updated:
        14384083030@s.whatsapp.net → "My WhatsApp Account"
```

### Use Case 3: Auto-Sync on First Message

```typescript
// src/whatsapp/client.ts - in _handleIncomingMessage()

// When a message from unknown contact arrives
if (!chatName && !isGroup) {
  // Try to fetch profile name
  const name = await this.resolveContactName(msg.chatJid);
  if (name) {
    this.messageStore.updateChatName(msg.chatJid, name);
  }
}
```

---

## Alternative Approach: Background Sync

Instead of a manual tool, implement a background job that periodically syncs unnamed contacts:

```typescript
// src/whatsapp/client.ts

private _syncInterval?: NodeJS.Timeout;

startBackgroundSync (): void {
  // Sync every 6 hours
  this._syncInterval = setInterval(() => this.syncUnnamedContacts(), 6 * 60 * 60 * 1000);
}

async syncUnnamedContacts (): Promise<void> {
  const chats = this.messageStore.getAllChatsForMatching();
  const unnamed = chats.filter(c => !c.is_group && (!c.name || c.name === c.jid));
  
  for (const chat of unnamed.slice(0, 20)) { // Limit to 20 per sync
    const name = await this.resolveContactName(chat.jid);
    if (name) {
      this.messageStore.updateChatName(chat.jid, name);
    }
    await new Promise(r => setTimeout(r, 1000)); // 1s delay
  }
}
```

**Pros:**
- Automatic, no user action needed
- Keeps names up-to-date

**Cons:**
- Background activity without user knowledge
- May hit rate limits if too aggressive
- User can't control timing

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/tools/contacts.ts` | Add `sync_contact_names` tool, enhance `get_user_info` with `save_names` |
| `src/whatsapp/client.ts` | Optionally add background sync |
| `catalog/whatsapp-mcp-docker-server.yaml` | Add new tool to MCP catalog |

---

## Testing Plan

```typescript
// test/unit/sync-contact-names.test.ts

describe('sync_contact_names tool', () => {
  test('syncs unnamed contacts', async () => {
    // Create contacts without names
    // Call sync_contact_names
    // Verify names fetched and stored
  });

  test('handles LID JIDs via phone mapping', async () => {
    // Create LID contact with phone mapping
    // Call sync_contact_names with LID
    // Verify phone JID used for lookup
  });

  test('rate limits gracefully', async () => {
    // Mock rate limit error
    // Verify tool handles and reports error
  });

  test('save_names option in get_user_info', async () => {
    // Call get_user_info with save_names: true
    // Verify name stored in database
  });
});
```

---

## Success Metrics

| Metric | Before | After |
|--------|--------|-------|
| Contacts with names after sync | Manual only | Automatic option |
| User effort to name contacts | High | Low |
| Profile name freshness | Stale | Can refresh on demand |