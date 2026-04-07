# BUG-003: send_reaction Tool - Emoji Not Appearing on Phone

**Status:** Resolved  
**Severity:** Medium  
**Component:** Message Actions (Reactions)  
**Reported:** 2026-04-07  
**Test Phase:** E2E Interactive Testing - Phase 6 (Message Actions)

---

## Summary

The `send_reaction` tool reports success but emoji reactions do not appear on messages in the WhatsApp client. When reactions do appear, they sometimes show incorrect emoji (🎯 instead of ).

---

## Symptoms

- Tool returns success message but no reaction appears on phone
- Reactions sent to messages in one chat don't appear
- Emoji encoding may be incorrect (target emoji 👍 vs actual emoji 🎯)
- Reaction system appears to have chat routing or emoji encoding issues

---

## Evidence from Testing

### Test T16 - First Attempt
```
Tool Call:
  send_reaction({
    chat: "Benjamin Alloul",
    emoji: "👍",
    message_id: "AC0DACEDC22AF877A25CE42141FE68E6"
  })

Tool Response:
  Reaction "👍" on message AC0DACEDC22AF877A25CE42141FE68E6.

User Observation:
  ❌ No reaction appeared on phone
  Message remained without emoji reaction
```

### Test T16 - Second Attempt (Fresh Message)
```
Step 1 - Send Message:
  send_message({
    message: "Testing reactions 🎯",
    to: "Benjamin"
  })
  → Message ID: 3EB031DE9AE47622992AFB

Step 2 - Send Reaction:
  send_reaction({
    chat: "Benjamin",
    emoji: "👍",
    message_id: "3EB031DE9AE47622992AFB"
  })
  → Response: Reaction "👍" on message 3EB031DE9AE47622992AFB.

User Observation (Screenshot):
  ❌ Message shows 🎯 target emoji (from message body)
  ❌ No 👍 thumbs-up reaction appeared
  Time: 18:17
```

---

## Root Cause Analysis (Confirmed)

The issue was not emoji encoding. The root cause was an argument mismatch with the
`@whatsmeow-node/whatsmeow-node` API:

- `sendReaction` in whatsmeow-node requires 4 arguments:
  `(chatJid, senderJid, messageId, emoji)`
- Our code passed only 3:
  `(chatJid, messageId, emoji)`

As a result, arguments were shifted at runtime (`messageId` used as `senderJid`, and
`emoji` used as `messageId`), so WhatsApp could not apply the reaction to the intended
message even though the tool reported success.

The same class of bug was also present for `revokeMessage`, which requires
`(chatJid, senderJid, messageId)` but was being called with only 2 arguments.

---

## Impact

- **User Experience:** Cannot react to messages via MCP tools
- **Feature Gap:** One of the core WhatsApp message actions is non-functional
- **Workflow Limitation:** Cannot build approval or feedback workflows that use reactions

---

## Reproduction Steps

1. Send a message: `send_message({ message: "Test message", to: "Benjamin" })`
2. Note the message ID from response
3. Send reaction: `send_reaction({ chat: "Benjamin", emoji: "👍", message_id: "<message_id>" })`
4. Check phone for reaction on the message
5. **Expected:** 👍 emoji appears below message
6. **Actual:** No reaction appears, or wrong emoji appears

---

## Related Code

Likely locations:
- `src/tools/reactions.ts` - send_reaction tool implementation
- `src/whatsapp/client.ts` - WhatsApp client reaction API call
- `whatsmeow-node` library reaction method

---

## Fix Implemented

1. Updated the Whatsmeow client interface and wrappers to pass required `senderJid`:
   - `sendReaction(chatJid, senderJid, messageId, emoji)`
   - `revokeMessage(chatJid, senderJid, messageId)`
2. Updated `send_reaction` tool to resolve `senderJid` from stored message metadata
   (`sender_jid`) and fall back to the connected account JID when needed.
3. Updated `delete_message` tool to pass both stored `chat_jid` and `sender_jid`.
4. Updated integration mocks and tests to validate the new argument order.
5. Added a regression test ensuring revoke uses stored chat and sender JIDs.

---

## Testing Notes

- Rebuilt test container and ran:
  `docker compose --profile test run --rm tester-container npx tsx --test test/integration/reactions.test.ts`
- Result: `16 passed, 0 failed`
- Coverage includes verification that reaction and revoke calls now forward both:
  - resolved/stored chat JID
  - stored sender JID

---

## API Specification

Current tool signature:
```typescript
send_reaction({
  chat: string,        // Chat name, phone, or JID
  emoji: string,       // Emoji character (e.g., "👍", "❤️", "😂")
  message_id: string   // Target message ID
})
```

Expected behavior:
- Reaction appears on target message within 1-2 seconds
- Reaction visible on both mobile and desktop WhatsApp
- Reaction shows sender's name/account

---

## References

- Test Phase: E2E Interactive Testing - Phase 6 (Message Actions)
- Related Test: T16
- Test Date: 2026-04-07
- Test Account: +14384083030
