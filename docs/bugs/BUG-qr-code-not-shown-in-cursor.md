# BUG: authenticate with waitForLink:true aborts in Cursor before QR/pairing code is shown

**Status: FIXED**

## Symptom

Calling `authenticate` with `waitForLink: true` (the old default) returned `Error: Aborted` in Cursor.
The QR code image and pairing code were generated correctly inside the container (visible in `docker logs`)
but were never surfaced to the user because Cursor cancelled the tool call before the 120-second wait ended.

## Root cause

`waitForLink: true` causes the MCP tool to block for up to `linkTimeoutSec` seconds (default 120) before
returning. Cursor has an internal timeout on tool-call responses and aborts the call mid-flight.
The container continues running and eventually logs the link-timeout, but the response is never delivered.

## Fix applied

**Option B — Changed default:** Flipped `waitForLink` default to `false` in both:
- `src/tools/auth.js` — `authEnvWaitForLink()` now returns `false` when unset
- `whatsapp-mcp-docker-server.yaml` — `auth_wait_for_link` config default is now `false`

The authenticate tool now returns the pairing code / QR image immediately.
Callers that explicitly pass `waitForLink: true` still get the blocking behaviour
(useful in non-Cursor environments that don't have a tool-call timeout).

## Files changed

- `src/tools/auth.js` — default logic inverted
- `whatsapp-mcp-docker-server.yaml` — config default `true` → `false`
