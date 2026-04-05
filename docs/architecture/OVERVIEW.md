---
layout: default
title: Architecture
nav_order: 3
description: "High-level architecture, component overview, data flow, storage schema, and design decisions."
---

# Architecture Overview

> **Purpose** — High-level architecture documentation for **WhatsApp MCP Server**.

| Topic | Detail |
|-------|--------|
| Runtime | Node.js 22 (Alpine) |
| Platform | Docker MCP Toolkit |
| WhatsApp protocol | whatsmeow-node (Go binary via JSON-line IPC) |
| MCP SDK | @modelcontextprotocol/sdk |
| Database | SQLite (better-sqlite3) with FTS5 full-text search |
| Validation | Zod |
| Container | Docker 4-stage build (~80 MB, npm removed from runtime) |
| Provenance | SLSA max-mode attestations via BuildKit |
| Tools | 34 MCP tools |

---

## Docker MCP Toolkit Architecture

This server runs inside Docker Desktop's [MCP Toolkit](https://docs.docker.com/ai/mcp-catalog-and-toolkit/). The MCP Toolkit provides a **gateway layer** between MCP clients and containerized MCP servers:

```
┌──────────────────────────────────────────────────────────┐
│                   MCP Clients                             │
│                                                           │
│   ┌──────────┐  ┌────────────┐  ┌─────────┐  ┌───────┐  │
│   │  Cursor  │  │ Claude Code│  │ VS Code │  │  CLI  │  │
│   └────┬─────┘  └─────┬──────┘  └────┬────┘  └───┬───┘  │
│        └───────────────┴──────────────┴────────────┘      │
│                         │                                 │
│              ┌──────────▼──────────┐                      │
│              │   Docker MCP        │   Tool discovery      │
│              │   Gateway           │   Lifecycle mgmt      │
│              │   (MCP Toolkit)     │   Multi-client fan-out│
│              │                     │   Secrets injection   │
│              └──────────┬──────────┘                      │
│                         │ stdio                           │
└─────────────────────────┼─────────────────────────────────┘
                          │
         ┌────────────────▼────────────────┐
         │     whatsapp-mcp-docker Container      │
         │     (long-lived, persistent)    │
         └─────────────────────────────────┘
```

### Why not run directly on the host?

| Concern | Docker MCP Toolkit | Running on Host |
|---------|-------------------|-----------------|
| **Isolation** | WhatsApp session keys and messages confined to Docker volumes | Data lives in your home directory |
| **Security** | Non-root, read-only FS, all capabilities dropped | Full user-level access |
| **Secrets** | Encryption key in OS Keychain via `docker mcp secret set` | Must manage `.env` files manually |
| **Multi-client** | One server serves all clients through the gateway | Each client needs its own server process |
| **Dependencies** | None on host — container handles Node.js, native addons, Go binary | Must install Node.js, build tools, manage platform binaries |
| **Portability** | Identical on Windows, macOS, Linux | Platform-specific native dependency issues |
| **Lifecycle** | Health checks, auto-restart, graceful shutdown, long-lived containers | Manual process management |
| **Cleanup** | `docker compose down -v` removes everything | Manual cleanup of data, sessions, processes |
| **Discovery** | `whatsapp-mcp-docker-server.yaml` auto-describes 34 tools to all clients | Manual per-client configuration |

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Docker Container                         │
│                  (read-only root filesystem)                  │
│                  (long-lived across tool calls)               │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐   │
│  │                  MCP Server (stdio)                    │   │
│  │                   src/index.ts                         │   │
│  └──────────┬───────────┬───────────┬────────────────────┘   │
│             │           │           │                         │
│   ┌─────────▼──┐ ┌──────▼──────┐ ┌──▼──────────┐            │
│   │   Tools    │ │  Security   │ │   Utils      │            │
│   │  (32 MCP)  │ │  audit.ts   │ │ fuzzy-match  │            │
│   │            │ │ permissions.ts │ │ phone.ts   │            │
│   └─────────┬──┘ └─────────────┘ └─────────────┘            │
│             │                                                │
│   ┌─────────▼──────────────────────────────────────────┐     │
│   │              WhatsApp Client Layer                  │     │
│   │                 client.ts                           │     │
│   ├─────────────────────┬──────────────────────────────┤     │
│   │    Message Store    │    whatsmeow-node (Go)       │     │
│   │     store.ts        │    JSON-line IPC             │     │
│   │    (SQLite/FTS5)    │                              │     │
│   └──────────┬──────────┴──────────────┬───────────────┘     │
│              │                         │                      │
│   ┌──────────▼──────┐          ┌───────▼───────┐             │
│   │ /data/sessions  │          │  WhatsApp     │             │
│   │  messages.db    │          │  Servers      │             │
│   │  session.db     │          │  (TLS)        │             │
│   │  media/         │          └───────────────┘             │
│   ├─────────────────┤                                        │
│   │  /data/audit    │                                        │
│   │  audit.db       │                                        │
│   ├─────────────────┤                                        │
│   │  /tmp (tmpfs)   │   RAM-backed scratch for media ops     │
│   └─────────────────┘                                        │
└─────────────────────────────────────────────────────────────┘
         │                              │
    Docker Volumes                 Internet
    (persistent)              (WhatsApp protocol)
```

---

## Component Overview

### Entry Point (`src/index.ts`) and Server Factory (`src/server.ts`)

| Responsibility | Detail |
|---------------|--------|
| Wiring | `createServer()` in `server.ts` instantiates and connects store, audit, permissions, and MCP tools. `index.ts` handles WhatsApp client, stdio transport, and lifecycle. |
| Transport | stdio (stdin/stdout for MCP, stderr for logging) |
| Lifecycle | Graceful shutdown on SIGINT/SIGTERM |
| Notifications | Forwards incoming messages as MCP notifications |
| Testability | `createServer()` can be called with mock dependencies for integration testing |
| Welcome group | Optionally creates a WhatsApp group and sends a hello message on first connection |

### WhatsApp Client (`src/whatsapp/client.ts`)

| Responsibility | Detail |
|---------------|--------|
| Protocol | Wraps `@whatsmeow-node/whatsmeow-node` (Go binary) |
| Binary resolution | Auto-detects musl binary for Alpine Linux |
| Session | Persists to `/data/sessions/session.db` |
| Events | `connected`, `logged_out`, `message`, `history_sync` |
| Auth | Pairing code (primary) with QR code image fallback (PNG generated in-container via `qrcode` library, returned as MCP image block + browser-pasteable data URI) |
| Media download | `downloadAny()` → temp file → persistent storage |
| Media upload | `uploadMedia()` + `sendRawMessage()` for image/video/audio/document |
| Message format | Uses `{ conversation: text }` protobuf format for text messages |
| Name resolution | Async backfill of group and contact names |
| Approval detection | Scans incoming messages for APPROVE/DENY keywords |

### Message Store (`src/whatsapp/store.ts`)

| Responsibility | Detail |
|---------------|--------|
| Database | SQLite via `better-sqlite3` with WAL mode |
| Tables | `chats`, `messages`, `approvals` |
| Full-text search | FTS5 virtual table (`messages_fts`) — manually indexed (triggers dropped for encryption compatibility) |
| Field encryption | Encrypts `body`, `sender_name`, `media_raw_json`, `last_message_preview`, `action`, `details`, `response_text` on write; decrypts on read |
| Auto-purge | `purgeOldData()` deletes messages, media files, and approvals older than `MESSAGE_RETENTION_DAYS`. Runs hourly via `startAutoPurge()` |
| Media metadata | `media_mimetype`, `media_filename`, `media_local_path`, `media_raw_json` |
| Pagination | All list/search methods support `limit` + `offset` |
| Message context | `getMessageContext()` returns surrounding messages |
| Migration | Auto-creates tables; ALTER TABLE for schema upgrades |

### Tools (`src/tools/`)

| File | Tools | Category |
|------|-------|----------|
| `auth.ts` | `disconnect`, `authenticate` | Authentication |
| `status.ts` | `get_connection_status` | Status |
| `messaging.ts` | `send_message`, `list_messages`, `search_messages`, `get_poll_results` | Messaging |
| `chats.ts` | `list_chats`, `search_contacts`, `catch_up`, `mark_messages_read`, `export_chat_data` | Chats |
| `media.ts` | `download_media`, `send_file` | Media |
| `approvals.ts` | `request_approval`, `check_approvals` | Approvals |
| `groups.ts` | `create_group`, `get_group_info`, `get_joined_groups`, `get_group_invite_link`, `join_group`, `leave_group`, `update_group_participants`, `set_group_name`, `set_group_topic` | Groups |
| `reactions.ts` | `send_reaction`, `edit_message`, `delete_message`, `create_poll` | Message Actions |
| `contacts.ts` | `get_user_info`, `is_on_whatsapp`, `get_profile_picture` | Contacts |
| `wait.ts` | `wait_for_message` | Workflow |

Each tool includes:
- Zod input schema with `.describe()` for LLM understanding
- MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`)
- Permission checks (whitelist + rate limit)
- Audit logging
- Structured error responses with recovery hints

### Security (`src/security/`)

| Module | Role |
|--------|------|
| `audit.ts` | SQLite-backed audit log; logs tool name, action, metadata, success/failure |
| `crypto.ts` | AES-256-GCM field-level encryption using `node:crypto`. Encrypts/decrypts sensitive database fields. Key derived from `DATA_ENCRYPTION_KEY` passphrase via SHA-256. |
| `file-guard.ts` | Upload path confinement, sensitive file blocklist, dangerous extension blocking, magic bytes verification, filename sanitization, media directory quota enforcement |
| `permissions.ts` | Contact whitelist (`ALLOWED_CONTACTS`), rate limiting (`RATE_LIMIT_PER_MIN`), tool disabling (`DISABLED_TOOLS`), authentication throttling with exponential backoff |

### Utils (`src/utils/`)

| Module | Role |
|--------|------|
| `phone.ts` | E.164 validation, normalization, JID conversion (`+1234567890` → `1234567890@s.whatsapp.net`) |
| `fuzzy-match.ts` | Levenshtein distance + substring matching; `resolveRecipient()` returns best match or ambiguity candidates |

---

## Data Flow

### Authentication

```
MCP Client → authenticate(phoneNumber)
  → client.requestPairingCode(digits)
    → whatsmeow-node.pairCode()
      → WhatsApp servers → 8-digit code
  → User enters code in WhatsApp mobile
  → "connected" event → session persisted
  → (optional) welcome group created
```

If pairing code fails (400 error or rate limit), the server falls back to QR code authentication:
1. Generates a PNG image in-container using the `qrcode` npm package
2. Returns the QR code as an MCP `image` content block (displayed inline by supporting clients)
3. Also returns a `data:image/png;base64,...` data URI in the text response — the user can paste this into any browser's address bar to view the QR code, with zero host tool dependencies

### Sending a Message

```
MCP Client → send_message(to="John", message="Hello")
  → resolveRecipient("John", chats)     # fuzzy match
    → Levenshtein("John", "John Smith") → match
  → permissions.canSendTo(jid)           # whitelist check
  → permissions.checkRateLimit()         # rate limit
  → client.sendMessage(jid, text)        # whatsmeow-node ({ conversation: text })
  → audit.log("send_message", "sent")    # audit trail
  → response with message ID
```

### Receiving a Message

```
WhatsApp servers → whatsmeow-node → "message" event
  → client._persistMessage(evt)
    → store.addMessage(msg)              # SQLite insert
    → store.upsertChat(chatJid)          # update chat metadata
    → store.updateMediaInfo()            # if media present
  → client._checkApprovalResponse(msg)   # check for APPROVE/DENY
  → mcpServer.sendNotification()         # notify MCP client
```

### Media Download

```
MCP Client → download_media(message_id)
  → store.getMediaRawJson(messageId)     # stored proto message
  → client.downloadAny(rawMessage)       # whatsmeow-node → temp file
  → copyFile(temp, /data/sessions/media/) # permanent storage
  → store.updateMediaInfo(localPath)     # record file path
  → response with file path
```

### Full-Text Search

```
MCP Client → search_messages(query="deadline")
  → store.searchMessages({ query })
    → FTS5: messages_fts MATCH "deadline"
    → fallback: LIKE "%deadline%" if FTS fails
  → optional: getMessageContext() for each result
  → paginated response with hints
```

---

## Storage Schema

### Table: `chats`

| Column | Type | Description |
|--------|------|-------------|
| `jid` | TEXT PK | WhatsApp JID (e.g. `1234567890@s.whatsapp.net`) |
| `name` | TEXT | Display name (resolved async) |
| `is_group` | INTEGER | 1 for group chats |
| `unread_count` | INTEGER | Unread message count |
| `last_message_at` | INTEGER | Unix timestamp |
| `last_message_preview` | TEXT | First 100 chars of last message |
| `updated_at` | INTEGER | Last metadata update |

### Table: `messages`

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Message ID from WhatsApp |
| `chat_jid` | TEXT FK | Chat this message belongs to |
| `sender_jid` | TEXT | Sender's JID |
| `sender_name` | TEXT | Push name at time of send |
| `body` | TEXT | Message text |
| `timestamp` | INTEGER | Unix timestamp |
| `is_from_me` | INTEGER | 1 if sent by this account |
| `is_read` | INTEGER | 1 if marked read |
| `has_media` | INTEGER | 1 if message contains media |
| `media_type` | TEXT | image, video, audio, document, sticker |
| `media_mimetype` | TEXT | MIME type |
| `media_filename` | TEXT | Original filename |
| `media_local_path` | TEXT | Path to downloaded file |
| `media_raw_json` | TEXT | Serialized proto message for re-download |

### Table: `approvals`

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Approval ID |
| `to_jid` | TEXT | Recipient JID |
| `action` | TEXT | Action description |
| `details` | TEXT | Context details |
| `status` | TEXT | pending, approved, denied, expired |
| `response_text` | TEXT | Recipient's response |
| `created_at` | INTEGER | Creation timestamp (ms) |
| `timeout_ms` | INTEGER | Timeout duration |
| `responded_at` | INTEGER | Response timestamp (ms) |

### Virtual Table: `messages_fts`

FTS5 full-text search index on `messages.body`. Plaintext is inserted manually (not via triggers) to remain compatible with field-level encryption — the `messages.body` column stores the encrypted value while `messages_fts` stores the searchable plaintext.

---

## Testing Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Dockerfile Stages                          │
│                                                              │
│  ┌─────────────┐   ┌──────────────┐   ┌──────────────────┐  │
│  │  prod-deps  │   │   builder    │   │      test        │  │
│  │ --omit=dev  │   │  full install│──▶│ builder node_mods│  │
│  │ NEVER dev-  │   │  + tsc       │   │ src/ + test/     │  │
│  │ tool touched│   │              │   │ tester-container │  │
│  └──────┬──────┘   └──────┬───────┘   └──────┬───────────┘  │
│         │                 │                  │               │
│         │   node_modules  │ dist/            │               │
│         └────────┐        │                  │               │
│                  ▼        ▼                  │               │
│           ┌──────────────────┐               │               │
│           │    runtime       │               │               │
│           │ clean node_mods  │               │               │
│           │ no npm/npx       │               │               │
│           │ ~80 MB           │               │               │
│           └──────────────────┘               │               │
│                                              ▼               │
│                            ┌─────────────────────────┐       │
│                            │     Automated Tests     │       │
│                            └────────────┬────────────┘       │
│                                         │                    │
│               ┌─────────────────────────┼──────────────┐     │
│               │                         │              │     │
│      ┌────────▼──────┐  ┌───────────────▼──┐  ┌───────▼──┐  │
│      │    Unit       │  │  Integration     │  │   E2E    │  │
│      │  Pure logic   │  │  Mock WA         │  │  Live WA │  │
│      │  No network   │  │  In-memory       │  │ Read-only│  │
│      └───────────────┘  └──────────────────┘  └──────────┘  │
└──────────────────────────────────────────────────────────────┘
```

| Layer | Files | What's tested |
|-------|-------|---------------|
| **Unit** | `phone`, `fuzzy-match`, `crypto`, `file-guard`, `permissions`, `audit`, `store` | Pure functions, SQLite operations, encryption, path validation, rate limiting |
| **Integration** | `tools.test.ts` | Full MCP protocol via `createServer()` + in-memory transport + mock WhatsApp client |
| **E2E** | `live.test.ts` | Real WhatsApp session (read-only: connection, chats, search, contacts, catch-up) |

Key design: `createServer()` in `src/server.ts` is a factory function that accepts injected dependencies (waClient, store, audit, permissions). Integration tests inject a mock WhatsApp client and an in-memory SQLite store, exercising the full MCP tool chain without any network.

---

## Design Decisions

1. **Docker MCP Toolkit as the platform** — Containerization provides isolation, multi-client gateway, secrets management via OS Keychain, and clean lifecycle management. The MCP Toolkit's gateway handles tool discovery and fan-out to multiple clients (Cursor, Claude Code, VS Code) from a single server instance.

2. **Long-lived containers** — The server runs with `longLived: true`, keeping the WhatsApp WebSocket connection alive across tool calls rather than spawning a new container per invocation.

3. **whatsmeow-node** — Native WhatsApp protocol via a Go binary (~80 MB runtime image), with proper TLS and text-based pairing code authentication. QR code fallback generates a PNG image in-container and delivers it as both an MCP image block and a browser-pasteable data URI — no host tools required beyond a browser.

4. **Go binary via IPC** — whatsmeow-node runs the Go `whatsmeow` library as a subprocess with JSON-line IPC. This provides protocol correctness from the mature Go library while keeping the MCP layer in Node.js.

5. **SQLite with FTS5** — Single-file database with full-text search. No external database server needed. WAL mode for concurrent reads.

6. **Fuzzy name matching** — Levenshtein distance + substring matching allows MCP clients to use natural language ("John", "book club") instead of raw JIDs.

7. **MCP annotations** — Declaring `readOnlyHint`, `destructiveHint`, etc. helps LLMs choose the right tool without trial and error.

8. **Deferred media download** — Raw message JSON is stored on receipt; actual media files are only downloaded when `download_media` is called. This avoids filling storage with unwanted media.

9. **Async name resolution** — Chat/contact names are resolved in the background after message persistence, so the main flow is never blocked by slow WhatsApp API calls.

10. **Field-level encryption** — AES-256-GCM encrypts sensitive fields at write time and decrypts on read. FTS5 receives plaintext for search while the source table stores ciphertext. Uses `node:crypto` — zero additional dependencies.

11. **Auto-purge for data minimization** — Messages, media, and approvals are automatically deleted after a configurable retention period, reducing the window of data exposure if volumes are left behind.

12. **Four-stage Dockerfile for minimal CVE surface** — A dedicated `prod-deps` stage runs `npm install --omit=dev` and is never touched by dev tools. The `builder` stage does a full install and compiles TypeScript. The runtime image copies `node_modules` from `prod-deps` and `dist/` from `builder`, and explicitly removes npm/npx. This eliminates dev-transitive packages (tar, glob, minimatch, etc.) that bleed in when TypeScript or test tooling is installed in the same stage as the production deps. Node.js was upgraded from 20 → 22 Alpine (LTS) to ship a newer Yarn bundle, reducing HIGH CVEs from 19 to 8.

13. **SLSA max-mode provenance** — Both build targets embed signed SLSA provenance attestations via BuildKit (`provenance: "mode=max"` in `docker-compose.yml`). This records base image digests, build arguments, Git commit SHA, and builder identity as a signed OCI manifest alongside the image — not inside the image layers, so there is no size or runtime overhead. Attestations enable Docker Scout to give exact base-image upgrade recommendations and allow image consumers to cryptographically verify supply-chain integrity.

---

## Edge Cases and Special Scenarios

### Session Expiry and Re-authentication

**Session Lifecycle:**
- WhatsApp sessions expire after ~20 days of inactivity
- Sessions also expire if user unlinks device from WhatsApp mobile app
- Permanent logout reasons: `revoked`, `replaced`, `banned`, `unlinked`, `device_removed`, `logged_out`

**Detection:**
```javascript
// Server detects via logged_out event
client.on('logged_out', ({ reason }) => {
  const permanent = PERMANENT_LOGOUT_REASONS.includes(reason);
  if (permanent) {
    _cleanupSession(); // Remove session.db
    onDisconnected({ reason, permanent: true });
  }
});
```

**Re-authentication Flow:**
1. User calls `get_connection_status` → shows `connected: false`, `logoutReason: "session_expired"`
2. User calls `authenticate` with phone number (same or different number)
3. New pairing code generated → session created fresh
4. Old session.db already cleaned up during logout

**Important:** User does NOT need to use the same phone number for re-authentication. Any WhatsApp account can link.

---

### Media File Handling

**Media Metadata Storage:**
- On message receipt: `media_raw_json` stored (encrypted), no file downloaded
- On `download_media` call: File downloaded to `/data/sessions/media/{type}/{messageId}.{ext}`
- If download fails: `media_raw_json` remains for retry, no local file created

**File Naming:**
```
/data/sessions/media/
├── image/
│   └── msg-ABC123.jpg
├── video/
│   └── msg-DEF456.mp4
├── audio/
│   └── msg-GHI789.ogg
└── document/
    └── msg-JKL012.pdf
```

**Collision Handling:**
- Message IDs are globally unique (WhatsApp-assigned)
- No collision possible unless message ID spoofed (extremely unlikely)
- Sanitized filenames: `sanitizeFilename(messageId)` removes `..`, control chars

**Media Expiry:**
- WhatsApp servers store media temporarily (~30 days)
- After expiry: `download_media` fails with "Media download failed"
- Recovery: Request sender to resend message

**Quota Enforcement:**
- Default: 512 MB total for `/data/sessions/media/`
- Checked before each download
- If exceeded: Error returned, user must delete old media

---

### Welcome Group Behavior

**Creation Logic:**
```javascript
async _ensureWelcomeGroup() {
  const groupName = process.env.WELCOME_GROUP_NAME || 'WhatsAppMCP';
  
  // Check if group already exists
  const existing = store.getAllChatsForMatching()
    .find(c => c.name === groupName && c.jid?.endsWith('@g.us'));
  
  if (existing) {
    return; // Group exists, skip creation
  }
  
  // Create new group
  const group = await client.createGroup(groupName, []);
  // Send welcome message
  await client.sendMessage(group.jid, `Hello from ${groupName} Server!`);
}
```

**When Created:**
- Only on **first successful connection** after fresh auth
- NOT created on every reconnect
- NOT created if group with same name already exists in chat list

**Failure Scenarios:**
- Group creation fails silently (logged to stderr)
- No error returned to user
- Welcome message send failure also logged silently

**Disabling:**
```bash
docker mcp profile config <profile> \
  --set whatsapp-mcp-docker.welcome_group_name=""
```

**Manual Creation:**
If welcome group creation fails, user can manually create WhatsApp group and server will detect it on next connection (by name match).

---

### Database Migration Strategy

**Current Approach:**
- Schema created on first startup with `IF NOT EXISTS`
- ALTER TABLE for schema additions (backward compatible)
- No version tracking table yet

**Schema Evolution:**
```sql
-- Initial schema
CREATE TABLE IF NOT EXISTS messages (...);

-- Schema addition (example)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS new_column TEXT;
```

**Migration Failure Recovery:**
- If ALTER fails: Server continues with existing schema
- Tool that requires new column: Graceful degradation (column optional)
- Manual intervention: Delete database, re-authenticate (data loss)

**Future Enhancement:**
Add schema version tracking:
```sql
CREATE TABLE schema_versions (version INTEGER PRIMARY KEY, applied_at INTEGER);
```

---

### Error Recovery Matrix

| Error | Auto-Recover? | User Action | Time to Recover |
|-------|---------------|-------------|-----------------|
| `session_expired` | No | Call `authenticate` | 2-5 minutes |
| `connection_lost` | Yes (5 retries) | Wait or restart container | 5-30 seconds |
| `media_expired` | No | Request resend from sender | N/A |
| `rate_limited` | Yes (wait 1 min) | Wait for reset | 60 seconds |
| `database_locked` | Yes (retry) | Automatic | < 1 second |
| `health_check_failed` | Yes (reconnect) | Automatic or restart | 5-60 seconds |
| `pairing_failed` | No | Retry with QR fallback | Immediate |

---

### Concurrent Access Patterns

**SQLite WAL Mode:**
- Enables multiple concurrent readers
- Single writer at a time
- Write locks are brief (< 10ms typically)

**Race Condition Handling:**
- Message inserts: Atomic, no conflicts
- Chat updates: Last-write-wins (acceptable for name/preview)
- Approval respond: Idempotent (second respond ignored)
- Mark read: Idempotent (can mark same message read multiple times)

**Tested Scenarios:**
- 500 concurrent operations (mix of reads/writes)
- No data corruption observed
- No deadlocks (SQLite handles automatically)

Concurrency behavior is covered by the integration tests in `test/integration/tools.test.ts`.

---

## MCP Notifications

The server sends **async notifications** to MCP clients for real-time events:

### `notifications/message_received`

Sent when a new WhatsApp message arrives (excluding messages sent by the bot itself).

**Payload:**
```json
{
  "method": "notifications/message_received",
  "params": {
    "messageId": "msg_12345_abc",
    "from": "15145551234@s.whatsapp.net",
    "senderName": "John Doe",
    "timestamp": 1711900000
  }
}
```

> **Note:** `from` is the **chat JID** — for group chats this will be a `@g.us` JID; for direct messages it will be the contact's `@s.whatsapp.net` JID. Use `senderName` to identify the individual sender.

**Use Cases:**
- Notify AI assistants of new messages for proactive responses
- Trigger automated workflows based on incoming messages
- Real-time chat monitoring

### `notifications/disconnected`

Sent when the WhatsApp connection is lost (temporary or permanent).

**Payload:**
```json
{
  "method": "notifications/disconnected",
  "params": {
    "reason": "connection_lost",
    "permanent": false,
    "message": "WhatsApp temporarily disconnected (connection_lost). Reconnection was attempted but failed."
  }
}
```

**Reason Values:**
- `connection_lost` - Network issue, may reconnect
- `logged_out` - Session expired, requires re-authentication
- `banned` - Account banned, cannot reconnect
- `replaced` - Another device took over session

**Permanent vs Temporary:**
- `permanent: true` - Call `authenticate` tool to re-link
- `permanent: false` - Wait for automatic reconnection

### Notification Flow

```
WhatsApp Server → whatsmeow-node → "message" event
  → WhatsAppClient._persistMessage()
  → MessageStore.addMessage()
  → MCP Server.sendNotification()
  → All connected MCP clients receive notification
```

**Implementation:**
- See `src/index.ts` for message and disconnect notification wiring
- Notifications are **best-effort** (failures logged but don't break flow)

---

### Performance Characteristics

**Benchmarks (in-memory SQLite):**
- Message insert: < 1ms per message
- FTS search: < 50ms for 1000 messages
- List chats: < 10ms for 100 chats
- Get message context: < 2ms

**Disk-based SQLite (typical):**
- Add ~2-5ms for disk I/O
- WAL mode minimizes write contention
- Performance degrades gracefully with size

**Scaling Recommendations:**
- Up to 10,000 messages: No issues expected
- 10,000-100,000 messages: Consider `MESSAGE_RETENTION_DAYS=30`
- 100,000+ messages: Archive old data, use search with date ranges

**Memory Usage:**
- Base: ~50 MB (Node.js + Go binary)
- SQLite cache: ~10 MB typical
- WhatsApp connection: ~20 MB
- Total: ~80-100 MB typical

See `test/benchmarks/performance.test.ts` for benchmark suite.

---

**AI Authors:** Qwen3-Coder-Next • MiniMax-M2.7 • Qwen3.5 • Nemotron-3-Super  
**Director:** Benjamin Alloul — [Benjamin.Alloul@gmail.com](mailto:Benjamin.Alloul@gmail.com)
