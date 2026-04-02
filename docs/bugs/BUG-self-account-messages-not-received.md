# BUG: Messages sent from user's phone are not triggering real-time event handlers

**Status: FIXED**

## Symptom

When the MCP server was linked as a secondary device on the user's own WhatsApp account
(same phone number), messages sent FROM the user's phone:

- **Were stored in the database** (visible in `list_messages`)
- **Did NOT fire the event handler** used by `wait_for_message` and the approval listener
- Therefore: `wait_for_message`, `request_approval` reply detection, and any real-time
  reactive logic silently failed even though the message was received

## Root cause

Two issues in `src/whatsapp/client.js`:

1. **`_handleIncomingMessage` filtered out all `isFromMe` messages.**
   Baileys emits `messages.upsert` with `key.fromMe = true` for messages sent from another
   device on the same account (device echo). The old code treated ALL of these as outbound
   and skipped waiter/approval dispatch entirely.

2. **`history_sync` messages bypassed waiters.**
   Messages arriving during reconnect sync were persisted to the DB but never dispatched
   to `_notifyMessageWaiters` or `_checkApprovalResponse`.

## Fix applied

### 1. Track server-originated message IDs instead of filtering on `isFromMe`

Added `_sentMessageIds` Set to the WhatsAppClient constructor. All send methods
(`sendMessage`, `uploadAndSendMedia`, `createPoll`) now register the returned message ID
in this Set. The `_handleIncomingMessage` handler now only skips messages whose ID is
in `_sentMessageIds` (i.e., messages THIS server process sent), allowing "echoes from
other devices" to flow through to waiters and approval listeners.

### 2. Dispatch recent history_sync messages to waiters

The `history_sync` event handler now collects messages with timestamps within the last
120 seconds and, after persisting, dispatches them to `_notifyMessageWaiters` and
`_checkApprovalResponse`. This handles the edge case where a `wait_for_message` is
active during a brief disconnect/reconnect cycle.

## Files changed

- `src/whatsapp/client.js` — constructor, `_trackSentId()`, `_handleIncomingMessage()`,
  `history_sync` handler, `sendMessage()`, `uploadAndSendMedia()`, `createPoll()`

## Additional fixes in the same changeset

- `src/tools/contacts.js` — `get_profile_picture` now extracts URL from object result
  (was producing `[object Object]`); `is_on_whatsapp` handles multiple field names
  (`exists`, `IsIn`, `isIn`, `registered`) from the Go bridge
- `src/tools/groups.js` — `get_group_invite_link` no longer double-prefixes
  `https://chat.whatsapp.com/` when the bridge already returns a full URL
