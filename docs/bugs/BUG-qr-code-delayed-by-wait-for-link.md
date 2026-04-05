# BUG: QR code not returned until wait completes when waitForLink=true

**Status: OPEN**

## Symptom

When calling `authenticate` with `waitForLink: true`:

1. The MCP client shows "Error: Aborted" or the tool call times out
2. Container logs show QR code was successfully generated
3. The user never sees the QR code in the MCP client
4. The 120-second wait never properly terminates for the user

From the container logs, the QR code IS generated:
```
[WA] QR code available — scan with WhatsApp > Linked Devices > Link a Device
[WA-QR] 2@IawLJpXo0itV8o4lW+...
[AUDIT] authenticate:qr_fallback OK
[AUTH] Waiting for device link... 5s elapsed (check #1, every 5s)
[AUTH] Waiting for device link... 10s elapsed (check #2, every 5s)
...
```

But the response never reaches the MCP client before Cursor/Client aborts due to internal timeout.

## Root cause

In [`src/tools/auth.ts`](../../src/tools/auth.ts), the code flow for QR mode is:

```typescript
// Line 318-341: Build content with QR image
if ('qrCode' in result && result.qrCode) {
  const content: McpContent[] = [];
  if (result.qrImageBase64) {
    content.push({
      type: 'image',
      data: result.qrImageBase64,
      mimeType: 'image/png'
    });
  }
  content.push({ type: 'text', text: '...' });

  // Line 343-358: BLOCKING WAIT
  if (shouldWait) {
    const wait = await waitForDeviceLink(waClient, waitOpts);  // <-- BLOCKS HERE
    // ... update text ...
  }

  return { content };  // <-- ONLY RETURNS AFTER WAIT
}
```

The sequence:
1. `requestPairingCode()` returns QR code immediately
2. Content array is built with QR image
3. `await waitForDeviceLink()` **blocks** for up to 120 seconds
4. Only AFTER wait completes, `return { content }` executes
5. MCP client aborts mid-wait due to internal timeout

## The fundamental issue

MCP protocol does not support **streaming responses** or **progressive updates**. A tool must:
- Return a complete response within a reasonable time (Cursor appears to have a ~60s timeout)
- Cannot "return early" then "update later"

When `waitForLink: true`, the code attempts to:
1. Return QR code AND
2. Wait for link confirmation AND
3. Return updated status

...in a single tool call, which is architecturally incompatible with MCP's request-response model.

## Two distinct problems

### Problem A: QR code should return immediately

**Expected**: When `waitForLink: true` with QR fallback:
1. Tool returns QR code immediately
2. User scans QR within ~20s (QR expiry)
3. User calls `authenticate` again to check status, or calls `get_connection_status`

**Actual**: Tool builds QR code but blocks waiting, never returns it.

### Problem B: 120-second timeout never reaches client

**Expected**: If tool sets a 120-second timeout, the client should see either:
- Success (linked) after X seconds
- Timeout message after 120 seconds

**Actual**: Client aborts earlier (due to Cursor/Agent internal timeout), user sees "Aborted" and no useful information.

## Current workaround

Setting `waitForLink: false` (now the default) correctly returns the QR code immediately. However:
- Users who explicitly pass `waitForLink: true` still hit this bug
- The "Error: Aborted" message is confusing — it doesn't indicate whether the QR was generated

## Proposed fix

**Option 1: Return immediately, ignore waitForLink for QR mode**

Since QR codes expire in ~20 seconds, waiting for a scan is pointless — by the time the client sees the QR, it may already be expired. For QR mode, always return immediately:

```typescript
if ('qrCode' in result && result.qrCode) {
  // QR codes expire in ~20s — return immediately regardless of waitForLink
  // User must scan quickly and call authenticate/get_connection_status
  const content: McpContent[] = [/* ... QR image + text ... */];
  return { content };  // Return immediately, no wait for QR mode
}
```

**Option 2: Add streaming progress to MCP protocol (not viable)**

MCP protocol doesn't support server-sent events or streaming. This would require protocol changes.

**Option 3: Detect client timeout and return early**

Detect that wait is taking too long (>30s) and return a partial response:

```typescript
// Not clean — the wait loop must periodically check if we should return early
// This adds complexity and still doesn't guarantee delivery
```

## Recommendation

**Implement Option 1**: For QR code mode, ignore `waitForLink` and return immediately. 

Rationale:
- QR codes expire in ~20s, making wait pointless
- The blocking pattern causes client aborts
- User can check link status with `get_connection_status`

## Files to modify

| File | Change |
|------|--------|
| `src/tools/auth.ts` | Skip `waitForDeviceLink` for QR mode, return immediately |
| `docs/tools/auth.md` | Document that QR mode always returns immediately |

## Test plan

1. Disconnect existing session
2. Call `authenticate` with `waitForLink: true` and phone number
3. Verify QR code image appears in MCP client immediately (<5s)
4. Text should indicate "QR codes expire in ~20s — scan quickly"
5. No 120-second wait should block the response

## Related

- [BUG-auth-wait-for-link-default.md](BUG-auth-wait-for-link-default.md) — The default value fix
- [BUG-qr-code-not-shown-in-cursor.md](BUG-qr-code-not-shown-in-cursor.md) — Previous (incomplete) fix