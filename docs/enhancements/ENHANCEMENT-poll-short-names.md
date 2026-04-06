# ENHANCEMENT: Poll Short Names for Easy Retrieval

**Status: PROPOSED**  
**Priority: Medium**  
**Created: 2026-04-05**

---

## Problem Statement

When a poll is created via `create_poll`, the tool returns a long message ID like `3EB02FEDA9F1FCC299D926`. This creates several usability issues:

1. **Memory burden** — Users cannot easily remember or reference polls by their 26-character hex IDs
2. **Verbose commands** — Retrieving poll results requires copying/pasting the full ID: `get_poll_results --poll_message_id "3EB02FEDA9F1FCC299D926"`
3. **Discovery difficulty** — If a user creates multiple polls, they have no way to list or find them without searching through all messages
4. **Error-prone** — Typo risk when manually entering IDs

### Current Workflow (Painful)

```
User: create_poll --question "What is your favorite food?" --options ["Pizza", "Burger", "Sushi"]
Tool: Poll sent. Message ID: 3EB02FEDA9F1FCC299D926

[Later, user wants results...]

User: get_poll_results --poll_message_id "3EB02FEDA9F1FCC299D926"
                        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                        User must copy/paste or remember this

[If user forgets the ID...]

User: list_messages --chat "WhatsAppMCP"
[Scroll through messages looking for poll...]
[Find poll message ID...] 
[Copy ID...]
[Get results...]
```

---

## Proposed Solution

Add an optional `short_name` parameter to `create_poll` that creates a memorable alias for the poll. Users can then retrieve poll results using the short name instead of the message ID.

Additionally, polls should be stored in a dedicated `polls` table for efficient querying and listing.

---

## Implementation Details

### 1. New `polls` Table Schema

```sql
-- New table in src/whatsapp/store.ts migration
CREATE TABLE IF NOT EXISTS polls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL UNIQUE,   -- WhatsApp message ID
  short_name TEXT UNIQUE,              -- User-assigned alias (optional)
  chat_jid TEXT NOT NULL,              -- Where poll was sent
  question TEXT NOT NULL,               -- Poll question text
  options TEXT NOT NULL,               -- JSON array of options
  allow_multiple INTEGER DEFAULT 0,     -- Allow multiple selections
  created_at INTEGER DEFAULT (unixepoch()),
  created_by TEXT                       -- User JID who created poll
);

CREATE INDEX IF NOT EXISTS idx_polls_message_id ON polls(message_id);
CREATE INDEX IF NOT EXISTS idx_polls_short_name ON polls(short_name);
CREATE INDEX IF NOT EXISTS idx_polls_chat_jid ON polls(chat_jid);
```

### 2. Enhanced `create_poll` Tool

```typescript
// src/tools/reactions.ts

const createPollHandler = async ({
  to,
  question,
  options,
  allow_multiple = false,
  short_name // NEW: optional parameter
}: {
  to: string;
  question: string;
  options: string[];
  allow_multiple?: boolean;
  short_name?: string; // NEW
}) => {
  // ... existing validation ...

  // Validate short_name if provided
  if (short_name) {
    if (!/^[a-zA-Z0-9_-]{3,50}$/.test(short_name)) {
      return {
        content: [{ 
          type: 'text', 
          text: 'Short name must be 3-50 characters, alphanumeric, underscore, or hyphen only.' 
        }],
        isError: true
      };
    }
    const existing = store.getPollByShortName(short_name);
    if (existing) {
      return {
        content: [{ 
          type: 'text', 
          text: `Short name "${short_name}" is already in use for another poll.` 
        }],
        isError: true
      };
    }
  }

  // Create poll
  const result = await waClient.createPoll(jid, question, options, allow_multiple ?? false);
  const messageId = result?.id;

  // Store poll in database
  store.createPoll({
    messageId,
    shortName: short_name || null,
    chatJid: jid,
    question,
    options: JSON.stringify(options),
    allowMultiple: allow_multiple ? 1 : 0,
    createdBy: waClient.jid
  });

  audit.log('create_poll', 'sent', { jid, question, optionCount: options.length, shortName: short_name });

  const shortNameInfo = short_name ? `\nShort name: "${short_name}"` : '';
  return {
    content: [{
      type: 'text',
      text: `Poll sent to ${jid}.\nQuestion: "${question}"\nOptions: ${options.map((o, i) => `${i+1}. ${o}`).join(', ')}\nMultiple answers: ${allow_multiple ? 'yes' : 'no'}\nMessage ID: ${messageId}${shortNameInfo}`
    }]
  };
};

// Register tool with updated schema
server.registerTool(
  'create_poll',
  {
    description: 'Send a poll to a WhatsApp chat. Participants can vote on one or more options. Optionally assign a short name for easy retrieval.',
    inputSchema: {
      to: z.string().max(200).describe('Recipient: contact name, group name, phone number, or JID'),
      question: z.string().min(1).max(255).describe('Poll question'),
      options: z.array(z.string().min(1).max(100)).min(2).max(12).describe('Poll answer options (2–12 options)'),
      allow_multiple: z.boolean().default(false).describe('Allow participants to select multiple answers'),
      short_name: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_-]+$/).optional()
        .describe('Optional memorable name to reference this poll later (e.g., "lunch-poll", "team-vote")')
    },
    annotations: { destructiveHint: false, openWorldHint: true }
  },
  createPollHandler as any
);
```

### 3. Enhanced `get_poll_results` Tool

```typescript
// src/tools/messaging.ts

const getPollResultsHandler = async ({
  poll_message_id,
  chat,
  // NEW: alternative lookups
  poll_name,
  question
}: {
  poll_message_id?: string;
  chat?: string;
  poll_name?: string;  // NEW: look up by short name
  question?: string;   // NEW: look up by partial question match
}) => {
  // Must provide exactly one lookup method
  const lookups = [poll_message_id, poll_name, question].filter(Boolean);
  if (lookups.length !== 1) {
    return {
      content: [{ 
        type: 'text', 
        text: 'Provide exactly one of: poll_message_id, poll_name, or question' 
      }],
      isError: true
    };
  }

  // Resolve poll
  let poll;
  
  if (poll_message_id) {
    poll = store.getPollByMessageId(poll_message_id);
  } else if (poll_name) {
    poll = store.getPollByShortName(poll_name);
  } else if (question) {
    // Must also provide chat for question lookup
    if (!chat) {
      return {
        content: [{ 
          type: 'text', 
          text: 'When searching by question, you must also provide the chat parameter.' 
        }],
        isError: true
      };
    }
    const resolved = resolveRecipient(chat, store.getAllChatsForMatching());
    if (!resolved.resolved) {
      return { content: [{ type: 'text', text: resolved.error ?? 'Chat not found' }], isError: true };
    }
    poll = store.findPollByQuestion(resolved.resolved, question);
  }

  if (!poll) {
    const hint = poll_name 
      ? `No poll found with short name "${poll_name}". Use list_polls to see all polls.`
      : poll_message_id 
        ? `Poll not found: ${poll_message_id}`
        : `No poll found matching "${question}"`;
    return { content: [{ type: 'text', text: hint }], isError: true };
  }

  // Get poll results
  const votes = store.getPollVotes(poll.message_id, poll.chat_jid);
  
  // ... render results ...
};

// Register with new parameters
server.registerTool(
  'get_poll_results',
  {
    description: 'Get poll results including vote counts for each option. Look up polls by message ID, short name, or question.',
    inputSchema: {
      poll_message_id: z.string().optional().describe('Message ID of the poll (from create_poll)'),
      poll_name: z.string().optional().describe('Short name assigned when poll was created'),
      question: z.string().optional().describe('Partial text to match poll question (requires chat parameter)'),
      chat: z.string().max(200).optional().describe('Chat where poll was sent (required for question lookup)')
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  getPollResultsHandler as any
);
```

### 4. New `list_polls` Tool

```typescript
// src/tools/messaging.ts

server.registerTool(
  'list_polls',
  {
    description: 'List all polls in a chat, or all polls created by you. Helps find poll IDs and short names.',
    inputSchema: {
      chat: z.string().max(200).optional().describe('Optional: filter to a specific chat'),
      limit: z.number().default(20).describe('Maximum polls to return')
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },

  async ({ chat, limit = 20 }: { chat?: string; limit?: number }) => {
    const resolved = chat 
      ? resolveRecipient(chat, store.getAllChatsForMatching())
      : null;

    const chatJid = resolved?.resolved || null;
    const polls = store.listPolls({ chatJid, limit });

    if (polls.length === 0) {
      return { 
        content: [{ 
          type: 'text', 
          text: 'No polls found.' + (chat ? ` In chat "${chat}".` : '') 
        }] 
      };
    }

    const lines = [`${polls.length} poll(s) found:\n`];
    
    for (const poll of polls) {
      const created = new Date(poll.created_at * 1000).toLocaleString();
      const nameInfo = poll.short_name 
        ? `Short name: "${poll.short_name}"\n  `
        : '';
      
      lines.push(
        `Poll: "${poll.question}"`,
        `  ${nameInfo}Message ID: ${poll.message_id}`,
        `  Chat: ${poll.chat_name || poll.chat_jid}`,
        `  Created: ${created}`,
        `  Options: ${JSON.parse(poll.options).join(', ')}`,
        ''
      );
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
);
```

### 5. Store Methods

```typescript
// src/whatsapp/store.ts

private _createPoll!: Database.Statement;
private _getPollByMessageId!: Database.Statement;
private _getPollByShortName!: Database.Statement;
private _findPollByQuestion!: Database.Statement;
private _listPolls!: Database.Statement;

private _prepareStatements (): void {
  // ... existing statements ...

  // Poll statements
  this._createPoll = this.db!.prepare(`
    INSERT INTO polls (message_id, short_name, chat_jid, question, options, allow_multiple, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  this._getPollByMessageId = this.db!.prepare(`
    SELECT p.*, c.name as chat_name 
    FROM polls p
    LEFT JOIN chats c ON c.jid = p.chat_jid
    WHERE p.message_id = ?
  `);

  this._getPollByShortName = this.db!.prepare(`
    SELECT p.*, c.name as chat_name 
    FROM polls p
    LEFT JOIN chats c ON c.jid = p.chat_jid
    WHERE p.short_name = ?
  `);

  this._findPollByQuestion = this.db!.prepare(`
    SELECT p.*, c.name as chat_name 
    FROM polls p
    LEFT JOIN chats c ON c.jid = p.chat_jid
    WHERE p.chat_jid = ? AND p.question LIKE ?
    ORDER BY p.created_at DESC
    LIMIT 1
  `);

  this._listPolls = this.db!.prepare(`
    SELECT p.*, c.name as chat_name 
    FROM polls p
    LEFT JOIN chats c ON c.jid = p.chat_jid
    WHERE (? IS NULL OR p.chat_jid = ?)
    ORDER BY p.created_at DESC
    LIMIT ?
  `);
}

public createPoll (params: {
  messageId: string;
  shortName: string | null;
  chatJid: string;
  question: string;
  options: string;
  allowMultiple: number;
  createdBy: string;
}): void {
  this._createPoll.run(
    params.messageId,
    params.shortName,
    params.chatJid,
    params.question,
    params.options,
    params.allowMultiple,
    params.createdBy
  );
}

public getPollByMessageId (messageId: string): PollRow | null {
  return this._getPollByMessageId.get(messageId) as PollRow | null;
}

public getPollByShortName (shortName: string): PollRow | null {
  return this._getPollByShortName.get(shortName) as PollRow | null;
}

public findPollByQuestion (chatJid: string, questionPattern: string): PollRow | null {
  return this._findPollByQuestion.get(chatJid, `%${questionPattern}%`) as PollRow | null;
}

public listPolls ({ chatJid, limit }: { chatJid: string | null; limit: number }): PollRow[] {
  return this._listPolls.all(chatJid, chatJid, limit) as PollRow[];
}
```

---

## Updated Workflow (Improved)

### Creating a Poll

```
User: create_poll 
       --question "What is your favorite food?" 
       --options ["Pizza", "Burger", "Sushi"]
       --short_name "food-poll"

Tool: Poll sent to WhatsAppMCP.
      Question: "What is your favorite food?"
      Options: Pizza, Burger, Sushi
      Short name: "food-poll"
      Message ID: 3EB02FEDA9F1FCC299D926
```

### Retrieving Poll Results (Multiple Options)

```
User: get_poll_results --poll_name "food-poll"
                       ^^^^^^^^^^^^
                       Much easier than copying message ID!

Tool: Poll: What is your favorite food?
      Total votes: 2

      Results:
        Pizza: 1 votes (50.0%)
          [████████░░]
          Voters: John at 2026-04-05 22:10:00
        Burger: 1 votes (50.0%)
          [████████░░]
          Voters: Jane at 2026-04-05 22:11:00
        Sushi: 0 votes (0.0%)
          [░░░░░░░░░░]
```

### Listing All Polls

```
User: list_polls

Tool: 3 poll(s) found:

      Poll: "What is your favorite food?"
        Short name: "food-poll"
        Message ID: 3EB02FEDA9F1FCC299D926
        Chat: WhatsAppMCP
        Created: 2026-04-05 22:05:00
        Options: Pizza, Burger, Sushi

      Poll: "Team outing activity?"
        Short name: "team-outing"
        Message ID: AC6523625AC442D497F75150AAAEB777
        Chat: Team Chat
        Created: 2026-04-04 15:30:00
        Options: Bowling, Escape Room, Karaoke

      Poll: "Lunch order?"
        Message ID: ACFB433DE22405316414C04AED4EC907
        Chat: Lunch Channel
        Created: 2026-04-03 12:00:00
        Options: Sandwich, Salad, Pizza
```

### Finding Poll Without Short Name

```
User: get_poll_results --question "favorite food" --chat "WhatsAppMCP"

Tool: Poll: What is your favorite food?
      Total votes: 2
      ...
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/whatsapp/store.ts` | Add `polls` table migration, poll CRUD methods |
| `src/tools/reactions.ts` | Add `short_name` parameter to `create_poll` |
| `src/tools/messaging.ts` | Enhance `get_poll_results` with multiple lookup methods, add `list_polls` tool |
| `catalog/whatsapp-mcp-docker-server.yaml` | Update tool schemas with new parameters |

---

## Database Migration Strategy

The `polls` table migration should be added to the existing `_migrate()` method in [`src/whatsapp/store.ts`](src/whatsapp/store.ts):

```typescript
// Add after poll_votes table creation (around line 202)

// Add polls table for poll metadata and short names
try {
  this.db!.exec(`
    CREATE TABLE IF NOT EXISTS polls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT NOT NULL UNIQUE,
      short_name TEXT UNIQUE,
      chat_jid TEXT NOT NULL,
      question TEXT NOT NULL,
      options TEXT NOT NULL,
      allow_multiple INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()),
      created_by TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_polls_message_id ON polls(message_id);
    CREATE INDEX IF NOT EXISTS idx_polls_short_name ON polls(short_name);
    CREATE INDEX IF NOT EXISTS idx_polls_chat_jid ON polls(chat_jid);
  `);
  console.error('[STORE] polls table created');
} catch (error: unknown) {
  console.error('[STORE] polls migration note:', (error as Error).message);
}
```

---

## Backward Compatibility

- `poll_message_id` remains the primary lookup method for `get_poll_results`
- Short names are optional — existing poll workflows continue unchanged
- Polls without short names are still searchable via `list_polls` or `question` parameter

---

## Edge Cases

### 1. Duplicate Short Names

```
User: create_poll --short_name "food" ...
Tool: Error: Short name "food" is already in use for another poll.
```

### 2. Invalid Short Name Characters

```
User: create_poll --short_name "my poll" ...  [contains space]
Tool: Error: Short name must be 3-50 characters, alphanumeric, underscore, or hyphen only.
```

### 3. Poll Deleted from WhatsApp

```
User: get_poll_results --poll_name "food"
Tool: Poll "food" exists in database but message not found in chat.
      It may have been deleted. Poll metadata:
      - Created: 2026-04-05 22:05:00
      - Question: What is your favorite food?
```

### 4. Multiple Polls Matching Question

Use exact match or limit to most recent:

```typescript
// findPollByQuestion returns most recent match
const poll = store.findPollByQuestion(chatJid, questionPattern);
```

---

## Benefits Over Message ID Only

| Capability | Message ID | Short Name |
|------------|-----------|------------|
| Easy to remember | ❌ (26 hex chars) | ✅ (3-50 chars, alphanumeric) |
| Quick reference in commands | ❌ (copy/paste) | ✅ (type directly) |
| Discover all polls | ❌ (search messages) | ✅ (list_polls) |
| Find poll by content | ❌ | ✅ (question search) |
| Human-readable in logs | ❌ | ✅ |

---

## Alternative: Auto-Generate Short IDs

Instead of user-assigned names, we could auto-generate short IDs:

```
User: create_poll --question "Lunch?" --options ["Pizza", "Sushi"]
Tool: Poll sent. Poll ID: POLL-3A7F
      Message ID: 3EB02FEDA9F1FCC299D926
```

**Pros:**
- No name conflicts
- Shorter than message ID
- Always available

**Cons:**
- Still not memorable (random chars)
- User can't customize
- Doesn't describe poll content

**Recommendation:** User-assigned short names are preferred for usability.

---

## Testing Plan

```typescript
// test/unit/poll-short-names.test.ts

describe('Poll short names', () => {
  test('creates poll with short name', async () => {
    const result = await call.create_poll({
      to: 'WhatsAppMCP',
      question: 'What is your favorite food?',
      options: ['Pizza', 'Burger', 'Sushi'],
      short_name: 'food-poll'
    });
    expect(result).toContain('Short name: "food-poll"');
    
    const poll = store.getPollByShortName('food-poll');
    expect(poll).toBeDefined();
    expect(poll.question).toBe('What is your favorite food?');
  });

  test('rejects duplicate short names', async () => {
    await call.create_poll({ ..., short_name: 'duplicate' });
    const result = await call.create_poll({ ..., short_name: 'duplicate' });
    expect(result).toContain('already in use');
  });

  test('retrieves poll by short name', async () => {
    await call.create_poll({ ..., short_name: 'test' });
    const results = await call.get_poll_results({ poll_name: 'test' });
    expect(results).toContain('Poll:');
  });

  test('retrieves poll by question search', async () => {
    await call.create_poll({ ..., question: 'Team lunch?', short_name: 'lunch1' });
    const results = await call.get_poll_results({ 
      question: 'lunch', 
      chat: 'WhatsAppMCP' 
    });
    expect(results).toContain('lunch1');
  });

  test('lists all polls', async () => {
    await call.create_poll({ ..., short_name: 'poll1' });
    await call.create_poll({ ..., short_name: 'poll2' });
    const list = await call.list_polls({});
    expect(list).toContain('poll1');
    expect(list).toContain('poll2');
  });
});
```

---

## Success Metrics

| Metric | Before | After |
|--------|--------|-------|
| Average time to retrieve poll results | ~30s (search messages) | ~5s (use short name) |
| User satisfaction with poll workflow | Low (copy/paste IDs) | High (memorable names) |
| Discovery of existing polls | Scan all messages | list_polls tool |
| Error rate from typo IDs | ~5-10% | Near 0% |