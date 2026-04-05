# BUG: search_contacts omits unread count, last message time, and preview

**Status: OPEN**

## Symptom

The `search_contacts` tool uses `store.getAllChatsForMatching()` which returns only 2 fields per contact (`jid`, `name`). This means the following fields are unavailable in the output:

- `unread_count` — users cannot see how many unread messages a contact has
- `last_message_at` — users cannot see when they last interacted with a contact
- `last_message_preview` — users cannot see a snippet of the last message

When `include_chats` is true, the tool does call `store.getAllChatsUnified()` (which has all fields), but only for the secondary chat list — the primary contact list still uses the limited 2-field query.

## Root cause

In `src/tools/chats.ts` (line 252), the tool calls:

```
const contacts = await store.getAllChatsForMatching(query);
```

This method (store.ts line 315) returns only `jid` and `name`. If `getAllChatsUnified()` were used instead (store.ts line 437), all 7 ChatRow fields would be available: `jid`, `name`, `is_group`, `unread_count`, `last_message_at`, `last_message_preview`, `updated_at`.

## Impact

- Users searching for contacts cannot see activity level at a glance
- No way to distinguish active contacts from stale ones without calling `list_chats` separately
- The `include_chats` path shows richer data for chats, but the primary contact list remains sparse

## Proposed fix

Switch from `getAllChatsForMatching()` to `getAllChatsUnified()` with a name-matching filter applied in code, or extend `getAllChatsForMatching()` to return the full ChatRow fields. This would make `unread_count`, `last_message_at`, and `last_message_preview` available for the primary contact list.

## Files to modify

- `src/tools/chats.ts` — contact list formatting (lines 263-267)
- `src/whatsapp/store.ts` — potentially extend `getAllChatsForMatching()` to return more fields

**Priority: MEDIUM** — affects the richness of the search output but does not break core functionality.
