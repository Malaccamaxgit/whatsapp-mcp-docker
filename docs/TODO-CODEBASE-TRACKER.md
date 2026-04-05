# TODO Tracker — WhatsApp MCP Server

> **Purpose** — Centralized tracking of all inline TODO comments, notes, and technical debt in the TypeScript codebase. Categorized as **BUG** or **ENHANCEMENT** with priority levels.

**Generated:** 2026-04-04  
**Total Items:** 6 TODOs across 5 files

---

## Summary by Category

| Category | Count | Files Affected |
|----------|-------|----------------|
| 🐛 **BUG** | 3 | `wait.ts`, `client.ts`, `auth.ts` |
| ✨ **ENHANCEMENT** | 2 | `messaging.ts`, `auth.ts` |

---

## Priority Legend

| Priority | Description | Target Timeline |
|----------|-------------|-----------------|
| 🔴 **P0 - Critical** | Blocks core functionality, data loss | Immediate |
| 🟠 **P1 - High** | Significant UX impact, workarounds exist | Next sprint |
| 🟡 **P2 - Medium** | Useful improvement, non-blocking | Backlog |
| 🟢 **P3 - Low** | Nice-to-have, cosmetic | Future consideration |

---

## TODO Items

### 🐛 BUG-001: `wait_for_message` Timeout with @lid JIDs

**File:** [`src/tools/wait.ts`](../src/tools/wait.ts)  
**Lines:** 68-95  
**Priority:** 🟠 **P1 - High**  
**Category:** BUG

**Issue:**
`wait_for_message` times out even when messages are arriving from the specified chat JID (e.g., `44612043436101@lid`).

**Observed Behavior:**
- Tool shows "Running Wait For Message in MCP_DOCKER" with correct parameters
- Messages arrive from the target JID (verified in WhatsApp UI)
- Tool returns timeout error: "No message matching chat='...' received within X seconds"

**Possible Causes:**
1. **JID mismatch** — Filter compares `msg.chatJid !== chatJidFilter`, but incoming messages may have different JID format (with/without @lid, normalized differently)
2. **Race condition** — Waiter added AFTER message arrives
3. **Filter logic gap** — `@lid` JIDs not correctly resolved in fuzzy match
4. **Waiter removal timing** — Timeout removes waiter before `_notifyMessageWaiters()` resolves it

**Workaround:**
Use `wait_for_message` without the `chat` filter (wait for any message), then filter manually.

**Debug Steps:**
- [ ] Add DEBUG logging to show filter JID vs actual `msg.chatJid`
- [ ] Log waiter add/remove events with timestamps
- [ ] Compare JID formats in store vs raw events
- [ ] Test with/without chat filter

**Related Issues:**
- `docs/bugs/BUG-duplicate-chat-contacts.md` — @lid vs @s.whatsapp.net duplication
- `docs/bugs/BUG-self-account-messages-not-received.md` — Event handling gaps

---

### 🐛 BUG-002: Empty Message Bodies in Database

**File:** [`src/whatsapp/client.ts`](../src/whatsapp/client.ts)  
**Lines:** 843-853  
**Priority:** 🟠 **P1 - High**  
**Category:** BUG

**Issue:**
Messages appear as `[empty]` in `list_messages` output even though they're stored in the database.

**Observed Behavior:**
- Connection status shows messages stored (e.g., "9 messages")
- `list_messages` returns messages with empty body: `[4/4/2026, 8:27:01 PM] You: [empty]`
- Event handlers work (messages are received and stored)

**Root Cause:**
Text extraction in `_persistMessage()` may not be finding the correct field from the Go bridge event structure. Current logic checks:
- `evt.text` / `evt.body`
- `rawMessage?.conversation`
- `rawMessage?.extendedTextMessage?.text`

**Debug Steps:**
- [ ] Enable `DEBUG=client` to log raw event structures
- [ ] Compare actual vs expected field names from whatsmeow-node
- [ ] Check if issue affects only self-messages or all incoming
- [ ] Test different message types (text, media, reactions, etc.)

**Impact:**
Users cannot see message content, only metadata (timestamp, sender, has_media flag).

**Related Issues:**
- `docs/bugs/BUG-self-account-messages-not-received.md` — TODO section on empty messages

---

### 🐛 BUG-003: Phone Number Validation Too Permissive

**File:** [`src/tools/auth.ts`](../src/tools/auth.ts)  
**Lines:** 278-281  
**Priority:** 🟡 **P2 - Medium**  
**Category:** BUG

**Issue:**
Phone number validation allows 7-15 digits (E.164 standard range) but doesn't enforce country-code-specific lengths, potentially accepting invalid numbers.

**Example:**
- `+143840830330` (12 digits after +1) passes validation
- But North American numbers should be exactly 10 digits after +1
- This can lead to authentication failures or messages sent to wrong numbers

**Current Validation:**
```typescript
if (digits.length < E164_MIN_DIGITS) { ... } // 7 digits
if (digits.length > E164_MAX_DIGITS) { ... } // 15 digits
```

**Proposed Enhancement:**
Add country-code-specific validation:
- `+1` (US/Canada) → exactly 10 digits
- `+33` (France) → exactly 9 digits
- `+49` (Germany) → variable (10-11 digits)
- etc.

**Reference:**
https://en.wikipedia.org/wiki/E.164#Country_codes_and_maximum_lengths

**Impact:**
Low — validation provides helpful error messages, but unusual formats may slip through.

---

### ✨ ENHANCEMENT-001: Auto-Convert Phone Numbers to JID Format

**File:** [`src/tools/messaging.ts`](../src/tools/messaging.ts)  
**Lines:** 114-119  
**Priority:** 🟡 **P2 - Medium**  
**Category:** ENHANCEMENT

**Issue:**
`send_message` fails for phone numbers not in existing chat list, requiring manual JID format.

**Current Behavior:**
```
❌ send_message(to: "+33680940027") → "Could not resolve recipient"
✅ send_message(to: "33680940027@s.whatsapp.net") → Works
```

**Proposed Enhancement:**
When fuzzy matching fails:
1. Check if `to` looks like a phone number (starts with `+` or digits only)
2. Validate with `validatePhoneNumber()` from `src/utils/phone.ts`
3. Auto-convert to JID format using `toJid()`
4. Proceed with send without requiring contact to exist in chat list

**Implementation:**
```typescript
if (!resolved) {
  // Check if "to" is a phone number
  if (to.startsWith('+') || /^\d+$/.test(to.replace(/\D/g, ''))) {
    const validation = validatePhoneNumber(to);
    if (validation.valid) {
      const jid = `${validation.number}@s.whatsapp.net`;
      // Proceed with send to jid
    }
  }
}
```

**Benefits:**
- More intuitive UX — message any WhatsApp number directly
- Matches behavior of `is_on_whatsapp` tool
- Eliminates manual JID format workaround

**Related Issues:**
- `docs/bugs/BUG-self-account-messages-not-received.md` — Contact resolution

---

### ✨ ENHANCEMENT-002: Enhanced DEBUG Logging for wait_for_message

**File:** [`src/tools/wait.ts`](../src/tools/wait.ts)  
**Lines:** 126-170  
**Priority:** 🟢 **P3 - Low**  
**Category:** ENHANCEMENT

**Issue:**
Insufficient logging makes it hard to diagnose `wait_for_message` timeouts and waiter registration issues.

**Proposed Enhancement:**
Add comprehensive DEBUG logging:
- Waiter registration: timestamp, filter criteria, chat JID, sender filter
- Message dispatch: which waiter matched, filter result
- Timeout events: waiter removal, filter parameters
- JID format comparison: filter JID vs incoming message JID

**Example:**
```typescript
const log = debug('wait');
log('Waiter registered: chat=%s, from=%s, timeout=%ds', chat, from_phone, timeout);
log('Incoming message: chatJid=%s, senderJid=%s', msg.chatJid, msg.senderJid);
log('Filter result: match=%s', filter(msg));
```

**Usage:**
```bash
export DEBUG=wait
# or
export DEBUG=wait,client
```

**Benefits:**
- Faster debugging of timeout issues
- Better visibility into message flow
- Easier to identify JID format mismatches

**Related Issues:**
- BUG-001 (this file) — Timeout investigation

---

## Cross-Reference Matrix

| TODO ID | Related Bug Report | Related Code | Status |
|---------|-------------------|--------------|--------|
| BUG-001 | `BUG-duplicate-chat-contacts.md` | `wait.ts`, `client.ts` | 🔴 Open |
| BUG-001 | `BUG-self-account-messages-not-received.md` | `wait.ts`, `client.ts` | 🔴 Open |
| BUG-002 | `BUG-self-account-messages-not-received.md` | `client.ts` | 🔴 Open |
| BUG-003 | — | `auth.ts`, `phone.ts` | 🟡 Open |
| ENHANCEMENT-001 | `BUG-self-account-messages-not-received.md` | `messaging.ts`, `phone.ts` | 🟡 Open |
| ENHANCEMENT-002 | BUG-001 | `wait.ts` | 🟢 Open |

---

## Action Plan

### Immediate (P0 - Critical)
*None currently*

### Next Sprint (P1 - High)
- [ ] **BUG-001** — Fix `wait_for_message` timeout with @lid JIDs
- [ ] **BUG-002** — Fix empty message body extraction

### Backlog (P2 - Medium)
- [ ] **BUG-003** — Add country-code-specific phone validation
- [ ] **ENHANCEMENT-001** — Auto-convert phone numbers to JID format

### Future (P3 - Low)
- [ ] **ENHANCEMENT-002** — Enhanced DEBUG logging for wait tools

---

## Appendix: How to Find TODOs

Search the codebase for inline TODOs:

```bash
# All TODOs
grep -r "TODO" src/ --include="*.ts"

# BUG-specific TODOs
grep -r "TODO.*BUG\|TODO.*bug\|TODO.*fix" src/ --include="*.ts"

# Enhancement TODOs
grep -r "TODO.*enhance\|TODO.*feature\|TODO.*improve" src/ --include="*.ts"
```

Or use the IDE's "Find in Files" with regex: `\/\/\s*TODO.*`

---

**Last Updated:** 2026-04-04  
**Maintainer:** WhatsApp MCP Server Team
