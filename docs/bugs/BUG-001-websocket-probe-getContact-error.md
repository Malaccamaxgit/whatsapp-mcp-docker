---
title: "BUG-001: WebSocket Probe Fails with 'getContact is not a function' After Authentication"
date: 2026-04-05
status: corrected
severity: high
component: whatsapp/client.ts
labels: [bug, websocket, authentication, whatsmeow]
---

# BUG-001: WebSocket Probe Fails with "getContact is not a function" After Authentication

## Resolution Status

Corrected.

## Fix Applied

Implemented in `src/whatsapp/client.ts`:

1. `WhatsmeowClient` interface updated so `getContact` is optional:
   - `getContact?(jid: string): Promise<...>`
2. `_probeWebSocket()` hardened:
   - Uses `getContact()` when available
   - Falls back to `getChats()` when `getContact` is unavailable
   - Preserves probe timeout and error reporting
3. `checkHealth()` hardened with the same fallback:
   - `getContact()` when available
   - `getChats()` fallback otherwise
4. `resolveContactName()` now degrades safely:
   - Returns `null` when `getContact` is unavailable instead of throwing

## Validation

- Containerized TypeScript check passed:
  - `docker compose --profile test run --rm tester-container npm run typecheck`
- Integration suite (including `authenticate`) passed in container:
  - `npx tsx --test test/integration/tools.test.ts --test-name-pattern "authenticate"`

## Summary

After successful QR code authentication, the WebSocket connection establishes but the probe verification fails with `this.client.getContact is not a function`, causing the connection to be marked as disconnected despite having a valid session.

## Environment

- **Server Version:** 0.4.0
- **Date Reported:** 2026-04-05
- **Platform:** Windows (Docker Desktop)
- **Profile:** `default-with-portainer`
- **Custom Catalog:** `my-custom-mcp-servers`

## Symptoms

1. Container starts successfully and reports healthy status
2. QR code authentication succeeds (session created with 2 chats, 8 messages)
3. WebSocket connects: `[WA] Connected as 14384083030:9@s.whatsapp.net`
4. WebSocket probe fails immediately: `[WA] WebSocket probe failed: this.client.getContact is not a function`
5. Connection status shows disconnected despite valid session
6. Subsequent authentication attempts fail: `websocket disconnected before info query (retry) returned response`

## Connection Status Output

```
WhatsApp Connection Status:
  ❌ Connected: No
  🔍 WebSocket Probe: Not verified
  Probe Error: this.client.getContact is not a function
  ⚠️  Session: 14384083030:9@s.whatsapp.net (disconnected)
  Status: Call authenticate (no phone number needed) to reconnect
```

## Container Logs

```
[CRYPTO] Field-level encryption enabled
[STORE] poll_votes table created
[STORE] Schema migration note: duplicate column name: media_mimetype
[STARTUP] WhatsApp MCP Server v0.4.0
[STARTUP] Store path: /data/sessions
[STARTUP] Encryption: ON
[PURGE] Auto-purge enabled: 90-day retention, checking every 60 min
[STARTUP] Auto-connect on startup: YES
[WA] Resuming session for 14384083030:9@s.whatsapp.net
[WA] WebSocket connect() completed
[WA] Connected as 14384083030:9@s.whatsapp.net
[WA] Welcome group "WhatsAppMCP" already exists (120363425651110648@g.us)
[WA] WebSocket probe failed: this.client.getContact is not a function
[WA] Session restored — connected as 14384083030:9@s.whatsapp.net
[STARTUP] MCP server running on stdio
[STARTUP] Authentication state: SESSION EXISTS for 14384083030:9@s.whatsapp.net — connection establishing or call authenticate tool
[AUDIT] server:started OK
[WA] Delivery receipts enabled
[WA] Presence set to "available"
[AUTH] Force re-pairing requested — WebSocket probe failed: this.client.getContact is not a function
[WA] Force re-pairing: resetting broken connection state
[WA] Waiting 8000ms for authentication readiness (Go bridge stabilization)...
[WA] Requesting pairing code for 14384083030
[WA] Connected as 14384083030:9@s.whatsapp.net
[WA] Welcome group "WhatsAppMCP" already exists (120363425651110648@g.us)
[WA] WebSocket probe failed: this.client.getContact is not a function
[WA] Delivery receipts enabled
[WA] Presence set to "available"
[WA] Pairing code attempt 1/2 failed: websocket disconnected before info query (retry) returned response
[WA] Retrying pairing code in 3000ms...
[WA] Connected as 14384083030:9@s.whatsapp.net
[WA] Welcome group "WhatsAppMCP" already exists (120363425651110648@g.us)
[WA] WebSocket probe failed: this.client.getContact is not a function
[WA] Delivery receipts enabled
[WA] Presence set to "available"
[WA] Connected as 14384083030:9@s.whatsapp.net
[WA] Welcome group "WhatsAppMCP" already exists (120363425651110648@g.us)
[WA] WebSocket probe failed: this.client.getContact is not a function
[WA] Delivery receipts enabled
[WA] Presence set to "available"
[WA] Pairing code attempt 2/2 failed: websocket disconnected before info query (retry) returned response
[WA] All pairing attempts failed, switching to QR code mode
[WA] Pairing code failed (websocket disconnected before info query (retry) returned response), switching to QR code mode
[WA] Failed to switch to QR mode: GetQRChannel can only be called when there's no user ID in the client's Store
[AUDIT] authenticate:pairing_failed FAIL
```

## Root Cause Analysis

### Expected Behavior

The `_probeWebSocket()` method in `src/whatsapp/client.ts` (line 1218-1233) calls `this.client.getContact(this.jid!)` to verify the Go WebSocket bridge is responsive after connection.

### Actual Behavior

The `getContact` method is undefined on the `this.client` object, causing a `TypeError`. This suggests:

1. **Type Definition Mismatch:** The `WhatsmeowClient` interface declares `getContact(jid: string): Promise<{ fullName?: string; pushName?: string } | null>` (line 54), but the actual @whatsmeow-node/whatsmeow-node client may not expose this method.

2. **API Version Incompatibility:** The @whatsmeow-node/whatsmeow-node package version 0.5.3 may have changed or removed the `getContact` method.

3. **Incomplete Client Initialization:** The Go bridge subprocess may not have fully initialized all methods when the probe runs.

### Code Location

**File:** `src/whatsapp/client.ts`

**Probe Method (lines 1218-1233):**
```typescript
async _probeWebSocket (): Promise<void> {
  try {
    const result = await this._withTimeout(
      Promise.resolve(this.client!.getContact(this.jid!)),
      8000,
      'ws-probe'
    );
    this._probeVerified = result !== null && result !== undefined;
    this._probeLastError = null;
    console.error('[WA] WebSocket probe:', this._probeVerified ? 'PASSED' : 'FAILED (null response)');
  } catch (err) {
    this._probeVerified = false;
    this._probeLastError = (err as Error).message;
    throw err;
  }
}
```

**Type Declaration (line 54):**
```typescript
getContact(jid: string): Promise<{ fullName?: string; pushName?: string } | null>;
```

**Health Check Also Uses getContact (lines 1262-1268):**
```typescript
// For long-running connections, verify we can get basic info
try {
  await this.client!.getContact(this.jid);
  return { healthy: true };
} catch {
  return { healthy: false, reason: 'contact_check_failed' };
}
```

**Contact Name Resolution Also Uses getContact (lines 1484-1492):**
```typescript
async resolveContactName (jid: string): Promise<string | null> {
  if (!this.isConnected()) {return null;}
  try {
    const contact = await this.client!.getContact(jid);
    return contact?.fullName || contact?.pushName || null;
  } catch {
    return null;
  }
}
```

## Impact

### Severity: HIGH

**User Impact:**
- Cannot authenticate after reinitiate/fresh install
- Session appears connected but tools fail
- WhatsApp MCP server is unusable

**Affected Scenarios:**
- Fresh authentication after cleanup
- Session restore after container restart
- Any scenario requiring WebSocket probe verification

**Workaround Status:** None identified

## Reproduction Steps

1. Run cleanup: `.\scripts\cleanup.ps1 -Force -Profile default-with-portainer -Catalog my-custom-mcp-servers`
2. Build image: `docker compose build`
3. Set encryption key: `docker mcp secret set "whatsapp-mcp-docker.data_encryption_key=..."`
4. Create catalog and profile: `docker mcp catalog create ...` and `docker mcp profile server add ...`
5. Configure profile: `docker mcp profile config default-with-portainer --set ...`
6. Connect client: `docker mcp client connect cursor --profile default-with-portainer`
7. Reload Cursor window
8. Authenticate: Call `authenticate` tool with phone number `+14384083030`
9. Scan QR code with WhatsApp
10. Observe: Connection succeeds but probe fails with `getContact is not a function`

## Proposed Fixes

### Option 1: Replace Probe Method (Recommended)

Replace `getContact()` with a different method that is guaranteed to exist on the whatsmeow-node client:

```typescript
async _probeWebSocket (): Promise<void> {
  try {
    // Use isConnected() or isLoggedIn() instead of getContact()
    const isAlive = this.client!.isConnected?.() ?? this.client!.isLoggedIn?.() ?? true;
    this._probeVerified = isAlive;
    this._probeLastError = null;
    console.error('[WA] WebSocket probe:', this._probeVerified ? 'PASSED' : 'FAILED');
  } catch (err) {
    this._probeVerified = false;
    this._probeLastError = (err as Error).message;
    throw err;
  }
}
```

### Option 2: Make Probe Tolerant of Missing Method

```typescript
async _probeWebSocket (): Promise<void> {
  try {
    if (typeof this.client!.getContact !== 'function') {
      // Method doesn't exist - use fallback check
      const isAlive = this.client!.isConnected?.() ?? true;
      this._probeVerified = isAlive;
      console.error('[WA] WebSocket probe: PASSED (fallback check)');
      return;
    }
    
    const result = await this._withTimeout(
      Promise.resolve(this.client!.getContact(this.jid!)),
      8000,
      'ws-probe'
    );
    this._probeVerified = result !== null && result !== undefined;
    this._probeLastError = null;
    console.error('[WA] WebSocket probe:', this._probeVerified ? 'PASSED' : 'FAILED (null response)');
  } catch (err) {
    this._probeVerified = false;
    this._probeLastError = (err as Error).message;
    throw err;
  }
}
```

### Option 3: Update Type Definition

If `getContact` was removed from @whatsmeow-node/whatsmeow-node v0.5.3, update the `WhatsmeowClient` interface to remove the method declaration and update all call sites.

### Option 4: Downgrade Dependency

If this is a regression in v0.5.3, downgrade to a previous version that had `getContact` working.

## Files Requiring Changes

1. **src/whatsapp/client.ts**
   - `_probeWebSocket()` method (line 1218)
   - `checkHealth()` method (line 1264)
   - `resolveContactName()` method (line 1487)
   - `WhatsmeowClient` interface (line 54) - if removing method

2. **test/integration/helpers/mock-wa-client.ts**
   - Mock `getContact` implementation may need updating

3. **package.json**
   - @whatsmeow-node/whatsmeow-node version (if downgrading)

## Related Code

### Other Methods Using getContact

**src/tools/chats.ts:**
- Line 85: `store.getContactByJid(c.jid)` (store method, not client)
- Line 318: `store.getContactChats(matches[0].jid, 10)` (store method)

**src/whatsapp/store.ts:**
- Multiple `getContact*` methods (these are store methods, not client methods)

**src/utils/jid-utils.ts:**
- Lines 179-180, 208, 298: `store.getContactByJid()` (store methods)

## Testing Plan

### Unit Tests
1. Test `_probeWebSocket()` with mock client lacking `getContact` method
2. Test `checkHealth()` fallback behavior
3. Test `resolveContactName()` error handling

### Integration Tests
1. Fresh authentication flow with QR code
2. Session restore after container restart
3. Force re-pairing scenario

### E2E Tests
1. Full authentication with live WhatsApp session
2. Message send/receive after authentication
3. Connection status verification

## Workarounds

**Current Status:** No known workaround

**Attempted (Failed):**
- Force re-authentication: Same error
- Container restart: Same error
- Profile reactivation: Same error
- Manual reconnect: Same error

## Dependencies

- @whatsmeow-node/whatsmeow-node: ^0.5.3
- @whatsmeow-node/linux-x64-musl: ^0.5.3

## References

- [DEVELOPER.md - Connection Management](docs/guides/DEVELOPER.md#connection-management)
- [ERRORS.md - Connection Errors](docs/guides/ERRORS.md#connection-errors)
- [TROUBLESHOOTING.md - Connection Lost](docs/TROUBLESHOOTING.md#connection-lost)

## Timeline

- **2026-04-05 16:06:** Bug discovered during reinitiate process
- **2026-04-05 16:15:** Root cause identified (getContact method undefined)
- **2026-04-05 16:20:** Bug report created

## Updates

### 2026-04-05 - Corrected

Implemented and validated.

Code changes applied:
- `src/whatsapp/client.ts`
  - `_probeWebSocket()` fallback from missing `getContact()` to `getChats()`
  - `checkHealth()` fallback from missing `getContact()` to `getChats()`
  - `resolveContactName()` safe guard when `getContact()` is unavailable
  - `WhatsmeowClient.getContact` changed to optional

Validation:
- Containerized typecheck passed
- Containerized integration authenticate tests passed

### 2026-04-05 - Initial Report

Bug documented with full container logs and code analysis. Awaiting fix implementation.

---

**Reported by:** AI Assistant (Cursor)
**Assignee:** Unassigned
**Priority:** P0 (Blocking)
