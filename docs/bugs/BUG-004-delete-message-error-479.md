# BUG-004: delete_message Tool - Error 479 on Revoke

**Status:** Open  
**Severity:** High  
**Component:** Message Actions (Delete)  
**Reported:** 2026-04-07  
**Test Phase:** E2E Interactive Testing - Phase 6 (Message Actions)

---

## Summary

The `delete_message` tool fails with "server returned error 479" when attempting to delete (revoke) a message for everyone. This prevents the "self-destruct" message workflow from working.

---

## Symptoms

- Tool returns error: "Failed to delete message: server returned error 479"
- Message remains visible on phone after delete attempt
- Error occurs consistently across multiple attempts
- No additional context provided about error 479 meaning

---

## Evidence from Testing

### Test T18 - Delete Message Attempt
```
Step 1 - Send Message:
  send_message({
    message: "This message will self-destruct",
    to: "Benjamin"
  })
  → Message ID: 3EB01234D3537F380A8733
  → Sent at: 18:18:43

Step 2 - Delete Message (Attempt 1):
  delete_message({
    message_id: "3EB01234D3537F380A8733"
  })
  → Error: Failed to delete message: server returned error 479

Step 3 - Delete Message (Attempt 2):
  delete_message({
    chat: "Benjamin",
    message_id: "3EB01234D3537F380A8733"
  })
  → Error: Failed to delete message: server returned error 479

User Observation:
  ❌ Message still visible on phone
  ❌ No "This message was deleted" placeholder
  ❌ Message remains unchanged
```

---

## Root Cause Analysis (Hypothesis)

Error 479 is not a standard HTTP status code, suggesting it's a WhatsApp-specific or internal error code. Possible causes:

1. **Permissions:** Insufficient permissions to delete message (not sender, or admin rights required)
2. **Time Limit:** WhatsApp only allows deletion within ~15 minutes of sending (message was fresh, so unlikely)
3. **Message Type:** Cannot delete certain message types (though this was plain text)
4. **Chat Type:** Cannot delete messages in certain chat types (this was a personal chat)
5. **API Implementation:** The delete_message tool may be calling the wrong WhatsApp API method
6. **Error Code Mapping:** Error 479 may indicate a specific WhatsApp protocol error that needs translation

---

## Impact

- **User Experience:** Cannot delete messages sent by mistake
- **Security:** Cannot revoke sensitive information after sending
- **Feature Gap:** Core WhatsApp message management feature is non-functional
- **Trust:** Users may hesitate to use the tool if they can't undo mistakes

---

## Reproduction Steps

1. Send a message: `send_message({ message: "Test delete", to: "Benjamin" })`
2. Note the message ID from response
3. Immediately call: `delete_message({ chat: "Benjamin", message_id: "<message_id>" })`
4. Check phone for message deletion
5. **Expected:** Message replaced with "This message was deleted"
6. **Actual:** Error 479 returned, message unchanged

---

## Related Code

Likely locations:
- `src/tools/reactions.ts` - delete_message tool implementation (may be in same file as reactions)
- `src/whatsapp/client.ts` - WhatsApp client delete/revoke API call
- `whatsmeow-node` library revoke method

---

## WhatsApp Delete Constraints (For Reference)

According to WhatsApp documentation:
- Messages can be deleted for everyone within ~15 minutes of sending
- Only the sender can delete their own messages
- Deleted messages show "This message was deleted" placeholder
- Some message types may not be deletable

In our test:
- ✅ Message was freshly sent (< 1 minute old)
- ✅ Message was sent by the same account
- ✅ Plain text message (should be deletable)
- ❌ Delete failed with error 479

---

## Suggested Fix

1. **Investigate error 479:** Research WhatsApp protocol error codes or check whatsmeow-node documentation
2. **Add error translation:** Map error 479 to a human-readable message
3. **Verify API call:** Ensure delete_message calls the correct WhatsApp revoke API
4. **Check permissions:** Verify the account has permission to delete the message
5. **Add logging:** Capture full error details from WhatsApp protocol layer
6. **Test edge cases:** Verify deletion works for:
   - Messages sent to self
   - Messages sent to groups
   - Messages with media
   - Messages at different ages (< 1 min, < 15 min, > 15 min)

---

## Testing Notes

- Tested immediately after sending message (well within 15-minute window)
- Tested with both parameter combinations (with and without chat parameter)
- Error 479 returned consistently
- No additional error details or stack trace provided
- Message was plain text (no media complications)
- Sent to personal chat (not a group)

---

## Error Code Research Needed

Error 479 is not documented in:
- WhatsApp Business API docs
- whatsmeow-node README
- Model Context Protocol specs

May be:
- Internal server error code
- WhatsApp protocol-specific error
- Rate limiting or quota error
- Permission/authorization error

---

## References

- Test Phase: E2E Interactive Testing - Phase 6 (Message Actions)
- Related Test: T18
- Test Date: 2026-04-07
- Test Account: +14384083030
- Message ID: 3EB01234D3537F380A8733
- Error Code: 479
