# WhatsApp MCP Server

> **WhatsApp integration for AI agents** — Send messages, search chats, share media, approval workflows, and intelligent activity summaries via any MCP client. Designed to run as a containerized MCP server through [Docker MCP Toolkit](https://docs.docker.com/ai/mcp-catalog-and-toolkit/).

> **Acknowledgment:** The author is well aware of [kapso.ai](https://kapso.ai), which provides a more robust and feature-complete WhatsApp integration solution. This project is what happens when a hobbyist coder with too much curiosity, decent system design instincts, and modern AI assistance decides to see how far they can push their weekend project. It's a learning exercise in MCP servers, containerization, and WhatsApp protocol integration — the kind of thing that would have been unreasonable to attempt alone a few years ago, but is now very much within reach thanks to better tooling and a lot of help from AI.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Runtime: Node.js](https://img.shields.io/badge/Runtime-Node.js%2020-green.svg)](https://nodejs.org/)
[![Protocol: MCP](https://img.shields.io/badge/Protocol-Model%20Context%20Protocol-purple.svg)](https://modelcontextprotocol.io/)
[![Platform: Docker](https://img.shields.io/badge/Platform-Docker%20MCP%20Toolkit-blue.svg)](https://docs.docker.com/ai/mcp-catalog-and-toolkit/)

> **Note:** This project requires [Docker Desktop](https://www.docker.com/products/docker-desktop/) with [MCP Toolkit](https://docs.docker.com/ai/mcp-catalog-and-toolkit/) enabled. Alternatively, you can run it with Docker Engine + Docker Compose (without the MCP Gateway features).

---

## Why Docker MCP Toolkit?

This server runs inside a Docker container managed by [Docker MCP Toolkit](https://docs.docker.com/ai/mcp-catalog-and-toolkit/), rather than directly on your host machine.

| Benefit | Docker MCP Toolkit | Running on Host |
|---------|-------------------|-----------------|
| **Isolation** | WhatsApp session keys, messages, and media are confined to Docker volumes — not mixed with your regular files | Session data ends up somewhere in your home directory |
| **Security boundary** | Non-root, read-only filesystem, capabilities dropped | Runs with your full user permissions |
| **Multi-client gateway** | One server instance serves all your MCP clients (Cursor, Claude Code, VS Code) simultaneously through the MCP Gateway | Each client needs its own server configuration |
| **Secrets management** | Encryption keys stored in OS Keychain via `docker mcp secret set`, configurable from Docker Desktop UI | Must manage `.env` files manually |
| **Host dependencies** | No Node.js, native compilation, or Go binary management required on your machine | Must install Node.js 18+, build tools for native addons, and manage platform-specific binaries |
| **Portability** | Works on Windows, macOS, and Linux (in theory — tested primarily on Windows) | Platform-specific issues with native dependencies |
| **Lifecycle management** | Health checks, auto-restart, graceful shutdown — all handled by Docker | Manual process management |
| **Clean teardown** | `docker compose down -v` removes everything | Must manually find and clean up data files, sessions, and processes |

---

## Features

- **32 MCP Tools** — Full WhatsApp control: messaging, media, search, contacts, groups, message actions, approvals, status, live interaction, and session management
- **Fuzzy Name Matching** — Say "John" or "book club" and the server finds the right chat via Levenshtein distance
- **Media Support** — Download received media and send images, videos, audio, and documents
- **Full-Text Search** — SQLite FTS5 indexes all messages with keyword, phrase, and boolean operators
- **Intelligent Catch-Up** — One tool that summarizes active chats, pending questions, and unread highlights
- **Approval Workflows** — Send approval requests via WhatsApp; recipients reply APPROVE or DENY
- **Pairing Code Auth** — Text-based 8-digit code authentication with QR code image fallback (rendered in-container, viewable in any browser via data URI)
- **Encryption at Rest** — AES-256-GCM field-level encryption for message bodies, sender names, and media metadata
- **Auto-Purge** — Automatic deletion of messages and media older than a configurable retention period
- **Read Receipts & Presence** — Delivery receipts (double checkmarks), read receipts (blue checkmarks), and online presence — all configurable
- **Session Resilience** — Automatic reconnection on transient disconnects, startup retry with exponential backoff, 60-second health heartbeat, and MCP notifications on session expiry
- **Session Persistence** — WhatsApp session survives container restarts via Docker named volumes
- **Long-Lived Containers** — The server keeps the WhatsApp WebSocket connection alive across tool calls
- **Welcome Group** — Optionally creates a WhatsApp group and sends a hello message on first connection

---

## Quick Start

### 🚀 Minimal Viable Setup (5 Minutes)

**Want to try it fast?** Here's the absolute minimum to get started:

> **PowerShell Users:** Replace `\` (backslash) with `` ` `` (backtick) for line continuation in the commands below.
>
> Example:
> ```powershell
> docker mcp catalog create my-mcp --title "My MCP Servers" `
>   --server file://./whatsapp-mcp-docker-server.yaml
> ```

```bash
# 1. Clone and build
git clone https://github.com/Malaccamaxgit/whatsapp-mcp-docker.git
cd whatsapp-mcp-docker
docker compose build

# 2. Create catalog (one-time setup)
docker mcp catalog create my-mcp --title "My MCP Servers" \
  --server file://./whatsapp-mcp-docker-server.yaml

# 3. Add to default profile
docker mcp profile server add default \
  --server file://./whatsapp-mcp-docker-server.yaml

# 4. Connect Cursor (or your MCP client)
docker mcp client connect cursor --profile default

# 5. In Cursor, type: "Authenticate WhatsApp with +1234567890"
```

**That's it!** You're now connected to WhatsApp. The server uses default settings (no encryption, standard rate limits). 

**Next steps:** Set up encryption and recommended configuration (below) for secure use.

---

### 📋 Full Setup (Recommended Secure Configuration)

### 1. Build the Docker Image

```bash
git clone https://github.com/Malaccamaxgit/whatsapp-mcp-docker.git
cd whatsapp-mcp-docker
docker compose build
```

### 2. Set the Encryption Key and Configuration

**Important:** Set the encryption key and all configuration values before adding the server to a profile. This ensures the server starts with proper security and settings from the first launch.

**Set the encryption key** (stored in OS Keychain):

```bash
# Option A: Using Node.js (if installed on host) — bash/zsh only
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" | docker mcp secret set whatsapp-mcp-docker.data_encryption_key

# Option B: Using Docker (no Node.js required on host) — bash/zsh only
docker run --rm node:20-alpine node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" | docker mcp secret set whatsapp-mcp-docker.data_encryption_key
```

> **Windows PowerShell users:** The pipe (`|`) and redirect (`<`) operators do not work with `docker mcp secret set` on PowerShell. Use this two-step approach instead:
>
> ```powershell
> # Step 1 — generate a key and store it inline
> $key = docker run --rm node:20-alpine node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
> docker mcp secret set "whatsapp-mcp-docker.data_encryption_key=$key"
> ```
>
> If you see a "logon session does not exist" error but the key still appears in `docker mcp secret ls`, the key was stored successfully in the `docker-pass` backend — the error is a misleading warning from a secondary Windows Credential Manager backend and can be safely ignored.

> **Tip:** Keep the generated key safe! If you lose it, encrypted messages cannot be recovered. Back it up to a password manager.

**Apply recommended configuration** to your profile (replace `<your-profile>` with your profile name, e.g., `default-with-portainer`):

> **PowerShell Users:** Use backtick (`` ` ``) instead of backslash (`\`) for line continuation.
>
> ```powershell
> docker mcp profile config <your-profile> `
>   --set whatsapp-mcp-docker.rate_limit_per_min=60 `
>   --set whatsapp-mcp-docker.message_retention_days=90 `
>   --set whatsapp-mcp-docker.send_read_receipts=true `
>   --set whatsapp-mcp-docker.auto_read_receipts=true `
>   --set whatsapp-mcp-docker.presence_mode=available `
>   --set whatsapp-mcp-docker.welcome_group_name=WhatsAppMCP `
>   --set whatsapp-mcp-docker.auth_wait_for_link=false `
>   --set whatsapp-mcp-docker.auth_link_timeout_sec=120 `
>   --set whatsapp-mcp-docker.auth_poll_interval_sec=5
> ```

```bash
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
```

Or configure via Docker Desktop: **MCP Toolkit → WhatsApp MCP → Configuration / Secrets**.

> **Why set this upfront?** The encryption key protects sensitive data at rest. Setting all configuration values ensures the server behaves consistently from first launch, and the Docker Desktop UI will show your values instead of blank fields.

### 3. Create a Custom Catalog

Register the server in a [custom catalog](https://docs.docker.com/ai/mcp-catalog-and-toolkit/catalog/#custom-catalogs) so it appears in Docker Desktop's **Catalog** tab alongside the official Docker MCP Catalog:

> **PowerShell Users:** On Windows PowerShell, use backtick (`` ` ``) instead of backslash (`\`) for line continuation.
>
> ```powershell
> docker mcp catalog create my-custom-mcp-servers `
>   --title "My Custom MCP Servers" `
>   --server file://./whatsapp-mcp-docker-server.yaml
> ```

```bash
docker mcp catalog create my-custom-mcp-servers \
  --title "My Custom MCP Servers" \
  --server file://./whatsapp-mcp-docker-server.yaml
```

In Docker Desktop, go to **MCP Toolkit → Catalog** — the **WhatsApp MCP** server now appears under your custom catalog with all 32 tools, configuration options, and secrets.

> **Tip:** To update the catalog after code changes, re-run the same command — it replaces the existing entry. To add more servers later, use multiple `--server` flags.

### 4. Add to a Profile

Add the server to a profile so MCP clients can use it.

**Option A — From the Catalog UI:**

1. In **MCP Toolkit → Catalog**, find **WhatsApp MCP** under your custom catalog.
2. Select the checkbox on the server card.
3. Choose a profile from the drop-down and confirm.

**Option B — CLI:**

```bash
docker mcp profile server add <your-profile> \
  --server file://./whatsapp-mcp-docker-server.yaml
```

**Option C — Docker Desktop Profiles tab:**

1. Open Docker Desktop and go to **MCP Toolkit → Profiles**.
2. Select an existing profile (or create a new one).
3. In the **Servers** section, click **+** and add the server.

All options register the server with `longLived: true` (persistent container), `secrets` (encryption key from OS Keychain), and all 32 tools.

**Apply default configuration** (recommended after first registration):

```bash
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
```

This populates the configuration fields in Docker Desktop so you can see and adjust them from the UI. Without this step, the server still works (defaults are applied at runtime), but the UI fields appear blank.

The **`auth_*`** keys set defaults for the **`authenticate`** tool when you omit `waitForLink`, `linkTimeoutSec`, or `pollIntervalSec`: whether to wait for the device to link after showing the pairing code or QR, the maximum wait time (seconds), and how often to poll (seconds). `auth_wait_for_link=false` is the default and recommended setting for Cursor — it returns the pairing code immediately without blocking. Set `auth_wait_for_link=true` only in non-Cursor environments that don't have a tool-call timeout.

### 5. Connect Your MCP Client

Connect your AI client to the profile with one command:

```bash
docker mcp client connect cursor --profile <your-profile>
```

This automatically configures Cursor's `mcp.json` with the MCP Gateway. Supported clients include `claude-code`, `claude-desktop`, `cursor`, `vscode`, `gemini`, `goose`, and [others](https://docs.docker.com/ai/mcp-catalog-and-toolkit/profiles/#using-profiles-with-clients).

To connect manually instead, add the following to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "MCP_DOCKER": {
      "command": "docker",
      "args": ["mcp", "gateway", "run", "--profile", "<your-profile>"]
    }
  }
}
```

### 6. Authenticate

From your MCP client:

```
Authenticate WhatsApp with my number +1234567890
```

The server returns an 8-digit pairing code. Enter it in:
**WhatsApp → Settings → Linked Devices → Link a Device → Link with phone number instead**

If pairing code fails (rate-limited or 400 error), the server falls back to QR code authentication:
- **MCP image block** — displayed inline by clients that support image rendering (e.g., Cursor)
- **Data URI** — a `data:image/png;base64,...` string included in the text response; paste it into any browser's address bar to view the QR code — no host tools needed

The session persists across container restarts in the `whatsapp-sessions` Docker volume.

**Compatible Clients:** Claude Code, Claude Desktop, Cursor, VS Code, Gemini CLI, Goose, Cline, Gordon, Codex, and any client supporting the Model Context Protocol. Run `docker mcp client connect --help` to see the full list.

---

## Available Tools (32)

### Authentication & Status

| Tool | Description |
|------|-------------|
| `disconnect` | Log out and disconnect from WhatsApp, clearing the session |
| `authenticate` | Link device via 8-digit pairing code (QR image fallback with data URI) |
| `get_connection_status` | Connection state + database statistics |

### Messaging

| Tool | Description |
|------|-------------|
| `send_message` | Send text with fuzzy contact/group name matching |
| `send_file` | Send image, video, audio, or document with optional caption |
| `list_messages` | Get messages from a chat with date range filtering and pagination |
| `search_messages` | Full-text search across all messages (SQLite FTS5) |

### Contacts & Chats

| Tool | Description |
|------|-------------|
| `list_chats` | List conversations sorted by recent activity |
| `search_contacts` | Find contacts/groups by name or phone number |
| `export_chat_data` | Export complete chat history for a contact or group (JSON or CSV) |

### Media

| Tool | Description |
|------|-------------|
| `download_media` | Download media from a received message to persistent storage |

### Intelligence

| Tool | Description |
|------|-------------|
| `catch_up` | Activity summary: active chats, questions, unread highlights |
| `mark_messages_read` | Mark messages as read in a chat |

### Approval Workflows

| Tool | Description |
|------|-------------|
| `request_approval` | Send approval request — recipient replies APPROVE/DENY |
| `check_approvals` | Check specific approval or list all pending |

**Group Management**

| Tool | Description |
|------|-------------|
| `create_group` | Create a new group with a name and list of participants |
| `get_group_info` | Get participants, admins, description, and settings for a group |
| `get_joined_groups` | List all groups this account belongs to |
| `get_group_invite_link` | Get the shareable invite link for a group (admin only) |
| `join_group` | Join a group via invite link or code |
| `leave_group` | Leave a group permanently |
| `update_group_participants` | Add, remove, promote, or demote participants (admin only) |
| `set_group_name` | Rename a group (admin only) |
| `set_group_topic` | Set or clear the group description (admin only) |

**Message Actions**

| Tool | Description |
|------|-------------|
| `send_reaction` | React to a message with an emoji, or remove an existing reaction |
| `edit_message` | Edit a previously sent message (own messages, within ~15 min) |
| `delete_message` | Delete a sent message for everyone (revoke) |
| `create_poll` | Send a poll with a question and 2–12 answer options |

**Contacts & User Info**

| Tool | Description |
|------|-------------|
| `get_user_info` | Get profile information for one or more phone numbers |
| `is_on_whatsapp` | Check whether phone numbers have WhatsApp accounts |
| `get_profile_picture` | Get the profile picture URL for a contact or group |

**Interactive Workflows**

| Tool | Description |
|------|-------------|
| `wait_for_message` | Block until an incoming message arrives — use during interactive tests so the AI detects phone messages automatically without user prompting |

---

## Example Usage

```
# Authenticate
Authenticate WhatsApp with +1234567890

# Send a message (fuzzy name matching)
Send "I'll be 10 minutes late" to John

# Send a photo
Send the file /data/sessions/media/image/photo.jpg to the Engineering group as an image

# Search across all chats
Search my WhatsApp messages for "project deadline"

# Get a summary
Catch me up on today's WhatsApp activity

# View a conversation
Show me the last 20 messages with the Engineering group

# Find a contact
Search for contacts named "Sarah"

# Download media from a message
Download media from message ID abc123

# Approval workflow
Send an approval request to Sarah: "Deploy v2.1 to production?"
Check approval status for approval_1234567890_abc
```

---

## Project Structure

```
whatsapp-mcp-docker/
├── src/
│   ├── index.js              # Entry point — stdio transport + lifecycle
│   ├── server.js             # Server factory — wires tools, store, security
│   ├── whatsapp/
│   │   ├── client.js         # whatsmeow-node wrapper + media operations
│   │   └── store.js          # SQLite persistence + FTS5 search + media metadata
│   ├── tools/
│   │   ├── auth.js           # disconnect, authenticate
│   │   ├── status.js         # get_connection_status
│   │   ├── messaging.js      # send_message, list_messages, search_messages
│   │   ├── chats.js          # list_chats, search_contacts, catch_up, mark_messages_read, export_chat_data
│   │   ├── media.js          # download_media, send_file
│   │   ├── approvals.js      # request_approval, check_approvals
│   │   ├── groups.js         # create_group, get_group_info, get_joined_groups, get_group_invite_link, join_group, leave_group, update_group_participants, set_group_name, set_group_topic
│   │   ├── reactions.js      # send_reaction, edit_message, delete_message, create_poll
│   │   ├── contacts.js       # get_user_info, is_on_whatsapp, get_profile_picture
│   │   └── wait.js           # wait_for_message
│   ├── security/
│   │   ├── audit.js          # SQLite audit logging
│   │   ├── crypto.js         # AES-256-GCM field-level encryption
│   │   ├── file-guard.js     # Path confinement, extension/magic checks, quota
│   │   └── permissions.js    # Whitelist, rate limiting, tool disabling, auth throttle
│   └── utils/
│       ├── fuzzy-match.js    # Levenshtein + substring matching
│       └── phone.js          # E.164 validation + JID conversion
├── docs/
│   ├── README.md             # Documentation index
│   ├── architecture/
│   │   └── OVERVIEW.md       # Architecture overview
│   └── guides/
│       └── DEVELOPER.md      # Build, test, deploy procedures
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.md
│   │   └── feature_request.md
│   └── workflows/
│       └── security-audit.yml
├── test/
│   ├── unit/                 # Unit tests (node:test)
│   ├── integration/          # MCP protocol tests (mock WhatsApp client)
│   └── e2e/                  # Live session tests (persistent auth)
├── Dockerfile                # Multi-stage (builder → test → runtime), ~150 MB
├── docker-compose.yml        # Main + tester-container (Compose profiles)
├── whatsapp-mcp-docker-server.yaml  # Docker MCP Toolkit server definition
├── catalog.yaml              # Docker MCP Toolkit catalog definition
├── .env.example              # Environment template (docker-compose fallback)
├── package.json
├── package-lock.json
├── CHANGELOG.md
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── SECURITY.md
├── PRIVACY.md
├── DEVELOPMENT.md
├── TESTING-GUIDE.md
└── LICENSE
```

---

## Security

- **Non-root user** (UID 1001, all capabilities dropped)
- **Read-only root filesystem** (only `/data` volumes and `/tmp` tmpfs writable)
- **TLS transport** — direct WhatsApp protocol (whatsmeow-node), no browser automation or TLS bypasses
- **Encryption at rest** — AES-256-GCM for sensitive database fields (`DATA_ENCRYPTION_KEY`)
- **Secrets in OS Keychain** — encryption key stored via `docker mcp secret set`, never in config files
- **Auto-purge** — messages and media auto-deleted after retention period (`MESSAGE_RETENTION_DAYS`)
- **File security** — upload path confinement, extension blocklist, magic bytes verification, 512 MB media quota
- **Contact whitelist** — restrict who can receive messages (`ALLOWED_CONTACTS`)
- **Rate limiting** — outbound messages, media downloads, and authentication attempts
- **Input validation** — Zod schemas with max-length limits on all tool parameters
- **Audit trail** — all tool invocations logged to SQLite with timestamps

See [SECURITY.md](./SECURITY.md) for the full security policy and vulnerability reporting.

---

## Configuration

Configuration is managed through Docker MCP Toolkit (preferred) or `docker-compose.yml` environment variables.

### Docker MCP Toolkit (Preferred)

Settings and secrets are managed via Docker Desktop UI or CLI:

**Recommended initial setup** (run all commands when first deploying):

```bash
# 1. Set encryption key (stored in OS Keychain)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" | \
  docker mcp secret set whatsapp-mcp-docker.data_encryption_key

# 2. Apply complete recommended configuration to your profile
# Replace <your-profile> with your profile name (e.g., default-with-portainer)
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
```

Or configure via Docker Desktop: **MCP Toolkit → WhatsApp MCP → Configuration / Secrets**.

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `STORE_PATH` | Session + message database directory | `/data/sessions` |
| `AUDIT_DB_PATH` | Audit log database path | `/data/audit/audit.db` |
| `RATE_LIMIT_PER_MIN` | Max outbound messages per minute | `60` |
| `DOWNLOAD_RATE_LIMIT_PER_MIN` | Max media downloads per minute | `30` |
| `DATA_ENCRYPTION_KEY` | Passphrase for AES-256-GCM field encryption | *(set via `docker mcp secret set`)* |
| `MESSAGE_RETENTION_DAYS` | Auto-delete messages/media older than N days (0 = keep forever) | `90` |
| `ALLOWED_CONTACTS` | Comma-separated phone whitelist (empty = allow all) | `""` |
| `DISABLED_TOOLS` | Comma-separated tool names to disable | `""` |
| `SEND_READ_RECEIPTS` | Send read receipts to WhatsApp when `mark_messages_read` is called | `true` |
| `AUTO_READ_RECEIPTS` | Auto-read incoming messages (senders see blue checkmarks immediately) | `true` |
| `PRESENCE_MODE` | Online presence: `available` or `unavailable` | `available` |
| `WELCOME_GROUP_NAME` | WhatsApp group created on first connection (empty = disable) | `WhatsAppMCP` |
| `AUTH_WAIT_FOR_LINK` | Default: after `authenticate` shows code/QR, wait and poll until linked (`false` = return immediately, recommended for Cursor) | `false` |
| `AUTH_LINK_TIMEOUT_SEC` | Default max seconds to wait for link when waiting (15–600) | `120` |
| `AUTH_POLL_INTERVAL_SEC` | Default seconds between connection checks when waiting (2–60) | `5` |

### Variable Details

**`DATA_ENCRYPTION_KEY`** — Encrypts sensitive fields (message bodies, sender names, media metadata, approval details) using AES-256-GCM. Store it via `docker mcp secret set whatsapp-mcp-docker.data_encryption_key` (OS Keychain) or in `.env` for docker-compose. Generate a strong key: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. If you lose the key, encrypted data becomes unrecoverable.

**`MESSAGE_RETENTION_DAYS`** — Runs on startup and then hourly. Deletes messages, associated media files, and expired approvals older than the configured number of days. Set to `0` to disable.

**`RATE_LIMIT_PER_MIN`** — Applies to outbound messages (`send_message`, `send_file`). Default is 60 (1/sec sustained), comfortable for AI assistant conversations.

**`DOWNLOAD_RATE_LIMIT_PER_MIN`** — Applies to media downloads (`download_media`). Default is 30/min. Authentication attempts are separately limited to 5 per 30 minutes with exponential backoff.

**`ALLOWED_CONTACTS`** — Comma-separated E.164 phone numbers (e.g. `+15145551234,+353871234567`). When set, only these contacts can receive outbound messages.

**`DISABLED_TOOLS`** — Comma-separated tool names (e.g. `send_file,download_media`). Disabled tools return an error when invoked.

**`SEND_READ_RECEIPTS`** — When `true`, calling `mark_messages_read` sends actual read receipts to WhatsApp (blue double checkmarks visible to senders), in addition to updating the local database. Set to `false` to only update the local database.

**`AUTO_READ_RECEIPTS`** — When `true`, incoming messages are automatically marked as read on WhatsApp (senders see blue checkmarks immediately). Since the server is an automated agent, this is enabled by default. Set to `false` to control read receipt timing manually via `mark_messages_read`.

**`PRESENCE_MODE`** — Controls the online/offline status of the linked device. Set to `available` (default) so the device appears online and delivery receipts (grey double checkmarks) are sent automatically. Set to `unavailable` to appear offline.

**`WELCOME_GROUP_NAME`** — On first connection, the server creates a WhatsApp group with this name and sends a hello message. Set to empty string to disable.

**`AUTO_CONNECT_ON_STARTUP`** — When `true` (default), the server automatically reconnects to WhatsApp at container startup if a valid session exists, without needing to call `authenticate`. Set to `false` to start in disconnected mode and connect manually.

**`AUTH_WAIT_FOR_LINK`**, **`AUTH_LINK_TIMEOUT_SEC`**, **`AUTH_POLL_INTERVAL_SEC`** — Defaults for the `authenticate` tool when the client omits `waitForLink`, `linkTimeoutSec`, or `pollIntervalSec`. In Docker MCP Toolkit they are driven by profile config `whatsapp-mcp-docker.auth_wait_for_link`, `auth_link_timeout_sec`, and `auth_poll_interval_sec`. Tool arguments always override these for that call.

**`DEBUG`** — When set to `true`, emits verbose diagnostic output to stderr. Useful when diagnosing connection or protocol issues. Don't leave it on permanently unless you enjoy reading walls of text.

---

## Data Persistence

Docker MCP Toolkit automatically provisions named volumes for session persistence:

| Data | Volume | Mount | Description |
|------|--------|-------|-------------|
| Session + Messages | `whatsapp-sessions` | `/data/sessions` | WhatsApp session DB, message DB, downloaded media |
| Audit | `whatsapp-audit` | `/data/audit` | Audit log SQLite DB |

Session data survives container restarts. Use `docker volume rm whatsapp-sessions whatsapp-audit` to delete all data.

---

## Data Management

### Backup Your Data

**Backup WhatsApp sessions and messages:**

```bash
# Create backup directory
mkdir -p whatsapp-backup

# Backup session volume
docker run --rm \
  -v whatsapp-sessions:/data \
  -v $(pwd)/whatsapp-backup:/backup \
  alpine tar czf /backup/sessions-$(date +%Y%m%d).tar.gz /data

# Backup audit volume (optional)
docker run --rm \
  -v whatsapp-audit:/data \
  -v $(pwd)/whatsapp-backup:/backup \
  alpine tar czf /backup/audit-$(date +%Y%m%d).tar.gz /data
```

**Backup encryption key:**

```bash
# If using docker mcp secrets, export from OS Keychain manually
# On macOS: security find-generic-password -s "docker-mcp" -a "whatsapp-mcp-docker.data_encryption_key" -w
# On Windows: Stored in Windows Credential Manager
# On Linux: Stored in secret-service (GNOME Keyring or KWallet)

# Save to password manager - DO NOT commit to git!
```

### Restore from Backup

```bash
# Stop the container
docker compose down

# Restore session volume
docker run --rm \
  -v whatsapp-sessions:/data \
  -v $(pwd)/whatsapp-backup:/backup \
  alpine tar xzf /backup/sessions-20260331.tar.gz -C /

# Start container
docker compose up -d
```

### Migrate to New Host

```bash
# On old host: create backup (see above)
# Copy backup files to new host (scp, rsync, etc.)

# On new host:
# 1. Install Docker Desktop and enable MCP Toolkit
# 2. Restore volumes (see above)
# 3. Set encryption key
docker mcp secret set whatsapp-mcp-docker.data_encryption_key
# 4. Register catalog and add to profile
# 5. Start container - session should resume automatically
```

### Delete All Data

```bash
# Stop container and remove volumes
docker compose down -v

# Verify volumes are gone
docker volume ls | grep whatsapp  # Should return nothing
```

> **Warning:** This permanently deletes all WhatsApp sessions, messages, and audit logs. You'll need to re-authenticate.

---

## Tech Stack

| Category | Technology |
|----------|-----------|
| **Runtime** | Node.js 20 (Alpine) |
| **WhatsApp Protocol** | whatsmeow-node (Go binary) |
| **MCP SDK** | @modelcontextprotocol/sdk |
| **Database** | SQLite (better-sqlite3) with FTS5 |
| **QR Code** | qrcode (in-container PNG generation) |
| **Validation** | Zod |
| **Container** | Docker (multi-stage, ~150 MB) |
| **Orchestration** | Docker MCP Toolkit + MCP Gateway |

---

## Documentation

- [docs/API.md](./docs/API.md) — Full MCP tool API reference (all 32 tools)
- [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md) — Symptom → cause → fix guide
- [docs/guides/DEVELOPER.md](./docs/guides/DEVELOPER.md) — Build, test, and deploy procedures
- [docs/architecture/OVERVIEW.md](./docs/architecture/OVERVIEW.md) — Architecture overview
- [docs/guides/ERRORS.md](./docs/guides/ERRORS.md) — Error taxonomy and recovery
- [docs/testing/TESTING.md](./docs/testing/TESTING.md) — Test strategy and commands
- [CHANGELOG.md](./CHANGELOG.md) — Release history
- [DEVELOPMENT.md](./DEVELOPMENT.md) — Docker-first development reference
- [TESTING-GUIDE.md](./TESTING-GUIDE.md) — Auth/session testing scenarios
- [PRIVACY.md](./PRIVACY.md) — Privacy policy and data handling
- [SECURITY.md](./SECURITY.md) — Security policy and vulnerability reporting
- [CONTRIBUTING.md](./CONTRIBUTING.md) — Contribution guidelines
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) — Community standards

---

## Common Pitfalls & Troubleshooting

### ⚠️ Authentication Issues

**Problem: Pairing code returns 400 error**
- **Cause:** WhatsApp rate-limits pairing attempts (5 per 30 minutes)
- **Solution:** Wait 10-15 minutes, then retry. The server automatically falls back to QR code.
- **Prevention:** Use QR code authentication if pairing codes frequently fail.

**Problem: QR code expired**
- **Cause:** QR codes expire in ~20 seconds
- **Solution:** Call `authenticate` again for a fresh QR code
- **Prevention:** Have WhatsApp open and ready before calling authenticate

**Problem: "Already authenticated" but messages not sending**
- **Cause:** Session may have expired (20 days of inactivity) or WhatsApp disconnected
- **Solution:** 
  1. Check status: `docker compose logs --tail 50 whatsapp-mcp-docker`
  2. Look for "logged_out" or "session expired" messages
  3. Call `authenticate` again to re-link

**Problem: Can't scan QR code in time**
- **Cause:** QR codes expire quickly and you need to navigate WhatsApp menus
- **Solution:** 
  1. Open WhatsApp → Settings → Linked Devices **before** calling authenticate
  2. Tap "Link a Device" and have the camera ready
  3. Then call `authenticate` to generate QR code
- **Alternative:** Use pairing code instead (lasts 60 seconds)

### ⚠️ Rate Limiting

**Problem: "Rate limit exceeded" for messages**
- **Default:** 60 messages per minute
- **Solution:** Wait for the window to reset, or adjust `RATE_LIMIT_PER_MIN`
- **Warning:** Sending too many messages too quickly can get your account banned by WhatsApp

**Problem: "Authentication cooldown active"**
- **Cause:** Failed auth attempts trigger exponential backoff (60s → 120s → 240s → 480s → 900s)
- **Solution:** Wait for the cooldown period to expire
- **Prevention:** Ensure phone number is correct before calling authenticate

### ⚠️ Session & Data Issues

**Problem: Session lost after container restart**
- **Cause:** Docker volume not persisting
- **Check:** `docker volume ls | grep whatsapp-sessions`
- **Solution:** Ensure `whatsapp-sessions` volume exists and is mounted

**Problem: Messages not appearing in search**
- **Cause:** FTS5 index may be out of sync or messages lack text body
- **Solution:** 
  1. Check if messages exist: Use `list_messages` for the chat
  2. Verify search query: Try simpler keywords
  3. FTS5 limitation: Media-only messages (no text) aren't searchable

**Problem: Media download fails**
- **Cause 1:** Media expired on WhatsApp servers (30-day limit)
- **Cause 2:** Message ID invalid or from before metadata tracking
- **Solution:** Download media soon after receiving; old media may be unavailable

### ⚠️ Contact & Name Resolution

**Problem: Wrong contact matched by fuzzy search**
- **Cause:** Multiple contacts have similar names
- **Solution:** Use exact JID instead of name: `send_message({ to: "1234567890@s.whatsapp.net", ... })`
- **Prevention:** Use `search_contacts` first to find the exact JID

**Problem: Contact name shows as phone number**
- **Cause:** Name resolution from WhatsApp may take time or fail
- **Solution:** Names are resolved asynchronously; wait for messages to arrive
- **Note:** This is cosmetic; messaging still works with JIDs

### ⚠️ Backup & Restore

**Problem: Need to backup/restore sessions**
- **Backup:**
  ```bash
  docker run --rm -v whatsapp-sessions:/data -v $(pwd):/backup alpine \
    tar czf /backup/whatsapp-backup.tar.gz /data
  ```
- **Restore:**
  ```bash
  docker run --rm -v whatsapp-sessions:/data -v $(pwd):/backup alpine \
    tar xzf /backup/whatsapp-backup.tar.gz -C /data --strip-components 1
  ```

### 🔍 Diagnostic Commands

```bash
# Check if container is running
docker compose ps

# View last 50 lines of logs
docker compose logs --tail 50 whatsapp-mcp-docker

# Follow logs in real-time
docker compose logs -f whatsapp-mcp-docker

# Check volumes exist (bash/zsh)
docker volume ls | grep whatsapp

# Check volumes exist (PowerShell)
docker volume ls | findstr whatsapp

# Verify encryption key is set
docker mcp secret ls | findstr whatsapp        # PowerShell
docker mcp secret ls | grep whatsapp           # bash/zsh

# Check catalog registration
docker mcp catalog ls

# List available profiles
docker mcp profile list

# List profile servers
docker mcp profile server ls
```

### 📞 Getting Help

If issues persist:

1. **Check logs:** `docker compose logs --tail 100 whatsapp-mcp-docker`
2. **Run diagnostics:** `node scripts/diagnostics.js --verbose`
3. **Search issues:** [GitHub Issues](https://github.com/Malaccamaxgit/whatsapp-mcp-docker/issues)
4. **Report bug:** Include logs, Docker version, and steps to reproduce

---

## Testing

Tests run inside Docker via `tester-container` — no local build tools needed. The `npm test` scripts are intentionally blocked on the host; use the container's default CMD instead.

```bash
# Build the test image (tester-container is behind the 'test' Compose profile)
docker compose --profile test build tester-container

# Run all unit + integration tests (uses container default CMD)
docker compose --profile test run --rm tester-container

# Run a specific test file
docker compose --profile test run --rm tester-container node --test test/unit/crypto.test.js

# One-time WhatsApp auth for e2e tests
docker compose --profile test run --rm tester-container node test/e2e/setup-auth.js

# Run e2e tests with live session
docker compose --profile test run --rm tester-container node --test test/e2e/live.test.js
```

| Layer | What's covered |
|-------|----------------|
| **Unit** | phone, fuzzy-match, crypto, file-guard, permissions, audit, store, reconnect, receipts |
| **Integration** | Full MCP protocol round-trip with mock WhatsApp client |
| **E2E** | Live WhatsApp session (read-only, requires auth) |

See [docs/guides/DEVELOPER.md](./docs/guides/DEVELOPER.md) for the full testing guide.

---

## Troubleshooting

### 🔍 Diagnostic Commands

Run the diagnostic script to check system health:

```bash
# Quick status check
node scripts/diagnostics.js

# Verbose output with full logs
node scripts/diagnostics.js --verbose

# JSON output for automation
node scripts/diagnostics.js --json
```

**Manual diagnostics:**

```bash
# Check if container is running
docker compose ps

# View last 50 lines of logs
docker compose logs --tail 50 whatsapp-mcp-docker

# Check volumes exist (bash/zsh)
docker volume ls | grep whatsapp
# Check volumes exist (PowerShell)
docker volume ls | findstr whatsapp

# Verify encryption key is set (bash/zsh)
docker mcp secret ls | grep whatsapp-mcp-docker
# Verify encryption key is set (PowerShell)
docker mcp secret ls | findstr whatsapp-mcp-docker

# Check catalog registration
docker mcp catalog ls

# Test WhatsApp connection status (from MCP client)
get_connection_status
```

---

### Common Pitfalls & Solutions

#### 1. Authentication Issues

**Problem:** Pairing code returns 400 error or expires

**Cause:** WhatsApp rate-limits pairing attempts or code expires in 60 seconds

**Solution:**
- Wait 10-15 minutes between attempts if rate-limited
- Have WhatsApp mobile app ready before calling `authenticate`
- If pairing code fails, server automatically falls back to QR code
- QR codes expire in ~20 seconds — request a fresh one if expired

**Prevention:** Open WhatsApp → Settings → Linked Devices → "Link a Device" **before** calling `authenticate`, so you're ready to enter the code immediately. Pass `waitForLink: true` if you want the tool to poll until linked (note: this can time out in Cursor — see auth_wait_for_link config).

---

**Problem:** "Already authenticated" but messages aren't sending

**Cause:** Session may be stale or WhatsApp disconnected

**Solution:**
```bash
# Check connection status
get_connection_status

# If disconnected, check logout reason
# If reason is "revoked", "banned", or "unlinked" → re-authenticate
authenticate({ phoneNumber: "+1234567890" })
```

---

#### 2. Session Expiry

**Problem:** "WhatsApp not connected" after period of inactivity

**Cause:** WhatsApp linked device sessions expire after ~20 days of inactivity

**Solution:**
1. Call `authenticate` again with the same phone number
2. Session will resume (no need to re-link if still within 20 days)
3. If expired, you'll need to re-link with pairing code or QR

**Prevention:** Send a message or use the server at least once every 2 weeks.

---

#### 3. Rate Limiting

**Problem:** "Rate limit exceeded (60 messages/min)"

**Cause:** WhatsApp may ban accounts that send too many messages too quickly

**Solution:**
- Wait 60 seconds for the rate limit to reset
- Reduce message frequency
- Increase `RATE_LIMIT_PER_MIN` only if you have legitimate high-volume use

**Warning:** Aggressive messaging can get your WhatsApp account banned.

---

**Problem:** "Too many authentication attempts (5 per 30 min)"

**Cause:** Authentication is limited to 5 attempts per 30 minutes

**Solution:**
- Wait for the cooldown period (exponential backoff: 60s → 120s → 240s → 480s → 900s)
- Don't retry immediately after failed attempts
- If pairing code fails, wait for the QR code fallback instead of retrying

---

#### 4. Contact Resolution Issues

**Problem:** "Could not resolve recipient" or wrong contact matched

**Cause:** Fuzzy matching found multiple candidates or no matches

**Solution:**
```bash
# Get exact JID from list_chats
list_chats()

# Use JID directly (bypasses fuzzy matching)
send_message({ to: "1234567890@c.us", message: "Hello" })
```

**Tip:** Contact names may not resolve immediately after first message — wait a few seconds for name resolution.

---

#### 5. Media Download Failures

**Problem:** "No media metadata stored for this message"

**Cause:** Media was received before metadata tracking was enabled, or media expired

**Solution:**
- Media on WhatsApp servers expires after 30 days
- Only media received after enabling the server can be downloaded
- Check `has_media` flag in `list_messages` to see if media is available

---

**Problem:** "Media storage quota exceeded"

**Cause:** Total media directory has reached 512 MB limit

**Solution:**
```bash
# Check media directory size
docker compose exec whatsapp-mcp-docker du -sh /data/sessions/media

# Delete old media files manually or wait for auto-purge
# Auto-purge runs hourly if MESSAGE_RETENTION_DAYS > 0
```

---

#### 6. Search Returns No Results

**Problem:** `search_messages` finds nothing

**Cause:**
- FTS5 index may not have caught up (delayed indexing)
- Messages are encrypted but search index has plaintext
- Query syntax error (boolean operators need capitalization)

**Solution:**
```bash
# Try simpler query without operators
search_messages({ query: "hello" })  # Instead of "hello AND world"

# Use quotes for exact phrases
search_messages({ query: "\"exact phrase\"" })

# Check if messages exist
list_messages({ chat: "Contact Name", limit: 10 })
```

---

#### 7. Container Issues

**Problem:** Container won't start

**Solution:**
```bash
# Check logs
docker compose logs whatsapp-mcp-docker

# Verify volumes exist
docker volume ls | grep whatsapp

# Rebuild image
docker compose build --no-cache

# Remove and recreate
docker compose down -v
docker compose up -d
```

---

**Problem:** High memory usage

**Cause:** Message history sync loads many messages into memory

**Solution:**
- Set `MESSAGE_RETENTION_DAYS` to limit stored messages
- Use pagination in `list_messages` (limit: 50, page: 0, 1, 2...)
- Restart container periodically to clear memory

---

### Authentication Fails

If pairing code returns a 400 error, the server automatically falls back to QR code authentication — the QR code is returned directly in the tool response as an image and a data URI (paste the URI into any browser to view it). Check container logs for details: `docker compose logs whatsapp-mcp-docker`.

### Rate Limited (429)

WhatsApp rate-limits pairing attempts. Wait 10-15 minutes before retrying.

### Session Expired

WhatsApp sessions expire after ~20 days of inactivity. The server detects this automatically: it sends a `notifications/disconnected` MCP notification to your client, cleans up the stale session file, and reports the reason in `get_connection_status`. Call `authenticate` again to re-link.

For transient disconnects (network blips), the server automatically attempts reconnection after 5 seconds. A 60-second health heartbeat detects silent connection drops. Startup retries 5 times with exponential backoff before giving up.

### Container Won't Start

```bash
docker compose up -d
docker compose logs -f whatsapp-mcp-docker
```

---

## License

Apache License 2.0 — see [LICENSE](./LICENSE) for details.

---

## Disclaimer

This project is not affiliated with WhatsApp or Meta. WhatsApp does not officially support unofficial API clients. Use at your own risk and in compliance with WhatsApp's Terms of Service.

---

## Contact

- **AI Authors:** Qwen3-Coder-Next • MiniMax-M2.7 • Qwen3.5 • Nemotron-3-Super
- **Director:** Benjamin Alloul — [Benjamin.Alloul@gmail.com](mailto:Benjamin.Alloul@gmail.com)
- **Issues:** [GitHub Issues](https://github.com/Malaccamaxgit/whatsapp-mcp-docker/issues)
- **Discussions:** [GitHub Discussions](https://github.com/Malaccamaxgit/whatsapp-mcp-docker/discussions)
