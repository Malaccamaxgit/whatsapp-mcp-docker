---
layout: default
title: Developer Handbook
parent: Guides
nav_order: 2
description: "Build, test, deploy, and extend WhatsApp MCP Server. Docker-only development workflow."
---

# Developer Handbook — WhatsApp MCP Server

> **Purpose** — Build, test, deploy, and extend **WhatsApp MCP Server**.

## ⚠️ CRITICAL: Docker-Only Development

**This project uses Linux-only dependencies (`@whatsmeow-node/linux-x64-musl`). Running `npm install`, `npm test`, or lint/format commands on Windows/macOS host will fail.**

**ALWAYS use the Docker test container for all development tasks:**

```bash
# Build the test image first (uses the `test` profile)
docker compose --profile test build tester-container

# Run all tests (uses default CMD: node --test ...)
docker compose --profile test run --rm tester-container

# Run a specific test file
docker compose --profile test run --rm tester-container node --test test/unit/crypto.test.js

# Lint (inside the test container)
docker compose --profile test run --rm tester-container npx eslint src/

# Format check (inside the test container)
docker compose --profile test run --rm tester-container npx prettier --check src/
```

**Never run these on host:**
- ❌ `npm test` — Intentionally blocked (Linux-only binary; exits 1 with a hint)
- ❌ `npm run lint` — Intentionally blocked (exits 1 with a hint)
- ❌ `npm run format` — Intentionally blocked (exits 1 with a hint)
- ❌ `npm install` — Will install wrong platform binaries

**OK to run on host:**
- ✅ `docker compose` commands
- ✅ `node scripts/*.js` (diagnostic scripts)
- ✅ `git` operations
- ✅ File editing

**Project facts**

| Item | Value |
|------|-------|
| Platform | Docker MCP Toolkit |
| Runtime | Node.js 18+ (Node 20 Alpine in Docker) |
| WhatsApp library | whatsmeow-node (Go binary via JSON-line IPC) |
| MCP SDK | @modelcontextprotocol/sdk |
| Database | SQLite (better-sqlite3) with FTS5 |
| Container | Docker multi-stage (~150 MB) |
| Tools | 32 MCP tools |

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Development Environment](#development-environment)
3. [Build Process](#build-process)
4. [Testing](#testing)
5. [Docker Operations](#docker-operations)
6. [Code Organization](#code-organization)
7. [Adding a New Tool](#adding-a-new-tool)
8. [WhatsApp Client API](#whatsapp-client-api)
9. [Store API](#store-api)
10. [Troubleshooting](#troubleshooting)

---

## Quick Start

> **PowerShell Users:** On Windows PowerShell, use backtick (`` ` ``) instead of backslash (`\`) for line continuation. Example:
> ```powershell
> docker mcp catalog create my-custom-mcp-servers `
>   --title "My Custom MCP Servers" `
>   --server file://./whatsapp-mcp-docker-server.yaml
> ```

```bash
# Clone the repository
git clone https://github.com/Malaccamaxgit/whatsapp-mcp-docker.git
cd whatsapp-mcp-docker

# Build Docker image
docker compose build

# Create a custom catalog (appears in Docker Desktop → MCP Toolkit → Catalog)
docker mcp catalog create my-custom-mcp-servers \
  --title "My Custom MCP Servers" \
  --server file://./whatsapp-mcp-docker-server.yaml

# Add to a profile (or add from the Catalog UI in Docker Desktop)
docker mcp profile server add <your-profile> \
  --server file://./whatsapp-mcp-docker-server.yaml

# Apply default configuration (populates the UI fields)
docker mcp profile config <your-profile> \
  --set whatsapp-mcp-docker.rate_limit_per_min=60 \
  --set whatsapp-mcp-docker.message_retention_days=90 \
  --set whatsapp-mcp-docker.send_read_receipts=true \
  --set whatsapp-mcp-docker.auto_read_receipts=true \
  --set whatsapp-mcp-docker.presence_mode=available \
  --set whatsapp-mcp-docker.welcome_group_name=WhatsAppMCP \
  --set whatsapp-mcp-docker.auth_wait_for_link=false \
  --set whatsapp-mcp-docker.auth_link_timeout_sec=120 \
  --set whatsapp-mcp-docker.auth_poll_interval_sec=5

# Connect your MCP client
docker mcp client connect cursor --profile <your-profile>
```

---

## Development Environment

### Required Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Docker Desktop | Container build/run | **Required.** Must have [MCP Toolkit](https://docs.docker.com/ai/mcp-catalog-and-toolkit/) enabled |
| Git | Version control | — |
| Node.js 20+ | Local development only | Not needed if you only build/run via Docker |
| npm | Package manager | Comes with Node.js |

> **Note:** For Docker use, only Docker Desktop with MCP Toolkit is needed. Node.js is only required for local development outside Docker.

### Dependencies

| Package | Purpose |
|---------|---------|
| `@whatsmeow-node/whatsmeow-node` | WhatsApp protocol (Go binary wrapper) |
| `@whatsmeow-node/linux-x64-musl` | Go binary for Alpine Linux |
| `@modelcontextprotocol/sdk` | MCP server SDK |
| `zod` | Schema validation for tool inputs |
| `better-sqlite3` | SQLite database with native bindings |
| `qrcode` | In-container QR code PNG generation for auth fallback |

### npm Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `start` | `node src/index.js` | Server start |
| `dev` | `node --watch src/index.js` | Development with auto-reload |
| docker:test | docker compose --profile test build tester-container && docker compose --profile test run --rm tester-container | Unit + integration tests in Docker |
| docker:test:auth | docker compose --profile test run --rm tester-container node test/e2e/setup-auth.js | One-time WhatsApp auth for e2e |
| docker:test:e2e | docker compose --profile test run --rm tester-container node --test test/e2e/live.test.js | E2E tests with live session |

---

## Build Process

### Local Development

```bash
# Install dependencies
npm install

# Run with auto-reload on file changes
npm run dev
```

The server uses stdio transport (stdin/stdout for MCP, stderr for logging). For local testing, you can pipe MCP JSON-RPC messages to stdin.

### Docker Build

```bash
# Build image (uses multi-stage Dockerfile)
docker compose build

# Build without cache (after Dockerfile changes)
docker compose build --no-cache

# Start container
docker compose up -d
```

### Dockerfile Stages

The Dockerfile uses a multi-stage build with three stages:

| Stage | Base | Purpose |
|-------|------|---------|
| `builder` | `node:20-alpine` | Installs build tools (python3, make, g++) for `better-sqlite3` native addon compilation |
| `test` | `node:20-alpine` | Copies `node_modules`, `src/`, and `test/` from builder. Used by `tester-container` for automated tests. |
| Runtime | `node:20-alpine` | Copies only `node_modules` and `src/` from builder. No build tools in final image |

### Docker Compose Configuration

Key settings in `docker-compose.yml`:

| Setting | Value | Purpose |
|---------|-------|---------|
| `read_only: true` | — | Read-only root filesystem |
| `tmpfs: /tmp` | 100 MB | RAM-backed scratch space for media operations |
| `cap_drop: ALL` | — | Drop all Linux capabilities |
| `user: "1001:1001"` | — | Non-root container user |
| `restart: unless-stopped` | — | Auto-restart on failure |
| Volumes | `whatsapp-sessions`, `whatsapp-audit` | Persistent data |

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `STORE_PATH` | Session + message database directory | `/data/sessions` |
| `AUDIT_DB_PATH` | Audit log database path | `/data/audit/audit.db` |
| `RATE_LIMIT_PER_MIN` | Max outbound messages per minute | `60` |
| `DOWNLOAD_RATE_LIMIT_PER_MIN` | Max media downloads per minute | `30` |
| `DATA_ENCRYPTION_KEY` | Passphrase for AES-256-GCM field encryption | *(via `docker mcp secret set`)* |
| `MESSAGE_RETENTION_DAYS` | Auto-delete data older than N days (0 = keep forever) | `90` |
| `ALLOWED_CONTACTS` | Comma-separated E.164 phone whitelist (empty = all) | `""` |
| `DISABLED_TOOLS` | Comma-separated tool names to disable | `""` |
| `WELCOME_GROUP_NAME` | WhatsApp group created on first connection (empty = disable) | `WhatsAppMCP` |
| `AUTH_WAIT_FOR_LINK` | Default `authenticate` wait-for-link behavior | `false` |
| `AUTH_LINK_TIMEOUT_SEC` | Default max wait seconds (15–600) | `120` |
| `AUTH_POLL_INTERVAL_SEC` | Default poll interval seconds (2–60) | `5` |

#### Encryption (`DATA_ENCRYPTION_KEY`)

Stored in Docker's credential store via `docker mcp secret set whatsapp-mcp-docker.data_encryption_key` (preferred), or in `.env` for docker-compose workflows (never committed to git). Generate a strong passphrase:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

When set, the server encrypts sensitive database fields using AES-256-GCM (`node:crypto`). The passphrase is run through scrypt (a memory-hard KDF) to derive a 32-byte key — this makes brute-forcing the passphrase expensive. Encrypted values are prefixed with `enc:` — plaintext data written before encryption was enabled remains readable without migration.

Encrypted fields: `messages.body`, `messages.sender_name`, `messages.media_raw_json`, `chats.last_message_preview`, `approvals.action`, `approvals.details`, `approvals.response_text`.

FTS5 search continues to work because plaintext is inserted into the `messages_fts` index manually, while the `messages` table stores the encrypted value.

> **Important:** Change the default passphrase before deploying. If the key is lost, encrypted data cannot be recovered.

#### Auto-Purge (`MESSAGE_RETENTION_DAYS`)

When set to a positive number, the server runs `purgeOldData()` on startup and then hourly. It deletes:
- Messages older than the retention period
- Media files on disk for deleted messages
- Expired approvals older than the retention period

Set to `0` to disable auto-purge entirely.

---

## Testing

The project uses `node:test` (built into Node.js 20+) with three test layers. Tests run inside Docker via `tester-container` — no local build tools needed.

### Running Tests

All tests run inside a Docker container that has the compiled native dependencies. No local Node.js or build tools required.

```bash
# Build the test container (first time, or after code changes)
docker compose --profile test build tester-container

# Run unit + integration tests
docker compose --profile test run --rm tester-container

# Or use the shorthand npm script
# (Note: npm run docker:test from the host calls the above with --profile test)
```

### Layer 1: Unit Tests

Pure function and module tests. No network, no WhatsApp.

```bash
docker compose --profile test run --rm tester-container node --test test/unit/*.test.js
```

Tests: `phone.js`, `fuzzy-match.js`, `crypto.js`, `file-guard.js`, `permissions.js`, `audit.js`, `store.js`.

### Layer 2: Integration Tests

MCP protocol-level tests. Uses a mock WhatsApp client connected to the real MCP server via in-memory transport. Tests input validation, permission checks, fuzzy matching, and response formatting.

```bash
docker compose --profile test run --rm tester-container node --test test/integration/*.test.js
```

### Layer 3: E2E Tests

Tests against a real WhatsApp session. Authenticate once; the session persists in `.test-data/` on your host filesystem (bind-mounted into the container).

```bash
# One-time setup — authenticate and save session to .test-data/
docker compose --profile test run --rm tester-container node test/e2e/setup-auth.js

# Run live tests (read-only, no messages sent)
docker compose --profile test run --rm tester-container node --test test/e2e/live.test.js
```

Re-authenticate after ~20 days (WhatsApp session expiry).

### Session Lifecycle and Resilience

The `WhatsAppClient` in `src/whatsapp/client.js` includes a full resilience layer:

- **Startup retry**: `_connectWithRetry()` retries the initial WebSocket connection up to 5 times with exponential backoff (2s, 4s, 8s, 16s, 30s).
- **Session expiry detection**: The `logged_out` event handler classifies the reason as permanent (revoked, banned, unlinked) or transient (connection lost, timeout). Permanent logouts delete `session.db` and notify the MCP client. Transient disconnects trigger a single reconnection attempt.
- **Health heartbeat**: A 60-second interval checks the connection is alive. Silent drops are detected and trigger reconnection.
- **Operation retry**: `sendMessage`, `downloadMedia`, and `uploadMedia` are wrapped in `_withRetry()` which retries once on transient errors (timeout, socket reset, network errors).
- **Error classification**: `classifyError()` categorizes errors as `transient`, `permanent`, `client_error`, or `unknown` to determine retry behavior and user-facing messages.
- **MCP notification**: `onDisconnected` callback pushes `notifications/disconnected` to the MCP client with the reason and whether re-authentication is needed.

### Read Receipts and Presence

The client manages WhatsApp presence and read receipts:

- **Delivery receipts**: `setForceActiveDeliveryReceipts(true)` enables grey double checkmarks for all incoming messages.
- **Online presence**: `sendPresence('available')` on connect, `sendPresence('unavailable')` on disconnect. Configurable via `PRESENCE_MODE`.
- **Read receipts**: `markMessagesRead()` calls `client.markRead()` to send blue checkmarks to WhatsApp, in addition to updating the local store. Controlled by `SEND_READ_RECEIPTS`.
- **Auto-read**: When `AUTO_READ_RECEIPTS=true` (default), incoming messages are automatically marked as read. Senders see blue checkmarks immediately.

### Testing Resilience

Resilience behavior is covered by integration tests:

Integration tests in `test/integration/tools.test.js` cover:
- `get_connection_status` with logout reason after simulated disconnect
- `mark_messages_read` routing through `waClient.markMessagesRead()`
- `send_message` error when disconnected

### Test Container Architecture

The `tester-container` service uses a `test` stage in the Dockerfile:
- Same compiled `node_modules` as the production image (builder stage)
- Includes `test/` files (excluded from the production runtime stage)
- `.test-data/` bind-mounted from the host for persistent WhatsApp sessions
- Uses Docker Compose profiles — only starts when explicitly invoked
- `docker compose up` still only starts the production server

### Manual Testing with MCP Client

1. Build the image: `docker compose build`
2. Create a custom catalog (first time only): `docker mcp catalog create my-custom-mcp-servers --title "My Custom MCP Servers" --server file://./whatsapp-mcp-docker-server.yaml`
3. Add to a profile: `docker mcp profile server add <profile> --server file://./whatsapp-mcp-docker-server.yaml` (or add from Docker Desktop → MCP Toolkit → Catalog)
4. Apply defaults (include `auth_wait_for_link`, `auth_link_timeout_sec`, `auth_poll_interval_sec` — see README Quick Start)
5. Connect an MCP client: `docker mcp client connect cursor --profile <profile>`
6. Test tools via natural language prompts

---

## Docker Operations

### Rebuild After Code Changes

```bash
docker compose up -d --build
```

### View Logs

```bash
# Follow logs
docker compose logs -f whatsapp-mcp-docker

# Last 50 lines
docker compose logs --tail 50 whatsapp-mcp-docker
```

### Reset Data

```bash
# Stop and remove containers + volumes (deletes all data including session)
docker compose down -v

# Rebuild and start fresh
docker compose up -d --build
```

### Update MCP Toolkit Registration

```bash
# Update the custom catalog (replaces existing entry)
docker mcp catalog create my-custom-mcp-servers \
  --title "My Custom MCP Servers" \
  --server file://./whatsapp-mcp-docker-server.yaml

# Update the profile registration
docker mcp profile server remove <profile> whatsapp-mcp-docker
docker mcp profile server add <profile> --server file://./whatsapp-mcp-docker-server.yaml

# Re-apply profile config if new keys were added (see README Quick Start for full --set list)
```

---

## Code Organization

### Source Tree

```
src/
├── index.js              # Entry point, stdio transport, lifecycle
├── server.js             # Server factory (createServer) for tools + security wiring
├── whatsapp/
│   ├── client.js         # whatsmeow-node wrapper, events, media
│   └── store.js          # SQLite persistence, FTS5, encryption, auto-purge
├── tools/
│   ├── auth.js           # authenticate (with auth rate limiting)
│   ├── status.js         # get_connection_status
│   ├── messaging.js      # send_message, list_messages, search_messages
│   ├── chats.js          # list_chats, search_contacts, catch_up, mark_messages_read
│   ├── media.js          # download_media, send_file (with file security)
│   └── approvals.js      # request_approval, check_approvals
├── security/
│   ├── audit.js          # SQLite audit log
│   ├── crypto.js         # AES-256-GCM field-level encryption
│   ├── file-guard.js     # Path confinement, extension/magic checks, quota
│   └── permissions.js    # Whitelist, rate limit, tool disable, auth throttle
└── utils/
    ├── fuzzy-match.js    # Levenshtein + substring matching
    └── phone.js          # E.164 validation, JID conversion
```

### Key Patterns

- **ES modules** throughout (`import`/`export`)
- **stderr for logging** (stdout reserved for MCP stdio transport)
- **Zod schemas** for all tool input validation
- **Prepared statements** for all SQL queries (injection-safe)
- **Graceful shutdown** on SIGINT/SIGTERM

---

## Adding a New Tool

### Step 1: Create or extend a tool file

```javascript
// src/tools/example.js
import { z } from 'zod';

export function registerExampleTools(server, waClient, store, permissions, audit) {
  server.tool(
    'my_tool',
    'Clear description of what this tool does and when to use it.',
    {
      param: z.string().describe('What this parameter is for')
    },
    async ({ param }) => {
      const rateCheck = permissions.checkRateLimit();
      if (!rateCheck.allowed) {
        return { content: [{ type: 'text', text: rateCheck.error }], isError: true };
      }

      const result = /* ... */;

      audit.log('my_tool', 'action', { param });

      return {
        content: [{ type: 'text', text: `Result: ${result}` }]
      };
    },
    {
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    }
  );
}
```

### Step 2: Wire in server.js

```javascript
import { registerExampleTools } from './tools/example.js';
// ...
registerExampleTools(mcpServer, waClient, store, permissions, audit);
```

### Step 3: Add to whatsapp-mcp-docker-server.yaml

```yaml
  - name: my_tool
    description: "Clear description"
    arguments:
      - name: param
        type: string
        desc: "What this parameter is for"
```

### Step 4: Update README.md tool table

---

## WhatsApp Client API

### Key Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `initialize()` | `void` | Creates client, registers events, connects WebSocket |
| `isConnected()` | `boolean` | Current connection state |
| `requestPairingCode(phone)` | `{ code, waitForConnection }` | Initiates pairing; on failure falls back to QR code (PNG image + data URI) |
| `generateQrImage(data)` | `string` (base64) | Generates QR code as base64-encoded PNG using `qrcode` library |
| `sendMessage(jid, text)` | `{ id, timestamp }` | Send text message (uses `{ conversation: text }` format) |
| `downloadMedia(messageId)` | `{ path, mediaType, chatJid }` | Download media to storage |
| `uploadAndSendMedia(jid, path, type, caption)` | `{ id, timestamp, mediaType }` | Upload and send media |
| `resolveGroupName(jid)` | `string \| null` | Get group name from WhatsApp |
| `resolveContactName(jid)` | `string \| null` | Get contact name from WhatsApp |

### Events Handled

| Event | Action |
|-------|--------|
| `connected` | Sets `_connected = true`, resolves pending pair, optionally creates welcome group |
| `logged_out` | Sets `_connected = false`, clears JID |
| `message` | Persists to store, checks approvals, notifies MCP |
| `history_sync` | Batch-persists conversation history and chat names |

---

## Store API

### Chat Methods

| Method | Description |
|--------|-------------|
| `upsertChat(jid, name, isGroup, lastMessageAt, preview)` | Create or update chat |
| `listChats({ filter, groupsOnly, limit, offset })` | Paginated chat list |
| `getChatByJid(jid)` | Single chat lookup |
| `getAllChatsForMatching()` | All chats for fuzzy matching |
| `getContactChats(jid, limit, offset)` | All chats involving a contact |
| `getLastInteraction(jid)` | Most recent message involving a JID |
| `updateChatName(jid, name)` | Update chat display name (only if null) |
| `incrementUnread(chatJid)` | Increment unread count |
| `clearUnread(chatJid)` | Reset unread count to 0 |

### Message Methods

| Method | Description |
|--------|-------------|
| `addMessage(msg)` | Insert message + update chat + FTS index |
| `listMessages({ chatJid, limit, offset, before, after })` | Paginated message list |
| `searchMessages({ query, chatJid, limit, offset })` | FTS5 search with LIKE fallback |
| `getMessageContext(messageId, before, after)` | Surrounding messages |
| `getUnreadMessages(limit)` | Unread messages in chronological order |
| `markRead({ chatJid, messageIds })` | Mark as read |
| `getCatchUpData(sinceTimestamp)` | Active chats, unread, questions, pending approvals |

### Media Methods

| Method | Description |
|--------|-------------|
| `updateMediaInfo(messageId, { mimetype, filename, localPath, rawJson })` | Update media metadata |
| `getMediaMessages(chatJid, limit, offset)` | List media messages (all chats if null) |

### Approval Methods

| Method | Description |
|--------|-------------|
| `createApproval({ toJid, action, details, timeoutMs })` | Create pending approval |
| `respondToApproval(id, approved, responseText)` | Record response |
| `getApproval(id)` | Get single approval |
| `getPendingApprovals()` | List pending approvals (expires timed-out) |

### Lifecycle Methods

| Method | Description |
|--------|-------------|
| `getStats()` | Returns chatCount, messageCount, unreadCount, pendingApprovals, lastSync |
| `purgeOldData(retentionDays)` | Delete messages, media, approvals older than N days |
| `startAutoPurge(retentionDays, intervalMs)` | Runs purge immediately then on interval |
| `close()` | Stop purge timer and close database |

---

## Troubleshooting

| Problem | What to check |
|---------|---------------|
| Container crashes on start | `docker compose logs whatsapp-mcp-docker` — look for binary resolution or dependency errors |
| "WhatsApp not connected" | Session may have expired; run `authenticate` again |
| Authentication 429 error | Rate limited by WhatsApp; wait 10-15 minutes |
| Authentication 400 error | Pairing code failed; server falls back to QR code — returned as an image in the tool response plus a `data:image/png;base64,...` URI (paste into browser) |
| FTS5 search returns nothing | Messages may lack text body; check `messages` table |
| Fuzzy match wrong contact | Use JID directly to bypass fuzzy matching |
| Media download fails | Check that `media_raw_json` is stored for the message |
| Container rebuilds slowly | Use `docker compose up -d --build` (incremental) instead of `--no-cache` |
| Session lost after restart | Verify `whatsapp-sessions` volume exists: `docker volume ls` |

---

## Contact

- **Email:** [benjamin.alloul@gmail.com](mailto:benjamin.alloul@gmail.com)
- **Issues:** [GitHub Issues](https://github.com/Malaccamaxgit/whatsapp-mcp-docker/issues)
