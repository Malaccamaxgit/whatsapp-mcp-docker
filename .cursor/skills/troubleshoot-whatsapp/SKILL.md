---
name: troubleshoot-whatsapp
description: Diagnose and fix common issues with the WhatsApp MCP Docker server — container crashes, connection failures, authentication errors, search problems, media failures, and session loss. Use when the user reports an error, unexpected behavior, or asks why something isn't working.
---

# Troubleshoot — WhatsApp MCP Docker

## Quick reference

| Symptom | First thing to check |
|---------|----------------------|
| Container crashes on start | `docker compose logs whatsapp-mcp-docker` |
| "WhatsApp not connected" | Session expired — run `authenticate` tool again |
| Auth 429 error | Rate-limited by WhatsApp — wait 10–15 min |
| Auth 400 error | Pairing failed — server falls back to QR code (returned as image in tool response) |
| FTS5 search returns nothing | Messages may lack text body; check `messages` table |
| Fuzzy match picks wrong contact | Pass JID directly to bypass fuzzy matching |
| Media download fails | Check `media_raw_json` is stored for the message |
| Container rebuilds slowly | Use `docker compose up -d --build` (incremental), not `--no-cache` |
| Session lost after restart | Verify volume exists: `docker volume ls \| grep whatsapp-sessions` |

## Connection and session issues

### "WhatsApp not connected"
The session may have expired (WhatsApp sessions last ~20 days without activity). Run the `authenticate` MCP tool. If it fails, check logs:
```bash
docker compose logs --tail 50 whatsapp-mcp-docker
```

### Container exits immediately
```bash
docker compose logs whatsapp-mcp-docker
```
Look for: binary resolution errors (`@whatsmeow-node/linux-x64-musl`), missing env vars, or volume permission errors.

### Session lost after container restart
```bash
docker volume ls | grep whatsapp
```
If `whatsapp-sessions` is missing, volumes were deleted. Run the full setup again and re-authenticate.

## Authentication errors

| Code | Cause | Fix |
|------|-------|-----|
| 429 | WhatsApp rate limit | Wait 10–15 minutes before retrying |
| 400 | Pairing code rejected | Server auto-falls back to QR code — check the tool response for a base64 PNG image or `data:image/png;base64,...` URI (paste into browser) |

## Resilience internals (for debugging deep issues)

- **Startup**: `_connectWithRetry()` retries up to 5 times (2s → 4s → 8s → 16s → 30s backoff)
- **Health heartbeat**: 60-second check; silent drops trigger reconnection
- **Operation retry**: `sendMessage`, `downloadMedia`, `uploadMedia` retry once on transient errors
- **Permanent logout**: `session.db` is deleted; re-authentication required
- **Transient disconnect**: single reconnect attempt, no re-authentication needed

## Search and data issues

### Full-text search returns nothing
FTS5 index (`messages_fts`) is populated with plaintext even when `DATA_ENCRYPTION_KEY` is set. If search fails:
- Messages may have no text body (media-only messages)
- Use `search_messages` with a simpler query

### Contact fuzzy match picks wrong person
Skip fuzzy matching by passing the JID directly (e.g., `15551234567@s.whatsapp.net` for individuals, `groupid@g.us` for groups).

## Data and encryption

### Encrypted data unreadable after key change
If `DATA_ENCRYPTION_KEY` changes, previously encrypted rows (prefixed `enc:`) cannot be decrypted. There is no migration path — reset data or restore from backup before the key change.

### Check what's encrypted
Fields encrypted when `DATA_ENCRYPTION_KEY` is set:
`messages.body`, `messages.sender_name`, `messages.media_raw_json`, `chats.last_message_preview`, `approvals.action`, `approvals.details`, `approvals.response_text`

## Useful log commands

```bash
# Live logs
docker compose logs -f whatsapp-mcp-docker

# Last 100 lines
docker compose logs --tail 100 whatsapp-mcp-docker

# Container status
docker compose ps
```
