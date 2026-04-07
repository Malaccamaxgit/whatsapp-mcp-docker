# BUG-002: Approval Response Detection - Chat Routing Issue

**Status:** Fixed  
**Severity:** Medium  
**Component:** Approval Workflow  
**Reported:** 2026-04-07  
**Test Phase:** E2E Interactive Testing - Phase 3 (Approval Workflow)

---

## Summary

Approval requests are sent to one chat JID, but user replies arrive in a different chat JID, causing the approval detection system to fail to match responses to requests.

---

## Symptoms

- Approval requests sent via `request_approval` tool arrive in chat `14384083030@s.whatsapp.net` (Benjamin - User JID)
- User replies ("APPROVE", "DENY", "YES", "NO") arrive in chat `128819088347371@lid` (Benjamin Alloul - LID JID)
- `check_approvals` tool continues to show approvals as "pending" even after user has responded
- Approval workflow detection system does not process responses from the LID chat

---

## Evidence from Testing

### Test T7 (APPROVE flow)
```
Approval Request Sent:
  Request ID: approval_1775597899687_z8lolwg
  Action: Deploy to staging
  Sent to: 14384083030@s.whatsapp.net
  Chat shown in UI: Benjamin

User Response:
  Sent "APPROVE" from phone at 17:40:00
  Response arrived in: Benjamin Alloul (128819088347371@lid)
  check_approvals result: Still showing as pending
```

### Test T8 (DENY flow)
```
Approval Request Sent:
  Request ID: approval_1775598051169_ccjtyox
  Action: Delete production database
  Sent to: 14384083030@s.whatsapp.net

User Response:
  Sent "DENY" from phone at 17:41:28
  Response arrived in: Benjamin Alloul (128819088347371@lid)
  check_approvals result: Still showing as pending
```

### Chat List Observation
```
[Chat] Benjamin Alloul
  JID: 128819088347371@lid [LID]
  Messages: User responses (APPROVE, DENY, Yes)

[Chat] Benjamin
  JID: 14384083030@s.whatsapp.net [User]
  Messages: Approval request templates
```

---

## Root Cause Analysis (Hypothesis)

The approval detection system likely monitors only the chat where the approval request was sent (`14384083030@s.whatsapp.net`), but WhatsApp is routing user replies to the LID (Linked Device ID) chat (`128819088347371@lid`).

This suggests:
1. The approval message handler is listening on the wrong chat JID
2. WhatsApp's message routing for linked devices separates outgoing messages (User JID) from incoming replies (LID JID)
3. The approval detection logic needs to monitor both JIDs or correlate them

---

## Impact

- **User Experience:** Approval workflow appears broken - users respond but system doesn't detect it
- **Automation:** Cannot rely on automatic approval detection for workflows
- **Workaround:** Users must manually check if approvals were received via other means

---

## Reproduction Steps

1. Call `request_approval` with phone number `+14384083030`
2. Observe approval request arrives in chat "Benjamin" (`14384083030@s.whatsapp.net`)
3. Reply "APPROVE" from phone (mobile or desktop)
4. Call `check_approvals` with the request ID
5. **Expected:** Status shows "approved"
6. **Actual:** Status remains "pending"

---

## Related Code

Likely locations:
- `src/tools/approvals.ts` - Approval request sending and response detection
- `src/whatsapp/client.ts` - Message event handling and routing
- `src/whatsapp/store.ts` - Approval storage and lookup logic

---

## Suggested Fix

1. **Monitor both JIDs:** Update approval detection to listen for responses on both User JID and LID JID
2. **JID correlation:** Implement logic to correlate User JID (`14384083030@s.whatsapp.net`) with LID JID (`128819088347371@lid`)
3. **Message thread matching:** Match approval responses by looking for approval keywords in recent messages across both chats
4. **Request ID tracking:** Store the chat JID where each approval was sent, and check for responses in related chats

---

## Fix Implemented

1. Updated `src/whatsapp/client.ts` (`_checkApprovalResponse`) to keep the existing direct JID match, then add a JID-alias fallback via `messageStore.getJidMapping(msg.chatJid)`.
2. Fallback now matches pending approvals against either mapped JID format (`phoneJid` or `lidJid`), allowing:
   - LID reply -> phone-JID approval match
   - Phone-JID reply -> LID approval match
3. Updated unit test mocks in `test/unit/client.test.ts` to include a safe default `getJidMapping: () => null`.
4. Added regression coverage in `test/unit/client.test.ts` for both JID directions and no-mapping fallthrough.

---

## Testing Notes

- Tested with both mobile WhatsApp and WhatsApp Desktop simultaneously
- Responses arrived in LID chat regardless of which device was used
- Approval requests consistently sent to User JID chat
- Manual message listing shows responses exist, but approval system doesn't detect them

---

## References

- Test Phase: E2E Interactive Testing - Phase 3 (Approval Workflow)
- Related Tests: T7, T8, T9
- Test Date: 2026-04-07
- Test Account: +14384083030
