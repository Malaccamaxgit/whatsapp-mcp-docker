# BUG: send_file output does not display the send timestamp

**Status: OPEN**

## Symptom

The `send_file` tool receives a `timestamp` field from `waClient.uploadAndSendMedia()` but does not include it in the output. The current output shows:

```
Sent [image] to: My Contact (+1234567890)
Message ID: 3EB0ABC123
```

The send timestamp is available but not displayed.

## Root cause

In `src/tools/media.ts` (lines 255-262), the output formatting includes:

- `mediaType`
- `jid` (resolved)
- `chatName`
- `result.id`

But `result.timestamp` is not included.

## Impact

- Users cannot verify when the file was sent without checking the message separately
- Inconsistent with other messaging tools that display timestamps
- Minor but useful for audit trails and debugging

## Proposed fix

Add the timestamp to the output:

```
Sent [image] to: My Contact (+1234567890)
Message ID: 3EB0ABC123
Sent at: 2026-04-04, 10:00:00
```

## Files to modify

- `src/tools/media.ts` — output formatting in `send_file` (lines 255-262)

**Priority: LOW** — minor enhancement that improves consistency and auditability.
