---
layout: default
title: API Reference
nav_order: 2
description: "Complete API documentation for all 32 MCP tools — parameters, return types, and examples."
---

# WhatsApp MCP Server API Reference

> **API documentation for all 32 MCP tools**

## Table of Contents

1. [Authentication & Status](#authentication--status)
2. [Messaging](#messaging)
3. [Contacts & Chats](#contacts--chats)
4. [Media](#media)
5. [Intelligence](#intelligence)
6. [Approval Workflows](#approval-workflows)
7. [Groups](#groups)
8. [Message Actions](#message-actions)
9. [Contact Info](#contact-info)
10. [Workflow](#workflow)

---

## Authentication & Status

### `disconnect`

Log out and disconnect from WhatsApp. Clears the current session so the device is unlinked.

**Parameters:** None

**Returns:**
```typescript
{
  content: [{
    type: 'text';
    text: string;  // Confirmation message
  }];
  isError?: boolean;
}
```

**Example:**
```javascript
disconnect()
```

**Notes:**
- After disconnecting, you will need to call `authenticate` again to re-link the device.
- The stored messages and media are not deleted — only the session credentials are cleared.

---

### `authenticate`

Link device to WhatsApp using 8-digit pairing code or QR code.

**Parameters:**
```typescript
{
  phoneNumber?: string;       // E.164 format: "+1234567890" (required when not yet linked)
  waitForLink?: boolean;      // Wait for device to link (default: true)
  linkTimeoutSec?: number;    // Max wait time: 15-600 seconds (default: 120)
  pollIntervalSec?: number;   // Poll interval: 2-60 seconds (default: 5)
}
```

**Returns:**
```typescript
{
  content: [{
    type: 'text' | 'image';
    text: string;
    data?: string;            // Base64 image (for QR)
    mimeType?: string;        // 'image/png' (for QR)
  }];
  isError?: boolean;
}
```

**Example:**
```javascript
authenticate({ phoneNumber: "+15145551234" })
```

**Error Codes:**
- `429` - Rate limited (5 attempts per 30 minutes)
- `400` - Invalid phone number format
- `408` - Pairing code expired (60 seconds)

---

### `get_connection_status`

Check WhatsApp connection state and database statistics.

**Parameters:** None

**Returns:**
```typescript
{
  content: [{
    type: 'text';
    text: string;  // Formatted status report
  }];
}
```

**Status Report Includes:**
- Connection state (connected/disconnected)
- Authenticated JID
- Uptime (if connected)
- Logout reason (if disconnected)
- Database statistics (chats, messages, unread, approvals)
- Recent error count

---

## Messaging

### `send_message`

Send text message with fuzzy contact/group name matching.

**Parameters:**
```typescript
{
  to: string;           // Name, phone, or JID
  message: string;      // Max 4096 characters
}
```

**Returns:**
```typescript
{
  content: [{
    type: 'text';
    text: string;  // Confirmation with message ID
  }];
  isError?: boolean;
}
```

**Example:**
```javascript
send_message({ to: "John Smith", message: "Hello!" })
```

**Error Codes:**
- `429` - Rate limited (60 messages/minute)
- `404` - Recipient not found
- `409` - Ambiguous recipient (multiple matches)
- `403` - Contact not whitelisted

---

### `list_messages`

Get messages from a specific chat with pagination and date filtering.

**Parameters:**
```typescript
{
  chat: string;              // Chat name, phone, or JID
  limit?: number;            // Max results: 1-200 (default: 50)
  page?: number;             // Page number (default: 0)
  before?: string;           // ISO 8601 or natural date
  after?: string;            // ISO 8601 or natural date
  include_context?: boolean; // Include surrounding messages (default: false)
  context_messages?: number; // Context count (default: 2)
}
```

**Returns:**
```typescript
{
  content: [{
    type: 'text';
    text: string;  // Formatted message list
  }];
}
```

**Example:**
```javascript
list_messages({
  chat: "Engineering Group",
  limit: 20,
  after: "2026-03-01",
  include_context: true
})
```

---

### `search_messages`

Full-text search across all messages using SQLite FTS5.

**Parameters:**
```typescript
{
  query: string;             // Search keywords (max 500 chars)
  chat?: string;             // Scope to specific chat
  limit?: number;            // Max results: 1-100 (default: 20)
  page?: number;             // Page number (default: 0)
  include_context?: boolean; // Include context (default: false)
}
```

**Returns:**
```typescript
{
  content: [{
    type: 'text';
    text: string;  // Formatted search results
  }];
  isError?: boolean;
}
```

**Search Syntax:**
- Keywords: `deadline project`
- Exact phrase: `"project deadline"`
- Boolean: `deadline AND urgent`
- Exclusion: `meeting NOT zoom`

---

## Contacts & Chats

### `list_chats`

List conversations sorted by recent activity.

**Parameters:**
```typescript
{
  filter?: string;      // Filter by name (substring)
  groups_only?: boolean;// Only group chats (default: false)
  limit?: number;       // Max results: 1-100 (default: 20)
  page?: number;        // Page number (default: 0)
}
```

**Returns:**
```typescript
{
  content: [{
    type: 'text';
    text: string;  // Formatted chat list
  }];
}
```

**Example:**
```javascript
list_chats({ groups_only: true, limit: 10 })
```

---

### `search_contacts`

Find contacts/groups by name or phone number.

**Parameters:**
```typescript
{
  query: string;         // Search term (max 500 chars)
  include_chats?: boolean; // Return chats involving match (default: false)
  limit?: number;        // Max results: 1-50 (default: 20)
}
```

**Returns:**
```typescript
{
  content: [{
    type: 'text';
    text: string;  // Formatted contact list
  }];
}
```

**Example:**
```javascript
search_contacts({ query: "John", include_chats: true })
```

---

## Media

### `download_media`

Download media from a received message to persistent storage.

**Parameters:**
```typescript
{
  message_id: string;   // Message ID from list_messages
  chat?: string;        // Chat name/phone/JID (optional, for context only — lookup is by message_id)
}
```

**Returns:**
```typescript
{
  content: [{
    type: 'text';
    text: string;  // Download path and metadata
  }];
  isError?: boolean;
}
```

**Example:**
```javascript
download_media({ message_id: "msg-abc123", chat: "John" })
```

**Error Codes:**
- `429` - Rate limited (30 downloads/minute)
- `404` - Media not found or expired
- `413` - Media quota exceeded (512 MB)

---

### `send_file`

Send image, video, audio, or document with optional caption.

**Parameters:**
```typescript
{
  to: string;           // Recipient name/phone/JID
  file_path: string;    // Absolute path in container
  media_type: 'image' | 'video' | 'audio' | 'document';
  caption?: string;     // Max 1024 characters
}
```

**Returns:**
```typescript
{
  content: [{
    type: 'text';
    text: string;  // Confirmation with message ID
  }];
  isError?: boolean;
}
```

**Allowed Directories:**
- `/data/sessions/media/`
- `/tmp`

**Security Checks:**
- Path traversal prevention
- Dangerous extension blocklist
- Magic bytes verification
- File size limit (64 MB)

---

## Intelligence

### `catch_up`

Get intelligent summary of recent WhatsApp activity.

**Parameters:**
```typescript
{
  since?: '1h' | '4h' | 'today' | '24h' | 'this_week';
}
```

**Returns:**
```typescript
{
  content: [{
    type: 'text';
    text: string;  // Activity summary
  }];
}
```

**Summary Includes:**
- Active chats with unread counts
- Questions awaiting response
- Recent unread highlights
- Pending approval requests

---

### `mark_messages_read`

Mark messages as read to clear unread indicators.

**Parameters:**
```typescript
{
  chat?: string;         // Chat to mark all messages
  message_ids?: string[] // Specific message IDs (max 500)
}
```

**Returns:**
```typescript
{
  content: [{
    type: 'text';
    text: string;  // Count of marked messages
  }];
  isError?: boolean;
}
```

**Example:**
```javascript
mark_messages_read({ chat: "John" })
mark_messages_read({ message_ids: ["msg-1", "msg-2"] })
```

---

### `export_chat_data`

Export complete chat history for a specific contact or group. Supports JSON and CSV formats. Designed for PIPEDA individual access rights compliance.

**Parameters:**
```typescript
{
  jid: string;           // Chat JID to export (use list_chats to find JIDs)
  format?: 'json' | 'csv'; // Export format (default: 'json')
}
```

**Returns:**
```typescript
{
  content: [{
    type: 'text';
    text: string;  // Export confirmation with metadata
  }];
  isError?: boolean;
}
```

**Example:**
```javascript
// Export chat to JSON
export_chat_data({ jid: "1234567890@s.whatsapp.net", format: "json" })

// Export chat to CSV
export_chat_data({ jid: "1234567890@s.whatsapp.net", format: "csv" })
```

**Response Includes:**
- Chat name and JID
- Message count
- Export format
- Export timestamp
- Preview of data (first 500 characters for CSV)

**Limitations:**
- Export limited to 10,000 most recent messages per call
- JSON format returns metadata only in response (full data available via programmatic access)
- CSV format includes preview in response

**Compliance Use Cases:**
- PIPEDA individual access requests (Canada)
- Quebec Law 25 data portability
- Personal data export for users

---

## Approval Workflows

### `request_approval`

Send approval request via WhatsApp; recipient replies APPROVE/DENY.

**Parameters:**
```typescript
{
  to: string;           // Recipient name/phone/JID
  action: string;       // What needs approval (max 500 chars)
  details: string;      // Context (max 2000 chars)
  timeout?: number;     // Timeout: 10-3600 seconds (default: 300)
}
```

**Returns:**
```typescript
{
  content: [{
    type: 'text';
    text: string;  // Request ID and expiry
  }];
  isError?: boolean;
}
```

**Example:**
```javascript
request_approval({
  to: "Sarah",
  action: "Deploy v2.1 to production",
  details: "Critical security fixes included",
  timeout: 600
})
```

**Recipient Response:**
- APPROVE/YES/OK/✅ → Approved
- DENY/NO/❌ → Denied
- Reply can include request ID for clarity

---

### `check_approvals`

Check status of approval requests.

**Parameters:**
```typescript
{
  request_id?: string;  // Specific approval ID (omit for all pending)
}
```

**Returns:**
```typescript
{
  content: [{
    type: 'text';
    text: string;  // Approval status
  }];
}
```

**Example:**
```javascript
check_approvals()  // List all pending
check_approvals({ request_id: "approval_123_abc" })  // Specific approval
```

**Status Values:**
- `pending` - Awaiting response
- `approved` - Approved by recipient
- `denied` - Denied by recipient
- `expired` - Timeout reached

---

## Groups

### `create_group`

Create a new WhatsApp group with the given name and participant phone numbers or JIDs.

**Parameters:**
```typescript
{
  name: string;            // Group name (1–100 characters)
  participants: string[];  // E.164 phone numbers or JIDs (1–256 participants)
}
```

**Returns:**
```typescript
{
  content: [{ type: 'text'; text: string }];  // Group JID and invite link
  isError?: boolean;
}
```

**Example:**
```javascript
create_group({ name: "Project Alpha", participants: ["+15145551234", "+447911123456"] })
```

---

### `get_group_info`

Get detailed information about a WhatsApp group: name, description, participants, admin list, and settings.

**Parameters:**
```typescript
{
  group: string;  // Group name (fuzzy match) or JID ending in @g.us
}
```

**Returns:**
```typescript
{
  content: [{ type: 'text'; text: string }];  // Name, JID, description, participant list with roles
}
```

**Example:**
```javascript
get_group_info({ group: "Engineering Team" })
```

---

### `get_joined_groups`

List all WhatsApp groups this account is a member of, with participant counts and admin status.

**Parameters:** None

**Returns:**
```typescript
{
  content: [{ type: 'text'; text: string }];  // Formatted list with names, member counts, JIDs
}
```

---

### `get_group_invite_link`

Get the invite link for a WhatsApp group. Anyone with the link can join. Requires admin privileges.

**Parameters:**
```typescript
{
  group: string;  // Group name (fuzzy match) or JID ending in @g.us
}
```

**Returns:**
```typescript
{
  content: [{ type: 'text'; text: string }];  // https://chat.whatsapp.com/CODE
}
```

---

### `join_group`

Join a WhatsApp group using an invite link or invite code.

**Parameters:**
```typescript
{
  link: string;  // Full invite URL (https://chat.whatsapp.com/CODE) or just the code
}
```

**Returns:**
```typescript
{
  content: [{ type: 'text'; text: string }];  // Joined group JID
  isError?: boolean;
}
```

---

### `leave_group`

Leave a WhatsApp group. This action is permanent — you will need an invite to rejoin.

**Parameters:**
```typescript
{
  group: string;  // Group name (fuzzy match) or JID ending in @g.us
}
```

**Returns:**
```typescript
{
  content: [{ type: 'text'; text: string }];
  isError?: boolean;
}
```

---

### `update_group_participants`

Add, remove, promote to admin, or demote participants in a WhatsApp group. Requires admin privileges for most actions.

**Parameters:**
```typescript
{
  group: string;           // Group name (fuzzy match) or JID ending in @g.us
  action: 'add' | 'remove' | 'promote' | 'demote';
  participants: string[];  // E.164 phone numbers or JIDs (1–50 participants)
}
```

**Returns:**
```typescript
{
  content: [{ type: 'text'; text: string }];  // Per-participant outcome
  isError?: boolean;
}
```

**Example:**
```javascript
update_group_participants({
  group: "Engineering Team",
  action: "promote",
  participants: ["+15145551234"]
})
```

---

### `set_group_name`

Change the name of a WhatsApp group. Requires admin privileges.

**Parameters:**
```typescript
{
  group: string;  // Group name (fuzzy match) or JID ending in @g.us
  name: string;   // New group name (1–100 characters)
}
```

**Returns:**
```typescript
{
  content: [{ type: 'text'; text: string }];
  isError?: boolean;
}
```

---

### `set_group_topic`

Set or update the description/topic of a WhatsApp group. Requires admin privileges.

**Parameters:**
```typescript
{
  group: string;  // Group name (fuzzy match) or JID ending in @g.us
  topic: string;  // New description (max 512 chars; empty string to clear)
}
```

**Returns:**
```typescript
{
  content: [{ type: 'text'; text: string }];
  isError?: boolean;
}
```

---

## Message Actions

### `send_reaction`

React to a WhatsApp message with an emoji. Use an empty string to remove an existing reaction.

**Parameters:**
```typescript
{
  chat: string;        // Chat name, phone number, or JID
  message_id: string;  // Message ID (from list_messages output)
  emoji: string;       // Emoji to react with (e.g. "👍"). Empty string removes reaction.
}
```

**Returns:**
```typescript
{
  content: [{ type: 'text'; text: string }];
  isError?: boolean;
}
```

**Example:**
```javascript
send_reaction({ chat: "John", message_id: "msg-abc123", emoji: "👍" })
send_reaction({ chat: "John", message_id: "msg-abc123", emoji: "" })  // remove
```

---

### `edit_message`

Edit a previously sent WhatsApp message. Only works on messages sent by this account within the last ~15 minutes.

**Parameters:**
```typescript
{
  chat: string;        // Chat name, phone number, or JID
  message_id: string;  // Message ID to edit (from list_messages output)
  new_text: string;    // Replacement text (max 4096 characters)
}
```

**Returns:**
```typescript
{
  content: [{ type: 'text'; text: string }];
  isError?: boolean;
}
```

**Notes:**
- Only messages sent by this account can be edited
- WhatsApp enforces a ~15-minute edit window
- Edited messages show an "edited" indicator to recipients

---

### `delete_message`

Delete a WhatsApp message for everyone in the chat (revoke). Only works on messages sent by this account.

**Parameters:**
```typescript
{
  chat: string;        // Chat name, phone number, or JID
  message_id: string;  // Message ID to delete (from list_messages output)
}
```

**Returns:**
```typescript
{
  content: [{ type: 'text'; text: string }];
  isError?: boolean;
}
```

**Notes:**
- Message is removed for all participants
- Only messages sent by this account can be deleted
- `destructiveHint: true` — this action cannot be undone

---

### `create_poll`

Send a poll to a WhatsApp chat. Participants can vote on one or more options.

**Parameters:**
```typescript
{
  to: string;              // Recipient: contact name, group name, phone number, or JID
  question: string;        // Poll question (max 255 characters)
  options: string[];       // Answer options (2–12 options, max 100 chars each)
  allow_multiple?: boolean;// Allow multiple selections (default: false)
}
```

**Returns:**
```typescript
{
  content: [{ type: 'text'; text: string }];  // Poll confirmation with message ID
  isError?: boolean;
}
```

**Example:**
```javascript
create_poll({
  to: "Engineering Team",
  question: "Which day for the team lunch?",
  options: ["Monday", "Tuesday", "Wednesday", "Thursday"],
  allow_multiple: false
})
```

---

## Contact Info

### `get_user_info`

Get WhatsApp profile information for one or more phone numbers: display name, status, and business details.

**Parameters:**
```typescript
{
  phones: string[];  // Phone numbers in E.164 format (1–20 numbers)
}
```

**Returns:**
```typescript
{
  content: [{ type: 'text'; text: string }];  // Per-number: name, status, business flag
  isError?: boolean;
}
```

**Example:**
```javascript
get_user_info({ phones: ["+15145551234", "+447911123456"] })
```

---

### `is_on_whatsapp`

Check whether one or more phone numbers have WhatsApp accounts. Useful before sending a message to a new contact.

**Parameters:**
```typescript
{
  phones: string[];  // Phone numbers in E.164 format (1–50 numbers)
}
```

**Returns:**
```typescript
{
  content: [{ type: 'text'; text: string }];  // Per-number: ✅ on WhatsApp / ❌ not on WhatsApp
}
```

**Example:**
```javascript
is_on_whatsapp({ phones: ["+15145551234"] })
```

---

### `get_profile_picture`

Get the profile picture URL for a contact or group. Returns the direct image URL from WhatsApp's CDN.

**Parameters:**
```typescript
{
  target: string;  // Phone number, contact name, group name, or JID
}
```

**Returns:**
```typescript
{
  content: [{ type: 'text'; text: string }];  // CDN URL or "no profile picture set"
  isError?: boolean;
}
```

**Notes:**
- CDN URLs expire after a short period; fetch the image promptly
- Privacy settings may prevent retrieval for non-contacts

---

## Workflow

### `wait_for_message`

Block until an incoming WhatsApp message arrives, then return it. Use during interactive AI workflows: ask the user to send a message, call this tool, and the AI receives the reply automatically.

**Parameters:**
```typescript
{
  timeout?: number;      // Seconds to wait (1–300, default: 60)
  chat?: string;         // Only match messages from this chat (name, phone, or JID)
  from_phone?: string;   // Only match messages from this sender phone or JID
}
```

**Returns:**
```typescript
{
  content: [{ type: 'text'; text: string }];  // Sender, chat, timestamp, body, media info, message ID
  isError?: boolean;                           // isError: true if timeout reached
}
```

**Example:**
```javascript
// Wait up to 2 minutes for any message from John
wait_for_message({ timeout: 120, chat: "John" })

// Wait for a message from a specific number
wait_for_message({ timeout: 60, from_phone: "+15145551234" })
```

**Notes:**
- Returns `isError: true` with a descriptive message if the timeout expires with no match
- `readOnlyHint: true` — does not send anything; only observes incoming messages

---

## MCP Notifications

The server sends async notifications for real-time events:

### `notifications/message_received`

```json
{
  "method": "notifications/message_received",
  "params": {
    "messageId": "msg_12345",
    "from": "1234567890@g.us",
    "senderName": "John Doe",
    "timestamp": 1711900000
  }
}
```

> **Note:** `from` is the **chat JID** (e.g. group JID ending in `@g.us` or contact JID ending in `@s.whatsapp.net`), not the individual sender's JID. Use `senderName` to identify who sent the message.

### `notifications/disconnected`

```json
{
  "method": "notifications/disconnected",
  "params": {
    "reason": "connection_lost",
    "permanent": false,
    "message": "WhatsApp temporarily disconnected..."
  }
}
```

### `notifications/audit_failure`

```json
{
  "method": "notifications/audit_failure",
  "params": {
    "type": "audit_failure",
    "reason": "audit_db_init_failed",
    "error": "Database unavailable",
    "timestamp": "2026-03-31T12:00:00.000Z"
  }
}
```

---

## Error Handling

All tools return structured errors with recovery hints:

```typescript
{
  content: [{
    type: 'text';
    text: string;  // Error message with hints
  }];
  isError: true;
}
```

**Common Error Patterns:**
- Rate limit errors include retry-after time
- Ambiguous recipient errors include candidate list
- Connection errors suggest authentication
- Permission errors list allowed contacts

---

**Version:** 2026.1  
**Last Updated:** April 1, 2026
