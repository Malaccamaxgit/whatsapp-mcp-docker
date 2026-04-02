# Security Policy

> **Security measures** — Container isolation via Docker MCP Toolkit, field-level encryption, auto-purge, file security, permission controls, and audit logging.

This server runs inside [Docker MCP Toolkit](https://docs.docker.com/ai/mcp-catalog-and-toolkit/), which provides an isolation boundary between MCP clients and the WhatsApp protocol layer. WhatsApp session keys, messages, and media are confined to Docker volumes and never touch the host filesystem directly.

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **GitHub Security Advisories** (preferred): Go to the "Security" tab → "Advisories" → "Report a vulnerability"
2. **Email**: Send details to **benjamin.alloul@gmail.com** with subject `SECURITY: whatsapp-mcp-docker`

**Please do not open public GitHub issues for security vulnerabilities.**

### What to Include

| Item | Description |
|------|-------------|
| Description | Vulnerability description |
| Reproduction | Steps to reproduce |
| Environment | Docker Desktop version, MCP client |
| Evidence | Proof of concept or screenshots |

### Response Expectations

This is a solo-maintained open source project. Security reports are reviewed on a **best-effort basis** as time permits. There are no guaranteed response timelines or SLAs.

## Security Architecture

### Docker MCP Toolkit Isolation

Running via Docker MCP Toolkit provides a security boundary not available when running MCP servers directly on the host:

| Risk | Docker MCP Toolkit | Running on Host |
|------|-------------------|-----------------|
| **Filesystem access** | Container sees only its own read-only root + mounted volumes | Server process has full access to your user's files |
| **Process isolation** | Server runs in its own PID/network namespace | Server shares your PID namespace and network |
| **Credential containment** | WhatsApp session keys confined to Docker volumes; encryption key in OS Keychain | Session keys and secrets stored somewhere in your home directory |
| **Blast radius** | If compromised, attacker is limited to a minimal Alpine container with no capabilities | If compromised, attacker has your full user-level access |
| **Cleanup** | `docker compose down -v` removes all data and the container | Must manually find and remove all artifacts |

### Container Hardening

| Measure | Implementation |
|---------|---------------|
| Non-root user | UID 1001, GID 1001 (`mcp` user) |
| Capabilities | All dropped (`cap_drop: ALL`) |
| Filesystem | Read-only root (`read_only: true`) |
| Writable paths | Only `/data/sessions` and `/data/audit` via volumes, `/tmp` via tmpfs |
| Privileged mode | Disabled (`privileged: false`) |
| Log limits | 10 MB max, 3 files rotation |

### Protocol Security

| Measure | Description |
|---------|-------------|
| Native protocol | whatsmeow-node communicates directly via WhatsApp's protocol (no browser) |
| Proper TLS | Standard TLS connections to WhatsApp servers |
| No unsafe flags | No sandbox bypasses or certificate error suppression |

### Secrets Management

| Method | Description |
|--------|-------------|
| **Docker MCP secrets** (preferred) | `docker mcp secret set whatsapp-mcp-docker.data_encryption_key` stores the encryption key in the OS Keychain. Docker MCP Gateway injects it as an environment variable at container start. |
| **Docker Desktop UI** | Configure secrets from MCP Toolkit → WhatsApp MCP → Secrets |
| **`.env` file** (fallback) | For docker-compose workflows, set `DATA_ENCRYPTION_KEY` in `.env` (excluded from git) |

### Data Protection at Rest

| Measure | Implementation |
|---------|---------------|
| **Field-level encryption** | AES-256-GCM via `node:crypto`. Encrypts message bodies, sender names, media metadata, approval details, and chat previews. Enabled via `DATA_ENCRYPTION_KEY`. |
| **Auto-purge** | Deletes messages, media files, and expired approvals older than `MESSAGE_RETENTION_DAYS`. Runs on startup and hourly. |
| **Encrypted fields** | `messages.body`, `messages.sender_name`, `messages.media_raw_json`, `chats.last_message_preview`, `approvals.action`, `approvals.details`, `approvals.response_text` |
| **Not encrypted** (needed for queries) | JIDs, timestamps, read/unread flags, media type |
| **Plaintext coexistence** | Values prefixed with `enc:` are encrypted; unprefixed values pass through unchanged. |

**⚠️ CRITICAL LIMITATION - FTS5 Plaintext Index:** The SQLite FTS5 full-text search index stores message bodies in plaintext even when field-level encryption is enabled. This is a technical requirement of SQLite FTS5 but violates data minimization principles under Quebec Law 25 and PIPEDA.

**Deployment Requirement:** Host-level volume encryption (BitLocker, FileVault, or dm-crypt/LUKS) is **recommended** for deployments handling sensitive personal information to compensate for FTS5 plaintext storage.

**Threat model:** Field-level encryption protects against volume access (container left behind, backup leaked, volume mounted elsewhere). It does not protect against an attacker with root access to the Docker host, who could read the encryption key from `docker inspect`.

### File Security

| Protection | Implementation |
|------------|---------------|
| **Upload path confinement** | `send_file` only allows files from `/data/sessions/media/` and `/tmp`. Blocks exfiltration of `session.db`, `messages.db`, and other sensitive files. |
| **Sensitive file blocklist** | Patterns matching `session.db`, `messages.db`, `audit.db`, `.key`, `.pem`, `.env`, `credentials` are rejected. |
| **Download path traversal** | Downloaded media paths are validated to stay within `/data/sessions/media/`. |
| **Filename sanitization** | Strips `..`, control characters, and path separators. Caps at 200 characters. |
| **Dangerous extension blocklist** | 30 extensions blocked: `.exe`, `.bat`, `.cmd`, `.ps1`, `.dll`, `.vbs`, `.lnk`, etc. |
| **Magic bytes verification** | Checks file headers (JPEG, PNG, GIF, WEBP, OGG, MP3, PDF, ZIP) against the declared media type before upload. |
| **Media storage quota** | Total media directory capped at 512 MB. |

### Rate Limiting & Abuse Prevention

| Control | Configuration | Default |
|---------|---------------|---------|
| **Outbound message rate** | `RATE_LIMIT_PER_MIN` | 10 per minute |
| **Media download rate** | Hardcoded | 20 per minute |
| **Auth attempt limit** | Hardcoded | 5 per 30 minutes |
| **Auth backoff** | Exponential: 60s → 120s → 240s → 480s → 900s | Resets on success |
| **Contact whitelist** | `ALLOWED_CONTACTS` | Empty (allow all) |
| **Tool disabling** | `DISABLED_TOOLS` | Empty (all enabled) |

### Input Validation

| Measure | Description |
|---------|-------------|
| Schema validation | All tool inputs validated with Zod schemas and `.max()` length limits |
| Message body | 4,096 characters max |
| Caption | 1,024 characters max |
| Search query | 500 characters max |
| File size | 64 MB max per upload |
| Mark-read IDs | 500 per call max |
| Phone normalization | E.164 format validation with detection of common mistakes |
| SQL injection | Parameterized queries via `better-sqlite3` prepared statements |

### Audit Logging

| Measure | Description |
|---------|-------------|
| Output channel | `stderr` only (stdout reserved for MCP stdio) |
| Sensitive data | Message content truncated to 60 chars in logs |
| Structured audit | SQLite-based audit log with tool name, action, status, and metadata |
| Security events | Failed auth, rate limit hits, path denials, dangerous extensions — all logged |

## Environment Variables

Configurable via Docker MCP Toolkit UI/CLI or `docker-compose.yml`. See [Configuration](./README.md#configuration) in README.md for the full reference.

| Variable | Purpose | Default |
|----------|---------|---------|
| `STORE_PATH` | Session + message database directory | `/data/sessions` |
| `AUDIT_DB_PATH` | Audit log database path | `/data/audit/audit.db` |
| `RATE_LIMIT_PER_MIN` | Max outbound messages per minute | `10` |
| `DATA_ENCRYPTION_KEY` | Passphrase for AES-256-GCM field encryption | *(via `docker mcp secret set`)* |
| `MESSAGE_RETENTION_DAYS` | Auto-delete data older than N days | `90` |
| `ALLOWED_CONTACTS` | Phone whitelist (comma-separated, empty = all) | `""` |
| `DISABLED_TOOLS` | Tools to disable (comma-separated) | `""` |

## Dependencies

Dependencies are checked for known vulnerabilities:

| Method | Frequency |
|--------|-----------|
| `npm audit` | CI on push/PR and weekly |
| GitHub Dependabot | Automated alerts |

## Limitations

| Limitation | Description |
|------------|-------------|
| Unofficial API | WhatsApp does not officially support third-party clients |
| Session expiry | WhatsApp linked device sessions expire after ~20 days |
| Volume access | Anyone with Docker host access can read env vars via `docker inspect` |
| Rate limits | WhatsApp may rate-limit or ban accounts using unofficial clients |
| session.db | Managed by whatsmeow-node; cannot be encrypted by this application |

## Contact

| Issue Type | Contact |
|------------|---------|
| **AI Authors** | Qwen3-Coder-Next • MiniMax-M2.7 • Qwen3.5 • Nemotron-3-Super |
| **Director** | Benjamin Alloul |
| **Security Issues** | [Benjamin.Alloul@gmail.com](mailto:Benjamin.Alloul@gmail.com) |
| **General Issues** | [GitHub Issues](https://github.com/Malaccamaxgit/whatsapp-mcp-docker/issues) |
