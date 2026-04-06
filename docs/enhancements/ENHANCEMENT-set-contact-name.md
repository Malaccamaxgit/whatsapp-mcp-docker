# ENHANCEMENT: Set Contact Name Tool

**Status: PROPOSED**  
**Priority: Medium**  
**Created: 2026-04-05**

---

## Problem Statement

WhatsApp contacts may not have display names stored for several reasons:

1. **Self account** - The authenticated user's own number has no `pushName` (you don't send your own name to yourself)
2. **Privacy settings** - Users with privacy settings enabled hide their phone numbers and appear as LID JIDs
3. **New contacts** - Contacts that haven't messaged yet have no `pushName` captured
4. **Business accounts** - Some business API accounts don't provide profile names

Currently, these contacts display as raw JIDs (e.g., `138053771370743@lid`) instead of meaningful names, making chat lists and search results harder to interpret.

---

## Proposed Solution

Add a new MCP tool `set_contact_name` that allows users to manually assign a display name to any JID or phone number. The name will be stored locally and used when displaying contacts and chats.

---

## Implementation Details

### New Tool: `set_contact_name`

```typescript
// src/tools/contacts.ts

server.registerTool(
  'set_contact_name',
  {
    description: 'Set a custom display name for a contact by JID or phone number. This name is stored locally and used for display purposes.',
    inputSchema: {
      jid: z.string().max(200).describe('JID or phone number (e.g., "+14155552671" or "123456789@s.whatsapp.net")'),
      name: z.string().max(100).describe('Display name for this contact')
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  },
  
  async ({ jid, name }: { jid: string; name: string }) => {
    // Resolve JID if phone number provided
    const resolvedJid = jid.includes('@') ? jid : toJid(jid);
    if (!resolvedJid) {
      return { content: [{ type: 'text', text: `Invalid phone number: "${jid}"` }], isError: true };
    }
    
    // Store the custom name
    store.setCustomContactName(resolvedJid, name);
    audit.log('set_contact_name', 'updated', { jid: resolvedJid, name });
    
    return {
      content: [{ 
        type: 'text', 
        text: `Contact name set: ${resolvedJid} → "${name}"` 
      }]
    };
  }
);
```

### Store Method: `setCustomContactName`

```typescript
// src/whatsapp/store.ts

private _setCustomName!: Database.Statement;
private _getCustomName!: Database.Statement;

private _prepareStatements (): void {
  // ... existing statements ...
  
  // Custom contact names (user-assigned)
  this._setCustomName = this.db!.prepare(`
    INSERT INTO custom_contact_names (jid, name, updated_at)
    VALUES (?, ?, unixepoch())
    ON CONFLICT(jid) DO UPDATE SET
      name = excluded.name,
      updated_at = unixepoch()
  `);
  
  this._getCustomName = this.db!.prepare(`
    SELECT name FROM custom_contact_names WHERE jid = ?
  `);
}

/**
 * Set a custom display name for a contact.
 * This overrides any name from WhatsApp pushName.
 */
public setCustomContactName (jid: string, name: string): void {
  this._setCustomName.run(jid, name);
  
  // Also update the chat name for immediate visibility
  this.updateChatName(jid, name);
}

/**
 * Get the custom name for a contact, if set.
 */
public getCustomContactName (jid: string): string | null {
  const row = this._getCustomName.get(jid) as { name: string } | undefined;
  return row?.name ?? null;
}
```

### Schema Migration

```sql
-- New table for user-assigned contact names
CREATE TABLE IF NOT EXISTS custom_contact_names (
  jid TEXT PRIMARY KEY,           -- The JID (LID or phone JID)
  name TEXT NOT NULL,             -- User-assigned display name
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_custom_names_jid
ON custom_contact_names(jid);
```

### Updated Name Resolution Priority

```typescript
// src/whatsapp/store.ts - getChatByJid() and list_chats

// Priority order for contact names:
// 1. Custom name (user-assigned via set_contact_name)
// 2. WhatsApp pushName (from message metadata)
// 3. Group name (for groups)
// 4. JID (fallback)

public getDisplayNameForJid (jid: string): string {
  // 1. Check custom name first
  const customName = this.getCustomContactName(jid);
  if (customName) return customName;
  
  // 2. Check stored chat name (from pushName)
  const chat = this.getChatByJid(jid);
  if (chat?.name && chat.name !== jid) return chat.name;
  
  // 3. For groups, the name is authoritative
  if (isGroupJid(jid) && chat?.name) return chat.name;
  
  // 4. Fallback to JID
  return jid;
}
```

---

## Updated Tool Outputs

### `list_chats` with Custom Names

**Before:**
```
[Chat] 138053771370743@lid (4 unread)
     JID: 138053771370743@lid [LID]
```

**After (with custom name "Kapso AI"):**
```
[Chat] Kapso AI (4 unread)
     JID: 138053771370743@lid [LID]
```

### `search_contacts` with Custom Names

**Before:**
```
- 138053771370743@lid (138053771370743) [4 unread]
```

**After:**
```
- Kapso AI [4 unread]
     JID: 138053771370743@lid [LID]
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/whatsapp/store.ts` | Add `custom_contact_names` table, `setCustomContactName()`, `getCustomContactName()` |
| `src/tools/contacts.ts` | Add `set_contact_name` tool |
| `src/tools/chats.ts` | Use `getDisplayNameForJid()` in chat listing |
| `src/utils/jid-utils.ts` | Add `getDisplayNameForJid()` utility |

---

## Alternative Approach: Use Existing `contacts` Table

Instead of a new table, we could use the existing `contacts.canonical_name` field:

```typescript
// Reuse existing _updateContactName prepared statement
public setContactName (phoneNumber: string, name: string): void {
  const contact = this.getOrCreateContactByPhone(phoneNumber);
  this._updateContactName.run(name, contact.phoneNumber);
}
```

**Pros:**
- Reuses existing schema
- Works with multi-device contact linking

**Cons:**
- Requires phone number (doesn't work for LIDs without phone)
- Less flexible than JID-based approach

**Recommendation:** Use the `custom_contact_names` table approach for flexibility with LIDs.

---

## Testing Plan

```typescript
// test/unit/custom-contact-name.test.ts

describe('set_contact_name tool', () => {
  test('sets custom name for phone JID', async () => {
    await call.set_contact_name({ jid: '+14384083030', name: 'Myself' });
    const result = await call.search_contacts({ query: 'Myself' });
    expect(result).toContain('Myself');
  });

  test('sets custom name for LID', async () => {
    await call.set_contact_name({ jid: '138053771370743@lid', name: 'Kapso AI' });
    const result = await call.list_chats({});
    expect(result).toContain('Kapso AI');
  });

  test('custom name overrides pushName', async () => {
    // Contact has pushName "John"
    // User sets custom name "Johnny"
    // Display should show "Johnny"
  });

  test('clears custom name when empty string provided', async () => {
    await call.set_contact_name({ jid: '138053771370743@lid', name: '' });
    // Name should fall back to JID or pushName
  });
});
```

---

## Success Metrics

| Metric | Before | After |
|--------|--------|-------|
| Contacts with meaningful names | ~60% | >90% (with user action) |
| User ability to identify contacts | Limited | Full control |
| Group member identification | By JID only | By custom name |