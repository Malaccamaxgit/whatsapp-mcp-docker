# ENHANCEMENT: Chat Message Statistics

**Status: PROPOSED**  
**Priority: Medium**  
**Created: 2026-04-06**

---

## Problem Statement

The `list_chats` tool returns chat metadata (name, unread count, last message preview) but lacks message activity statistics. Users who want to know:

1. **Total messages in a chat** - must call `export_chat_data` and count records
2. **Message volume over time** - has no efficient query method
3. **Recent message activity** - must manually compute from message timestamps

This is inefficient for a simple count query. The database already stores all messages, so computing these statistics on-demand would be trivial.

Additionally, while `unread_count` and `last_message_at` exist in the chat row, they are not always clear in the output format.

---

## Current Implementation

### ChatRow Type (incomplete for stats)

```typescript
// src/whatsapp/store.ts:15-23

type ChatRow = {
  jid: string;
  name: string | null;
  is_group: number;
  unread_count: number;       // EXISTS - but not clearly labeled in output
  last_message_at: number | null;  // EXISTS - but not clearly labeled in output
  last_message_preview: string | null;
  updated_at: number;
  // MISSING: message_count
  // MISSING: messages_last_hour
};
```

### Current list_chats Output

```
[Group] WhatsAppMCP
     Last: 2026-04-05, 22:05:34
     JID: 120363406696586603@g.us [Group]
```

No message count is shown. Users see unread count only if there are unread messages.

### Existing Pattern: getCatchUpData

The store already computes `recent_messages` via SQL JOIN for the catch-up feature:

```typescript
// src/whatsapp/store.ts:1436-1451

const activeChats = this._decryptRows(
  this.db!
    .prepare(
      `
  SELECT c.jid, c.name, c.is_group, c.unread_count,
         COUNT(m.id) as recent_messages
  FROM chats c
  LEFT JOIN messages m ON m.chat_jid = c.jid AND m.timestamp > ?
  WHERE c.last_message_at > ?
  GROUP BY c.jid
  ORDER BY c.last_message_at DESC
  LIMIT 20
`
    )
    .all(sinceTimestamp, sinceTimestamp)
) as (ChatRow & { recent_messages: number })[];
```

This pattern can be adapted for `list_chats`.

---

## Proposed Solution

Enhance `list_chats` output to include per-chat message statistics:

| Field | Description | Source |
|-------|-------------|--------|
| `message_count` | Total messages in chat | `COUNT(m.id)` via LEFT JOIN |
| `messages_last_hour` | Messages in last 60 minutes | `COUNT` with timestamp filter |
| `unread_count` | Unread messages | Already in `chats` table |
| `last_message_at` | Datetime of most recent message | Already in `chats` table |

### Enhanced Output Format

**Before:**
```
[Group] WhatsAppMCP
     Last: 2026-04-05, 22:05:34
     JID: 120363406696583@g.us [Group]
```

**After:**
```
[Group] WhatsAppMCP
     Last: 2026-04-05, 22:05:34 | 3 messages | 0 unread | 0 last hour
     JID: 120363406696583@g.us [Group]
```

---

## Implementation Details

### 1. Extended ChatRow Type

```typescript
// src/whatsapp/store.ts

type ChatRow = {
  jid: string;
  name: string | null;
  is_group: number;
  unread_count: number;
  last_message_at: number | null;
  last_message_preview: string | null;
  updated_at: number;
  // NEW: computed fields for list_chats
  message_count?: number;
  messages_last_hour?: number;
};
```

### 2. New Store Method: listChatsWithStats

```typescript
// src/whatsapp/store.ts

/**
 * List chats with message statistics.
 * Computes total messages and messages in the last hour per chat.
 */
public listChatsWithStats ({ 
  filter, 
  groupsOnly, 
  limit = 20, 
  offset = 0 
}: { 
  filter?: string; 
  groupsOnly?: boolean; 
  limit?: number; 
  offset?: number 
} = {}): (ChatRow & { message_count: number; messages_last_hour: number })[] {
  const oneHourAgo = Math.floor(Date.now() / 1000) - 3600;
  
  let sql = `
    SELECT 
      c.jid,
      c.name,
      c.is_group,
      c.unread_count,
      c.last_message_at,
      c.last_message_preview,
      c.updated_at,
      COUNT(m.id) as message_count,
      SUM(CASE WHEN m.timestamp > ? THEN 1 ELSE 0 END) as messages_last_hour
    FROM chats c
    LEFT JOIN messages m ON m.chat_jid = c.jid
    WHERE 1=1
  `;
  const params: (string | number)[] = [oneHourAgo];

  if (filter) {
    sql += ' AND c.name LIKE ?';
    params.push(`%${filter}%`);
  }
  if (groupsOnly) {
    sql += ' AND c.is_group = 1';
  }

  sql += ' GROUP BY c.jid ORDER BY c.last_message_at DESC NULLS LAST LIMIT ? OFFSET ?';
  params.push(limit, offset);

  return this._decryptRows(
    this.db!.prepare(sql).all(...params)
  ) as (ChatRow & { message_count: number; messages_last_hour: number })[];
}
```

### 3. Update getAllChatsUnified for Stats

For the unified (multi-device) chat view, modify the merging logic to sum message counts:

```typescript
// src/whatsapp/store.ts - in getAllChatsUnified()

// After merging chats, compute message stats for unified JIDs
public getAllChatsUnifiedWithStats ({ 
  filter, 
  groupsOnly, 
  limit = 20, 
  offset = 0 
} = {}): (ChatRow & { message_count: number; messages_last_hour: number })[] {
  // Get chats with stats from database
  const chatsWithStats = this.listChatsWithStats({ filter, groupsOnly, limit: 1000, offset: 0 });
  
  // Apply existing unification logic (merge duplicate JIDs)
  const mappings = this.getAllContactMappings();
  const unifiedMap = new Map<string, ChatRow & { message_count: number; messages_last_hour: number }>();
  
  for (const chat of chatsWithStats) {
    // ... existing unification logic ...
    
    // For merged chats, sum the message counts
    if (existing) {
      existing.message_count += chat.message_count;
      existing.messages_last_hour += chat.messages_last_hour;
      // ... rest of merge logic ...
    }
  }
  
  // Apply pagination after unification
  return Array.from(unifiedMap.values())
    .sort((a, b) => (b.last_message_at || 0) - (a.last_message_at || 0))
    .slice(offset, offset + limit);
}
```

### 4. Updated list_chats Tool Output

```typescript
// src/tools/chats.ts - in registerChatTools 'list_chats' handler

const lines = readableChats.map((c) => {
  const type = c.is_group ? '[Group]' : '[Chat]';
  const name = c.name || c.jid;
  const unread = c.unread_count > 0 ? ` (${c.unread_count} unread)` : '';
  const time = c.last_message_at
    ? formatTimestamp(c.last_message_at)
    : 'never';
  
  // NEW: Message statistics
  const msgCount = c.message_count ?? 0;
  const lastHour = c.messages_last_hour ?? 0;
  const stats = `${msgCount} messages${lastHour > 0 ? ` | ${lastHour} last hour` : ''}`;
  
  // Format: "3 messages | 1 unread | 0 last hour" or just "3 messages"
  const statsParts = [`${msgCount} messages`];
  if (c.unread_count > 0) statsParts.push(`${c.unread_count} unread`);
  if (lastHour > 0) statsParts.push(`${lastHour} last hour`);
  const statsLine = statsParts.join(' | ');
  
  const preview = c.last_message_preview
    ? `: ${c.last_message_preview.substring(0, 60)}${c.last_message_preview.length > 60 ? '...' : ''}`
    : '';
  
  // ... JID display logic remains unchanged ...
  
  return `${type} ${name}${unread}\n     Last: ${time} | ${statsLine}\n     JID: ${jidInfo} ${jidType.shortLabel}`;
});
```

---

## Use Cases

### Use Case 1: Dashboard Overview

```
User: list_chats

[Group] WhatsAppMCP
     Last: 2026-04-05, 22:05:34 | 3 messages | 0 last hour
     JID: 120363406696586603@g.us [Group]

[Chat] Benjamin Alloul (1 unread)
     Last: 2026-04-05, 22:01:43 | 3 messages | 1 last hour
     JID: 44612043436101@lid [LID]

[Chat] Kapso AI Support (4 unread)
     Last: 2026-04-05, 21:10:18 | 4 messages | 2 last hour
     JID: 138053771370743@lid [LID]
```

User can immediately see:
- Chat volume (message count)
- Recent activity (last hour)
- Unread messages

### Use Case 2: Activity-Based Filtering

A future enhancement could filter by `min_messages` or `active_last_hour`:

```typescript
// Future extension
list_chats({ min_messages: 10, active_last_hour: true })
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/whatsapp/store.ts` | Add `listChatsWithStats()`, `getAllChatsUnifiedWithStats()` methods |
| `src/tools/chats.ts` | Update `list_chats` output format to include message stats |
| `docs/API.md` | Document updated `list_chats` response format |
| `README.md` | Update tool description to mention message statistics |

---

## Alternative Approach: Separate Stats Tool

Instead of modifying `list_chats`, create a dedicated `get_chat_stats` tool:

```typescript
server.registerTool(
  'get_chat_stats',
  {
    description: 'Get message statistics for one or more chats',
    inputSchema: {
      jids: z.array(z.string()).max(50).describe('Chat JIDs to get stats for')
    }
  },
  async ({ jids }: { jids: string[] }) => {
    // Return message counts per chat
  }
);
```

**Pros:**
- Doesn't change `list_chats` output
- Can request stats for specific chats only

**Cons:**
- Requires two API calls (list_chats + get_chat_stats)
- Less convenient for dashboard use case

**Recommendation:** Integrate stats into `list_chats` as proposed, since the use case is showing statistics in the chat list view.

---

## Performance Considerations

### Query Complexity

The LEFT JOIN with COUNT is O(n) where n = total messages. For databases with many messages:

```sql
-- Efficient: one query with indexes
SELECT c.jid, c.name, COUNT(m.id)
FROM chats c LEFT JOIN messages m ON m.chat_jid = c.jid
GROUP BY c.jid
```

### Optimization: Index on chat_jid

Ensure the `messages` table has an index on `chat_jid`:

```sql
CREATE INDEX IF NOT EXISTS idx_messages_chat_jid ON messages(chat_jid);
```

This index already exists in `store.ts:_migrate()`:

```typescript
// src/whatsapp/store.ts:177
this.db!.exec(`CREATE INDEX IF NOT EXISTS idx_messages_chat_jid ON messages(chat_jid)`);
```

### Caching Consideration

For very large chat lists (100+ chats), consider caching stats with a TTL. However, the simple COUNT approach is fast enough for typical usage.

---

## Testing Plan

```typescript
// test/unit/chat-stats.test.ts

describe('list_chats message statistics', () => {
  test('includes message count for each chat', async () => {
    // Create chat with 5 messages
    // Call list_chats
    // Expect message_count: 5
  });

  test('counts messages in last hour correctly', async () => {
    // Create chat with messages spread across hours
    // 3 messages in last hour, 2 older than 1 hour
    // Call list_chats
    // Expect messages_last_hour: 3, message_count: 5
  });

  test('handles zero-message chats', async () => {
    // Create chat with no messages
    // Call list_chats
    // Expect message_count: 0, messages_last_hour: 0
  });

  test('merges stats for unified JIDs', async () => {
    // Create LID and phone JID for same contact
    // Some messages under LID, some under phone JID
    // Call list_chats (which uses getAllChatsUnified)
    // Expect combined message count
  });

  test('formats output with all stats', async () => {
    // Create chat with 10 messages, 2 unread, 3 in last hour
    // Call list_chats
    // Expect: "10 messages | 2 unread | 3 last hour"
  });

  test('hides last hour when zero', async () => {
    // Create chat with no recent messages
    // Call list_chats
    // Expect: "5 messages" (no last hour shown)
  });
});
```

---

## Success Metrics

| Metric | Before | After |
|--------|--------|-------|
| API calls to get chat stats | 2 (list_chats + export_chat_data) | 1 (list_chats) |
| Message count visibility | Not shown in list | Shown per chat |
| Recent activity visibility | Not available | Shown per chat |
| User effort for stats summary | High (manual count) | Low (automatic) |