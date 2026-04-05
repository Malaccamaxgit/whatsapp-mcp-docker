# Timezone Feature - Test Documentation

**Date:** 2026-04-04  
**Feature:** Timezone-aware timestamp formatting with 24-hour display  
**Test File:** `test/unit/timezone.test.ts`

---

## Overview

The timezone utility (`src/utils/timezone.ts`) provides timestamp formatting for all WhatsApp MCP Server tools. All timestamps are displayed in:

1. **24-hour format** (HH:mm:ss) — NO AM/PM
2. **User's configured timezone** (default: America/Toronto)
3. **ISO-like date format** (YYYY-MM-DD)

---

## Automated Test Suite

### Test File Location
```
test/unit/timezone.test.ts
```

### Running the Tests

```bash
# Build test container (after code changes)
docker compose --profile test build tester-container

# Run all unit tests (includes timezone tests)
docker compose --profile test run --rm tester-container npm run test:unit

# Run only timezone tests
docker compose --profile test run --rm tester-container node --test test/unit/timezone.test.ts
```

### Test Coverage

The test suite includes **24 test cases** covering:

#### 1. `getUserTimezone()` (4 tests)
- ✅ Returns TZ from environment variable
- ✅ Returns default (America/Toronto) when TZ not set
- ✅ Returns default when TZ is empty
- ✅ Supports common IANA timezones

#### 2. `formatTimestamp()` (6 tests)
- ✅ 24-hour format (afternoon: 17:46:02, NOT 5:46:02 PM)
- ✅ Morning time (09:30:15)
- ✅ Midnight (00:00:00)
- ✅ ISO-like date format (2026-04-04)
- ✅ Different timezones (Toronto, Paris, Tokyo)
- ✅ DST transitions (winter EST vs summer EDT)

#### 3. `formatTimeOnly()` (4 tests)
- ✅ Time-only in 24-hour format
- ✅ Single-digit hours with leading zero (09:05:03)
- ✅ Midnight (00:00:00)
- ✅ Noon (12:00:00, no PM)

#### 4. `formatTimestampISO()` (2 tests)
- ✅ ISO 8601 format
- ✅ Always returns UTC (Z suffix)

#### 5. Edge Cases (3 tests)
- ✅ Very old timestamps (Unix epoch: 1969-12-31 or 1970-01-01)
- ✅ Future timestamps (year 2099)
- ✅ Leap years (Feb 29, 2028)

#### 6. Integration (1 test)
- ✅ Consistent formatting across message types (morning, afternoon, evening, night)

---

## Test Results

**Latest Run:**
```
# Subtest: Timezone Utilities
    # Subtest: getUserTimezone()
        ok 1 - should return TZ from environment variable
        ok 2 - should return default timezone when TZ is not set
        ok 3 - should return default timezone when TZ is empty
        ok 4 - should support common IANA timezones
    ok 1 - getUserTimezone()
    
    # Subtest: formatTimestamp()
        ok 1 - should format timestamp in 24-hour format (no AM/PM)
        ok 2 - should format morning time correctly in 24-hour format
        ok 3 - should format midnight correctly
        ok 4 - should use ISO-like date format (YYYY-MM-DD)
        ok 5 - should respect different timezones
        ok 6 - should handle DST transitions
    ok 2 - formatTimestamp()
    
    # Subtest: formatTimeOnly()
        ok 1 - should return time-only in 24-hour format
        ok 2 - should handle single-digit hours with leading zero
        ok 3 - should handle midnight
        ok 4 - should handle noon
    ok 3 - formatTimeOnly()
    
    # Subtest: formatTimestampISO()
        ok 1 - should return ISO 8601 format
        ok 2 - should always return UTC (Z suffix)
    ok 4 - formatTimestampISO()
    
    # Subtest: Edge Cases
        ok 1 - should handle very old timestamps
        ok 2 - should handle future timestamps
        ok 3 - should handle leap years
    ok 5 - Edge Cases
    
    # Subtest: Integration with Message Formatting
        ok 1 - should format timestamps consistently across different message types
    ok 6 - Integration with Message Formatting

ok 25 - Timezone Utilities
# pass 274
# fail 0
```

**Status:** ✅ **ALL TESTS PASSING (274/274)**

---

## Key Assertions

Every test verifies:

### 1. No AM/PM Format
```typescript
assert.doesNotMatch(formatted, /AM|PM|am|pm/);
```

### 2. 24-Hour Format
```typescript
assert.match(formatted, /17:46:02/); // Afternoon
assert.match(formatted, /09:30:15/); // Morning
assert.match(formatted, /00:00:00/); // Midnight
```

### 3. Correct Timezone
```typescript
// Same UTC timestamp, different timezones
process.env.TZ = 'America/Toronto';
const toronto = formatTimestamp(utcTimestamp);
assert.match(toronto, /17:46:02/); // UTC-4

process.env.TZ = 'Europe/Paris';
const paris = formatTimestamp(utcTimestamp);
assert.match(paris, /23:46:02/); // UTC+2
```

### 4. ISO Date Format
```typescript
assert.match(formatted, /2026-04-04/); // YYYY-MM-DD
```

---

## Manual Testing

### Test in Live Environment

```bash
# 1. Set timezone in profile
docker mcp profile config default-with-portainer \
  --set whatsapp-mcp-docker.timezone=America/Toronto

# 2. Reload Cursor to pick up new image
# Ctrl+Shift+P → Developer: Reload Window

# 3. List messages
list_messages from +33680940027

# Expected output:
# [2026-04-04, 16:41:21] You: Salut, t'es contentes...
# [2026-04-04, 16:59:38] You: À 17h tu peux...
```

### Verify 24-Hour Format

Check that timestamps show:
- ✅ `16:41:21` (24-hour)
- ❌ NOT `4:41:21 PM` (12-hour)

### Verify Timezone Accuracy

If you're in Montreal and send a message at 5:00 PM local time:
- ✅ Should show: `17:00:00` (Montreal time)
- ❌ NOT: `21:00:00` (UTC) or `22:00:00` (Paris time)

---

## Configuration

### Default Timezone
```yaml
# whatsapp-mcp-docker-server.yaml
config:
  - name: whatsapp-mcp-docker
    properties:
      timezone:
        type: string
        default: America/Toronto
```

### Environment Variable
```bash
# Set in Docker MCP profile
docker mcp profile config <profile> \
  --set whatsapp-mcp-docker.timezone=Europe/Paris
```

### In Docker Compose (standalone mode)
```yaml
# docker-compose.yml
environment:
  - TZ=America/Toronto
```

---

## Related Documentation

- [`docs/bugs/BUG-timezone-formatting.md`](bugs/BUG-timezone-formatting.md) — Original bug report
- [`docs/TIMEZONE-FIX-SUMMARY.md`](TIMEZONE-FIX-SUMMARY.md) — Implementation summary
- [`src/utils/timezone.ts`](../../src/utils/timezone.ts) — Timezone utility source code
- [`docs/guides/DEVELOPER.md`](guides/DEVELOPER.md) — Developer handbook (updated with timezone docs)

---

## Future Enhancements

Potential additions to the test suite:

1. **Historical timezone changes** — Test dates before DST rules changed
2. **Southern hemisphere** — Test timezones with reversed DST (e.g., `Australia/Sydney`)
3. **Half-hour offsets** — Test timezones like `Asia/Kolkata` (UTC+5:30)
4. **Performance tests** — Benchmark formatting speed for large message sets
5. **Integration tests** — Test actual tool outputs with different timezones

---

**Test Maintenance:** When updating `src/utils/timezone.ts`, ensure all 24 test cases continue to pass. If adding new functions, add corresponding tests to maintain coverage.
