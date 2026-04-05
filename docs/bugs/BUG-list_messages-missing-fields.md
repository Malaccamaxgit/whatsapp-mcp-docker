# BUG: list_messages output omits message ID and metadata fields

**Status: OPEN**

## Symptom

The `list_messages` tool retrieves full `MessageRow` objects from the database (13+ fields) but the `formatMsg` function in `src/tools/messaging.ts` only renders 3 of them in plain text:

- `timestamp`
- `sender` (derived from `is_from_me` / `sender_name`)
- `body` (truncated to 200 chars)

The `id` field is **never shown** in the output, despite being critical for `edit_message`, `delete_message`, `send_reaction`, and `download_media` operations. Users have no way to know which message ID to reference when trying to edit, delete, or react to messages.

Other fields like `is_read`, `has_media`, `media_mimetype`, `media_filename`, and `media_local_path` are also omitted from the output.

## Root cause

The `formatMsg` function in `src/tools/messaging.ts` (lines 267–278) collapses all message data into a single line of plain text:

```
const formatMsg = (m: MessageRow, prefix = '') => {
    const dir = m.is_from_me ? 'You' : m.sender_name || m.sender_jid?.split('@')[0] || 'Unknown';
    const time = formatTimestamp(m.timestamp);
    const body = m.body ? m.body.substring(0, 200) : m.has_media ? `[${m.media_type || 'media'}] (id: ${m.id})` : '[empty]';
    return `${prefix}[${time}] ${dir}: ${body}`;
};
```

Only the fallback branch for media messages without body text includes the `id`, and even then it's embedded in the media description rather than presented as a standalone field. The normal text path completely drops it.

This function is used in two places within `list_messages`:

1. **Normal listing** (`messaging.ts` line 296): `messages.map((m) => formatMsg(m))`
2. **Context listing** (`messaging.ts` lines 286–294): same `formatMsg` calls with a prefix parameter

## Impact

- **edit_message** — users cannot identify the message ID to edit
- **delete_message** — users cannot identify the message ID to delete
- **send_reaction** — users cannot identify the message ID to react to
- **download_media** — users cannot identify the message ID to download
- **is_read** status is invisible, so users cannot tell which messages have been read

## Proposed fix

Rewrite `formatMsg` to produce structured multi-line output that includes all key fields:

```
[2026-04-04, 21:17:14] You → Benjamin Alloul
  ID: 3EB0C12345ABCDEF
  Read: yes
  Hello mcp 22
```

Media messages:

```
[2026-04-04, 10:00:00] Benjamin Alloul → You
  ID: 3EB0XYZ789
  Read: no
  [image/jpeg: vacation.jpg] (downloaded: /data/media/vacation.jpg)
```

### Constraints

- Keep output readable and not excessively verbose
- Body text should still be truncated to 200 chars max
- Media metadata should only show when `has_media` is true
- The `media_raw_json` field should never be displayed (it's raw encrypted JSON)

## Files to modify

- `src/tools/messaging.ts` — rewrite `formatMsg` function (lines 267–278)

## Notes

The `search_messages` tool has its own inline formatting (lines 409–415) that does not use `formatMsg`. It should be updated separately or the new format could be shared in a future change.

**Priority:** Medium — affects usability of downstream message operations (edit, delete, react, download) but does not break core messaging functionality.
