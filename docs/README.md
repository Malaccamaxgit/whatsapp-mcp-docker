# Documentation Index

> **Purpose** — Central index for all WhatsApp MCP Server documentation. This project runs via [Docker MCP Toolkit](https://docs.docker.com/ai/mcp-catalog-and-toolkit/).

---

## For Users

| Document | Description |
|----------|-------------|
| [../README.md](../README.md) | Features, installation, quick start |
| [../CHANGELOG.md](../CHANGELOG.md) | Release history |
| [API.md](API.md) | Full MCP tool API reference (all 32 tools) |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Symptom → cause → fix guide |
| [../PRIVACY.md](../PRIVACY.md) | Privacy policy and data handling |
| [interactive-phone-tests.html](interactive-phone-tests.html) | Interactive manual test checklist |

---

## For Developers

### Guides

| Document | Description |
|----------|-------------|
| [guides/DEVELOPER.md](guides/DEVELOPER.md) | Build, test, deploy, and extend procedures |

### Architecture

| Document | Description |
|----------|-------------|
| [architecture/OVERVIEW.md](architecture/OVERVIEW.md) | High-level architecture, component overview, data flow |

### Contributing

| Document | Description |
|----------|-------------|
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Contribution guidelines, coding standards |
| [../SECURITY.md](../SECURITY.md) | Security policy, vulnerability reporting |

---

## Testing

| Document | Description |
|----------|-------------|
| [guides/DEVELOPER.md#testing](guides/DEVELOPER.md#testing) | Test layers, Docker test runner, CI integration |
| [testing/TESTING.md](testing/TESTING.md) | Test strategy, structure, auth scenarios, and commands |
| [guides/ERRORS.md](guides/ERRORS.md) | Error taxonomy and recovery guidance |

Tests run inside Docker via `tester-container` — unit, integration, and e2e layers.

---

## Bug Reports & Known Issues

| Document | Description |
|----------|-------------|
| [bugs/BUG-qr-code-not-shown-in-cursor.md](bugs/BUG-qr-code-not-shown-in-cursor.md) | authenticate blocking in Cursor — FIXED |
| [bugs/BUG-self-account-messages-not-received.md](bugs/BUG-self-account-messages-not-received.md) | wait_for_message / approvals failing — FIXED |
| [bugs/BUG-websocket-not-connected.md](bugs/BUG-websocket-not-connected.md) | WebSocket connection errors |

---

## Configuration

| File | Description |
|------|-------------|
| [../docker-compose.yml](../docker-compose.yml) | Docker Compose stack with security hardening + test service |
| [../whatsapp-mcp-docker-server.yaml](../whatsapp-mcp-docker-server.yaml) | Docker MCP Toolkit server definition (catalog registration) |
| [../.env.example](../.env.example) | Environment variable template (docker-compose fallback) |
| [../Dockerfile](../Dockerfile) | 4-stage Docker image (prod-deps → builder → test → runtime, ~80 MB runtime) |
| [../package.json](../package.json) | Node.js dependencies and scripts |

---

## Quick Links

| Link | Description |
|------|-------------|
| [GitHub Repository](https://github.com/Malaccamaxgit/whatsapp-mcp-docker) | Source code, issues, discussions |
| [GitHub Issues](https://github.com/Malaccamaxgit/whatsapp-mcp-docker/issues) | Bug reports, feature requests |
| [GitHub Discussions](https://github.com/Malaccamaxgit/whatsapp-mcp-docker/discussions) | Community discussions, Q&A |
| [Docker MCP Toolkit Docs](https://docs.docker.com/ai/mcp-catalog-and-toolkit/) | Docker MCP integration |
| [Model Context Protocol](https://modelcontextprotocol.io/) | MCP specification |

---

**AI Authors:** Qwen3-Coder-Next • MiniMax-M2.7 • Qwen3.5 • Nemotron-3-Super  
**Director:** Benjamin Alloul — [Benjamin.Alloul@gmail.com](mailto:Benjamin.Alloul@gmail.com)
