# BUG: AUTH_WAIT_FOR_LINK defaults to false instead of true

**Status: OPEN**

## Symptom

When calling the `authenticate` tool without explicit parameters:

- The tool returns immediately with a pairing code or QR code
- The user must manually poll or call `authenticate` again to check if linking succeeded
- The default behavior (`wait_for_link=false`) is non-blocking, requiring the user to manage link detection themselves

## Expected behavior

The `authenticate` tool should **by default**:

1. Request **one** authentication token (pairing code) or QR code
2. **Automatically poll every 5 seconds** to check if the device is linked
3. **Timeout automatically** after 120 seconds (configurable)
4. Return a single response confirming success or timeout

This is already implemented via `waitForDeviceLink()` but is **disabled by default**.

## Root cause

In [`src/tools/auth.ts`](src/tools/auth.ts) line 35:

```typescript
function authEnvWaitForLink(): boolean {
  const v = process.env.AUTH_WAIT_FOR_LINK;
  if (v === undefined || v === null || String(v).trim() === '') {return false;}  // <-- DEFAULT IS FALSE
  // ...
}
```

The comment at line 32 explains: "AUTH_WAIT_FOR_LINK defaults false (safe for Cursor/long-lived MCP clients)"

However, for user-friendliness and to match typical authentication UX (one call, automatic confirmation), the default should be `true`.

## Current workarounds

Users must explicitly set one of:

1. **Environment variable:** `AUTH_WAIT_FOR_LINK=true`
2. **Docker MCP profile config:** `--set whatsapp-mcp-docker.auth_wait_for_link=true`
3. **Tool parameter:** `authenticate({ phoneNumber: "+...", waitForLink: true })`

## Proposed fix

Change the default in `src/tools/auth.ts`:

```diff
- /** Profile/env defaults (Docker MCP → AUTH_*). AUTH_WAIT_FOR_LINK defaults false (safe for Cursor/long-lived MCP clients). */
+ /** Profile/env defaults (Docker MCP → AUTH_*). AUTH_WAIT_FOR_LINK defaults true (automatic link detection). */
function authEnvWaitForLink(): boolean {
  const v = process.env.AUTH_WAIT_FOR_LINK;
- if (v === undefined || v === null || String(v).trim() === '') {return false;}
+ if (v === undefined || v === null || String(v).trim() === '') {return true;}
  // ...
}
```

## Implementation details

The following features are **already implemented** and working:

| Feature | Implementation | Location |
|---------|---------------|----------|
| Poll every 5s | `waitForDeviceLink()` with `DEFAULT_POLL_MS = 5000` | `auth.ts:29`, `auth.ts:62-86` |
| Single auth token/QR | `requestPairingCode()` returns one code or one QR | `client.ts:1119-1209` |
| Auto timeout | Configurable `linkTimeoutSec` (15-600s, default 120s) | `auth.ts:30`, `auth.ts:41-45` |

Only the **default value** needs to change.

## Files to modify

- `src/tools/auth.ts` — Change `authEnvWaitForLink()` default from `false` to `true`
- `.cursor/skills/reinitiate/SKILL.md` — Remove `--set whatsapp-mcp-docker.auth_wait_for_link=false` (no longer needed)

## Priority

**Low** — Easy workaround exists; one-line fix when ready.

## Related documentation

- [REINITIATE skill](.cursor/skills/reinitiate/SKILL.md) — Currently sets `auth_wait_for_link=false` explicitly
- [authenticate tool docstring](src/tools/auth.ts) — Documents `waitForLink` parameter