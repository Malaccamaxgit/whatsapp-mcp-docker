# Bug Report: "websocket not connected" — Server Cannot Send Messages

**Date:** 2026-04-01  
**Severity:** High — all outbound message sending is broken  
**Affected:** Production container (`whatsapp-mcp-docker`), not the test container  

---

## Symptom

Every call to `send_message`, `send_file`, or any write operation fails with:

```
Failed to send message: failed to get group members: websocket not connected
Failed to send message: failed to get device list: failed to send usync query: websocket not connected
```

This error comes from the **Go binary** (`@whatsmeow-node/linux-x64-musl`), not from Node.js.

---

## What Works vs. What Doesn't

| Operation | Result |
|---|---|
| `get_connection_status` | ✅ Reports "Connected: Yes, Authenticated as +1XXXXXXXXXX:94@s.whatsapp.net" |
| `list_chats` | ✅ Returns real data from SQLite |
| `list_messages` | ✅ Returns real data including messages received DURING this session |
| `search_messages` | ✅ Works |
| `catch_up` | ✅ Works |
| `send_message` (to group) | ❌ "failed to get group members: websocket not connected" |
| `send_message` (to direct) | ❌ "failed to get device list: failed to send usync query: websocket not connected" |
| `authenticate` (no phone) | Returns "Already authenticated" immediately — does nothing |
| `authenticate` (with phone) | Returns "Already authenticated" — does not re-pair |
| `disconnect` then `authenticate` | Disconnect succeeds; then `authenticate` with phone fails: "websocket not connected" |

---

## Container Logs on Every Startup

```
[WA] No existing session — call authenticate tool to link device
[WA] WebSocket connect() completed
[STARTUP] Authentication state: NOT AUTHENTICATED — call authenticate tool to link device
```

**Despite these logs**, `get_connection_status` consistently reports:
```
✅ Connected: Yes
✅ Authenticated as: +1XXXXXXXXXX:94@s.whatsapp.net
```

This means: AFTER startup logging completes, the Go process fires a `connected` event with a valid JID. Node.js trusts this event and sets `_connected = true` and `this.jid = "+1XXXXXXXXXX:94@s.whatsapp.net"`. But the Go process **cannot actually perform operations** on the WebSocket.

---

## `session.db` State Investigation

Production volume path: `/data/sessions/`

### File listing:
```
-rw-r--r--  session.db       148 KB   (Apr 1 21:16)
-rw-r--r--  session.db-shm    32 KB   (Apr 1 21:18)
-rw-r--r--  session.db-wal     0 B    (Apr 1 21:16)
```

### Table contents (via `better-sqlite3`):

```
whatsmeow_version:   1 row   ← {"version":13,"compat":8}
whatsmeow_device:    0 rows  ← NO SESSION CREDENTIALS
whatsmeow_identity_keys:       0 rows
whatsmeow_pre_keys:            0 rows
whatsmeow_sessions:            0 rows
... (all other tables: 0 rows)
```

The `whatsmeow_device` table is **empty**. There are no device credentials, no JID stored as text, no identity keys.

### Binary search:
Searching `session.db` binary for the string `+1XXXXXXXXXX` → **not found**. The phone number does not appear anywhere in the file.

### Checkpoint result:
```javascript
db.pragma('wal_checkpoint(TRUNCATE)') → [{"busy":0,"log":0,"checkpointed":0}]
```
Zero WAL frames — nothing to checkpoint. Data is not hiding in the WAL.

---

## The Core Contradiction

The Go process fires a `connected` event with JID `+1XXXXXXXXXX:94@s.whatsapp.net`, which causes Node.js to believe it is authenticated. But:

1. `session.db` has no device row — no stored credentials
2. The Go binary itself says "websocket not connected" when asked to perform any operation
3. The JID `+1XXXXXXXXXX` does not appear in any file on the container filesystem (`grep -rl` across `/data`, `/tmp`, `/app` returns nothing)
4. `uptime` resets to `0h 0m` on every status check → the `connected` event is firing repeatedly (reconnect loop)

**Where the JID comes from is unknown.** It appears in the Go process's `connected` event but is stored nowhere on disk.

---

## Architecture of `@whatsmeow-node`

The library (`@whatsmeow-node/whatsmeow-node`) works via:
- A Go binary spawned as a child process with `spawn(binaryPath, [], { stdio: 'pipe' })`
- JSON-line IPC over stdin/stdout
- `proc.unref()` is called after spawn (Go process detached from Node.js event loop)
- `init()` → sends `{"cmd":"init","store":"/data/sessions/session.db"}` → returns `{jid}` or `null`
- `connect()` → sends `{"cmd":"connect"}` → Go opens WebSocket to WhatsApp
- `connected` event → forwarded from Go process via IPC

Key source lines from `dist/index.js`:
```javascript
this.proc.unref();                                          // Go process detached
this.proc.on("connected", (d) => this.emit("connected", d)); // JID from Go
close() { this.proc.kill(); }                               // SIGTERM to Go
```

---

## Attempted Fixes

| Attempt | Result |
|---|---|
| `authenticate` tool (no phone) | Returns "Already authenticated" — `isConnected()` returns true, skips auth |
| `authenticate` tool (with `++1XXXXXXXXXX`) | Returns "Already authenticated" — same issue |
| `disconnect` MCP tool → `authenticate` | Disconnect clears session; then `authenticate` fails: "websocket not connected" (WebSocket is down after disconnect) |
| `docker compose restart` | Container restarts, same problem on next startup |
| WAL checkpoint via `better-sqlite3` | Reports 0 frames — nothing to checkpoint |

---

## Key Code Paths

### `WhatsAppClient.isConnected()` — `src/whatsapp/client.js`
```javascript
isConnected() {
  return this._connected && !!this.jid;
}
```
Returns `true` whenever the `connected` event has fired. Does NOT verify the Go WebSocket is actually usable.

### `WhatsAppClient.requestPairingCode()` — `src/whatsapp/client.js`
```javascript
if (this.isConnected()) {
  return { alreadyConnected: true, jid: this.jid };
}
```
If `isConnected()` is true, it immediately returns without requesting a pairing code. This is the gate that prevents re-authentication.

### `waitForDeviceLink()` — `src/tools/auth.js`
```javascript
while (Date.now() < deadline) {
  if (waClient.isConnected()) {
    return { ok: true, jid: waClient.jid, elapsedSec };
  }
  ...
}
```
Uses the same `isConnected()` check. Immediately returns if already "connected".

### `WhatsAppClient.initialize()` — `src/whatsapp/client.js`
```javascript
const { jid } = await this.client.init();
this._sessionExists = !!jid;
if (jid) {
  this.jid = jid;
  console.error('[WA] Resuming session for', jid);
} else {
  console.error('[WA] No existing session — call authenticate tool to link device');
}
if (autoConnect) {
  await this._connectWithRetry();
  // If _sessionExists is false, does NOT wait for connected event
}
```

---

## Hypotheses (Unresolved)

### H1: Go process fires `connected` unconditionally on WebSocket establishment
The `connected` event from whatsmeow may fire when the **WebSocket connection** is established, even before the **authentication handshake** completes. Node.js interprets this as "fully authenticated" but the Go process is still mid-handshake when we try to send.

### H2: WhatsApp server caches device identity by IP/fingerprint
WhatsApp's servers may temporarily restore a session for a known device fingerprint even without stored credentials, allowing the `connected` event to fire. But the session is ephemeral, so operations fail almost immediately.

### H3: Race condition — `connected` fires then immediately disconnects
The reconnect loop (uptime always 0h 0m, errors accumulating) suggests: Go connects → `connected` fires → Node.js sees connected=true → Go immediately disconnects (no credentials) → logged_out event is NOT properly handled → `_connected` stays true → repeat. The window between `connected` and actual disconnect is too small to send any message.

### H4: `session.db-wal` from previous run contained the session; Go reads it but Node.js `better-sqlite3` cannot
Before the `disconnect` call, `session.db-wal` was **156.9 KB** and `session.db` was **4 KB**. The Go binary might have been reading valid session data from this WAL. After `disconnect` (which deletes `session.db`), the WAL was orphaned. After container restart, a new empty `session.db` was created (148 KB schema-only) with `session.db-wal` at 0 bytes.

---

## What a Fix Likely Needs

1. **Distinguish "WebSocket connected" from "authenticated and ready"** — The `isConnected()` method should verify the Go process can actually perform operations, not just that the `connected` event has fired.

2. **Probe the Go WebSocket before trusting it** — Add a lightweight operation (e.g., `isConnected()` RPC call to the Go binary, or a ping) after the `connected` event to confirm the WebSocket is truly usable.

3. **Force re-pairing even when `isConnected()` is true** — The `authenticate` tool should accept a `force` flag to bypass the early return, allowing re-authentication when the user knows the connection is broken.

4. **Understand why session credentials are not persisted to `whatsmeow_device`** — The Go binary authenticates (fires `connected` with JID) but writes nothing to the SQLite device table. This is either a bug in the Go binary, a WAL that doesn't checkpoint, or the binary uses a different storage path we haven't identified.

---

## Environment

- OS: Windows 11 (Docker Desktop)
- Container: Alpine Linux (node:20-alpine)
- `@whatsmeow-node/whatsmeow-node`: `^0.5.3`
- `@whatsmeow-node/linux-x64-musl`: `^0.5.3`
- `better-sqlite3`: `^11.0.0`
- Node.js: v20.20.2
- WhatsApp account: `+1 438-408-3030`

---

## Relevant Files

- `src/whatsapp/client.js` — `WhatsAppClient` class, `isConnected()`, `disconnect()`, `logout()`, `requestPairingCode()`
- `src/tools/auth.js` — `authenticate` and `disconnect` MCP tools
- `src/tools/status.js` — `get_connection_status` MCP tool
- `node_modules/@whatsmeow-node/whatsmeow-node/dist/index.js` — Go process bridge
