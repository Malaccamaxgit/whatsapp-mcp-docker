# BUG: Same contact appears as duplicate entries in chat list

**Status:** ✅ FIXED (2026-04-04)

---

## Resolution

This bug was fixed by implementing a **contact mapping system** that unifies duplicate chat entries caused by WhatsApp's different JID formats (`@lid` vs `@s.whatsapp.net`).

### What Was Implemented

1. **Database Schema** (`src/whatsapp/store.ts`):
   - Added `contact_mappings` table to store JID relationships
   - Maps: `lid_jid` ↔ `phone_jid` ↔ `phone_number` ↔ `contact_name`

2. **JID Utilities** (`src/utils/jid-utils.ts`):
   - Helper functions for JID detection and normalization
   - Automatic resolution of phone numbers to unified JIDs

3. **Automatic Mapping** (`src/whatsapp/client.ts`):
   - Mappings created automatically when sending/receiving messages
   - LID resolution from phone JIDs using `getUserInfo()`

4. **Unified Chat Listing** (`src/tools/chats.ts`):
   - `list_chats` now uses `getAllChatsUnified()` to merge duplicates
   - Prefers `@lid` format for display
   - Shows both JID formats for reference

5. **Migration Tool** (`migrate_duplicate_chats`):
   - Temporary admin tool to backfill existing duplicate data
   - Can be run once to migrate historical duplicates

### Test Results

✅ All 125 tests passed (including 20+ new JID unification tests)  
✅ No TypeScript compilation errors  
✅ No linter errors  

### Files Modified

- `src/whatsapp/store.ts` - Schema + mapping methods + migration
- `src/utils/jid-utils.ts` - NEW - JID normalization utilities
- `src/whatsapp/client.ts` - Automatic mapping population
- `src/tools/chats.ts` - Unified chat listing + migration tool
- `test/integration/jid-unification.test.ts` - NEW - Integration tests

### Before vs After

**Before:**
```
[Chat] Séverine Godet
     JID: 44612043436101@lid

[Chat] Séverine Godet  
     JID: 33680940027@s.whatsapp.net
```

**After:**
```
[Chat] Séverine Godet
     JID: 44612043436101@lid ↔ 33680940027@s.whatsapp.net (+33680940027)
```

### Usage

The fix works automatically for all new messages. To migrate existing duplicates:

```
/migrate_duplicate_chats dry_run=true   # Preview what will be migrated
/migrate_duplicate_chats                # Execute migration
```

---

## Symptom

When listing chats via `list_chats`, the same contact appears **twice** with different identifiers:

### Example from Testing (2026-04-04)

**Benjamin Alloul** appears as TWO separate chats:
1. `[Chat] Benjamin Alloul` — JID: `128819088347371@lid`
2. `[Chat] 14384083030@s.whatsapp.net` — JID: `14384083030@s.whatsapp.net`

**Séverine Godet** appears as TWO separate chats:
1. `[Chat] Séverine Godet (7 unread)` — JID: `44612043436101@lid`
2. `[Chat] 33680940027@s.whatsapp.net` — JID: `33680940027@s.whatsapp.net`

### Expected Behavior

Each unique WhatsApp user should appear **once** in the chat list, regardless of:
- Whether they were messaged via phone number (+33...) or name ("Séverine Godet")
- Whether WhatsApp uses `@lid` (Local ID) or `@s.whatsapp.net` (phone-based JID) format
- Whether the contact exists in the user's phone address book

---

## Root Cause (To Investigate)

### Background: WhatsApp JID Formats

WhatsApp uses two types of JIDs:

1. **`@s.whatsapp.net`** — Phone number-based JID (traditional format)
   - Example: `33680940027@s.whatsapp.net`
   - Used for: Phone number lookups, some message routing

2. **`@lid`** — Local ID (newer format for privacy)
   - Example: `44612043436101@lid`
   - Used for: Contacts in address book, group participants, some message types
   - More stable across phone number changes

### Hypothesis

The MCP server is treating `@lid` and `@s.whatsapp.net` JIDs as **separate contacts** when they represent the **same person**.

**What's likely happening:**

1. User sends message to `+33680940027` → stored as `33680940027@s.whatsapp.net`
2. WhatsApp receives message, associates it with contact's LID → replies from `44612043436101@lid`
3. MCP server sees two different JIDs → creates two separate chat entries
4. Contact name ("Séverine Godet") is only associated with one JID (likely the `@lid` version from the address book)

### Possible Technical Causes

#### 1. No JID resolution/unification layer

The `list_chats` tool (or underlying `getAllChatsForMatching()` in the store) returns raw JIDs without:
- Detecting that `44612043436101@lid` and `33680940027@s.whatsapp.net` are the same person
- Merging chat history from both JIDs into a single conversation view
- Preferring one JID format over the other for display

#### 2. WhatsApp sends different JID formats for different operations

- **Outbound messages** to phone numbers → use `@s.whatsapp.net`
- **Inbound messages** from contacts → use `@lid`
- **Group messages** → may use either format
- **Non-contact messages** → may only have `@s.whatsapp.net`

The MCP server doesn't normalize these.

#### 3. Store doesn't track JID mappings

The SQLite database likely has no table or field that maps:
```
lid_jid ↔ phone_number_jid ↔ contact_name
```

Without this mapping, the server cannot unify the conversations.

---

## Files to Review

- `src/whatsapp/store.ts` — How chats are stored and retrieved
- `src/tools/chats.ts` — `list_chats` implementation
- `src/utils/fuzzy-match.ts` — How contacts are resolved for sending messages
- `src/utils/phone.ts` — JID conversion utilities (`toJid()`)
- `src/whatsapp/client.ts` — How incoming messages extract and store JIDs

---

## Debug Steps

### 1. Query the database directly

Check how chats are stored:

```sql
-- See all unique JIDs in the messages table
SELECT DISTINCT chat_jid, sender_jid FROM messages ORDER BY timestamp DESC LIMIT 20;

-- Check if both JID formats exist for the same contact
SELECT chat_jid, sender_jid, sender_name, body, timestamp 
FROM messages 
WHERE chat_jid LIKE '%33680940027%' OR chat_jid LIKE '%44612043436101%'
ORDER BY timestamp DESC;
```

### 2. Check contact resolution

Test the fuzzy match logic:

```typescript
// Does resolveRecipient() know these are the same person?
resolveRecipient("33680940027@s.whatsapp.net", chats)
resolveRecipient("44612043436101@lid", chats)
resolveRecipient("+33680940027", chats)
resolveRecipient("Séverine Godet", chats)
```

### 3. Enable DEBUG logging

```bash
export DEBUG=client,fuzzy
```

Then:
- Send a message to `+33680940027`
- Wait for a reply
- Observe which JIDs are used in each direction

### 4. Check WhatsApp's contact mapping

The `get_user_info` or `is_on_whatsapp` tools may return JID mappings:

```typescript
// Does this return both JIDs?
getUserInfo(["+33680940027"])
```

---

## Impact

| Issue | Severity |
|-------|----------|
| **User confusion** — Same person appears twice | High |
| **Fragmented conversation history** — Messages split across two chats | High |
| **Fuzzy matching fails** — "Séverine" may only match one JID | Medium |
| **Unread count inaccurate** — Unread messages may be in the "other" chat | Medium |
| **Reply confusion** — User may reply to wrong JID | Medium |
| **Database bloat** — Duplicate chat entries | Low |

---

## Priority

**High** — This affects core chat functionality and user experience. Users expect to see one conversation per person, not multiple entries based on JID format.

---

## Related Issues

- `docs/bugs/BUG-self-account-messages-not-received.md` — Message extraction and JID handling
- `docs/bugs/BUG-poll-votes-not-received.md` — Poll votes may use different JID formats
- `src/tools/wait.ts` — TODO comment on `@lid` JID filter timeout issues

---

## Fix Requirements

### Short-term (Quick Fix)

1. **Detect duplicate contacts** — When listing chats, identify JIDs that likely represent the same person:
   - Same `sender_name` with different JIDs
   - Phone number in `@s.whatsapp.net` JID matches contact's known number
   - Track recent message timestamps to identify "active" vs "stale" JID

2. **Merge in UI** — Display as single chat entry with preferred JID (likely `@lid` for contacts with names)

3. **Document workaround** — Tell users to always message via contact name or `@lid` JID

### Long-term (Proper Fix)

1. **Add JID mapping table** to SQLite:
   ```sql
   CREATE TABLE contact_mappings (
     id INTEGER PRIMARY KEY,
     lid_jid TEXT,              -- e.g., "44612043436101@lid"
     phone_jid TEXT,            -- e.g., "33680940027@s.whatsapp.net"
     phone_number TEXT,         -- e.g., "+33680940027"
     contact_name TEXT,         -- e.g., "Séverine Godet"
     created_at INTEGER,
     updated_at INTEGER
   );
   ```

2. **Populate mappings automatically**:
   - When sending to a phone number, store the mapping when WhatsApp responds
   - When receiving from `@lid`, check if we have a phone number mapping
   - Use `get_user_info()` to enrich contact data

3. **Update all tools to use unified JIDs**:
   - `list_chats` — Merge duplicate entries
   - `list_messages` — Show messages from both JIDs in single thread
   - `send_message` — Resolve to correct JID automatically
   - `wait_for_message` — Accept either JID format in filters

4. **Backfill existing data** — Migrate existing duplicate chats into unified view

---

## Test Plan

After fix:

1. **Send message to phone number** → Should appear in unified chat
2. **Receive reply from `@lid`** → Should appear in same chat entry
3. **List chats** — Each contact appears once
4. **Fuzzy matching** — "Séverine", "+33680940027", and "33680940027@s.whatsapp.net" all resolve to same chat
5. **Message history** — All messages visible regardless of which JID was used
6. **Group participants** — `@lid` JIDs in groups correctly map to phone contacts

---

## WhatsApp Protocol Notes

From whatsmeow/Baileys documentation:

- **LID (Local ID)**: Introduced for privacy, used for contacts in address book
- **Phone JID**: Traditional format, still used for non-contacts and some operations
- **Mapping**: WhatsApp internally knows both JIDs refer to same user
- **Bridge behavior**: whatsmeow-node may emit different JID formats depending on message type and direction

The MCP server needs to maintain its own mapping since the bridge doesn't automatically unify them.
