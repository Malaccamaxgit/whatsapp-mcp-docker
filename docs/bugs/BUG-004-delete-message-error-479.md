# BUG-004: delete_message Tool - Error 479 on Revoke

**Status:** Resolved  
**Severity:** High  
**Component:** Message Actions (Delete)  
**Reported:** 2026-04-07  
**Resolved:** 2026-04-07  
**Resolution Source:** BUG-003 shared fix

---

## Summary

`delete_message` previously failed with `server returned error 479` when revoking a message. This is now resolved by the same argument-order correction delivered in BUG-003.

---

## Root Cause (Confirmed)

The revoke call into `@whatsmeow-node/whatsmeow-node` previously passed the wrong argument shape.

- Expected: `revokeMessage(chatJid, senderJid, messageId)`
- Old behavior: only 2 args were passed, shifting parameters at runtime
- Result: malformed revoke request and WhatsApp server error `479`

This was the same class of bug as BUG-003 (`send_reaction` argument mismatch), and both were fixed together.

---

## Fix Implemented

1. `delete_message` now resolves and forwards all required revoke arguments:
   - `jid` from stored message chat JID fallback or resolved chat input
   - `senderJid` from stored message metadata fallback or connected account JID
   - `message_id` as the revoke target
2. WhatsApp client wrapper signature enforces:
   - `revokeMessage(jid, senderJid, messageId)`
3. Integration coverage verifies stored chat and sender JIDs are used for revoke.

---

## Related Code

- `src/tools/reactions.ts` - `delete_message` handler now passes `(jid, senderJid, message_id)`
- `src/whatsapp/client.ts` - `revokeMessage` wrapper expects and forwards 3 arguments
- `test/integration/reactions.test.ts` - regression check for stored chat/sender JID forwarding

---

## Validation Status

- Integration tests for message actions are passing, including revoke-path assertions.
- E2E re-validation for Test T18 should be re-run in a live WhatsApp session during the next test cycle.

---

## Follow-up Improvement

Even with the root cause fixed, add defensive error translation for `479` so future edge-case failures return a more actionable message.

---

## Cross References

- `docs/bugs/BUG-003-send-reaction-emoji-encoding.md` (resolved; includes shared root-cause details)
- Test Phase: E2E Interactive Testing - Phase 6 (Message Actions)
