# BUG: Messages appear as `[empty]` in list_messages output

**Status:** OPEN

## Symptom

When reading messages via `list_messages`, all messages from certain chats (particularly self-messages) appear as `[empty]` in the output, even though:

- The messages were successfully received and stored in the database (count shows 8 messages)
- The connection status shows messages exist
- The `list_messages` tool returns message metadata correctly (sender, timestamp, etc.)
- Only the `body` field is empty/missing

### Observed Behavior

```
Messages from 14384083030@s.whatsapp.net (8):

[2026-04-04, 20:33:57] You: [empty]
[2026-04-04, 20:33:57] You: [empty]
[2026-04-04, 20:33:57] You: [empty]
[2026-04-04, 20:33:57] You: [empty]
[2026-04-04, 20:33:57] You: [empty]
[2026-04-04, 20:33:57] You: [empty]
[2026-04-04, 20:33:57] You: [empty]
[2026-04-04, 20:34:02] You: [empty]
```

Connection status shows the messages were received:
- Chats: 2
- Messages: 8
- Status: Ready to send/receive messages

---

## Root Cause (To Investigate)

### 1. Text extraction field mismatch

The `_persistMessage()` method in `src/whatsapp/client.ts` extracts text from these fields:

```typescript
body:
  evt.text ||
  evt.body ||
  rawMessage?.conversation ||
  rawMessage?.extendedTextMessage?.text ||
  '',
```

However, the Go bridge (whatsmeow-node) may populate **different fields** depending on message type:
- Standard text messages: `conversation` or `extendedTextMessage.text`
- Media messages with captions: Likely different field names
- System messages, reactions, status updates: May use `protocolMessage` or other types
- Device echo messages (from secondary devices): May have different structure

### 2. Media flag not set correctly

The `list_messages` output shows `[empty]` rather than `[media] (id: ...)`, indicating that BOTH:
- `body` is empty/null
- `has_media` is false (or not being detected)

The media detection code:
```typescript
hasMedia: Boolean(evt.mediaType || evt.hasMedia || mediaInfo),
mediaType: evt.mediaType || mediaInfo?.type || null
```

This suggests the Go bridge isn't populating `evt.mediaType` or `evt.hasMedia`, and `_extractMediaInfo()` isn't detecting media from `rawMessage` structure.

### 3. Go bridge event structure differs from Baileys

The original Baileys library (JavaScript) has a known event structure, but the Go bridge (whatsmeow-node) may serialize events differently. The TypeScript client expects certain fields that may not exist or may be nested differently.

---

## Diagnostic Information Gathered

### Database Query Results

Attempted to inspect database directly but container filesystem structure differs from expected:
- `/app/data/messages.db` — path does not exist inside container
- Messages are stored somewhere (8 messages counted) but location unclear

### Message Display Logic

From `src/tools/messaging.ts` lines 267-276:

```typescript
const formatMsg = (m: MessageRow, prefix = '') => {
  const dir = m.is_from_me
    ? 'You'
    : m.sender_name || m.sender_jid?.split('@')[0] || 'Unknown';
  const time = formatTimestamp(m.timestamp);
  const body = m.body
    ? m.body.substring(0, 200)
    : m.has_media
      ? `[${m.media_type || 'media'}] (id: ${m.id})`
      : '[empty]';
  // ...
};
```

Messages show `[empty]` when BOTH conditions are true:
1. `m.body` is falsy (null/empty)
2. `m.has_media` is falsy (0/false)

### Known Related Bug

This is documented as a TODO in `docs/bugs/BUG-self-account-messages-not-received.md`:

> **TODO / OPEN ISSUE: Messages still appear as `[empty]` in list_messages output**

That bug (now FIXED) was about event handlers not triggering for self-messages. This new bug is about **text extraction** from the message event.

---

## Requirements to Fix

### 1. Enable DEBUG logging to capture raw event structures

**Setup:**
```bash
# Set environment variable when running the container
export DEBUG=client
# Or in docker-compose.yml / orchestration config
environment:
  - DEBUG=client
```

**What to capture:**
- Raw `evt` object from `_handleIncomingMessage()`
- Full `rawMessage` structure from `evt.message`
- All field names and nested paths
- Comparison between text messages, media messages, and system messages

**Code location:**
- `src/whatsapp/client.ts` — Line ~853 already logs: `log('Empty body event (isFromMe=%s, isHistorySync=%s): %s', ...)`
- Need to verify this log appears and captures the full structure

### 2. Compare raw event structure against extraction fields

**Analyze the Go bridge output:**

The `log()` call at line 853 should output JSON like:
```
Empty body event (isFromMe=true, isHistorySync=false): {"info":{...},"message":{...},"text":"","body":"","mediaType":...}
```

**Fields to check in raw event:**

For text messages:
- `evt.text` — direct text field
- `evt.body` — alternative text field
- `evt.message.conversation` — standard text messages
- `evt.message.extendedTextMessage.text` — reply/forward messages
- `evt.message.ephemeralMessage.message` — disappearing messages
- `evt.message.viewOnceMessage.message` — view-once messages

For media messages:
- `evt.message.imageMessage.caption` — image caption
- `evt.message.videoMessage.caption` — video caption
- `evt.message.documentMessage.caption` — document caption
- `evt.message.imageMessage.mimetype` — media type detection
- `evt.hasMediaMessage` — Go bridge specific flag
- `evt.type` — message type indicator

For special messages:
- `evt.message.reactionMessage` — emoji reactions
- `evt.message.pollCreationMessage` — poll creation
- `evt.message.pollUpdateMessage` — poll votes
- `evt.message.protocolMessage` — system messages
- `evt.message.statusNotification` — status updates

**Code locations:**
- Text extraction: `src/whatsapp/client.ts` lines 838-843
- Media extraction: `src/whatsapp/client.ts` lines 1292-1314 (`_extractMediaInfo()`)
- Message type detection: Should check all possible message types

### 3. Update extraction logic based on findings

After identifying the correct fields, update `_persistMessage()`:

```typescript
// Current implementation (lines 838-843)
body:
  evt.text ||
  evt.body ||
  rawMessage?.conversation ||
  rawMessage?.extendedTextMessage?.text ||
  '',

// Needs to include additional fields:
body:
  evt.text ||
  evt.body ||
  rawMessage?.conversation ||
  rawMessage?.extendedTextMessage?.text ||
  rawMessage?.imageMessage?.caption ||
  rawMessage?.videoMessage?.caption ||
  rawMessage?.documentMessage?.caption ||
  rawMessage?.ephemeralMessage?.message?.conversation ||
  rawMessage?.viewOnceMessage?.message?.conversation ||
  // ... other discovered fields
  '',
```

And update `_extractMediaInfo()` to detect more media types and check additional paths.

---

## Files to Review

### Primary files:
- `src/whatsapp/client.ts`
  - `_persistMessage()` method (lines 823-907) — text extraction logic
  - `_extractMediaInfo()` method (lines 1292-1314) — media type detection
  - `_handleIncomingMessage()` method — event handler
  - Log statement at line 853 — empty body detection

### Secondary files:
- `src/tools/messaging.ts`
  - `formatMsg()` function (lines 267-276) — message display logic
  - Message interface definition (lines 41-51)

- `src/whatsapp/store.ts`
  - Message persistence schema
  - `addMessage()` method — what fields are stored

### Documentation:
- `docs/bugs/BUG-self-account-messages-not-received.md` — related fixed bug
- `docs/bugs/BUG-poll-votes-not-received.md` — similar text extraction issue for polls

---

## Debug Steps

### Step 1: Enable DEBUG logging

```bash
# Restart the container with DEBUG=client
export DEBUG=client
# Or modify docker-compose/environment config
```

### Step 2: Send test messages from known number

Send various message types to the authenticated WhatsApp number:
1. Plain text message
2. Image with caption
3. Image without caption
4. Video with caption
5. Document
6. Voice message
7. Reaction (emoji tap on a message)
8. Reply/quoted message

### Step 3: Capture log output

Monitor the container logs:
```bash
docker logs -f <container-name> | grep -A 20 "Empty body event"
```

Expected output:
```
[WA] Empty body event (isFromMe=true, isHistorySync=false): {"info":{...},"message":{...},"text":"","body":"","mediaType":null}
```

Save full JSON structures for each message type.

### Step 4: Analyze event structures

For each message type, identify:
- Which field contains the text/caption
- Which field indicates media type
- Which field contains the media metadata (mimetype, filename, etc.)
- Any nested message structures (ephemeral, viewOnce, etc.)

### Step 5: Update extraction code

Based on findings:
1. Add missing field paths to `body` extraction in `_persistMessage()`
2. Enhance `_extractMediaInfo()` to detect all media types
3. Add media type to `mediaInfo` for proper display (`[image]`, `[video]`, etc.)
4. Test with all message types

### Step 6: Verify fix

```bash
# After code changes, rebuild
docker compose build

# Reconnect WhatsApp
docker mcp client connect cursor --profile <profile>

# Authenticate
# Send test messages
# Check list_messages output
```

---

## Impact

### User experience:
- Users can see message count but not content
- Media messages appear as `[empty]` instead of `[image] (id: xxx)`
- Cannot use `download_media` without message ID (not visible in `[empty]` output)
- Conversation history is effectively unreadable

### Functionality affected:
- `list_messages` — text body always empty
- `search_messages` — searching text always returns nothing
- `catch_up` — message previews show `[empty]`
- `download_media` — cannot download without message ID

### Functionality NOT affected:
- Message count is correct
- Sender metadata is preserved
- Timestamps are correct
- `wait_for_message` still works (event handlers receive messages)
- Approval workflows still work

---

## Priority

**High** — This is the primary way users view their WhatsApp messages. Without visible message content, the MCP server's core feature (reading messages) is broken.

However, real-time functionality (approvals, wait_for_message) continues to work, so this doesn't block automation workflows entirely.

---

## Related Issues

- `docs/bugs/BUG-self-account-messages-not-received.md` — Fixed bug about event handlers
- `docs/bugs/BUG-poll-votes-not-received.md` — Similar issue with poll vote extraction
- `src/whatsapp/client.ts` line 853 — Empty body logging already exists
- `src/tools/messaging.ts` lines 267-276 — Display logic falls back to `[empty]`

---

## Test Plan

After fix:

1. Authenticate with test phone number
2. Send test messages of various types (text, media, reactions)
3. Verify `list_messages` shows:
   - Text messages display the actual text
   - Media messages show `[image] (id: 3A...)` format
   - Message IDs are visible for `download_media`
4. Verify `search_messages` can find text content
5. Verify `catch_up` shows message previews
6. Test with self-messages (messages from phone to linked device)
7. Test with messages from others (group DMs, individual chats)