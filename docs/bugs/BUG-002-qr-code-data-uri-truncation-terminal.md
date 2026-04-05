---
title: "BUG-002: QR Code Data URI Not Systematically Provided and Truncated in Terminal-Based CLI"
date: 2026-04-05
status: corrected
severity: medium
component: tools/auth.ts, whatsapp/client.ts
labels: [bug, authentication, terminal, qr-code, ux]
---

# BUG-002: QR Code Data URI Not Systematically Provided and Truncated in Terminal-Based CLI

## Resolution Status

Corrected.

## Fix Applied

Implemented across `src/whatsapp/client.ts`, `src/tools/auth.ts`, and integration mocks:

1. Reduced QR payload size in `generateQrImage()`:
   - Width reduced from `256` to `150`
   - Margin reduced from `40` to `2`
2. Added file-based QR fallback (container-only, no host install/scripts required):
   - New `saveQrCodeToFile()` writes PNG to `${STORE_PATH}/qr-code.png` (typically `/data/sessions/qr-code.png`)
   - New `cleanupQrCodeFile()` removes stale QR file after successful connect
3. Improved terminal UX in `authenticate` QR response:
   - Data URL is now explicitly called out for terminal users
   - Includes a clear fallback path when long data URLs are truncated:
     - `docker cp whatsapp-mcp-docker:/data/sessions/qr-code.png ./qr-code.png`
4. Updated integration mock client API to include QR file methods so tests remain aligned.

## Validation

- Containerized TypeScript check passed:
  - `docker compose --profile test run --rm tester-container npm run typecheck`
- Integration suite (including `authenticate`) passed in container:
  - `npx tsx --test test/integration/tools.test.ts --test-name-pattern "authenticate"`
- Live E2E read-only test suite passed in container:
  - `npx tsx --test test/e2e/live.test.ts`

## Summary

When authenticating via terminal-based CLI (e.g., Cursor integrated terminal, Windows Terminal), the QR code data URI for browser viewing is:
1. **Not systematically provided** in the initial authentication response
2. **Truncated when displayed**, making it unusable for browser pasting

This blocks terminal-only users from completing authentication when the inline QR code image is not rendered by their terminal.

## Environment

- **Server Version:** 0.4.0
- **Date Reported:** 2026-04-05
- **Platform:** Windows (Docker Desktop, Cursor IDE)
- **Terminal:** Windows Terminal / Cursor Integrated Terminal
- **Profile:** `default-with-portainer`

## Symptoms

### Issue 1: Data URI Not Systematically Provided

**Expected Behavior:**
The authentication response should always include the data URI in the text response for terminal users to paste into a browser.

**Actual Behavior:**
- Initial authentication response shows QR code as an image block only
- Data URI is mentioned but not clearly visible or accessible
- User must explicitly request the data URL to see it
- No clear indication in the initial response that the data URI exists

**User Transcript:**
```
User: authenticate +14384083030
Assistant: [Displays QR code image]
User: what is the Data URL?
Assistant: [Explains data URL format and provides truncated URL]
User: can you provide the Data URL in full
```

### Issue 2: Data URI Truncation

**Expected Behavior:**
The full data URI (`data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...` ~30KB string) should be displayed in its entirety for users to copy and paste into a browser.

**Actual Behavior:**
- Terminal output truncates the long base64 string
- Display shows: `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAAAAklEQVR4AewaftIAABDHSURBVO3BQY7jirIoSXci979l74oBAYKQUqq65/0eMMzsD9Zaj3Sw1nqsg7XWYx2stR7rYK31WAdrrcc6WGs91sFa67EO1lqPdbDWeqyDtdZjHay1HutgrfVYB2utxzpYaz3WwVrrsQ7WWo91sNZ6rIO11mMdrLUe62Ct9VgHa63HOlhrPdbBWuuxDtZaj3Ww1nqsg7XWYx2stR7rYK31WAdrrcc6WGs91sFa67EO1lqPdbDWeqyDtdZjHay1HutgrfVYB2utxzpYaz3WwVrrsQ7WWo91sNZ6rIO11mMdrLUe62Ct9VgHa63HOlhrPdbBWuuxDtZaj/XD...`
- String is cut off mid-sequence, making it impossible to copy the complete URI
- Terminal line wrapping or output buffer limits cause the truncation

## Container Logs

```
[WA] Pairing code failed (websocket disconnected before info query (retry) returned response), switching to QR code mode
[WA] Switched to QR code mode — waiting for QR code...
[WA] QR code available — scan with WhatsApp > Linked Devices > Link a Device
[WA-QR] <qr_code_string_data>
[QRCode terminal art rendered]
```

## Root Cause Analysis

### Issue 1: Data URI Not Prominently Displayed

**Code Location:** `src/tools/auth.ts` lines 343-352

**Current Implementation:**
```typescript
content.push({
  type: 'text',
  text:
    'Scan this QR code with WhatsApp > Linked Devices > Link a Device.\n\n' +
    'QR codes expire in ~20 seconds. If the code has expired, call authenticate again for a fresh one.\n' +
    'Once linked, the session persists across container restarts.\n\n' +
    'Note: QR mode returns immediately — use get_connection_status to check if the scan succeeded.\n\n' +
    'Terminal Mode: Open this URL in your browser to view the QR code:\n' +
    `data:image/png;base64,${result.qrImageBase64}`
});
```

**Problems:**
1. Data URI is appended at the end of a long text block without clear formatting
2. No explicit instruction like "COPY THE FULL URL BELOW" to draw attention
3. No visual separation (blank lines, code block formatting) before the URI
4. Terminal users may not see the image block, so the data URI is their only option, but it's buried in the text

### Issue 2: Data URI Truncation

**Root Causes:**

1. **Terminal Output Buffer Limits:**
   - Windows Terminal and many CLI terminals have output buffer size limits
   - Long single-line strings (>10KB) may be truncated in display
   - Copy-paste operations may only capture visible portion

2. **MCP Protocol Response Size Limits:**
   - MCP servers may have response size limits for content
   - Base64 QR code image is ~25-30KB
   - Combined with text content, may exceed protocol limits

3. **Base64 String Generation:**
   - `generateQrImage()` in `src/whatsapp/client.ts` (lines 1274-1281) creates a 256x256 PNG with margin 40
   - This produces a large base64 string
   - No compression or optimization applied

**Data URI Size Calculation:**
```
QR Code: 256x256 pixels, margin 40, error correction M
PNG Size: ~8-10 KB
Base64 Overhead: ~33% (4/3 ratio)
Total Data URI: ~11-13 KB

Actual string length: ~15,000-20,000 characters
Terminal display width: Typically 80-120 characters
Lines required: ~125-250 lines of wrapped text
```

## Impact

### Severity: MEDIUM

**User Impact:**
- Terminal-only users cannot authenticate when image rendering fails
- Users must explicitly request data URI (not obvious it exists)
- Even when provided, truncated URI is unusable
- Forces users to find alternative methods (browser-based MCP clients)

**Affected Scenarios:**
- Terminal-based MCP clients (Cursor integrated terminal, VS Code terminal)
- SSH sessions to remote Docker hosts
- Headless server environments
- Terminals without image rendering support (most Windows terminals, many Linux terminals)

**Workaround Status:** Partially available but broken

## Reproduction Steps

### Issue 1: Missing Data URI Visibility

1. Open terminal-based MCP client (Cursor, VS Code with terminal)
2. Run: `authenticate +1234567890`
3. Observe: QR code image displayed (if terminal supports it) or placeholder
4. Observe: No prominent mention of data URI for terminal viewing
5. User must ask: "what is the Data URL?" to get information about it

### Issue 2: Data URI Truncation

1. Run: `authenticate +1234567890`
2. Wait for QR code response (pairing code failure triggers QR fallback)
3. Request: "can you provide the Data URL in full"
4. Observe: Response contains `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...` 
5. Observe: String is truncated mid-sequence (typically after ~500-1000 characters)
6. Attempt to copy full URI: fails, incomplete base64 data
7. Attempt to paste into browser: fails, invalid/corrupted image data

## Proposed Fixes

### Fix 1: Improve Data URI Visibility (src/tools/auth.ts)

**Change:** Make data URI prominent and clearly formatted for terminal users

```typescript
content.push({
  type: 'text',
  text:
    'Scan this QR code with WhatsApp > Linked Devices > Link a Device.\n\n' +
    'QR codes expire in ~20 seconds. If the code has expired, call authenticate again for a fresh one.\n' +
    'Once linked, the session persists across container restarts.\n\n' +
    'Note: QR mode returns immediately — use get_connection_status to check if the scan succeeded.\n\n' +
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
    'TERMINAL USERS: Cannot see the QR image above?\n' +
    'Copy the FULL data URL below and paste it into your browser:\n' +
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
    '```text\n' +
    `data:image/png;base64,${result.qrImageBase64}\n` +
    '```\n\n' +
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
    '⚠️  IMPORTANT: Copy the ENTIRE URL above (starts with "data:image" and ends with "...")\n' +
    'Paste it into your browser address bar to view the QR code.\n' +
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
});
```

**Benefits:**
- Clear visual separation with borders
- Explicit instructions for terminal users
- Code block formatting (```text) may help with copy-paste
- Warning about copying entire URL

### Fix 2: Reduce QR Code Size (src/whatsapp/client.ts)

**Change:** Generate smaller QR code to reduce data URI length

```typescript
async generateQrImage (data: string): Promise<string> {
  const buf = await QRCode.toBuffer(data, {
    width: 200,  // Reduced from 256
    margin: 2,   // Reduced from 40 (excessive margin)
    errorCorrectionLevel: 'M'
  });
  return buf.toString('base64');
}
```

**Impact:**
- Reduces base64 string length by ~40-50%
- QR code still scannable (200x200 is sufficient)
- Margin of 2 is standard (40 was excessive)

### Fix 3: Provide Alternative Viewing Methods

**Option A: Save QR Code to File**

Add functionality to save QR code as a file in a known location:

```typescript
// In authenticate tool response
const qrFilePath = '/tmp/whatsapp-qr-code.png';
await fs.writeFile(qrFilePath, Buffer.from(result.qrImageBase64, 'base64'));

content.push({
  type: 'text',
  text: `QR code saved to: ${qrFilePath}\nCopy this file to your host machine and open it in any image viewer.`
});
```

**Option B: Provide Shortened URL**

Generate a temporary short URL (requires external service or local HTTP server):

```typescript
// Not recommended for security/privacy reasons
```

**Option C: Chunked Data URI**

Split the data URI into multiple messages/chunks:

```typescript
const dataUri = `data:image/png;base64,${result.qrImageBase64}`;
const chunkSize = 2000;
const chunks = [];
for (let i = 0; i < dataUri.length; i += chunkSize) {
  chunks.push(dataUri.slice(i, i + chunkSize));
}

content.push({
  type: 'text',
  text: `Data URI (Part 1 of ${chunks.length}):\n${chunks[0]}\n\n... (additional parts follow)`
});
```

### Fix 4: Add Terminal Detection and Fallback

**Change:** Detect if client supports image rendering, provide data URI prominently if not

```typescript
// In authenticate tool, check client capabilities
const supportsImages = clientCapabilities?.imageSupport === true;

if (!supportsImages || forceTerminalMode) {
  // Provide data URI prominently
  content.push({
    type: 'text',
    text: `Terminal Mode - Copy this URL to your browser:\ndata:image/png;base64,${result.qrImageBase64}`
  });
} else {
  // Provide image block with data URI as fallback
  content.push({
    type: 'image',
    data: result.qrImageBase64,
    mimeType: 'image/png'
  });
  content.push({
    type: 'text',
    text: 'Terminal users: data URL available on request'
  });
}
```

## Files Requiring Changes

1. **src/tools/auth.ts**
   - `createAuthenticateHandler()` function (lines 343-352)
   - Improve data URI formatting and visibility

2. **src/whatsapp/client.ts**
   - `generateQrImage()` method (lines 1274-1281)
   - Reduce QR code size and margin

3. **docs/README.md** (optional)
   - Update authentication documentation with terminal user instructions

4. **docs/guides/DEVELOPER.md** (optional)
   - Add troubleshooting section for terminal-based authentication

## Testing Plan

### Manual Testing

1. **Terminal without Image Support:**
   - Use Windows Terminal, PowerShell, or basic SSH terminal
   - Run `authenticate +1234567890`
   - Verify data URI is prominently displayed
   - Copy full data URI and paste into browser
   - Verify QR code displays and is scannable

2. **Terminal with Image Support:**
   - Use Cursor, VS Code with image rendering
   - Run `authenticate +1234567890`
   - Verify image displays inline
   - Verify data URI is available on request

3. **Data URI Completeness:**
   - Copy data URI from terminal output
   - Verify string starts with `data:image/png;base64,`
   - Verify string ends with valid base64 characters (no truncation)
   - Paste into browser address bar
   - Verify QR code displays correctly

### Automated Testing

1. **Unit Test:** Verify `generateQrImage()` produces base64 string within size limits
2. **Integration Test:** Test authenticate tool response contains data URI
3. **E2E Test:** Full authentication flow in terminal-only environment

## Workarounds

### Current Workarounds (Limited Success)

1. **Request Data URI Explicitly:**
   - Ask: "can you provide the Data URL in full"
   - May still receive truncated response
   - **Status:** Unreliable

2. **Use Browser-Based MCP Client:**
   - Switch to Cursor desktop app or Claude Desktop
   - These clients render image blocks natively
   - **Status:** Effective but requires different client

3. **Use Pairing Code Instead:**
   - Pairing code authentication doesn't require QR code
   - Enter 8-digit code in WhatsApp mobile app
   - **Status:** Effective when available (may fail due to BUG-001)

4. **Extract from Container Logs:**
   - Run: `docker logs whatsapp-mcp-docker | grep "data:image"`
   - May get full data URI from logs
   - **Status:** Possible but cumbersome

## Related Issues

- **BUG-001:** WebSocket Probe Fails with 'getContact is not a function' - causes pairing code to fail, forcing QR fallback
- **Feature Request:** Add file-based QR code export for terminal users
- **Feature Request:** Add terminal mode detection for automatic fallback

## Dependencies

- `qrcode` npm package: ^1.5.4
- MCP Protocol: Image content block support varies by client
- Terminal emulators: Image rendering support varies widely

## References

- [README.md - Pairing Code Authentication](README.md#pairing-code-authentication)
- [docs/architecture/OVERVIEW.md - Authentication Flow](docs/architecture/OVERVIEW.md#authentication-flow)
- [docs/guides/DEVELOPER.md - Troubleshooting](docs/guides/DEVELOPER.md#troubleshooting)

## Timeline

- **2026-04-05 16:30:** Bug reported by user during authentication attempt
- **2026-04-05 16:35:** Root cause identified (data URI visibility and truncation)
- **2026-04-05 16:40:** Bug report created

## Updates

### 2026-04-05 - Corrected

Implemented and validated.

Code changes applied:
- `src/whatsapp/client.ts`
  - Reduced QR image size (`width: 150`, `margin: 2`) to lower data URL length
  - Added `saveQrCodeToFile()` and `cleanupQrCodeFile()`
- `src/tools/auth.ts`
  - Improved terminal-focused QR response text
  - Added file fallback guidance and QR file save call
- `test/integration/helpers/mock-wa-client.ts`
  - Added mock methods for QR file save/cleanup parity

Validation:
- Containerized typecheck passed
- Containerized integration authenticate tests passed
- Containerized live E2E read-only tests passed

### 2026-04-05 - Initial Report

Bug documented with user transcript and code analysis. Two distinct issues identified:
1. Data URI not prominently displayed in initial response
2. Data URI truncated when displayed in terminal output

Awaiting fix implementation.

---

**Reported by:** User (via Cursor terminal)
**Investigated by:** AI Assistant (Cursor)
**Assignee:** Unassigned
**Priority:** P1 (High - Blocks terminal-only users)
