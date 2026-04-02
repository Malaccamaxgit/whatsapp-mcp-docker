---
layout: default
title: Troubleshooting
parent: Guides
nav_order: 3
description: "Common issues, diagnostic steps, and recovery procedures for WhatsApp MCP Server."
---

# Troubleshooting Guide

> **Purpose:** Common issues, diagnostic steps, and recovery procedures for WhatsApp MCP Server.

## Quick Reference

| Symptom | Likely Cause | Recovery Time | Action |
|---------|--------------|---------------|--------|
| `Not connected` | Session expired | 2-5 min | Call `authenticate` |
| `Rate limit exceeded` | Too many requests | 60 sec | Wait and retry |
| `Authentication failed` | Wrong phone format | Immediate | Fix phone number format |
| `Media download failed` | Media expired on server | N/A | Request resend |
| `Database write failed` | Disk full or permissions | 5-10 min | Check disk space |

---

## Session and Connection Issues

### Session Expired

**Symptoms:**
- `get_connection_status` returns `Connected: No`
- Error message: `WhatsApp not connected. Use the authenticate tool first.`
- Logout reason: `session_expired`, `logged_out`, or `device_removed`

**Cause:**
- WhatsApp sessions expire after ~20 days of inactivity
- User unlinked device from WhatsApp mobile app
- Another device replaced the session

**Recovery:**
1. Check connection status:
   ```
   get_connection_status
   ```

2. Re-authenticate with phone number:
   ```
   authenticate({ phoneNumber: "+1234567890" })
   ```

3. Enter the pairing code in WhatsApp mobile:
   - Open WhatsApp > Settings > Linked Devices
   - Tap "Link a Device" > "Link with phone number instead"
   - Enter the 8-digit code

**Time to recover:** 2-5 minutes

---

### Connection Lost (Temporary)

**Symptoms:**
- `get_connection_status` returns `Connected: No`
- Logout reason: `connection_lost`
- Error message: `WhatsApp temporarily disconnected`

**Cause:**
- Network interruption
- WhatsApp server maintenance
- Container restart

**Recovery:**
- **Automatic:** Server attempts reconnection with exponential backoff (5 sec, 10 sec, 20 sec, max 30 sec)
- **Manual:** If auto-reconnect fails after 5 attempts, call `authenticate` to re-link

**Time to recover:** 5-30 seconds (automatic), 2-5 minutes (manual)

---

### Authentication Failed

**Symptoms:**
- Pairing code request fails immediately
- Error: `Authentication failed: <reason>`
- Cooldown message: `Next retry available in X seconds`

**Cause:**
- Invalid phone number format
- Rate limit exceeded (5 attempts per 30 min)
- WhatsApp server rejection

**Recovery:**

1. **Phone number format:**
   - Must be E.164 format: `+` followed by country code and number
   - No spaces, dashes, or parentheses
   - Examples:
     - ✅ `+15145551234` (Canada)
     - ✅ `+353871234567` (Ireland)
     - ❌ `0612345678` (missing country code)
     - ❌ `(514) 555-1234` (local format)

2. **Rate limit cooldown:**
   - Wait for cooldown period to expire (starts at 60s, doubles each attempt, capped at 900s)
   - Cooldown increases after each failed attempt
   - Max cooldown: 15 minutes (900 seconds)

3. **QR fallback:**
   - If pairing code fails, server automatically falls back to QR code
   - Scan QR with WhatsApp > Linked Devices > Link a Device

**Time to recover:** Immediate (format fix), 1-15 minutes (cooldown)

---

## Media Issues

### Media Download Failed

**Symptoms:**
- `download_media` returns error
- Message: `Failed to download media: <reason>`

**Causes and Solutions:**

1. **Media expired on WhatsApp servers:**
   - WhatsApp stores media for ~30 days only
   - After expiry, download fails permanently
   - **Solution:** Request sender to resend the message

2. **No media metadata stored:**
   - Message received before metadata tracking was enabled
   - **Solution:** Cannot recover; media not tracked

3. **Database unavailable:**
   - Cannot retrieve media metadata
   - **Solution:** Check database health (see Database Issues below)

**Time to recover:** N/A (expired media), Immediate (metadata issue)

---

### File Upload Rejected

**Symptoms:**
- `send_file` returns error
- Message: `Upload denied: <reason>`

**Causes:**

1. **Path outside allowed directories:**
   - Files must be within `/data/sessions/media` or `/tmp`
   - **Solution:** Move file to allowed directory

2. **Dangerous file extension:**
   - Blocked extensions: `.exe`, `.bat`, `.ps1`, `.sh`, `.cmd`, `.scr`, etc.
   - **Solution:** Use safe file types (images, videos, documents)

3. **Sensitive file pattern:**
   - Database files (`.db`), credentials (`.env`), keys (`.key`, `.pem`)
   - **Solution:** Do not send system files via WhatsApp

4. **Magic bytes mismatch:**
   - File content doesn't match declared type
   - Example: Text file with `.jpg` extension
   - **Solution:** Use correct file extension or re-export file

**Time to recover:** Immediate (fix path/extension)

---

### Media Quota Exceeded

**Symptoms:**
- `download_media` returns error
- Message: `Media storage quota exceeded (X MB / 512 MB)`

**Cause:**
- Media directory reached 512 MB limit

**Recovery:**
1. Check media directory size:
   ```bash
   docker exec -it <container> du -sh /data/sessions/media/
   ```

2. Delete old media files:
   ```bash
   docker exec -it <container> rm -rf /data/sessions/media/image/*.jpg
   ```

3. Or wait for auto-purge (if `MESSAGE_RETENTION_DAYS` is set)

**Time to recover:** 5-10 minutes

---

## Database Issues

### Database Locked

**Symptoms:**
- Slow responses
- Occasional `Database is locked` errors

**Cause:**
- SQLite WAL mode allows concurrent reads but single writer
- Write lock held too long

**Recovery:**
- **Automatic:** SQLite retries with exponential backoff
- **Manual:** Restart container if persistent
   ```bash
   docker compose restart whatsapp-mcp-docker
   ```

**Time to recover:** < 1 second (automatic), 30 seconds (restart)

---

### Database Corruption

**Symptoms:**
- `Database disk I/O error`
- Unable to read/write messages
- Container logs show SQLite errors

**Cause:**
- Disk failure
- Container killed during write operation
- Filesystem corruption

**Recovery:**
1. **Backup current database:**
   ```bash
   docker cp <container>:/data/sessions/messages.db ./messages.db.backup
   ```

2. **Delete and re-authenticate:**
   ```bash
   docker compose down
   docker volume rm whatsapp-mcp-docker_whatsapp-sessions
   docker compose up -d
   authenticate({ phoneNumber: "+..." })
   ```

3. **Data loss:** Messages will be lost; session must be re-established

**Time to recover:** 5-10 minutes

---

### Audit Logging Unavailable

**Symptoms:**
- Logs show: `[AUDIT] Database unavailable - logging to stderr only`
- Audit trail incomplete

**Cause:**
- Audit database file inaccessible
- Permissions issue
- Disk full

**Recovery:**
1. Check audit database path:
   ```bash
   docker exec -it <container> ls -la /data/audit/
   ```

2. Check disk space:
   ```bash
   docker exec -it <container> df -h /data
   ```

3. Fix permissions (if needed):
   ```bash
   docker exec -it <container> chown -R mcp:mcp /data/audit
   ```

**Note:** Tool operations continue; only audit logging is affected

**Time to recover:** 5-10 minutes

---

## Rate Limiting

### Message Rate Limit

**Symptoms:**
- `send_message` returns error
- Message: `Rate limit exceeded (60 messages/min). Try again in Xs.`

**Cause:**
- Exceeded 60 messages per minute limit

**Recovery:**
- Wait for rate limit window to reset (60 seconds)
- Rate limit is sliding window (oldest message drops after 60 sec)

**Time to recover:** 60 seconds

---

### Download Rate Limit

**Symptoms:**
- `download_media` returns error
- Message: `Download rate limit exceeded (30/min)`

**Cause:**
- Exceeded 30 downloads per minute

**Recovery:**
- Wait for rate limit window to reset

**Time to recover:** 60 seconds

---

### Authentication Rate Limit

**Symptoms:**
- `authenticate` returns error
- Message: `Too many authentication attempts (5 per 30 min)`

**Cause:**
- Exceeded 5 authentication attempts per 30 minutes

**Recovery:**
- Wait for cooldown to expire (up to 30 minutes)
- Cooldown increases after each failed attempt

**Time to recover:** 5-30 minutes

---

## Search Issues

### No Search Results

**Symptoms:**
- `search_messages` returns `No messages found`
- Expected messages exist

**Causes:**

1. **FTS5 index unavailable:**
   - Fallback to LIKE search (slower, less accurate)
   - **Solution:** Check logs for FTS errors

2. **Special characters in query:**
   - FTS5 special chars: `" * ( ) + - : ^ ~`
   - **Solution:** Use quotes for exact phrases: `"exact phrase"`

3. **Encrypted messages:**
   - FTS5 index stores plaintext even with encryption
   - **Solution:** No issue; search works with encrypted messages

**Time to recover:** Immediate

---

## Tool-Specific Issues

### request_approval Timeout

**Symptoms:**
- Approval expires before response
- `check_approvals` shows status: `expired`

**Cause:**
- Default timeout: 300 seconds (5 minutes)
- Recipient didn't respond in time

**Recovery:**
1. Create new approval request with longer timeout:
   ```
   request_approval({
     to: "+1234567890",
     action: "Deploy v2.0",
     details: "...",
     timeout: 600  // 10 minutes
   })
   ```

**Time to recover:** Immediate (new request)

---

### list_chats Empty Results

**Symptoms:**
- `list_chats` returns no chats
- WhatsApp has active conversations

**Causes:**

1. **No messages received yet:**
   - Chats created only when messages arrive
   - **Solution:** Send/receive a message first

2. **Filter too restrictive:**
   - Filter parameter excludes all chats
   - **Solution:** Remove filter or use broader term

**Time to recover:** Immediate

---

## Diagnostic Commands

### Check Container Health

```bash
# View container status
docker compose ps

# Check health check status
docker inspect --format='{{.State.Health.Status}}' <container_id>

# View recent logs
docker compose logs --tail 50 whatsapp-mcp-docker
```

### Check Database Status

```bash
# Enter container (note: this is a minimal Alpine image)
docker exec -it <container_id> sh

# Check database files exist and have reasonable size
ls -la /data/sessions/
ls -la /data/audit/

# sqlite3 is NOT included in the runtime image
# To inspect the database, copy it out first:
docker cp <container_id>:/data/sessions/messages.db ./messages-inspect.db
# Then open it locally with your sqlite3 client
```

### Check Network Connectivity

```bash
# The runtime image does not include ping or curl
# Check connectivity via logs instead:
docker compose logs whatsapp-mcp-docker | grep -E "(connect|disconnect|TLS|WebSocket)"

# Or inspect from your host (outside the container):
curl -I https://web.whatsapp.com
```

---

## Recovery Procedures

### Full Reset (Nuclear Option)

When all else fails, complete reset:

```bash
# Stop container
docker compose down

# Remove all volumes (DATA LOSS)
docker volume rm whatsapp-mcp-docker_whatsapp-sessions
docker volume rm whatsapp-mcp-docker_whatsapp-audit

# Restart fresh
docker compose up -d

# Re-authenticate
authenticate({ phoneNumber: "+..." })
```

**Time to recover:** 10-15 minutes  
**Data loss:** All messages, sessions, audit logs

---

## Getting Help

### Collect Diagnostic Information

1. **Container logs:**
   ```bash
   docker compose logs --tail 200 whatsapp-mcp-docker > logs.txt
   ```

2. **Connection status:**
   ```
   get_connection_status
   ```

3. **Recent audit logs:**
   - Check stderr output for `[AUDIT]` entries

4. **Database stats:**
   ```bash
   docker cp <container_id>:/data/sessions/messages.db ./temp-check.db && sqlite3 ./temp-check.db "SELECT COUNT(*) FROM messages;"
   ```

### Contact

- **Technical Contact:** Benjamin Alloul — [Benjamin.Alloul@gmail.com](mailto:Benjamin.Alloul@gmail.com)
- **Documentation:** See `docs/architecture/OVERVIEW.md`
- **Privacy:** See `PRIVACY.md`

---

**Version:** 1.0  
**Last Updated:** April 1, 2026
