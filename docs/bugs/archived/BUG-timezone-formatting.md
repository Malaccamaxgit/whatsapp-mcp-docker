# BUG: Timestamps displayed in wrong timezone (not using configured timezone)

**Status:** ✅ **FIXED** (2026-04-04)

**Archived:** 2026-04-04 — Moved to archived folder after successful fix

---

## Resolution Summary

This bug was **successfully resolved** by implementing timezone-aware timestamp formatting:

### What Was Fixed

1. **Created timezone utility** (`src/utils/timezone.ts`)
   - `getUserTimezone()` — Reads `process.env.TZ` from Docker MCP profile
   - `formatTimestamp()` — Formats in 24-hour format with timezone
   - `formatTimeOnly()` — Time-only display (HH:mm:ss)
   - `formatTimestampISO()` — ISO 8601 for exports

2. **Updated all timestamp formatting** in:
   - `src/tools/messaging.ts` — `list_messages`, `search_messages`
   - `src/tools/wait.ts` — `wait_for_message`
   - `src/tools/chats.ts` — `list_chats`, `catch_up`
   - `src/tools/status.ts` — `get_connection_status`

3. **Added comprehensive tests** (`test/unit/timezone.test.ts`)
   - 24 test cases covering all formatting functions
   - Timezone conversion, DST handling, edge cases
   - All tests passing: 274/274 ✅

4. **Updated documentation**:
   - `docs/guides/DEVELOPER.md` — Timezone configuration
   - `docs/testing/TIMEZONE-TESTS.md` — Test documentation
   - `docs/TIMEZONE-FIX-SUMMARY.md` — Implementation summary

### Verification

**Before fix:**
```
[4/4/2026, 9:46:02 PM] You: À 17h tu peux...  ❌ (UTC, 12-hour)
```

**After fix:**
```
[2026-04-04, 17:46:02] You: À 17h tu peux...  ✅ (Montreal time, 24-hour)
```

### Test Results

```bash
# All unit tests passing
docker compose --profile test run --rm tester-container npm run test:unit
# pass 274
# fail 0
```

---

## Original Bug Report (Historical)


## Symptom

When displaying message timestamps in `list_messages`, `list_chats`, `wait_for_message`, and other tools, times are shown in **UTC** or the **container's system timezone** instead of the user's configured timezone.

### Example

- **User location:** Montreal, Quebec (America/Toronto timezone, EST/EDT)
- **Actual local time:** 17:46 (5:46 PM)
- **Displayed time:** 21:46 (9:46 PM) or similar UTC conversion
- **Expected:** 17:46 (matching user's local time)

## Root Cause

The code uses JavaScript's `.toLocaleString()` **without specifying a timezone**:

```typescript
// ❌ Current implementation (src/tools/messaging.ts line 270)
const time = new Date(m.timestamp * 1000).toLocaleString();

// ❌ Also in wait.ts line 191
`Time: ${new Date(msg.timestamp * 1000).toISOString()}`

// ❌ Also in chats.ts line 72
? new Date(c.last_message_at * 1000).toLocaleString()
```

When `.toLocaleString()` is called without arguments:
- In **Node.js**, it uses the **process default locale/timezone**
- In **Docker containers**, this is typically **UTC** unless `TZ` environment variable is set
- The **configured timezone** from Docker MCP profile is **ignored**

## Configuration Already Exists

The server YAML (`whatsapp-mcp-docker-server.yaml`) already defines:

```yaml
config:
  - name: whatsapp-mcp-docker
    properties:
      timezone:
        type: string
        description: IANA timezone for timestamps (e.g. America/Toronto, America/New_York, Europe/Paris)
        default: America/Toronto
```

And the environment variable is mapped:

```yaml
env:
  - name: TZ
    value: "{{whatsapp-mcp-docker.timezone}}"
```

**However**, the code never reads `process.env.TZ` or the config value to format timestamps!

## Impact

| Problem | Effect |
|---------|--------|
| **Confusing UX** | Users see times in wrong timezone (UTC instead of local) |
| **Scheduling errors** | "À 17h" invitation vs displayed "9:46 PM" creates confusion |
| **Audit trail issues** | Timestamps in logs don't match user's clock |
| **International users** | Users in different timezones can't easily correlate times |

## Files to Fix

| File | Line(s) | Issue |
|------|---------|-------|
| `src/tools/messaging.ts` | 270, 398, 412 | `.toLocaleString()` without timezone |
| `src/tools/wait.ts` | 191 | `.toISOString()` always returns UTC |
| `src/tools/chats.ts` | 72, 150, 261 | `.toLocaleString()` / `.toLocaleTimeString()` without timezone |
| `src/tools/status.ts` | 69 | `.toLocaleString()` without timezone |
| `src/tools/approvals.ts` | 26-29 | Has `formatDateTime()` but uses default locale |
| `src/whatsapp/store.ts` | 558, 587 | `.toISOString()` in export functions |

## User Requirements

**Time format:** 24-hour format (HH:mm:ss), **NOT** 12-hour with AM/PM

**Example:**
- ✅ Correct: `17:46:02` (24-hour)
- ❌ Wrong: `5:46:02 PM` (12-hour with AM/PM)

**Rationale:** User is based in Montreal and prefers European/Canadian 24-hour time format standard.

---

## Fix Requirements

### 1. Read timezone from environment

```typescript
// Add to src/utils/timezone.ts (new file)
export function getUserTimezone(): string {
  return process.env.TZ || 'America/Toronto'; // Fallback to default
}
```

### 2. Create timezone-aware formatting function (24-hour format)

```typescript
// src/utils/timezone.ts
export function formatTimestamp(timestampSeconds: number): string {
  const tz = getUserTimezone();
  return new Date(timestampSeconds * 1000).toLocaleString('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false // Force 24-hour format (NO AM/PM)
  });
}

// For time-only display (HH:mm:ss)
export function formatTimeOnly(timestampSeconds: number): string {
  const tz = getUserTimezone();
  return new Date(timestampSeconds * 1000).toLocaleString('en-CA', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}
```

### 3. Replace all timestamp formatting

```typescript
// Before:
const time = new Date(m.timestamp * 1000).toLocaleString();

// After:
import { formatTimestamp } from '../utils/timezone.js';
const time = formatTimestamp(m.timestamp);
```

### 4. Update `wait_for_message` output

```typescript
// Before:
`Time: ${new Date(msg.timestamp * 1000).toISOString()}`

// After:
`Time: ${formatTimestamp(msg.timestamp)} (${getUserTimezone()})`
```

## Testing

After fix:

1. Set timezone in profile:
   ```bash
   docker mcp profile config <profile> --set whatsapp-mcp-docker.timezone=America/Toronto
   ```

2. Send a message and list messages:
   ```
   send_message to +1234567890 "Test"
   list_messages from +1234567890
   ```

3. Verify timestamp matches local time (e.g., 17:46 not 21:46)

4. Test with different timezones:
   - `America/New_York` (EST/EDT)
   - `Europe/Paris` (CET/CEST)
   - `Asia/Tokyo` (JST)
   - `UTC` (for comparison)

## Related Issues

- `BUG-self-account-messages-not-received.md` — Message extraction and display issues
- `BUG-poll-votes-not-received.md` — Poll data not captured
- `BUG-duplicate-chat-contacts.md` — Contact resolution with @lid JIDs

## Priority

**MEDIUM-HIGH** — Affects user experience and trust in timestamps. Users making plans (like "À 17h") need accurate time display.

## Workaround (Until Fixed)

Users can mentally convert from UTC to their local time, or check the container's timezone:

```bash
docker exec whatsapp-mcp-docker date
```

Or set the `TZ` environment variable in docker-compose.yml (though this won't help with MCP Gateway deployments).

---

## Implementation Notes

- **Backward compatibility:** Existing timestamps in SQLite are stored as Unix epoch (seconds since 1970), so they're timezone-agnostic. Only display formatting changes.
- **Export functions:** CSV/JSON exports should use ISO 8601 format with timezone offset (e.g., `2026-04-04T17:46:02-04:00`) for clarity.
- **Performance:** `.toLocaleString()` with `timeZone` option is fast enough for interactive use (<1ms per call).

---

## References (Solution Documentation)

- ✅ **FIXED** — Timezone feature implemented and tested
- 📄 `docs/TIMEZONE-FIX-SUMMARY.md` — Complete implementation summary
- 📄 `docs/testing/TIMEZONE-TESTS.md` — Test documentation and results
- 📄 `docs/guides/DEVELOPER.md` — Updated with timezone configuration
- 🧪 `test/unit/timezone.test.ts` — Automated test suite (24 tests, all passing)
- 🔧 `src/utils/timezone.ts` — Timezone utility implementation
- 🛠️ `.cursor/skills/test-troubleshooting/SKILL.md` — Test troubleshooting guide

**Status:** 🎉 Resolved — All timestamps now display in user's configured timezone with 24-hour format.
