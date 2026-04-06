# BUG: Reactions sent via send_reaction do not appear in WhatsApp

**Status:** OPEN

**Priority:** Medium

**Reported:** 2026-04-05

## Symptom

When using `send_reaction` to react to a message, the tool returns success:

```
[AUDIT] send_reaction:reacted with 🚣 OK
{"result":{"content":[{"type":"text","text":"Reaction \"🚣\" on message ACFA6DE007E01686FA23F23B48D51DAE."}]},"jsonrpc":"2.0","id":57}
```

But the reaction does **NOT appear** in the WhatsApp client on the user's phone.

### Observed Behavior

#### Test Case 1: Reaction to Own Message

- Sent 🚣 reaction to own message in Benjamin chat
- Server reported: `[AUDIT] send_reaction:reacted with 🚣 OK`
- Result: Reaction not visible on phone

#### Test Case 2: Reaction to Incoming Message

- Sent 🚣 reaction to Séverine's message "Run diagnostic"
- Message ID: `ACFA6DE007E01686FA23F23B48D51DAE`
- Server reported: `[AUDIT] send_reaction:reacted with 🚣 OK`
- Result: Reaction not visible on phone (see screenshot)

#### Screenshot Evidence

User-provided screenshot shows:
- Message "Run diagnostic" from Séverine is visible
- No reaction emoji appears below the message
- The reaction should show as 🚣 under the message

---

## Test Session: 2026-04-06

Detailed test session with full technical parameters.

### Test Case 1: Reaction to Own Message (Detailed)

| Parameter | Value |
|-----------|-------|
| Message ID | `3EB021EB1B7F0A7640B52B` |
| Chat JID | `33680940027@s.whatsapp.net` |
| Contact | Benjamin Alloul |
| Message Text | "entre le 8 et 28 Aout? (Car si je me rapelle bien c'est du Vendredi au Vendredi)" |
| Message Owner | `You` (own outgoing message) |
| Emoji | 🚣 (rowboat) |
| Timestamp | 2026-04-05 22:47:58 |
| Result | Success logged, no visible reaction |

### Test Case 2: Reaction to Incoming Message (Detailed)

| Parameter | Value |
|-----------|-------|
| Message ID | `ACFA6DE007E01686FA23F23B48D51DAE` |
| Chat JID | `44612043436101@lid` |
| Contact | Séverine Godet |
| Message Text | "Run diagnostic" |
| Message Owner | Séverine Godet (incoming message) |
| Emoji | 🚣 (rowboat) |
| Timestamp | 2026-04-05 22:37:45 |
| Result | Success logged, no visible reaction |

### Log Evidence

Multiple reaction attempts were made during the session. All reported success but none produced visible reactions:

```
[AUDIT] send_reaction:reacted with 🚣 OK
{"result":{"content":[{"type":"text","text":"Reaction \"🚣\" on message 3EB021EB1B7F0A7640B52B."}]},"jsonrpc":"2.0","id":54}

[AUDIT] send_reaction:reacted with 🚣 OK
{"result":{"content":[{"type":"text","text":"Reaction \"🚣\" on message 3EB021EB1B7F0A7640B52B."}]},"jsonrpc":"2.0","id":56}

[AUDIT] send_reaction:reacted with 🚣 OK
{"result":{"content":[{"type":"text","text":"Reaction \"🚣\" on message 3EB021EB1B7F0A7640B52B."}]},"jsonrpc":"2.0","id":57}

[AUDIT] send_reaction:reacted with 🚣 OK
{"result":{"content":[{"type":"text","text":"Reaction \"🚣\" on message ACFA6DE007E01686FA23F23B48D51DAE."}]},"jsonrpc":"2.0","id":62}

[AUDIT] send_reaction:reacted with 🚣 OK
{"result":{"content":[{"type":"text","text":"Reaction \"🚣\" on message ACFA6DE007E01686FA23F23B48D51DAE."}]},"jsonrpc":"2.0","id":73}
```

### Key Observations

1. **Consistent Failure Across All Attempts**: Every reaction attempt (5+ total) reported success but produced no visible result
2. **Affects Both Message Types**: Issue occurs for both outgoing (`fromMe: true`) and incoming (`fromMe: false`) messages
3. **Spans Multiple JID Types**: Tested with `@s.whatsapp.net` (standard user JID) and `@lid` (linked device JID)
4. **No Errors Logged**: All reactions complete without error - the failure is silent
5. **Immediate Feedback**: User confirmed in real-time that reactions do not appear in WhatsApp client

---

## Root Cause Analysis

### Hypothesis 1: Reaction Not Actually Sent

The `sendReaction` method in [`src/whatsapp/client.ts`](src/whatsapp/client.ts) calls:

```typescript
async sendReaction (jid: string, messageId: string, emoji: string): Promise<unknown> {
  return this._withRetry(
    () => this.client!.sendReaction(jid, messageId, emoji),
    'sendReaction'
  );
}
```

The underlying `@whatsmeow-node/whatsmeow-node` library's `sendReaction` may:
1. Return success without actually sending to WhatsApp servers
2. Send but the reaction is rejected by WhatsApp
3. Send but the sync back to the user's device fails

### Hypothesis 2: Message ID Format Issues

The message IDs being used might not be in the correct format for reactions. WhatsApp reactions require:
- The message ID must be from the correct chat context
- The message must still exist (not deleted)
- The reaction must be sent to the correct JID

### Hypothesis 3: Reaction to Own Messages

WhatsApp treats reactions to your own messages differently:
- Reactions to your own messages ARE sent to the recipient
- But they may not sync back to your own device correctly
- This could explain why "You" messages don't show reactions

---

## Investigation Steps

### Step 1: Verify Message ID Format

Check if the message IDs returned by `list_messages` are the correct format for `send_reaction`.

### Step 2: Test with Outgoing vs Incoming Messages

- Reaction to own message: May sync differently
- Reaction to incoming message: Should sync to sender AND reflect locally

### Step 3: Check whatsmeow-node Library

Verify if `sendReaction` has known issues or requires additional parameters.

### Step 4: Add Debug Logging

Add console logging to the `sendReaction` method to see:
- The actual JID being used
- The message ID format
- The raw response from whatsmeow-node

---

## Files to Investigate

| File | Purpose |
|------|---------|
| `src/whatsapp/client.ts` | `sendReaction` implementation |
| `src/tools/reactions.ts` | Tool handler that calls `sendReaction` |
| `@whatsmeow-node/whatsmeow-node` | Underlying WhatsApp library |

---

## Potential Fixes

### Fix 1: Add Reaction Storage

Similar to the poll message fix, we may need to store reactions locally:

```typescript
async sendReaction (jid: string, messageId: string, emoji: string): Promise<unknown> {
  const result = await this._withRetry(
    () => this.client!.sendReaction(jid, messageId, emoji),
    'sendReaction'
  );
  
  // Store reaction locally so we can track it
  this.messageStore.addReaction?.({
    messageId,
    chatJid: jid,
    emoji,
    timestamp: Math.floor(Date.now() / 1000),
    fromMe: true
  });
  
  return result;
}
```

### Fix 2: Verify JID Resolution

The `send_reaction` tool resolves the chat JID via `resolveJid()`. We should verify this resolution is correct.

---

## Test Plan

### Before Fix:

1. `list_messages` for a chat with incoming messages
2. `send_reaction` to an incoming message
3. Verify reaction does NOT appear on phone
4. Check if recipient sees the reaction (ask Benjamin/Séverine)

### After Fix:

1. `list_messages` for a chat with incoming messages
2. `send_reaction` to an incoming message
3. Verify reaction DOES appear on phone
4. Verify reaction persists after refresh/app restart

---

## Related Issues

- [BUG-003-poll-message-not-stored.md](BUG-003-poll-message-not-stored.md) — Similar pattern of server reporting success but outcome not visible in WhatsApp

---

## Additional Notes

### WhatsApp Web vs Phone App

Check if reactions appear in WhatsApp Web even if not on phone app. This would indicate a sync issue rather than a send issue.

### Reaction Receipts

WhatsApp reactions should generate receipts. Check if we're receiving `reaction` events in the message handler.