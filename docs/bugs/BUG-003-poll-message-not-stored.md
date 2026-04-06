# BUG: Poll creation messages are not stored in the database

**Status:** OPEN

**Priority:** High

**Reported:** 2026-04-05

## Symptom

When a poll is created via `create_poll`, the poll creation message is successfully sent to WhatsApp but is **NOT stored in the SQLite message database**. This makes it impossible to retrieve poll results via `get_poll_results` because:

1. `get_poll_results` searches for the poll message by ID in the messages table
2. The poll message doesn't exist in the database
3. The tool returns `Poll message not found: <message_id>`

### Observed Behavior

#### Container Log Evidence

From `D:\Downloads\poll_log.txt`:

```
[AUDIT] create_poll:sent OK

{"result":{"content":[{"type":"text","text":"Poll sent to 120363406696586603@g.us.\nQuestion: \"What is your favorite food?\"\nOptions: 1. Pizza, 2. Burger, 3. Sushi\nMultiple answers: no\nMessage ID: 3EB02FEDA9F1FCC299D926"}]},"jsonrpc":"2.0","id":16}

[AUDIT] list_messages:read OK

{"result":{"content":[{"type":"text","text":"Messages from WhatsAppMCP (3):\n\n[2026-04-05, 20:56:51] You\n  ID: AC6523625AC442D497F75150AAAEB777\n  Read: no\n  [empty]\n[2026-04-05, 21:03:04] You\n  ID: ACFB433DE22405316414C04AED4EC907\n  Read: no\n  Ajout\n[2026-04-05, 22:05:34] You\n  ID: 3EB0AFD1894A01EB231117\n  Read: no\n  [empty]"}]},"jsonrpc":"2.0","id":18}

{"result":{"content":[{"type":"text","text":"Poll message not found: 3EB02FEDA9F1FCC299D926"}],"isError":true},"jsonrpc":"2.0","id":19}
```

#### Timeline Analysis

| Timestamp | Event | Message ID |
|-----------|-------|------------|
| ~22:05:22 | Poll created via `create_poll` | `3EB02FEDA9F1FCC299D926` |
| 22:05:34 | Message appears in group (likely vote) | `3EB0AFD1894A01EB231117` |

The poll message ID `3EB02FEDA9F1FCC299D926` never appears in `list_messages` output.

#### Image Evidence

User-provided screenshot (from WhatsApp UI) shows:
- Poll question: "What is your favorite food?"
- Options: Pizza, Burger, Sushi
- A vote was cast by Benjamin Alloul

---

## Root Cause

### Primary Issue: Poll Creation Messages Not Persisted

The `createPoll` method in [`src/whatsapp/client.ts`](src/whatsapp/client.ts) successfully sends the poll to WhatsApp but **never calls `addMessage()`** to store the poll in the SQLite database.

```typescript:src/whatsapp/client.ts:1788-1796
async createPoll (jid: string, question: string, options: string[], allowMultiple: boolean): Promise<{ id: string | undefined }> {
  const result = await this._withRetry(
    () => this.client!.sendPollCreation(jid, question, options, allowMultiple ? options.length : 1),
    'createPoll'
  );
  const id = result?.id || result?.key?.id;
  this._trackSentId(id);
  return { id };
}
```

**Problem:** The method returns `{ id }` without persisting the message to `this.messageStore`.

### Secondary Issue: Poll Messages Sent by Us Don't Echo Back

When you send a poll via `createPoll`, the message goes out to WhatsApp, but unlike regular text messages:
- Regular messages often echo back through the `messages.upsert` event (self-messages)
- Poll creation messages may not trigger the same event handler
- The poll message never enters `_handleIncomingMessage()` to be stored

### Evidence from Code

#### How `get_poll_results` Expects Poll Messages

[`src/tools/messaging.ts`](src/tools/messaging.ts) lines 509-525:

```typescript
// Get the poll creation message
const pollMsg = store.listMessages({ chatJid: resolved, limit: 100, offset: 0 })
  .find((m) => m.id === poll_message_id);

if (!pollMsg) {
  return {
    content: [{ type: 'text', text: `Poll message not found: ${poll_message_id}` }],
    isError: true
  };
}

if (!pollMsg.body || !pollMsg.body.startsWith('Poll: ')) {
  return {
    content: [{ type: 'text', text: `Message ${poll_message_id} is not a poll.` }],
    isError: true
  };
}
```

This expects:
1. The poll message to exist in `messages` table with the poll ID
2. The message `body` to start with `"Poll: "` followed by the question

But the poll message was never stored!

#### How Poll Messages SHOULD Be Stored

Incoming poll messages ARE handled correctly in [`src/whatsapp/client.ts`](src/whatsapp/client.ts) lines 931-937:

```typescript
// Extract poll metadata for poll creation messages (after msg is defined)
if (rawMessage?.pollCreationMessage) {
  const pollCreation = rawMessage.pollCreationMessage as Record<string, unknown>;
  const options = (pollCreation.options as Array<{ optionName?: string }> | undefined) || [];
  msg.pollMetadata = {
    pollCreationMessageKey: msg.id,
    voteOptions: options.map((opt) => opt.optionName || '').filter(Boolean)
  };
}
```

The problem is this code only runs for **incoming** messages (`_handleIncomingMessage`), not for **outgoing** poll creation.

### The Empty Message

The `[empty]` message at 22:05:34 (ID: `3EB0AFD1894A01EB231117`) is likely a **poll vote notification** from Benjamin Alloul. The vote was stored in `poll_votes` table (lines 950-955), but the message body shows as `[empty]` because:

```typescript
// Lines 906-910 in client.ts
body:
  evt.text ||
  evt.body ||
  rawMessage?.conversation ||
  rawMessage?.pollCreationMessage?.name ||       // <-- Poll creation uses .name
  rawMessage?.pollUpdateMessage?.vote?.selectedOption ||
  rawMessage?.pollUpdateMessage?.vote?.selectedOptions?.join(', ') ||
  ...
```

Poll votes (`pollUpdateMessage`) should extract the selected options, but the body may still appear empty in the UI.

---

## Hypothesis: Solution

### Fix 1: Persist Poll Creation Messages

After sending a poll, we need to construct and store a synthetic message in the database. The message should have:
- Message ID from the send result
- Chat JID where poll was sent
- Sender JID = our own JID (is_from_me = true)
- Body formatted as: `"Poll: <question>\n  - option1\n  - option2\n  - ..."`
- Timestamp = current time
- Store poll metadata for later retrieval

**Code location:** [`src/whatsapp/client.ts`](src/whatsapp/client.ts) `createPoll` method

**Pseudocode:**

```typescript
async createPoll (jid: string, question: string, options: string[], allowMultiple: boolean): Promise<{ id: string | undefined }> {
  const result = await this._withRetry(
    () => this.client!.sendPollCreation(jid, question, options, allowMultiple ? options.length : 1),
    'createPoll'
  );
  const id = result?.id || result?.key?.id;
  this._trackSentId(id);

  // NEW: Store the poll message in database
  const pollBody = `Poll: ${question}\n${options.map(o => `  - ${o}`).join('\n')}`;
  this.messageStore.addMessage({
    id: id!,
    chatJid: jid,
    senderJid: this.jid,
    senderName: null,
    body: pollBody,
    timestamp: Math.floor(Date.now() / 1000),
    isFromMe: true,
    hasMedia: false,
    mediaType: null,
    pollMetadata: {
      pollCreationMessageKey: id!,
      voteOptions: options
    }
  });

  return { id };
}
```

### Fix 2: Handle Poll Vote Message Bodies

The `[empty]` message for poll votes should display the selected option(s). Current extraction in lines 906-910 already handles this, but need to verify the JSON structure.

### Enhancement: Poll Short Names (Database Change)

User requested the ability to give polls a short name for easier retrieval. This would require:

1. **New `polls` table:**
   ```sql
   CREATE TABLE polls (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     message_id TEXT NOT NULL UNIQUE,
     short_name TEXT UNIQUE,
     chat_jid TEXT NOT NULL,
     question TEXT NOT NULL,
     options TEXT NOT NULL, -- JSON array
     allow_multiple INTEGER DEFAULT 0,
     created_at INTEGER,
     created_by TEXT -- sender JID
   );
   ```

2. **Modify `create_poll` tool schema** to accept optional `short_name` parameter

3. **Modify `get_poll_results` tool** to accept either:
   - `poll_message_id` (current)
   - OR `poll_short_name` (new)
   - OR `chat` + partial question match (future)

4. **Benefits:**
   - No need to remember long message IDs like `3EB02FEDA9F1FCC299D926`
   - Can use `get_poll_results --poll-name "food-poll"` or `get_poll_results --poll-id "food-poll"`
   - Polls stored in dedicated table for better query performance

---

## Files to Modify

### Immediate Fix (Poll Storage)

| File | Changes |
|------|---------|
| `src/whatsapp/client.ts` | Add message persistence after `createPoll` sends successfully |
| `src/tools/reactions.ts` | Ensure audit log captures poll creation (already done) |

### Enhancement (Poll Short Names)

| File | Changes |
|------|---------|
| `src/whatsapp/store.ts` | Add `polls` table migration, `createPoll()`, `getPollByShortName()` methods |
| `src/whatsapp/client.ts` | Store poll in new table after creation |
| `src/tools/reactions.ts` | Add `short_name` parameter to `create_poll` schema |
| `src/tools/messaging.ts` | Add `poll_name` parameter to `get_poll_results`, lookup by short_name |
| MCP catalog | Update tool JSON schemas |

---

## Impact

### Blocked Functionality:
- `get_poll_results` — Cannot retrieve results because poll message doesn't exist
- Poll-based workflows — Cannot build automation that reacts to poll results

### Not Affected:
- `create_poll` — Works correctly, poll is sent to WhatsApp
- Message delivery — Polls arrive in WhatsApp chats
- Vote collection — Votes are stored in `poll_votes` table correctly

---

## Test Plan

### Before Fix:
1. Create poll via `create_poll`
2. Note the returned message ID
3. `list_messages` for the chat — poll message NOT present
4. `get_poll_results` with message ID — returns "Poll message not found"

### After Fix:
1. Create poll via `create_poll`
2. Note the returned message ID
3. `list_messages` for the chat — poll message SHOULD APPEAR with body `"Poll: <question>\n  - opt1\n  - opt2"`
4. Cast votes from another device
5. `get_poll_results` with message ID — SHOULD return vote counts and voter info
6. Test polling over time (wait 1 hour, retrieve results) — results still accessible

---

## Related Issues

- [BUG-poll-votes-not-received.md](/docs/bugs/archived/BUG-poll-votes-not-received.md) — Poll votes are stored but message bodies show `[empty]`
- [BUG-messages-appear-empty.md](/docs/bugs/archived/BUG-messages-appear-empty.md) — Similar issue with message body extraction

---

## Additional Notes

### Why Regular Messages Work But Polls Don't

Regular messages sent via `sendMessage` may be stored because:
1. They echo back through `messages.upsert` event (WhatsApp sends a copy back)
2. The incoming message handler stores them

But `sendPollCreation` might not trigger the same echo behavior, so we need explicit storage.

### Alternative Fix: Listen for Poll Echo

Instead of storing after send, we could listen for the poll creation message to come back via `messages.upsert`. But this:
- Adds latency
- Is unreliable (WhatsApp may not echo)
- Requires complex state management

Explicit storage after successful send is more reliable.

### User Experience Note

The user also pointed out that remembering 26-character hex message IDs like `3EB02FEDA9F1FCC299D926` is impractical. The suggested enhancement (poll short names) would significantly improve usability.