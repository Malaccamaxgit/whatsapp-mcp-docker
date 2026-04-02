# Error Code Reference

> **Purpose** — Comprehensive error reference for WhatsApp MCP Server with recovery procedures and troubleshooting guidance.

---

## Error Classification

The server classifies errors into four categories to determine retry behavior and user guidance:

| Type | Retry? | User Action | Examples |
|------|--------|-------------|----------|
| **`transient`** | Yes (automatic) | Wait for auto-recovery | Network blips, temporary WhatsApp server issues |
| **`permanent`** | No | Re-authenticate required | Session expired, account banned, device removed |
| **`client_error`** | No | Fix input/configuration | Invalid phone number, file not found, permission denied |
| **`unknown`** | No | Check logs, report bug | Unexpected exceptions, internal errors |

---

## Error Codes by Layer

### Authentication Errors

| Error | Type | Code | Description | Recovery |
|-------|------|------|-------------|----------|
| `AUTH_RATE_LIMITED` | `transient` | 429 | Too many authentication attempts | Wait 10-15 minutes, then retry |
| `AUTH_PAIRING_FAILED` | `client_error` | 400 | Pairing code rejected by WhatsApp | Verify phone number format, ensure WhatsApp mobile app is open |
| `AUTH_QR_EXPIRED` | `transient` | 408 | QR code timed out | Request new QR code via `authenticate` tool |
| `AUTH_SESSION_EXPIRED` | `permanent` | 401 | WhatsApp session expired (~20 days inactivity) | Call `authenticate` with phone number to re-link |
| `AUTH_DEVICE_REMOVED` | `permanent` | 410 | Device removed from WhatsApp account | Re-authenticate with `authenticate` tool |
| `AUTH_BANNED` | `permanent` | 403 | Account banned by WhatsApp | Contact WhatsApp support; do not retry |
| `AUTH_MULTIDEVICE_MISMATCH` | `permanent` | 409 | Multi-device state inconsistency | Re-authenticate; ensure primary device is connected |

**Recovery Flow:**
```
AUTH_SESSION_EXPIRED → Call authenticate → Pairing code → Enter in WhatsApp → Connected
```

---

### Connection Errors

| Error | Type | Code | Description | Recovery |
|-------|------|------|-------------|----------|
| `CONNECTION_LOST` | `transient` | 503 | WebSocket disconnected | Auto-reconnect in 5 seconds |
| `CONNECTION_TIMEOUT` | `transient` | 504 | Connection timed out | Auto-retry with exponential backoff |
| `CONNECTION_DNS_FAILED` | `transient` | 502 | DNS resolution failed | Check container DNS; auto-retry |
| `CONNECTION_TLS_FAILED` | `transient` | 500 | TLS handshake failed | Check ca-certificates; auto-retry |
| `HEALTH_CHECK_FAILED` | `transient` | 503 | Health heartbeat detected silent disconnect | Auto-reconnect attempt |

**Auto-Recovery:**
The server automatically attempts reconnection for transient errors:
- **First retry:** 5 seconds delay
- **Second retry:** 10 seconds delay
- **Third retry:** 20 seconds delay
- **Max attempts:** 5 before giving up

---

### Messaging Errors

| Error | Type | Code | Description | Recovery |
|-------|------|------|-------------|----------|
| `MESSAGE_RATE_LIMITED` | `transient` | 429 | Exceeded RATE_LIMIT_PER_MIN | Wait until next minute; reduce send frequency |
| `MESSAGE_TOO_LONG` | `client_error` | 413 | Message exceeds 4096 characters | Shorten message; split into multiple messages |
| `MESSAGE_RECIPIENT_NOT_FOUND` | `client_error` | 404 | Fuzzy match found no candidates | Use exact JID or phone number |
| `MESSAGE_AMBIGUOUS_RECIPIENT` | `client_error` | 409 | Multiple fuzzy matches found | Specify exact contact name from candidates list |
| `MESSAGE_CONTACT_BLOCKED` | `client_error` | 403 | Recipient not in ALLOWED_CONTACTS whitelist | Add to whitelist or contact support |
| `MESSAGE_SEND_FAILED` | `transient` | 500 | WhatsApp server rejected message | Auto-retry once; check message content |
| `MESSAGE_NOT_CONNECTED` | `client_error` | 400 | WhatsApp not authenticated | Call `authenticate` tool first |

**Example Error Response:**
```json
{
  "isError": true,
  "content": [{
    "type": "text",
    "text": "Failed to send message: Recipient not found. Multiple contacts match 'John':\n  - \"John Smith\" → 15145551234@s.whatsapp.net\n  - \"John Doe\" → 353871234567@s.whatsapp.net\n\nCall send_message again with the exact JID as the \"to\" parameter."
  }]
}
```

---

### Media Errors

| Error | Type | Code | Description | Recovery |
|-------|------|------|-------------|----------|
| `MEDIA_RATE_LIMITED` | `transient` | 429 | Exceeded 20 downloads/minute | Wait 1 minute; retry |
| `MEDIA_FILE_NOT_FOUND` | `client_error` | 404 | File path does not exist | Verify file path; ensure file is in allowed directory |
| `MEDIA_PATH_TRAVERSAL` | `client_error` | 403 | Path outside allowed directories | Use absolute path within `/data/sessions/media/` or `/tmp` |
| `MEDIA_DANGEROUS_EXTENSION` | `client_error` | 403 | Blocked extension (.exe, .bat, etc.) | Rename file; extension is blocklisted for security |
| `MEDIA_MAGIC_MISMATCH` | `client_error` | 400 | File type doesn't match declaration | Verify file is valid image/video/audio/document |
| `MEDIA_QUOTA_EXCEEDED` | `client_error` | 413 | Exceeded 512 MB media storage quota | Delete old media via cleanup; request quota increase |
| `MEDIA_UPLOAD_FAILED` | `transient` | 500 | WhatsApp media upload failed | Auto-retry once; check file size (< 64 MB) |
| `MEDIA_DOWNLOAD_FAILED` | `transient` | 500 | WhatsApp media download failed | Auto-retry; media may have expired on WhatsApp servers |
| `MEDIA_TOO_LARGE` | `client_error` | 413 | File exceeds 64 MB limit | Compress file; WhatsApp has hard limit |

**Allowed Directories:**
- `/data/sessions/media/` — Persistent media storage
- `/tmp` — Temporary files (tmpfs, 100 MB)

**Blocked Extensions:**
`.exe`, `.bat`, `.ps1`, `.sh`, `.dll`, `.so`, `.cmd`, `.com`, `.pif`, `.scr`, `.vbs`, `.msi`, `.jar`, `.apk`, `.ipa`, `.dmg`, `.pkg`, `.deb`, `.rpm`, `.sys`, `.drv`, `.ocx`, `.cpl`, `.msp`, `.lnk`, `.reg`, `.inf`, `.scf`, `.action`, `.application`, `.gadget`, `.msu`, `.pcw`, `.theme`, `.themepack`, `.workflow`

---

### Search Errors

| Error | Type | Code | Description | Recovery |
|-------|------|------|-------------|----------|
| `SEARCH_QUERY_TOO_LONG` | `client_error` | 413 | Query exceeds 200 characters | Shorten search query |
| `SEARCH_NO_RESULTS` | N/A | 204 | No messages match query | Try different keywords; check spelling |
| `SEARCH_FTS_UNAVAILABLE` | `transient` | 503 | FTS5 index corrupted | Auto-fallback to LIKE search; reindex on next startup |

**FTS5 Query Syntax:**
```
# Keywords
deadline project

# Exact phrase
"project deadline"

# Boolean operators
deadline AND project
deadline OR meeting
deadline NOT friday

# Wildcards
deadl*
%deadline%
```

---

### Approval Errors

| Error | Type | Code | Description | Recovery |
|-------|------|------|-------------|----------|
| `APPROVAL_TIMEOUT` | `permanent` | 408 | Approval request timed out | Send new approval request |
| `APPROVAL_RECIPIENT_NOT_FOUND` | `client_error` | 404 | Cannot resolve recipient | Use exact JID or phone number |
| `APPROVAL_ALREADY_RESPONDED` | `client_error` | 409 | Approval already has response | Check status with `check_approvals` |
| `APPROVAL_INVALID_TIMEOUT` | `client_error` | 400 | Timeout outside 10-3600 seconds | Use valid timeout value |

**Approval Lifecycle:**
```
request_approval → pending → (APPROVE/DENY) → approved/denied
                              ↓ (timeout)
                            expired
```

---

### Database Errors

| Error | Type | Code | Description | Recovery |
|-------|------|------|-------------|----------|
| `DB_LOCKED` | `transient` | 503 | SQLite database locked | Auto-retry with WAL mode; wait 1 second |
| `DB_CORRUPT` | `permanent` | 500 | Database file corrupted | Restore from backup; contact support |
| `DB_DISK_FULL` | `transient` | 507 | No space left on device | Free disk space; increase volume size |
| `DB_MIGRATION_FAILED` | `permanent` | 500 | Schema migration error | Restore from backup; check logs |

**Database Locations:**
- Messages: `/data/sessions/messages.db`
- Session: `/data/sessions/session.db`
- Audit: `/data/audit/audit.db`

---

### Permission Errors

| Error | Type | Code | Description | Recovery |
|-------|------|------|-------------|----------|
| `PERMISSION_TOOL_DISABLED` | `client_error` | 403 | Tool disabled via DISABLED_TOOLS | Enable tool in configuration; use alternative |
| `PERMISSION_CONTACT_NOT_WHITELISTED` | `client_error` | 403 | Recipient not in ALLOWED_CONTACTS | Add to whitelist or contact admin |
| `PERMISSION_AUTH_THROTTLED` | `transient` | 429 | Too many failed auth attempts | Wait for exponential backoff (60s → 900s) |

**Auth Backoff Schedule** (doubles each failure, capped at 15 min):
- 1st failure: 60 seconds
- 2nd failure: 120 seconds
- 3rd failure: 240 seconds
- 4th failure: 480 seconds
- 5th+ failure: 900 seconds (max)

---

## MCP Notification Errors

The server sends MCP notifications for async events:

### `notifications/message_received`
Sent when a new message arrives.

```json
{
  "method": "notifications/message_received",
  "params": {
    "messageId": "ABC123XYZ",
    "from": "15145551234@s.whatsapp.net",
    "senderName": "John Smith",
    "timestamp": 1711824000
  }
}
```

### `notifications/disconnected`
Sent when WhatsApp session ends.

```json
{
  "method": "notifications/disconnected",
  "params": {
    "reason": "session_expired",
    "permanent": true,
    "message": "WhatsApp session ended (session_expired). Call the authenticate tool to re-link."
  }
}
```

**Permanent Disconnect Reasons:**
- `revoked` — User revoked device access
- `replaced` — Device replaced by another
- `banned` — Account banned by WhatsApp
- `unlinked` — User unlinked device manually
- `device_removed` — Device removed from account
- `logged_out` — Logout from primary device
- `multidevice_mismatch` — Multi-device state error

**Transient Disconnect Reasons:**
- `connection_lost` — Network connectivity lost
- `reconnect_failed` — Reconnection attempt failed
- `health_check_timeout` — Silent disconnect detected
- `connection_timeout` — Initial connection timed out

---

## Troubleshooting Guide

### "WhatsApp not connected" (400)

**Symptoms:**
- All messaging tools fail with "WhatsApp not connected"
- `get_connection_status` shows `connected: false`

**Causes:**
1. Never authenticated
2. Session expired
3. Permanent logout

**Recovery:**
```bash
# Check status
get_connection_status

# If not connected, authenticate
Authenticate WhatsApp with +1234567890
```

---

### "Rate limited" (429)

**Symptoms:**
- Messages fail with rate limit error
- Counter resets every minute

**Causes:**
- Exceeded `RATE_LIMIT_PER_MIN` (default: 10)

**Recovery:**
1. Wait until next minute window
2. Reduce message frequency
3. Increase limit in configuration (not recommended)

```bash
docker mcp profile config <profile> \
  --set whatsapp-mcp-docker.rate_limit_per_min=20
```

---

### "Session expired" (401)

**Symptoms:**
- `get_connection_status` shows `logoutReason: "session_expired"`
- `notifications/disconnected` received

**Causes:**
- ~20 days of WhatsApp inactivity
- Primary device logged out

**Recovery:**
```bash
# Re-authenticate
Authenticate WhatsApp with +1234567890
```

**Prevention:**
- Send/receive messages regularly
- Enable `AUTO_READ_RECEIPTS` to show activity

---

### "Media download failed" (500)

**Symptoms:**
- `download_media` fails with error

**Causes:**
1. Media expired on WhatsApp servers (> 30 days)
2. Network error during download
3. Insufficient storage quota

**Recovery:**
```bash
# Check if media metadata exists
list_messages --chat "John" --after "2026-03-01"

# If metadata exists, retry download
download_media --message_id "ABC123"

# If still fails, media may have expired
# Contact sender to resend
```

---

### "Health check failed" (503)

**Symptoms:**
- Container health check shows unhealthy
- Logs show "Health check detected silent disconnect"

**Causes:**
- WhatsApp WebSocket silent disconnect
- Go binary crashed or hung

**Recovery:**
1. Server auto-attempts reconnection (5 retries)
2. If all retries fail, check container logs
3. Restart container if needed

```bash
docker compose logs whatsapp-mcp-docker
docker compose restart whatsapp-mcp-docker
```

---

### "Database locked" (503)

**Symptoms:**
- Operations fail with "database is locked"
- Multiple concurrent operations

**Causes:**
- SQLite WAL mode contention
- Long-running queries blocking others

**Recovery:**
- Auto-retries after 1 second
- Usually resolves within 2-3 retries
- If persistent, restart container

```bash
docker compose restart whatsapp-mcp-docker
```

---

## Error Logging

All errors are logged to:
- **stderr:** Runtime errors with context
- **SQLite audit.db:** Tool invocations with success/failure status

**View Logs:**
```bash
docker compose logs whatsapp-mcp-docker
```

**Query Audit Log:**
```sql
SELECT timestamp, tool, action, details, success
FROM audit_logs
WHERE success = 0
ORDER BY timestamp DESC
LIMIT 100;
```

---

## Reporting Bugs

If you encounter an `unknown` error type or unexpected behavior:

1. **Collect information:**
   - Error message and code
   - Container logs (`docker compose logs`)
   - `get_connection_status` output
   - Steps to reproduce

2. **Check existing issues:**
   https://github.com/Malaccamaxgit/whatsapp-mcp-docker/issues

3. **Create new issue:**
   Include all collected information + server version

---

## Version Information

| Version | Date | Changes |
|---------|------|---------|
| 0.1.1 | 2026-04-01 | Initial error reference |

---

**See Also:**
- [SECURITY.md](../../SECURITY.md) — Security policy
- [PRIVACY.md](../../PRIVACY.md) — Privacy and data handling
- [docs/architecture/OVERVIEW.md](../architecture/OVERVIEW.md) — System architecture
