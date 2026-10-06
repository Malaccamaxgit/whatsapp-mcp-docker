---
name: troubleshoot-whatsapp
description: Diagnose and fix common issues with the WhatsApp MCP Docker server. Covers container crashes, connection failures, authentication errors, search problems, media failures, and session loss. Use when the user reports an error, unexpected behavior, or asks why something is not working.
---

# Troubleshoot: WhatsApp MCP Docker

## Quick reference

| Symptom | First thing to check |
|---------|----------------------|
| Container crashes on start | `docker compose logs whatsapp-mcp-docker` |
| WhatsApp not connected | Session expired. Run the `authenticate` tool again. |
| Auth 429 error | Rate limited by WhatsApp. Wait 10 to 15 minutes. |
| Auth 400 error | Pairing failed. The server falls back to a QR code, returned as an image in the tool response. |
| FTS5 search returns nothing | Messages may lack a text body. Check the `messages` table. |
| Fuzzy match picks the wrong contact | Pass the JID directly to bypass fuzzy matching. |
| Media download fails | Check that `media_raw_json` is stored for the message. |
| Container rebuilds slowly | Use an incremental build, not `--no-cache`, unless source changed. |
| Session lost after restart | Verify the volume exists: `docker volume ls | Select-String whatsapp-sessions` |

## Connection and session issues

### WhatsApp not connected

The session may have expired. WhatsApp sessions last about 20 days without
activity. Run the `authenticate` MCP tool. If it fails, check the logs.

```bash
docker compose logs --tail 50 whatsapp-mcp-docker
```

### Container exits immediately

```bash
docker compose logs whatsapp-mcp-docker
```

Look for binary resolution errors such as `@whatsmeow-node/linux-x64-musl`,
missing environment variables, or volume permission errors.

### Session lost after a container restart

```bash
docker volume ls | Select-String whatsapp
```

If `whatsapp-sessions` is missing, the volumes were deleted. Run the setup again
and re-authenticate.

## Authentication errors

| Code | Cause | Fix |
|------|-------|-----|
| 429 | WhatsApp rate limit | Wait 10 to 15 minutes before retrying |
| 400 | Pairing code rejected | The server auto-falls back to a QR code. Check the tool response for a base64 PNG image or a `data:image/png;base64,...` URI, and open it in a browser. |

## Resilience internals (for deep issues)

- Startup: `_connectWithRetry()` retries up to 5 times, with 2s, 4s, 8s, 16s,
  then 30s backoff.
- Health heartbeat: a 60 second check. Silent drops trigger reconnection.
- Operation retry: `sendMessage`, `downloadMedia`, and `uploadMedia` retry once
  on transient errors.
- Permanent logout: `session.db` is deleted, and re-authentication is required.
- Transient disconnect: a single reconnect attempt, no re-authentication.

## Search and data issues

### Full-text search returns nothing

The FTS5 index (`messages_fts`) is populated with plaintext even when
`DATA_ENCRYPTION_KEY` is set. If search fails:

- Messages may have no text body, for example media-only messages.
- Use `search_messages` with a simpler query.

### Contact fuzzy match picks the wrong person

Skip fuzzy matching by passing the JID directly. For example,
`15551234567@s.whatsapp.net` for individuals, or `groupid@g.us` for groups.

## Data and encryption

### Encrypted data is unreadable after a key change

If `DATA_ENCRYPTION_KEY` changes, previously encrypted rows prefixed with `enc:`
cannot be decrypted. There is no migration path. Reset the data or restore from
a backup that predates the key change.

### Fields that are encrypted when `DATA_ENCRYPTION_KEY` is set

- `messages.body`
- `messages.sender_name`
- `messages.media_raw_json`
- `chats.last_message_preview`
- `approvals.action`
- `approvals.details`
- `approvals.response_text`

## Useful log commands

```bash
docker compose logs -f whatsapp-mcp-docker
docker compose logs --tail 100 whatsapp-mcp-docker
docker compose ps
```
