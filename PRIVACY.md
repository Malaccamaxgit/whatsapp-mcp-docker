# Privacy and Data Protection

> **Compliance:** This document addresses requirements under Quebec Law 25, PIPEDA (Canada), and Alberta PIPA.

## Data Collection and Storage

### What We Collect

The WhatsApp MCP Server collects and stores the following data:

| Data Type | Source | Storage Location | Encryption |
|-----------|--------|------------------|------------|
| **Message bodies** | WhatsApp messages | SQLite (`messages.body`) | ✅ AES-256-GCM (optional) |
| **Sender names** | WhatsApp push names | SQLite (`messages.sender_name`) | ✅ AES-256-GCM (optional) |
| **Chat metadata** | WhatsApp chat list | SQLite (`chats` table) | ⚠️ Plaintext (last_message_preview encrypted) |
| **Media files** | WhatsApp media downloads | Filesystem (`/data/sessions/media/`) | ⚠️ Plaintext |
| **Session keys** | WhatsApp authentication | SQLite (`/data/sessions/session.db`) | ⚠️ Plaintext |
| **Approval requests** | User-generated | SQLite (`approvals` table) | ✅ AES-256-GCM (action, details, response_text) |
| **Audit logs** | Tool invocations | SQLite (`/data/audit/audit.db`) | ⚠️ Plaintext |

### Data Minimization

**What we do:**
- Store only messages received through the connected WhatsApp account
- Retain only metadata necessary for search and retrieval (JIDs, timestamps, message IDs)
- Support automatic data purging via `MESSAGE_RETENTION_DAYS`

**Limitations:**
- **Full-text search index (FTS5)** stores plaintext message bodies to enable search functionality, even when field-level encryption is enabled. This is a technical requirement of SQLite FTS5.
- **Media files** are stored as plaintext on disk for performance reasons. Only media metadata (`media_raw_json`) is encrypted.
- **WhatsApp session database** (`session.db`) containing authentication keys is stored unencrypted.

## Encryption

### Field-Level Encryption (Optional)

When `DATA_ENCRYPTION_KEY` environment variable is set:

- ✅ **Encrypted fields:** `messages.body`, `messages.sender_name`, `messages.media_raw_json`, `chats.last_message_preview`, `approvals.action`, `approvals.details`, `approvals.response_text`
- ✅ **Algorithm:** AES-256-GCM with SHA-256 key derivation
- ✅ **Prefix detection:** Encrypted values prefixed with `enc:` for migration compatibility

### Encryption Limitations

| Component | Status | Reason |
|-----------|--------|--------|
| FTS5 search index | ⚠️ **PLAINTEXT - SECURITY CONSIDERATION** | SQLite FTS5 requires plaintext for search operations. **This is a compliance consideration for high-security deployments under Quebec Law 25 data minimization.** |
| Media files on disk | ⚠️ Plaintext | Performance; encryption would add latency to media operations |
| Session database | ⚠️ Plaintext | WhatsApp protocol requirement; session keys managed by whatsmeow-node |
| Audit logs | ⚠️ Plaintext | Compliance auditing requires readable logs |

**⚠️ DEPLOYMENT CONSIDERATION:** The FTS5 plaintext index stores all message bodies in searchable plaintext form, even when field-level encryption is enabled. This affects data minimization under Quebec Law 25 and PIPEDA for deployments handling sensitive personal information.

**Technical Details:**
- The FTS5 virtual table (`messages_fts`) stores plaintext message bodies to enable full-text search functionality
- This is a technical limitation of SQLite FTS5, which cannot search encrypted content
- When encryption is enabled, message bodies are encrypted in the main `messages` table but stored in plaintext in the FTS index
- The plaintext index is created and managed in `src/whatsapp/store.js` lines 92-98

**Mitigation Strategies (choose one):**
1. **Host-level volume encryption** (recommended): Enable BitLocker (Windows), FileVault (macOS), or dm-crypt/LUKS (Linux) for Docker volumes
2. **Disable FTS5 search** (if search not needed): Remove FTS5 index creation in `src/whatsapp/store.js`
3. **Application-layer search** (future enhancement): Implement encrypted search alternative
4. **Database file access control**: Restrict filesystem access to `/data/sessions/messages.db` and associated WAL files

## Data Retention

### Default Retention Policy

| Data Type | Default Retention | Configurable |
|-----------|-------------------|--------------|
| Messages | **90 days** | ✅ `MESSAGE_RETENTION_DAYS` (default: 90) |
| Media files | **90 days** | ✅ Auto-deleted with parent message |
| Approval requests | **90 days** | ✅ Auto-deleted after timeout + retention period |
| Audit logs | Indefinite | ⚠️ Manual cleanup required |
| Chat metadata | Indefinite | ⚠️ Retained for contact resolution |

### Auto-Purge Mechanism

The server automatically purges old data:

```javascript
// Runs every hour by default
startAutoPurge(retentionDays = 90, intervalMs = 3600_000);
```

**What gets purged:**
- Messages older than `retentionDays`
- Media files associated with purged messages
- Approval requests older than `retentionDays`

**What is NOT purged:**
- Chat metadata (contacts, groups)
- Audit logs
- Session data

### Changing Retention Period

```bash
# Set 30-day retention
docker mcp profile config <profile> \
  --set whatsapp-mcp-docker.message_retention_days=30

# Disable auto-purge (not recommended for compliance)
docker mcp profile config <profile> \
  --set whatsapp-mcp-docker.message_retention_days=0
```

## Cross-Border Data Transfers

### Data Flow

```
WhatsApp Servers (Global)
    ↓ (TLS encryption)
whatsmeow-node (Go binary)
    ↓ (JSON-line IPC)
WhatsApp MCP Server (Docker container)
    ↓ (local writes)
SQLite databases + media files (local filesystem)
```

### Geographic Considerations

- **WhatsApp servers** are globally distributed; message data may traverse international borders during transmission
- **Local storage** occurs on the user's machine (Docker Desktop) or designated deployment environment
- **Data residency** is determined by where the Docker container runs

### Safeguards

- All WhatsApp protocol communication uses TLS encryption
- Data stored at rest can be encrypted via `DATA_ENCRYPTION_KEY`
- Docker volumes can be encrypted at the host level (BitLocker, FileVault, etc.)
- No data is transmitted to third-party services beyond WhatsApp's infrastructure

## Individual Rights

### Access Rights (PIPEDA Principle 9)

Individuals have the right to access their personal information. The server supports data export:

**✅ Implemented Feature:**
- Export chat history for a specific contact/group via `export_chat_data` tool
- Supports JSON and CSV formats
- Returns up to 10,000 most recent messages
- Designed for PIPEDA individual access rights compliance

**Usage:**
```javascript
// Export chat to JSON
export_chat_data({ jid: "1234567890@s.whatsapp.net", format: "json" })

// Export chat to CSV
export_chat_data({ jid: "1234567890@s.whatsapp.net", format: "csv" })
```

**Current Limitations:**
- Export limited to 10,000 messages per call
- Audit logs export not yet available (planned feature)

### Correction Rights (PIPEDA Principle 10)

- Message content is immutable (WhatsApp protocol limitation)
- Chat names are auto-resolved from WhatsApp; manual override available via future feature
- Audit logs are immutable by design (compliance requirement)

### Deletion Rights (Quebec Law 25, PIPEDA)

- Automatic deletion via `MESSAGE_RETENTION_DAYS` (default 90 days)
- Manual deletion supported via future admin tool
- Session deletion: Use the `disconnect` tool to log out and clear the session; re-link a new device with `authenticate`

### Data Portability

- SQLite database format is open and portable
- Messages can be exported to JSON/CSV via direct database queries
- Media files stored in standard formats (JPEG, MP4, OGG, PDF, etc.)

## Security Safeguards

### Technical Measures

| Safeguard | Implementation |
|-----------|----------------|
| **Encryption at rest** | AES-256-GCM for sensitive database fields |
| **Rate limiting** | 60 messages/min, 30 downloads/min, 5 auth attempts/30min |
| **Contact whitelist** | `ALLOWED_CONTACTS` env var restricts outbound messages |
| **File security** | Path traversal prevention, dangerous extension blocking, magic bytes verification |
| **Audit logging** | All tool invocations logged with timestamp and outcome |
| **Container hardening** | Non-root user, read-only filesystem, dropped capabilities |

### Organizational Measures

- **Access control:** Only authenticated WhatsApp users can access their own data
- **Logging:** All operations logged to audit trail
- **Incident response:** Audit log alerts when database unavailable

## Compliance Checklist

> ⚠️ **Hobby project disclaimer:** This checklist reflects best-effort implementation for a personal-use tool. It is **not a legal compliance certification**. Consult a privacy professional for actual compliance needs.


### Quebec Law 25

| Requirement | Status | Notes |
|-------------|--------|-------|
| Data minimization | ⚠️ Partial | FTS5 stores plaintext for search |
| Consent tracking | — N/A | User-operated personal tool |
| Retention policies | ✅ Implemented | Auto-purge with configurable retention |
| Cross-border disclosure | ⚠️ Noted | See "Cross-Border Data Transfers" section |
| Privacy impact assessment | ⚠️ Best effort | This document is that attempt |

### PIPEDA

| Requirement | Status | Notes |
|-------------|--------|-------|
| Personal information handling | ⚠️ Partial | Encryption available but FTS5 and media remain plaintext |
| Audit trail | ✅ Implemented | SQLite audit logging (plaintext) |
| Individual access rights | ✅ Implemented | `export_chat_data` tool (JSON/CSV, up to 10,000 messages) |
| Breach notification | ⚠️ Partial | Audit failure alerts to stderr |
| Accountability | ⚠️ Best effort | Audit logs and this documentation |

### Alberta PIPA

| Requirement | Status | Notes |
|-------------|--------|-------|
| Personal information protection | ⚠️ Partial | Field-level encryption available; FTS5 and media are plaintext |
| Reasonable purposes | ✅ Documented | Personal WhatsApp messaging integration |
| Data accuracy | ⚠️ Partial | Async name resolution may lag |
| Security safeguards | ⚠️ Best effort | Multiple layers, but not a hardened system |

## Known Limitations and Risks

### High Priority

1. **FTS5 Plaintext Index**
   - **Risk:** Message bodies searchable in plaintext even with encryption enabled
   - **Impact:** If database file compromised, message content recoverable from FTS index
   - **Compliance:** Affects data minimization under Quebec Law 25 and PIPEDA for sensitive deployments
   - **Mitigation:** 
     - Enable host-level volume encryption (BitLocker, FileVault, dm-crypt)
     - Restrict database file access to container user only
     - Consider disabling FTS5 if search functionality not required
     - Monitor for future application-layer encrypted search alternatives

2. **Unencrypted Media Files**
   - **Risk:** Downloaded images/videos stored as plaintext
   - **Impact:** Sensitive media accessible if filesystem compromised
   - **Mitigation:** Store media in encrypted volume; regular cleanup via auto-purge

3. **Session Database Exposure**
   - **Risk:** `session.db` contains WhatsApp authentication keys
   - **Impact:** Session hijacking possible if file accessed
   - **Mitigation:** Docker volume permissions; host-level encryption

### Medium Priority

4. **Audit Log Gaps**
   - **Risk:** Audit logging fails silently if database unavailable
   - **Impact:** Incomplete compliance trail
   - **Mitigation:** Enhanced alerting added (see `src/security/audit.js`)

5. **Partial Export Coverage**
   - **Risk:** `export_chat_data` exports one chat at a time (up to 10,000 messages); audit log export is not yet available
   - **Impact:** Multi-chat or audit log exports require manual SQL queries
   - **Mitigation:** Run `export_chat_data` for each chat separately; audit log export is a planned feature

## Recommended Security Practices

### Essential

1. **Enable field-level encryption:**
   ```bash
   docker mcp secret set whatsapp-mcp-docker.data_encryption_key "your-strong-passphrase"
   ```

2. **Set retention period:**
   ```bash
   docker mcp profile config <profile> \
     --set whatsapp-mcp-docker.message_retention_days=90
   ```

3. **Enable host-level volume encryption:**
   - Windows: BitLocker for Docker volumes
   - macOS: FileVault for Docker volumes
   - Linux: dm-crypt/LUKS for Docker volumes

### Optional

4. **Restrict allowed contacts:**
   ```bash
   docker mcp profile config <profile> \
     --set whatsapp-mcp-docker.allowed_contacts="+1234567890,+0987654321"
   ```

5. **Monitor audit logs:**
   ```bash
   docker compose logs -f whatsapp-mcp-docker | grep '\[AUDIT\]'
   ```

6. **Regular backups:**
   - Backup `/data/sessions/messages.db` with encryption
   - Backup `/data/audit/audit.db` for compliance
   - Exclude `/data/sessions/session.db` (can be recreated via re-authentication)

## Contact and Accountability

**Data Controller:** User deploying this Docker container

**Technical Contact:** Benjamin Alloul — [Benjamin.Alloul@gmail.com](mailto:Benjamin.Alloul@gmail.com)

**Version:** 1.0  
**Last Updated:** April 1, 2026
