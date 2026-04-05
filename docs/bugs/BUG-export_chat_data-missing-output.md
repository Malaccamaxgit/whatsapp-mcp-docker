# BUG: export_chat_data text output shows only metadata, not exported messages

**Status: OPEN**

## Symptom

The `export_chat_data` tool calls `store.exportChatData()` which returns a rich object containing the full message list (with `id`, `timestamp`, `sender`, `body`, `hasMedia`, `mediaType`, etc.). However, the text output formatted for the user only shows metadata:

```
Exported: My Contact (+1234567890)
  Format: json
  Messages: 142
  Exported at: 2026-04-04T10:00:00.000Z
```

The actual exported message data is returned in the tool's result object (accessible programmatically via MCP) but never rendered in the human-readable text output. For CSV mode, only the first 500 characters of the CSV string are shown as a preview.

## Root cause

In `src/tools/chats.ts` (lines 406-426), the output formatting only displays:

- `chatName` / `jid`
- `messageCount`
- `exportedAt`
- `format`
- For CSV: first 500 chars of the data as a preview

The full `messages[]` array from the export result is available but not rendered.

## Impact

- Users calling the tool via MCP get the full data in the return object, but the text output (what they see in the chat) hides it
- CSV mode only shows a truncated 500-char preview, making it hard to verify the export without programmatic access
- Users may not realize the data is available in the return object and think the export was empty or failed

## Proposed fix

For JSON mode: Show a sample of the first few messages in the text output (e.g., first 3-5 messages), with a note that full data is in the return object.

For CSV mode: Increase the preview limit or show a summary (e.g., column headers + first N rows) instead of a raw 500-char truncation.

## Files to modify

- `src/tools/chats.ts` — output formatting in `export_chat_data` (lines 406-426)

**Priority: MEDIUM** — the data is available in the return object, but the text output should be more informative for interactive use.
