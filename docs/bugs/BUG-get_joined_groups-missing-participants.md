# BUG: get_joined_groups only shows participant count, not member details

**Status: OPEN**

## Symptom

The `get_joined_groups` tool fetches full `JoinedGroup[]` data from the WhatsApp client, including the complete participant list with `jid`, `isAdmin`, and `isSuperAdmin` for each member. However, the output only shows:

- Group `name` / `jid`
- Participant `count` (e.g., "15 participants")

All participant details are fetched but discarded from the output.

## Root cause

In `src/tools/groups.ts` (lines 197-199), the output formatting is:

```
groups.map(g => `${g.name || g.jid} — ${g.participants?.length || 0} participants (${g.jid})`);
```

The `g.participants` array contains full objects but only `.length` is used.

## Impact

- Users cannot see who is in each group without calling `get_group_info` for each one
- Cannot see which members are admins from the list view
- Requires additional tool calls to get information that was already fetched

## Proposed fix

Enhance the output to show at minimum:
- Admin members (names/JIDs) inline
- Option flag (e.g., `show_participants`) to include full participant list in output

Example enhanced output:
```
Family Group — 15 participants (1234567890-1234567890@g.us)
  Admins: +1234567890 (owner), +0987654321
```

## Files to modify

- `src/tools/groups.ts` — output formatting in `get_joined_groups` (lines 197-199)

**Priority: LOW** — the tool is designed as a lightweight list; detailed participant info is available via `get_group_info`. However, showing admins inline would add value without excessive verbosity.
