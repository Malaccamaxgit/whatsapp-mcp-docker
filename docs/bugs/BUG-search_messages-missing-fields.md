# BUG: search_messages output omits message ID, read status, and media metadata

**Status: OPEN**

## Symptom

The `search_messages` tool retrieves full `MessageRow` objects from the database (14 fields) via a FTS5 join (`SELECT m.* FROM messages_fts ... JOIN messages m`), but the inline formatting (messaging.ts lines 386-416) only renders 5-6 fields in plain text:

- `chat_jid` — resolved to chat name via `store.getChatByJid()`
- `is_from_me` — determines "You" vs sender
- `sender_name` — fallback display
- `sender_jid` — fallback: `sender_jid?.split('@')[0]`
- `body` — truncated to 150 chars (100 for context lines)
- `timestamp` — formatted via `formatTimestamp()` (only in non-context mode)

The `id` field is **never shown**, making search results unusable for downstream operations. Media messages with empty body text appear as `[empty]` instead of `[media]`. Users cannot tell which messages are read vs unread.

## Root cause

The search results are formatted with inline logic (messaging.ts lines 386-416) that does not use the shared `formatMsg` function. The formatting logic:

```
// Lines 386-416 (simplified):
const dir = m.is_from_me ? 'You' : m.sender_name || m.sender_jid?.split('@')[0] || 'Unknown';
const body = m.body ? m.body.substring(0, 150) : '[empty]';
// No id, no is_read, no has_media check, no media metadata
```

Media messages are not checked at all — `has_media`, `media_type`, `media_filename`, and `media_mimetype` are all fetched but ignored.

## Impact

- **edit_message** — users cannot identify the message ID from search results to edit
- **delete_message** — users cannot identify the message ID from search results to delete
- **send_reaction** — users cannot identify the message ID from search results to react to
- **download_media** — users cannot identify the message ID from search results to download
- **is_read** status is invisible — users cannot distinguish read from unread
- **Media messages** appear as `[empty]` instead of showing `[image]`, `[document]`, etc.
- **Document filenames** are never shown — users see `[document]` instead of the actual filename

## Proposed fix

Update the inline formatting in `search_messages` to include all key fields, consistent with the planned enrichment of `formatMsg` in `list_messages`. Consider extracting a shared formatting utility that both tools can use.

Include at minimum:
- `id` — message ID (essential for all downstream operations)
- `is_read` — boolean indicator
- `has_media` / `media_type` — show `[image/jpeg]`, `[document]`, etc. instead of `[empty]`
- `media_filename` — show actual filename for documents

## Files to modify

- `src/tools/messaging.ts` — inline formatting in `search_messages` (lines 386-416)

## Notes

This tool has its own inline formatting path separate from `formatMsg`. A longer-term improvement would be to extract a shared formatting utility that both `list_messages` and `search_messages` can use, ensuring consistency.

**Priority: HIGH** — search results are fundamentally unusable for acting on messages without the ID field.
