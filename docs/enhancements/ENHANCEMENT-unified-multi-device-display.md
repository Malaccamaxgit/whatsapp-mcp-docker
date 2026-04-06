# ENHANCEMENT: Unified Multi-Device Contact Display

**Status: PROPOSED**  
**Priority: High**  
**Created: 2026-04-05**
**Depends on: ENHANCEMENT-multi-device-jid-mapping (ARCHIVED - schema implemented)**

---

## Problem Statement

The multi-device JID mapping schema has been implemented (see `src/whatsapp/store.ts` - `contacts`, `contact_devices`, `contact_phone_jids` tables), but the **display layer still shows each JID as a separate contact**.

### Current Behavior

When a user has multiple WhatsApp devices (phone, desktop, web), they appear as separate conversations:

```
[Chat] Benjamin Alloul (1 unread)
     JID: 44612043436101@lid [LID]

[Chat] 138053771370743@lid (4 unread)
     JID: 138053771370743@lid [LID]

[Chat] 14384083030@s.whatsapp.net
     JID: 14384083030@s.whatsapp.net [User]
```

All three JIDs belong to the **same person** (the account owner), but appear as 3 separate chats.

### Expected Behavior

All devices linked to the same phone number should be **merged into one unified contact**:

```
[Chat] Benjamin Alloul (5 unread)
     Primary: 14384083030@s.whatsapp.net [User]
     Devices: 44612043436101@lid [LID], 128819088347371@lid [LID]
```

---

## Current Implementation Gap

### What's Implemented

```typescript
// src/whatsapp/store.ts - Schema EXISTS
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY,
  phone_number TEXT NOT NULL UNIQUE,
  canonical_name TEXT,
  is_self INTEGER DEFAULT 0,
  ...
);

CREATE TABLE IF NOT EXISTS contact_devices (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER NOT NULL,
  lid_jid TEXT NOT NULL UNIQUE,
  device_type TEXT,
  device_name TEXT,
  is_primary INTEGER DEFAULT 0,
  ...
);

CREATE TABLE IF NOT EXISTS contact_phone_jids (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER NOT NULL,
  phone_jid TEXT NOT NULL,
  ...
);
```

### What's NOT Implemented

The `list_chats` and `search_contacts` tools do NOT use the multi-device schema to merge JIDs. They still query the `chats` table directly without joining to the contacts/devices tables.

```typescript
// src/tools/chats.ts - current implementation
const chats = store.getAllChatsForMatching();
// ❌ Returns separate rows for each JID, not merged

// src/utils/jid-utils.ts - helpers exist but not used in display
export async function getAllRelatedJids(jid: string, store: MessageStore): Promise<string[]>
```

---

## Proposed Solution

### 1. Add `getUnifiedChats()` to MessageStore

```typescript
// src/whatsapp/store.ts

/**
 * Get all chats with JIDs merged under their unified contacts.
 * Multiple JIDs belonging to the same contact appear as one entry.
 */
public getUnifiedChats (options?: { limit?: number; page?: number }): UnifiedChatInfo[] {
  const chats = this.getAllChatsForMatching();
  
  // Group chats by contact
  const contactMap = new Map<number, UnifiedChatInfo>();
  const orphanChats: ChatInfo[] = [];
  
  for (const chat of chats) {
    const contact = this.getContactByJid(chat.jid);
    
    if (contact) {
      // This JID belongs to a known contact
      const existing = contactMap.get(contact.id);
      
      if (existing) {
        // Merge into existing unified chat
        existing.jids.push(chat.jid);
        existing.devices.push({
          jid: chat.jid,
          jidType: getJidTypeInfo(chat.jid),
          unreadCount: chat.unread_count || 0,
          lastMessage: chat.last_message_at,
          lastPreview: chat.last_message_preview
        });
        // Update aggregated values
        if (chat.last_message_at && (!existing.lastMessage || chat.last_message_at > existing.lastMessage)) {
          existing.lastMessage = chat.last_message_at;
          existing.lastPreview = chat.last_message_preview;
        }
        existing.unreadCount += chat.unread_count || 0;
      } else {
        // First chat for this contact
        contactMap.set(contact.id, {
          contactId: contact.id,
          name: contact.canonicalName || contact.phoneNumber,
          phoneNumber: contact.phoneNumber,
          primaryJid: this.getPrimaryJid(contact),
          jids: [chat.jid],
          devices: [{
            jid: chat.jid,
            jidType: getJidTypeInfo(chat.jid),
            unreadCount: chat.unread_count || 0,
            lastMessage: chat.last_message_at,
            lastPreview: chat.last_message_preview
          }],
          unreadCount: chat.unread_count || 0,
          lastMessage: chat.last_message_at,
          lastPreview: chat.last_message_preview,
          isGroup: false
        });
      }
    } else {
      // No contact mapping - keep as orphan
      orphanChats.push(chat);
    }
  }
  
  // Convert to array and add orphans
  const unified = [...contactMap.values(), ...orphanChats.map(c => this.chatToOrphan(c))];
  
  // Sort by last message time
  unified.sort((a, b) => (b.lastMessage || 0) - (a.lastMessage || 0));
  
  // Apply pagination
  const offset = (options?.page || 0) * (options?.limit || 20);
  return unified.slice(offset, offset + (options?.limit || 20));
}

private getPrimaryJid (contact: Contact): string {
  // Prefer: primary device LID > first device LID > phone JID
  const primaryDevice = contact.devices.find(d => d.isPrimary);
  if (primaryDevice) return primaryDevice.lidJid;
  if (contact.devices.length > 0) return contact.devices[0].lidJid;
  if (contact.phoneJids.length > 0) return contact.phoneJids[0];
  return `${contact.phoneNumber}@s.whatsapp.net`;
}
```

### 2. Update `list_chats` Output

```typescript
// src/tools/chats.ts

const unifiedChats = store.getUnifiedChats({ limit: safeLimit, page });

const lines = unifiedChats.map((chat) => {
  if (chat.isGroup) {
    // Groups show as before
    return `[Group] ${chat.name}\n     JID: ${chat.jids[0]} [Group]`;
  }
  
  if (chat.jids.length === 1) {
    // Single JID - show simple format
    const device = chat.devices[0];
    return `[Chat] ${chat.name || chat.jids[0]}${chat.unreadCount > 0 ? ` (${chat.unreadCount} unread)` : ''}\n` +
           `     JID: ${chat.jids[0]} ${device.jidType.shortLabel}`;
  }
  
  // Multiple JIDs - show unified format
  const deviceList = chat.devices.map(d => 
    `       - ${d.jid} ${d.jidType.shortLabel}${d.unreadCount > 0 ? ` (${d.unreadCount} unread)` : ''}`
  ).join('\n');
  
  return `[Chat] ${chat.name}${chat.unreadCount > 0 ? ` (${chat.unreadCount} unread)` : ''}\n` +
         `     Primary: ${chat.primaryJid} [User]\n` +
         `     Devices (${chat.jids.length}):\n${deviceList}`;
});
```

### 3. Update `search_contacts` Output

```typescript
// src/tools/contacts.ts

// When searching, show unified contact with all devices
const unifiedResults = store.searchUnifiedContacts(query, limit);

const lines = unifiedResults.map((contact) => {
  const deviceList = contact.devices.map(d =>
    `  - ${d.jid} ${d.jidType.shortLabel}${d.isPrimary ? ' [primary]' : ''}`
  ).join('\n');
  
  return `\n${contact.name} (${contact.phoneNumber})\n` +
         `  Devices (${contact.devices.length}):\n${deviceList}`;
});
```

### 4. Types

```typescript
// src/whatsapp/store.ts

export interface UnifiedChatInfo {
  contactId: number | null;
  name: string;
  phoneNumber: string | null;
  primaryJid: string;
  jids: string[];
  devices: DeviceChatInfo[];
  unreadCount: number;
  lastMessage: number | null;
  lastPreview: string | null;
  isGroup: boolean;
}

export interface DeviceChatInfo {
  jid: string;
  jidType: JidTypeInfo;
  unreadCount: number;
  lastMessage: number | null;
  lastPreview: string | null;
  isPrimary?: boolean;
}
```

---

## Expected Output Examples

### Single JID Contact

```
[Chat] John Smith (2 unread)
     JID: 14384083030@s.whatsapp.net [User]
```

### Multi-Device Contact (Unified)

```
[Chat] Benjamin Alloul (5 unread)
     Primary: 14384083030@s.whatsapp.net [User]
     Devices (3):
       - 14384083030@s.whatsapp.net [User] [primary] (1 unread)
       - 128819088347371@lid [LID] (2 unread)
       - 44612043436101@lid [LID] (2 unread)
```

### Group

```
[Group] WhatsAppMCP
     JID: 120363406696586603@g.us [Group]
```

### Unknown Contact (No Mapping)

```
[Chat] 138053771370743@lid (4 unread)
     JID: 138053771370743@lid [LID]
     Note: No contact mapping found
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/whatsapp/store.ts` | Add `getUnifiedChats()`, `searchUnifiedContacts()`, `getPrimaryJid()` |
| `src/tools/chats.ts` | Update `list_chats` to use `getUnifiedChats()` |
| `src/tools/contacts.ts` | Update `search_contacts` to show unified devices |
| `src/utils/jid-utils.ts` | Ensure `getJidTypeInfo()` is exported and usable |
| `test/unit/unified-chats.test.ts` | New test file |

---

## Migration Considerations

### Backward Compatibility

- Add a new tool parameter `unified: boolean = true` to `list_chats`
- If `unified: false`, return the old flat format
- `search_contacts` can also accept a `unified` parameter

```typescript
// src/tools/chats.ts

server.registerTool(
  'list_chats',
  {
    description: 'List WhatsApp conversations...',
    inputSchema: {
      filter: z.string().optional(),
      limit: z.number().default(20),
      page: z.number().default(0),
      unified: z.boolean().default(true).describe('Merge multi-device JIDs under one contact')
    }
  },
  ...
);
```

### Self-Account Detection

The unified view should detect if the contact is the **MCP user's own account**:

```typescript
// Check if any JID is the authenticated user
const isSelf = chat.jids.some(jid => jid === waClient.jid);

if (isSelf) {
  // Mark as "You" in the display
  lines.push(`${device.jid} ${device.jidType.shortLabel} [you]`);
}
```

---

## Testing Plan

```typescript
// test/unit/unified-chats.test.ts

describe('Unified Multi-Device Chat Display', () => {
  test('merges multiple LIDs under one contact', () => {
    // Create contact with 3 devices
    // Call getUnifiedChats()
    // Verify single entry with 3 devices
  });

  test('preserves unread counts across devices', () => {
    // Contact with 2 devices, 3 unread each
    // Verify total unread = 6
  });

  test('uses most recent message across devices', () => {
    // Device 1: last message 10:00
    // Device 2: last message 11:00
    // Verify unified.lastMessage = 11:00
  });

  test('separates unmapped JIDs as orphans', () => {
    // Create unmapped LID
    // Verify appears as separate entry
  });

  test('marks primary device correctly', () => {
    // Contact with is_primary device
    // Verify [primary] label appears
  });

  test('unified: false returns flat format', () => {
    // Call with unified: false
    // Verify old behavior (separate rows)
  });
});
```

---

## Success Metrics

| Metric | Before | After |
|--------|--------|-------|
| Chats shown for user with 3 devices | 3 separate entries | 1 unified entry |
| Device visibility | Hidden | Explicitly listed |
| Unread count accuracy | Fragmented | Summed across devices |
| Contact identification | Confusing | Clear primary + devices |

---

## Related Documents

- [ENHANCEMENT-multi-device-jid-mapping.md](./archived/ENHANCEMENT-multi-device-jid-mapping.md) - Original schema design (ARCHIVED, implemented)
- [ENHANCEMENT-set-contact-name.md](./ENHANCEMENT-set-contact-name.md) - Manual contact naming
- [ENHANCEMENT-sync-profile-names.md](./ENHANCEMENT-sync-profile-names.md) - Auto-sync WhatsApp names