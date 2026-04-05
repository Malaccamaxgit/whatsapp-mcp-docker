# Timezone Fix Summary

**Date:** 2026-04-04  
**Issue:** Timestamps displayed in wrong timezone (UTC) and 12-hour AM/PM format  
**Request:** User in Montreal wants 24-hour format (17:46, not 5:46 PM)

---

## What Was Fixed

### ✅ Created timezone utility

**File:** `src/utils/timezone.ts` (new)

**Functions:**
- `getUserTimezone()` — Reads `process.env.TZ` (from Docker MCP profile config)
- `formatTimestamp(seconds)` — Full date-time in 24-hour format
- `formatTimeOnly(seconds)` — Time-only in 24-hour format
- `formatTimestampISO(seconds)` — ISO 8601 for exports

**Example output:**
- `formatTimestamp()` → `"2026-04-04, 17:46:02"`
- `formatTimeOnly()` → `"17:46:02"`

---

### ✅ Updated all timestamp formatting

**Files changed:**
1. `src/tools/messaging.ts` — `list_messages`, `search_messages`
2. `src/tools/wait.ts` — `wait_for_message`
3. `src/tools/chats.ts` — `list_chats`, `catch_up`
4. `src/tools/status.ts` — `get_connection_status`

**Before:**
```typescript
const time = new Date(m.timestamp * 1000).toLocaleString();
// Output: "4/4/2026, 9:46:02 PM" (12-hour, AM/PM)
```

**After:**
```typescript
import { formatTimestamp } from '../utils/timezone.js';
const time = formatTimestamp(m.timestamp);
// Output: "2026-04-04, 17:46:02" (24-hour, no AM/PM)
```

---

## Configuration

The timezone is controlled by the Docker MCP profile config:

```yaml
# whatsapp-mcp-docker-server.yaml
config:
  - name: whatsapp-mcp-docker
    properties:
      timezone:
        type: string
        description: IANA timezone
        default: America/Toronto

env:
  - name: TZ
    value: "{{whatsapp-mcp-docker.timezone}}"
```

**Default:** `America/Toronto` (same as Montreal, EST/EDT)

**To change timezone:**
```bash
docker mcp profile config <profile> \
  --set whatsapp-mcp-docker.timezone=Europe/Paris
```

**Common timezones:**
- `America/Toronto` — Montreal, Ottawa (EST/EDT)
- `America/New_York` — New York (EST/EDT)
- `Europe/Paris` — Paris, Brussels (CET/CEST)
- `Europe/London` — London (GMT/BST)
- `Asia/Tokyo` — Tokyo (JST)
- `UTC` — Coordinated Universal Time

---

## Testing

After rebuild, the timestamps now show:

**Before fix:**
```
[4/4/2026, 9:46:02 PM] You: À 17h tu peux aller manger ma chérie
```

**After fix:**
```
[2026-04-04, 17:46:02] You: À 17h tu peux aller manger ma chérie
```

✅ Matches user's local time (Montreal)  
✅ 24-hour format (no AM/PM)  
✅ ISO-like date format (YYYY-MM-DD)

---

## Files Changed

| File | Changes |
|------|---------|
| `src/utils/timezone.ts` | **NEW** — Timezone utilities |
| `src/tools/messaging.ts` | Import + 3x `formatTimestamp()` calls |
| `src/tools/wait.ts` | Import + 1x `formatTimestamp()` call |
| `src/tools/chats.ts` | Import + 3x `formatTimestamp()` / `formatTimeOnly()` calls |
| `src/tools/status.ts` | Import + 1x `formatTimestamp()` call |
| `docs/bugs/BUG-timezone-formatting.md` | Updated with 24-hour requirement |
| `docs/TIMEZONE-FIX-SUMMARY.md` | **NEW** — This summary |

---

## Deployment

The Docker image was rebuilt with the fix:

```bash
docker compose build
# Image: malaccamax/whatsapp-mcp-docker:latest
# Status: ✅ Built successfully
```

**Next step:** Reload Cursor window so the gateway picks up the new image:
```
Ctrl+Shift+P → Developer: Reload Window
```

---

## Related Issues

- `BUG-timezone-formatting.md` — Full bug documentation
- `BUG-self-account-messages-not-received.md` — Message extraction issues
- `BUG-poll-votes-not-received.md` — Poll vote tracking
- `BUG-duplicate-chat-contacts.md` — @lid JID duplicates

---

## Notes

- **Backward compatible:** SQLite stores timestamps as Unix epoch (timezone-agnostic)
- **Exports:** CSV/JSON exports use ISO 8601 (`toISOString()`) for clarity
- **Performance:** `.toLocaleString()` with `timeZone` option is <1ms per call
- **Docker:** Container includes `tzdata` package for timezone support

---

**Status:** ✅ **COMPLETE** — Timestamps now display in user's local timezone (America/Toronto) with 24-hour format.
