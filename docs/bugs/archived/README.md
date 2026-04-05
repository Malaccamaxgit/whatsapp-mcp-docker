# Archived Bug Reports

This folder contains bug reports that have been **resolved** and are kept for historical reference.

---

## Archived Bugs

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

Active (non-archived) bug reports remain in the parent `docs/bugs/` folder:

- `BUG-self-account-messages-not-received.md` — Message extraction issues
- `BUG-poll-votes-not-received.md` — Poll vote tracking
- `BUG-duplicate-chat-contacts.md` — @lid JID duplicates
- `BUG-websocket-not-connected.md` — WebSocket connection errors

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
