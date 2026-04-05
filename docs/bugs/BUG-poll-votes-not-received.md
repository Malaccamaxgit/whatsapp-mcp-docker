# BUG: Poll votes are not being captured or displayed

**Status:** OPEN

## Symptom

When a WhatsApp poll is sent via `create_poll` or `send_message` (poll type), votes from recipients are **not visible** in the MCP server's message database or through `list_messages`.

### Observed Behavior

1. **Poll sent successfully** ✅
   - Poll created and sent to contact
   - Poll appears in WhatsApp chat with options
   - Recipients can see and interact with the poll

2. **Votes cast but not captured** ❌
   - Recipients vote on the poll (visible in WhatsApp UI)
   - Poll shows vote counts in WhatsApp (e.g., "Italienne: 1 vote")
   - MCP server's `list_messages` does NOT show the vote messages
   - `wait_for_message` does NOT detect poll vote messages

### Example from Testing

**Timestamp:** 2026-04-04, 16:55  
**Poll:** "Quelle est ta cuisine préférée ?"  
**Options:** Turque, Italienne, Française, Japonaise  
**WhatsApp UI shows:** Italienne — 1 vote (🔥 emoji from voter)  
**MCP server shows:** No messages after the original poll send

The vote is visible in the WhatsApp client screenshot but does not appear in the MCP server's database.

---

## Root Cause (To Investigate)

Possible causes:

### 1. Poll votes use a different message type
Poll votes may be sent as `protocolMessage`, `pollUpdateMessage`, or a special message type that `_persistMessage()` doesn't extract text from. The current text extraction logic looks for:
- `conversation`
- `extendedTextMessage.text`
- `evt.text` / `evt.body`

Poll votes likely have a completely different structure.

### 2. Poll votes are not stored in the database
The `_handleIncomingMessage` handler may be filtering out poll-related messages, or the store may not be persisting them.

### 3. Poll votes arrive as message updates, not new messages
WhatsApp may send poll votes as **message update events** (modifying the original poll message) rather than new standalone messages. The current implementation may only handle `messages.upsert` and not `messages.update`.

### 4. Event listener gap
The whatsmeow-node bridge may emit poll votes on a different event (e.g., `poll-vote`, `poll-update`) that the MCP server is not listening to.

---

## Files to Review

- `src/whatsapp/client.ts` — `_handleIncomingMessage()`, `_persistMessage()`, event listeners
- `src/whatsapp/store.ts` — Message persistence logic, poll message handling
- `src/tools/messaging.ts` — `create_poll` implementation (if votes need to be tracked)
- `src/tools/wait.ts` — How `wait_for_message` filters incoming messages

---

## Debug Steps

1. **Enable DEBUG logging**
   ```bash
   export DEBUG=client
   ```
   Then monitor incoming poll votes to see the raw event structure.

2. **Check event listeners**
   Review what events the WhatsApp client subscribes to:
   - `messages.upsert` — new messages
   - `messages.update` — message updates (may include poll votes)
   - Any poll-specific events?

3. **Log raw poll vote events**
   Add temporary logging in `_handleIncomingMessage()` to dump the full `evt` object when a poll-related message arrives.

4. **Check SQLite database directly**
   Query the messages table to see if poll votes are being stored but not displayed:
   ```sql
   SELECT * FROM messages WHERE chat_jid LIKE '%33680940027%' ORDER BY timestamp DESC LIMIT 10;
   ```

5. **Test with `wait_for_message`**
   Use `wait_for_message` without filters while casting a poll vote to see if ANY message is detected.

---

## Impact

- **User experience:** Users cannot see who voted or track poll results programmatically
- **Automation gap:** Cannot build workflows that react to poll votes (e.g., "if majority votes Turkish, send restaurant link")
- **Data loss:** Poll engagement metrics are lost

---

## Priority

**Medium-High** — Polls are a useful engagement tool, and not seeing votes breaks the feedback loop.

---

## Related Issues

- `docs/bugs/BUG-self-account-messages-not-received.md` — Message extraction issues
- `src/tools/wait.ts` — TODO comment on JID filter timeout issues (may be related if poll votes use different JID format)

---

## Fix Requirements

To resolve this bug, the MCP server needs to:

1. **Detect poll vote events** — Subscribe to the correct WhatsApp event for poll updates
2. **Parse vote structure** — Extract voter, selected option(s), timestamp from the event
3. **Store votes** — Persist vote data to SQLite (possibly in a separate `poll_votes` table or as message metadata)
4. **Expose votes** — Add a new tool or extend `list_messages` to show poll votes with voter info
5. **Optional: Real-time notifications** — Trigger `wait_for_message` or approval listeners when votes arrive

### Potential API Enhancement

Consider adding a `get_poll_results` tool:
```typescript
get_poll_results({
  poll_message_id: "3EB017FA5D3E4479224731",
  chat: "33680940027@s.whatsapp.net"
})
// Returns: { question, options: [{ text, votes: [{ voter_jid, voter_name, timestamp }] }] }
```

---

## Test Plan

After fix:

1. Send a poll via `create_poll`
2. Cast votes from another device/contact
3. Verify votes appear in `list_messages` or `get_poll_results`
4. Verify `wait_for_message` detects poll votes
5. Test multiple votes, vote changes (if WhatsApp allows changing votes)
6. Test group polls with multiple voters
