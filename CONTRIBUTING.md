---
layout: default
title: Contributing
nav_order: 5
description: "Contribution guidelines, coding standards, and development workflow for WhatsApp MCP Server."
---

# Contributing to WhatsApp MCP Server

> **Community contributions welcome** — Help improve WhatsApp integration for AI agents.

Thank you for considering contributing to WhatsApp MCP Server! This document provides guidelines and instructions for contributing.

## Code of Conduct

This project adheres to a Contributor Code of Conduct. By participating, you are expected to uphold this code. Please report unacceptable behavior to benjamin.alloul@gmail.com.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check existing issues. When creating a bug report, include:

* **Use a clear and descriptive title**
* **Describe the exact steps to reproduce the problem**
* **Include container logs** (`docker compose logs whatsapp-mcp-docker`)
* **Describe the behavior you observed and what you expected**
* **Include your MCP client** (Claude Code, Cursor, VS Code, etc.)
* **Include Docker Desktop version**

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating one, include:

* **Use a clear and descriptive title**
* **Provide a detailed description of the suggested enhancement**
* **Explain why this enhancement would be useful for MCP clients**
* **Consider security implications** (this project handles WhatsApp messages)

### Pull Requests

* Follow the existing code style (TypeScript, ES modules, JSDoc where needed)
* Include error handling for all WhatsApp operations
* Update documentation as needed
* Test with Docker MCP Toolkit before submitting
* Consider security implications for new tools

## Development Setup

### ⚠️ CRITICAL: Docker-Only Development

**This project uses Linux-only dependencies (`@whatsmeow-node/linux-x64-musl`). Running `npm install`, `npm test`, or lint/format commands on Windows/macOS host will fail.**

**ALWAYS use the Docker test container for all development tasks:**
```bash
# Build the test image first
docker compose --profile test build tester-container

# Run all tests (uses the container's default CMD)
docker compose --profile test run --rm tester-container

# Run a specific test file
docker compose --profile test run --rm tester-container node --test test/unit/crypto.test.ts

# Lint
docker compose --profile test run --rm tester-container npx eslint src/

# Format check
docker compose --profile test run --rm tester-container npx prettier --check src/
```

### Prerequisites

- Docker Desktop with [MCP Toolkit](https://docs.docker.com/ai/mcp-catalog-and-toolkit/) (required)
- Git
- Node.js 18+ (host, for diagnostic scripts only — NOT for running tests/lint)

### Setting Up

```bash
# Clone the repository
git clone https://github.com/Malaccamaxgit/whatsapp-mcp-docker.git
cd whatsapp-mcp-docker

# Build the Docker image
docker compose build

# Start the container
docker compose up -d

# View logs
docker compose logs -f whatsapp-mcp-docker

# Run tests (inside Docker, no local build tools needed)
docker compose --profile test build tester-container
npm run docker:test
```

### Adding a New Tool

1. Create or extend a file in `src/tools/` (`.ts` extension)
2. Register the tool with `server.registerTool(name, { description, inputSchema }, handler)`
3. Include MCP annotations (`readOnlyHint`, `destructiveHint`, etc.)
4. Wire the tool in `src/server.ts` (the `createServer()` factory)
5. Add the tool to `whatsapp-mcp-docker-server.yaml`
6. Add integration tests in `test/integration/tools.test.ts`
7. Update `README.md` tool table

## Coding Guidelines

### Code Style

* ES modules (`import`/`export`, not `require`)
* Async/await for all asynchronous operations
* Descriptive error messages that help MCP clients recover
* `console.error` for logging (stdout is reserved for MCP stdio transport)

### Commit Messages

* Use the present tense ("Add feature" not "Added feature")
* Use the imperative mood ("Add send_file tool" not "Adds send_file tool")
* Limit the first line to 72 characters or less
* Reference issues and pull requests after the first line

### Security Considerations

* Never log message content or media data
* All new tools must respect the permission manager (whitelist + rate limit)
* All tool invocations must be audit-logged
* Validate all inputs with Zod schemas
* Handle WhatsApp API errors gracefully

## Architecture Overview

```
src/
├── index.ts              # Entry point, stdio transport, lifecycle
├── server.ts             # Server factory (createServer) for tools + security wiring
├── whatsapp/
│   ├── client.ts         # whatsmeow-node wrapper, events, media
│   └── store.ts          # SQLite persistence, FTS5, encryption, auto-purge
├── tools/
│   ├── auth.ts           # disconnect, authenticate (with auth rate limiting)
│   ├── status.ts         # get_connection_status
│   ├── messaging.ts      # send_message, list_messages, search_messages
│   ├── chats.ts          # list_chats, search_contacts, catch_up, mark_messages_read, export_chat_data
│   ├── media.ts          # download_media, send_file (with file security)
│   ├── approvals.ts      # request_approval, check_approvals
│   ├── groups.ts         # create_group, get_group_info, get_joined_groups, get_group_invite_link,
│   │                     #   join_group, leave_group, update_group_participants,
│   │                     #   set_group_name, set_group_topic
│   ├── reactions.ts      # send_reaction, edit_message, delete_message, create_poll
│   ├── contacts.ts       # get_user_info, is_on_whatsapp, get_profile_picture
│   └── wait.ts           # wait_for_message
├── security/
│   ├── audit.ts          # SQLite audit log with file fallback
│   ├── crypto.ts         # AES-256-GCM field-level encryption
│   ├── file-guard.ts     # Path confinement, extension/magic checks, quota
│   └── permissions.ts    # Whitelist, rate limit, tool disable, auth throttle
└── utils/
    ├── fuzzy-match.ts    # Levenshtein + substring matching
    ├── phone.ts          # E.164 validation, JID conversion
    ├── errors.ts         # Error classification and structured error responses
    ├── zod-schemas.ts    # Shared Zod schemas (PhoneArraySchema)
    └── debug.ts          # Debug logging utility
```

See [docs/architecture/OVERVIEW.md](./docs/architecture/OVERVIEW.md) for detailed architecture documentation.

## Questions?

Feel free to open an issue for any questions about contributing.

---

**AI Authors:** Qwen3-Coder-Next • MiniMax-M2.7 • Qwen3.5 • Nemotron-3-Super  
**Director:** Benjamin Alloul — [Benjamin.Alloul@gmail.com](mailto:Benjamin.Alloul@gmail.com)
