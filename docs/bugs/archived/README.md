# Archived Bug Reports

This index tracks bug reports that are archived and kept for historical reference.

---

## Archived Bugs

The following bug reports are treated as archived:

- `BUG-auth-wait-for-link-default.md`
- `BUG-check_approvals-missing-details.md`
- `BUG-export_chat_data-missing-output.md`
- `BUG-get_joined_groups-missing-participants.md`
- `BUG-group-chatjid-name-mismatch.md`
- `BUG-list_messages-missing-fields.md`
- `BUG-messages-appear-empty.md`
- `BUG-multi-device-tests-sqlite-error.md`
- `BUG-poll-votes-not-received.md`
- `BUG-qr-code-delayed-by-wait-for-link.md`
- `BUG-qr-code-not-shown-in-cursor.md`
- `BUG-search_contacts-missing-fields.md`
- `BUG-search_messages-missing-fields.md`
- `BUG-self-account-messages-not-received.md`
- `BUG-send_file-missing-timestamp.md`
- `BUG-websocket-not-connected.md`
- `archived/BUG-duplicate-chat-contacts.md`
- `archived/BUG-timezone-formatting.md`

### ✅ BUG-timezone-formatting.md (Archived: 2026-04-04)

**Issue:** Timestamps displayed in wrong timezone (UTC) and 12-hour AM/PM format  
**Status:** FIXED  
**Resolution:** Implemented timezone-aware formatting with 24-hour display

**Summary:**
- Created `src/utils/timezone.ts` utility
- Updated all timestamp formatting across tools
- Added 24 automated tests (all passing)
- Users now see times in their local timezone (e.g., `17:46:02` not `9:46:02 PM`)

**References:**
- `docs/TIMEZONE-FIX-SUMMARY.md` — Implementation details
- `docs/testing/TIMEZONE-TESTS.md` — Test documentation
- `test/unit/timezone.test.ts` — Automated tests

---

## Active Bugs

There are currently no active bug reports.

---

## Archiving Process

Bugs are archived when:
1. ✅ Issue is fully resolved
2. ✅ Tests are added and passing
3. ✅ Documentation is updated
4. ✅ Solution is deployed and verified

**To archive a bug:**
1. Update status to "FIXED" with resolution summary
2. Move to `docs/bugs/archived/` folder
3. Add references to solution documentation
4. Update this index

---

**Purpose:** Keeping resolved bugs accessible for historical context while maintaining a clear separation between active and resolved issues.
