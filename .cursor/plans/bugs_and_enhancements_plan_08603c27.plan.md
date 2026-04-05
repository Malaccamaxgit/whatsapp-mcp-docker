---
name: Bugs and Enhancements Plan
overview: Prioritized execution plan for 14 open bugs and 2 enhancements, ordered by severity, dependency chains, and foundational value. The plan addresses critical data pipeline issues first (websocket, message persistence), then output formatting, then authentication UX, and finally architectural enhancements.
todos:
  - id: phase-1-websocket
    content: "Fix BUG-websocket-not-connected: add WebSocket probe, force re-pairing flag, enhance status reporting"
    status: pending
  - id: phase-1-empty-messages-jid
    content: "Fix BUG-messages-appear-empty + BUG-group-chatjid-name-mismatch: expand text extraction, fix chatJid routing, add chat repair migration"
    status: pending
  - id: phase-1-poll-votes
    content: "Fix BUG-poll-votes-not-received: add poll event listener, poll_votes table, get_poll_results tool"
    status: pending
  - id: phase-2-search-messages
    content: "Fix BUG-search_messages-missing-fields: add message ID, is_read, media metadata to search output"
    status: pending
  - id: phase-2-list-messages
    content: "Fix BUG-list_messages-missing-fields: enrich formatMsg with ID, is_read, media info"
    status: pending
  - id: phase-2-search-contacts
    content: "Fix BUG-search_contacts-missing-fields: add unread_count, last_message_at, last_message_preview"
    status: pending
  - id: phase-2-export-chat
    content: "Fix BUG-export_chat_data-missing-output: add message preview to text output"
    status: pending
  - id: phase-2-approvals
    content: "Fix BUG-check_approvals-missing-details: show details field in both output modes"
    status: pending
  - id: phase-2-send-file-ts
    content: Fix BUG-send_file-missing-timestamp (LOW)
    status: pending
  - id: phase-2-joined-groups
    content: Fix BUG-get_joined_groups-missing-participants (LOW)
    status: pending
  - id: phase-3-qr-delay
    content: "Fix BUG-qr-code-delayed-by-wait-for-link: return immediately in QR mode"
    status: pending
  - id: phase-3-pairing-timing
    content: "Implement ENHANCEMENT-pairing-code-websocket-timing: increase buffer, add retry logic"
    status: pending
  - id: phase-3-auth-default
    content: "Fix BUG-auth-wait-for-link-default: change default to true (safe after Steps 3.1 and 3.2)"
    status: pending
  - id: phase-4-multi-device
    content: "Implement ENHANCEMENT-multi-device-jid-mapping: 4-phase schema migration and tool updates"
    status: pending
isProject: false
---

# Bugs & Enhancements Execution Plan

## Dependency Graph

```
BUG-websocket-not-connected (foundation for everything outbound)
    │
    ├── BUG-messages-appear-empty (text extraction from Go bridge)
    │       ├── BUG-search_messages-missing-fields (formatting - now has data)
    │       ├── BUG-list_messages-missing-fields (formatting - now has data)
    │       ├── BUG-poll-votes-not-received (poll text extraction)
    │       └── BUG-export_chat_data-missing-output (has real message data)
    │
    ├── BUG-group-chatjid-name-mismatch (chat routing)
    │       └── ENHANCEMENT-multi-device-jid-mapping (needs correct JID handling)
    │
    ├── BUG-qr-code-delayed-by-wait-for-link (auth flow)
    │       ├── BUG-auth-wait-for-link-default (default value)
    │       └── ENHANCEMENT-pairing-code-websocket-timing (timing improvements)
    │
    └── BUG-search_contacts-missing-fields (uses getAllChatsUnified)

Independent (no blockers, output-only fixes):
    ├── BUG-send_file-missing-timestamp (LOW)
    ├── BUG-get_joined_groups-missing-participants (LOW)
    └── BUG-check_approvals-missing-details (MEDIUM)
```

## Phase 1: Fix the Data Pipeline (Critical Foundation)

These three HIGH-severity bugs all live in `src/whatsapp/client.ts`'s `_persistMessage()` method and share root causes in how the Go bridge event structure is interpreted. Fixing them together is more efficient than separate passes.

### Step 1.1: BUG-websocket-not-connected

**Why first:** All outbound messaging (`send_message`, `send_file`, `create_poll`) is broken. The `isConnected()` check in `[src/whatsapp/client.js](src/whatsapp/client.js)` returns true falsely because it trusts the `connected` event without verifying the Go WebSocket is actually usable. The `session.db` has no device credentials.

**Changes:**

- `[src/whatsapp/client.ts](src/whatsapp/client.ts)` — Add a probe after `connected` event (lightweight RPC call to Go binary) before setting `_connected = true`. Add a `force` flag to `requestPairingCode()` to bypass the early return when `isConnected()` is true but broken.
- `[src/tools/auth.ts](src/tools/auth.ts)` — Add `force` parameter to `authenticate` tool to allow re-pairing even when "already connected."
- `[src/tools/status.ts](src/tools/status.ts)` — Enhance `get_connection_status` to report WebSocket probe status, not just event history.

### Step 1.2: BUG-messages-appear-empty + BUG-group-chatjid-name-mismatch (combined)

**Why combined:** Both bugs live in the same `_persistMessage()` method in `[src/whatsapp/client.ts](src/whatsapp/client.ts)` (lines 823-907). The chatJid extraction (line 835) and text extraction (lines 838-843) share the same event parsing logic. One debug pass with `DEBUG=client` captures raw events for both fixes.

**Changes:**

- `[src/whatsapp/client.ts](src/whatsapp/client.ts)` — Fix `chatJid` extraction: when `evt.key?.participant` is present (group participant message), use `evt.key?.remoteJID` (the group JID) instead of falling back to `evt.from` (sender JID). Expand `body` extraction chain to cover all Go bridge field paths: `evt.text`, `evt.body`, `rawMessage?.conversation`, `rawMessage?.extendedTextMessage?.text`, `rawMessage?.ephemeralMessage?.message?.conversation`, `rawMessage?.viewOnceMessage?.message?.conversation`, and media captions.
- `[src/whatsapp/client.ts](src/whatsapp/client.ts)` — Fix `_extractMediaInfo()` (lines 1292-1314) to detect additional media type paths.
- `[src/whatsapp/store.ts](src/whatsapp/store.ts)` — Add a `repairMisroutedChats()` migration to fix existing chats where `@lid` JIDs have `is_group=0` but should be `is_group=1`.

### Step 1.3: BUG-poll-votes-not-received

**Why here:** Depends on correct message extraction (Step 1.2). Poll votes likely arrive as `pollUpdateMessage` or `protocolMessage` events that need dedicated parsing.

**Changes:**

- `[src/whatsapp/client.ts](src/whatsapp/client.ts)` — Add event listener for poll-specific events. Parse poll vote structure and store in a new `poll_votes` table or as message metadata.
- `[src/whatsapp/store.ts](src/whatsapp/store.ts)` — Add `poll_votes` table and query methods.
- `[src/tools/messaging.ts](src/tools/messaging.ts)` — Add `get_poll_results` tool to expose vote data.

## Phase 2: Output Formatting Fixes (Data Exists Now)

With message bodies and chat routing fixed, these formatting bugs become straightforward.

### Step 2.1: BUG-search_messages-missing-fields (HIGH → now actionable)

**Changes:**

- `[src/tools/messaging.ts](src/tools/messaging.ts)` — Update inline formatting (lines 386-416) to include: `id` (message ID for downstream operations), `is_read`, `has_media`/`media_type`/`media_filename`. Consider extracting a shared formatter with `list_messages`.

### Step 2.2: BUG-list_messages-missing-fields

**Changes:**

- `[src/tools/messaging.ts](src/tools/messaging.ts)` — Enrich `formatMsg()` function (lines 267-278) to show: `id` for all messages (not just media), `is_read` indicator, media type/filename instead of `[empty]`.

### Step 2.3: BUG-search_contacts-missing-fields

**Changes:**

- `[src/tools/chats.ts](src/tools/chats.ts)` — Update contact list formatting (lines 263-267) to include `unread_count`, `last_message_at`, `last_message_preview`.
- `[src/whatsapp/store.ts](src/whatsapp/store.ts)` — Ensure `getAllChatsForMatching()` returns the same fields as `getAllChatsUnified()`, or switch to `getAllChatsUnified()`.

### Step 2.4: BUG-export_chat_data-missing-output

**Changes:**

- `[src/tools/chats.ts](src/tools/chats.ts)` — Update text output (lines 406-426) to include a message preview/summary alongside metadata.

### Step 2.5: BUG-check_approvals-missing-details

**Changes:**

- `[src/tools/approvals.ts](src/tools/approvals.ts)` — Add `details` field to output in both specific mode (lines 193-210) and list mode (lines 220-226).

### Step 2.6: BUG-send_file-missing-timestamp (LOW)

**Changes:**

- `[src/tools/media.ts](src/tools/media.ts)` — Include `timestamp` field in output (lines 255-262).

### Step 2.7: BUG-get_joined_groups-missing-participants (LOW)

**Changes:**

- `[src/tools/groups.ts](src/tools/groups.ts)` — Expand output (lines 197-199) to show participant details (JID, isAdmin, isSuperAdmin) instead of just count.

## Phase 3: Authentication UX Improvements

These form a chain — the QR blocking bug must be fixed before the default can safely change to `waitForLink: true`.

### Step 3.1: BUG-qr-code-delayed-by-wait-for-link

**Why here:** QR codes expire in ~20 seconds, making `waitForDeviceLink` pointless in QR mode. The blocking pattern causes Cursor to abort.

**Changes:**

- `[src/tools/auth.ts](src/tools/auth.ts)` — In QR mode, skip `waitForDeviceLink()` and return immediately regardless of `waitForLink` setting. QR codes are time-sensitive; the user must scan quickly and check status with `get_connection_status`.

### Step 3.2: ENHANCEMENT-pairing-code-websocket-timing

**Why here:** Improves pairing code success rate. The enhancement document recommends starting with Enhancement A (increase buffer from 5s to 8s) and Enhancement C (retry logic).

**Changes:**

- `[src/whatsapp/client.ts](src/whatsapp/client.ts)` — Add `AUTH_READY_DELAY_MS` env var (default 8000ms). Add pairing code retry logic (max 2 attempts with 3s delays).

### Step 3.3: BUG-auth-wait-for-link-default

**Why last in auth chain:** Now that QR mode returns immediately (Step 3.1) and pairing code timing is improved (Step 3.2), it's safe to make `waitForLink` default to `true`.

**Changes:**

- `[src/tools/auth.ts](src/tools/auth.ts)` — Change `authEnvWaitForLink()` default from `false` to `true`.
- `[.cursor/skills/reinitiate/SKILL.md](.cursor/skills/reinitiate/SKILL.md)` — Remove explicit `auth_wait_for_link=false` setting.

## Phase 4: Architectural Enhancement

### Step 4.1: ENHANCEMENT-multi-device-jid-mapping

**Why last:** This is a multi-phase schema migration (4 weeks per the enhancement doc) that depends on the JID handling being correct (Steps 1.2, 1.3). The enhancement proposes a phased rollout:

- **Phase 4.1a:** Add new tables (`contacts`, `contact_devices`, `contact_phone_jids`) without removing `contact_mappings`. Parallel writes.
- **Phase 4.1b:** Implement device discovery — auto-link new LIDs to existing contacts.
- **Phase 4.1c:** Update `list_chats`, `search_contacts`, `send_message` to use unified views.
- **Phase 4.1d:** Cleanup — remove old `contact_mappings` table.

**Files:** `[src/whatsapp/store.ts](src/whatsapp/store.ts)`, `[src/whatsapp/client.ts](src/whatsapp/client.ts)`, `[src/utils/jid-utils.ts](src/utils/jid-utils.ts)`, `[src/utils/fuzzy-match.ts](src/utils/fuzzy-match.ts)`, `[src/tools/contacts.ts](src/tools/contacts.ts)`, `[src/tools/chats.ts](src/tools/chats.ts)`, `[src/tools/messaging.ts](src/tools/messaging.ts)`.

## Execution Order Summary

```
Phase 1: Data Pipeline
  1.1 BUG-websocket-not-connected          (blocks all outbound)
  1.2 BUG-messages-appear-empty            (blocks all readability)
      + BUG-group-chatjid-name-mismatch    (same method, shared debug pass)
  1.3 BUG-poll-votes-not-received          (needs message extraction working)

Phase 2: Output Formatting (now has real data)
  2.1 BUG-search_messages-missing-fields   (HIGH - ID needed for downstream ops)
  2.2 BUG-list_messages-missing-fields
  2.3 BUG-search_contacts-missing-fields
  2.4 BUG-export_chat_data-missing-output
  2.5 BUG-check_approvals-missing-details
  2.6 BUG-send_file-missing-timestamp      (LOW)
  2.7 BUG-get_joined_groups-missing-participants (LOW)

Phase 3: Authentication UX
  3.1 BUG-qr-code-delayed-by-wait-for-link (must fix before changing default)
  3.2 ENHANCEMENT-pairing-code-websocket-timing
  3.3 BUG-auth-wait-for-link-default        (safe now that QR returns immediately)

Phase 4: Architecture
  4.1 ENHANCEMENT-multi-device-jid-mapping  (depends on JID handling correctness)
```

