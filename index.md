---
layout: default
title: Home
nav_order: 1
description: "WhatsApp MCP Server — Docker-based WhatsApp integration for AI agents via Model Context Protocol."
permalink: /
---

# WhatsApp MCP Server
{: .fs-9 }

Docker-based WhatsApp integration for AI agents — 33 tools for messaging, groups, media, approvals, and intelligent activity summaries.
{: .fs-6 .fw-300 }

[Get Started](#quick-start){: .btn .btn-primary .fs-5 .mb-4 .mb-md-0 .mr-2 }
[API Reference]({{ site.baseurl }}/docs/API){: .btn .fs-5 .mb-4 .mb-md-0 .mr-2 }
[View on GitHub](https://github.com/Malaccamaxgit/whatsapp-mcp-docker){: .btn .fs-5 .mb-4 .mb-md-0 }

---

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Runtime: Node.js](https://img.shields.io/badge/Runtime-Node.js%2020-green.svg)](https://nodejs.org/)
[![Protocol: MCP](https://img.shields.io/badge/Protocol-Model%20Context%20Protocol-purple.svg)](https://modelcontextprotocol.io/)
[![Platform: Docker](https://img.shields.io/badge/Platform-Docker%20MCP%20Toolkit-blue.svg)](https://docs.docker.com/ai/mcp-catalog-and-toolkit/)

---

## What It Does

**WhatsApp MCP Server** lets AI agents (Cursor, Claude Code, VS Code, and any MCP client) control WhatsApp through 33 structured tools — all running in a secure, isolated Docker container managed by [Docker MCP Toolkit](https://docs.docker.com/ai/mcp-catalog-and-toolkit/).

| Category | Tools |
|----------|-------|
| **Messaging** | `send_message`, `list_messages`, `search_messages`, `get_poll_results` |
| **Chats** | `list_chats`, `search_contacts`, `catch_up`, `mark_messages_read`, `export_chat_data` |
| **Groups** | `create_group`, `get_group_info`, `get_joined_groups`, `join_group`, `leave_group`, `update_group_participants`, `set_group_name`, `set_group_topic`, `get_group_invite_link` |
| **Message Actions** | `send_reaction`, `edit_message`, `delete_message`, `create_poll` |
| **Media** | `send_file`, `download_media` |
| **Contacts** | `get_user_info`, `is_on_whatsapp`, `get_profile_picture` |
| **Approvals** | `request_approval`, `check_approvals` |
| **Auth & Status** | `authenticate`, `disconnect`, `get_connection_status` |
| **Workflow** | `wait_for_message` |

---

## Key Features

- **Fuzzy Name Matching** — Say "John" or "book club"; the server finds the right chat via Levenshtein distance
- **Full-Text Search** — SQLite FTS5 indexes all messages with keyword, phrase, and boolean operators
- **Approval Workflows** — Send approval requests; recipients reply APPROVE/DENY via WhatsApp
- **Encryption at Rest** — AES-256-GCM field-level encryption for message bodies and media metadata
- **Session Resilience** — Auto-reconnect, exponential backoff, 60-second health heartbeat
- **Pairing Code Auth** — 8-digit text code + QR code fallback (rendered in-container, viewable in any browser)
- **Auto-Purge** — Configurable data retention; automatic deletion of old messages and media
- **Long-Lived Containers** — WhatsApp WebSocket stays open across all tool calls

---

## Quick Start

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) with [MCP Toolkit](https://docs.docker.com/ai/mcp-catalog-and-toolkit/) enabled

### 5-Minute Setup

**1. Register with Docker MCP Toolkit**

```bash
docker mcp catalog add https://raw.githubusercontent.com/Malaccamaxgit/whatsapp-mcp-docker/main/whatsapp-mcp-docker-server.yaml
```

**2. Set your encryption key**

```bash
docker mcp secret set DATA_ENCRYPTION_KEY
# Enter a passphrase when prompted
```

**3. Enable in Docker Desktop**

Open Docker Desktop → MCP Toolkit → find `whatsapp-mcp-docker` → Enable

**4. Authenticate in your MCP client**

```
authenticate({ phoneNumber: "+1234567890" })
```

Enter the 8-digit pairing code in WhatsApp on your phone (Linked Devices).

**5. Start using WhatsApp from your AI agent**

```
send_message({ to: "John", message: "Hello from my AI agent!" })
catch_up({ since: "today" })
search_messages({ query: "project deadline" })
```

---

## Why Docker MCP Toolkit?

| Concern | Docker MCP Toolkit | Running on Host |
|---------|-------------------|-----------------|
| **Isolation** | Session keys confined to Docker volumes | Data in your home directory |
| **Security** | Non-root, read-only FS, capabilities dropped | Full user-level access |
| **Secrets** | Encryption key in OS Keychain | Must manage `.env` files manually |
| **Multi-client** | One server serves all clients through the gateway | Each client needs its own server |
| **Dependencies** | None on host — container handles everything | Must install Node.js, build tools, Go binary |
| **Lifecycle** | Health checks, auto-restart, graceful shutdown | Manual process management |

---

## Documentation

| Document | Description |
|----------|-------------|
| [API Reference]({{ site.baseurl }}/docs/API) | Complete docs for all 34 MCP tools |
| [Architecture]({{ site.baseurl }}/docs/architecture/OVERVIEW) | System design, data flow, storage schema |
| [Guides]({{ site.baseurl }}/docs/guides/) | Error reference, developer handbook, troubleshooting, testing |
| [Contributing]({{ site.baseurl }}/CONTRIBUTING) | Coding standards, contribution guidelines |
| [Changelog]({{ site.baseurl }}/CHANGELOG) | Release history |

---

**Director:** Benjamin Alloul — [Benjamin.Alloul@gmail.com](mailto:Benjamin.Alloul@gmail.com)
