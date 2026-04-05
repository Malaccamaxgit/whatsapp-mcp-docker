---
layout: default
title: Changelog
nav_order: 6
description: "Release history and change log for WhatsApp MCP Server."
---

# Changelog

All notable changes to WhatsApp MCP Docker will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.1] - 2026-04-04

### JID Unification - Duplicate Chat Contacts Fixed

Implemented a contact mapping system to unify duplicate chat entries caused by WhatsApp's different JID formats (`@lid` vs `@s.whatsapp.net`).

#### Added
- **Contact mappings table** — SQLite `contact_mappings` table to store JID relationships
- **JID utilities** — `src/utils/jid-utils.ts` with helper functions for JID detection and normalization
- **Automatic mapping** — Mappings created automatically when sending/receiving messages
- **Unified chat listing** — `getAllChatsUnified()` method merges duplicate entries
- **Migration tool** — `migrate_duplicate_chats` admin tool for backfilling existing duplicates
- **Integration tests** — 20+ test cases for JID unification

#### Changed
- **`list_chats` tool** — Now uses unified chat listing, shows both JID formats for reference
- **`src/whatsapp/client.ts`** — Stores contact mappings on message send/receive
- **`src/whatsapp/store.ts`** — Added mapping CRUD operations and migration method

#### Fixed
- **Duplicate contacts** — Same contact no longer appears twice in chat list
- **Fragmented conversations** — Messages from both JID formats now appear in single chat
- **Unread count accuracy** — Combined from duplicate entries

#### Technical Details
- Prefers `@lid` format for display (more stable, privacy-focused)
- Backward compatible — existing tools continue to work
- Automatic mapping — works transparently during normal message exchange
- Migration available — run `/migrate_duplicate_chats` to fix historical duplicates

#### Files Modified
- `src/whatsapp/store.ts` - Schema + mapping methods
- `src/utils/jid-utils.ts` - NEW - JID utilities
- `src/whatsapp/client.ts` - Automatic mapping
- `src/tools/chats.ts` - Unified listing + migration tool
- `test/integration/jid-unification.test.ts` - NEW - Tests

#### Test Results
✅ All 125 tests passed (including 20+ new JID unification tests)

---

## [0.3.0] - 2026-04-03

### TypeScript Migration Complete

The entire codebase has been migrated from JavaScript to TypeScript, providing full type safety and improved developer experience.

#### Added
- **TypeScript configuration** — `tsconfig.json` with strict type checking, `NodeNext` module resolution
- **Type declarations** — `src/env.d.ts` for environment variables, ambient types for MCP SDK and whatsmeow-node
- **Build pipeline** — TypeScript compilation in Dockerfile, `dist/` output directory
- **Development workflow** — `tsx --watch` for local development, `tsc --noEmit` for CI type checking

#### Changed
- **All source files** — 26 `.js` files in `src/` converted to `.ts` with full type annotations
- **All test files** — 16 `.js` test files converted to `.ts`
- **Tool registration API** — Migrated from `server.tool()` (MCP SDK v1) to `server.registerTool()` (current API)
- **ESLint** — Migrated from ESLint 8 (`.eslintrc.json`) to ESLint 9 (flat config, `eslint.config.js`)

#### Build & Runtime Changes
- **Entry point** — Changed from `src/index.js` to `dist/index.js` (compiled output)
- **Dev runtime** — Changed from `node --watch src/index.js` to `tsx --watch src/index.ts`
- **Type safety** — All tool inputs validated via Zod schemas with inferred TypeScript types
- **No runtime behavior changes** — All functionality remains identical; only type annotations added

#### Migration Statistics
| Metric | Count |
|--------|-------|
| Source files converted | 26 |
| Test files converted | 16 |
| Total lines of TypeScript | ~3,500 |
| Type errors fixed | 0 (clean build) |
| Tests passing | 100% |

#### Files Modified
- `src/**/*.ts` — All source files converted
- `test/**/*.ts` — All test files converted
- `tsconfig.json` — New TypeScript configuration
- `tsconfig.test.json` — Test-specific TypeScript configuration
- `Dockerfile` — Updated for TypeScript build pipeline
- `package.json` — Added TypeScript, `tsx`, updated scripts
- `eslint.config.js` — New ESLint 9 flat config

#### Backward Compatibility
- **No breaking changes** for end users — all tools work identically
- **No API changes** — MCP tool signatures unchanged
- **No data migration** required — database schema unchanged

---

## [Unreleased] - 2026-04-01

### Added

#### Authentication & Session Management
- **`disconnect` tool** - New tool to log out and disconnect from WhatsApp, clearing the session and requiring re-authentication
  - Use case: Users can unlink their device when they've unlinked their WhatsApp mobile app
  - Use case: Switch to a different WhatsApp account
  - Returns clear status messages about disconnection success/failure
  - Audit logged for security tracking

- **`AUTO_CONNECT_ON_STARTUP` environment variable** - Control automatic WhatsApp connection on container startup
  - Default: `true` (backward compatible with existing deployments)
  - Set to `"false"` to disable auto-connect (useful for testing, manual auth control)
  - Helps prevent unwanted connection attempts in test environments
  - Documented in `docker-compose.yml` with usage examples

#### Enhanced Connection Status
- **Improved `get_connection_status` tool output** - Clearer authentication state reporting
  - Shows three distinct states:
    - ✅ Connected & Authenticated (ready to use)
    - ⚠️ Session exists but disconnected (connection lost, needs re-auth)
    - ❌ Not authenticated (no session, needs initial auth)
  - Displays session JID when available for better debugging
  - Shows uptime when connected
  - Better error messaging for reconnection scenarios

#### Startup Diagnostics
- **Enhanced startup logging** - Clear authentication state reporting on container start
  - Logs auto-connect configuration (YES/NO)
  - Reports current authentication state with JID if connected
  - Audit log includes auth state for troubleshooting
  - Helps users immediately understand container state

### Changed

#### Documentation
- **`docker-compose.yml`** - Added comprehensive comments for new configuration options
  - `AUTO_CONNECT_ON_STARTUP` documented with use cases
  - Clear examples for testing scenarios

### Technical Details

#### Modified Files
- `src/index.js` - Enhanced startup diagnostics and auto-connect logic
- `src/tools/auth.js` - Added `disconnect` tool registration
- `src/tools/status.js` - Enhanced connection status reporting with three-state auth detection
- `docker-compose.yml` - Added `AUTO_CONNECT_ON_STARTUP` configuration option

#### Testing Implications
- **Unit tests needed:**
  - `disconnect` tool with active session
  - `disconnect` tool with no session (idempotent behavior)
  - `disconnect` tool when disabled via permissions
  - `get_connection_status` three-state reporting
  - Auto-connect startup behavior (enabled vs disabled)

- **Integration tests needed:**
  - Full auth → disconnect → re-auth flow
  - Container startup with `AUTO_CONNECT_ON_STARTUP=false`
  - Session persistence across container restarts
  - Manual auth trigger when auto-connect disabled

- **E2E tests needed:**
  - User workflow: start container → authenticate → use → disconnect → re-authenticate
  - Test environment setup with auto-connect disabled

### Migration Notes

#### For Existing Users
- **No breaking changes** - All changes are backward compatible
- Default behavior unchanged (auto-connect enabled)
- Existing sessions persist across updates
- New `disconnect` tool is optional

#### For Test Environments
- Set `AUTO_CONNECT_ON_STARTUP=false` to prevent automatic connection attempts
- Call `authenticate` tool explicitly when ready to test
- Use `disconnect` tool to clean up test sessions
- Check connection state with enhanced `get_connection_status`

### Security Considerations
- `disconnect` tool is subject to permission checks (can be disabled via `DISABLED_TOOLS`)
- All disconnect actions are audit logged
- Session cleanup removes authentication tokens securely
- No sensitive data exposed in status messages

---

## [0.1.1] - 2026-03-31

### Previous Release
- Initial MCP server implementation
- 13 tools: authenticate, get_connection_status, send_message, send_file, download_media, list_chats, list_messages, search_messages, search_contacts, catch_up, mark_messages_read, request_approval, check_approvals
- QR code and pairing code authentication
- SQLite message store with encryption
- Audit logging
- Rate limiting and permissions

---

## [Unreleased — Groups, Reactions, Contacts, Wait] - 2026-04-02

### Added

#### Group Management (9 new tools)
- **`create_group`** — Create a new WhatsApp group with specified participants
- **`get_group_info`** — Fetch name, description, participant list, and admin status for a group
- **`get_joined_groups`** — List all groups this account is a member of
- **`get_group_invite_link`** — Retrieve the invite link for a group (requires admin)
- **`join_group`** — Join a group via invite link or invite code
- **`leave_group`** — Leave a group permanently
- **`update_group_participants`** — Add, remove, promote, or demote participants (requires admin)
- **`set_group_name`** — Rename a group (requires admin)
- **`set_group_topic`** — Set or clear the group description (requires admin)

#### Message Actions (4 new tools)
- **`send_reaction`** — React to any message with an emoji; empty string removes the reaction
- **`edit_message`** — Edit a previously sent message (own messages, ≤15 min window)
- **`delete_message`** — Revoke a sent message for everyone in the chat
- **`create_poll`** — Send a poll with 2–12 options; optionally allow multiple selections

#### Contact & User Info (3 new tools)
- **`get_user_info`** — Fetch display name, status, and business details for up to 20 phone numbers
- **`is_on_whatsapp`** — Check whether up to 50 phone numbers have WhatsApp accounts
- **`get_profile_picture`** — Retrieve the CDN URL for a contact or group profile picture

#### Workflow (1 new tool)
- **`wait_for_message`** — Block until an incoming message arrives (optional chat/sender filter), returning full message metadata; useful for interactive AI workflows

#### Chats (1 new tool)
- **`export_chat_data`** — Export up to 10,000 messages as JSON or RFC 4180-compliant CSV for PIPEDA/Law 25 compliance

### Summary
Total tool count: **32** (was 13 in v0.1.1, 14 after `disconnect` was added)

---

## Implementation Checklist

### ✅ Completed (2026-04-01)
- [x] Add `disconnect` tool to auth.js
- [x] Enhance `get_connection_status` with three-state auth detection
- [x] Add `AUTO_CONNECT_ON_STARTUP` env variable support
- [x] Enhanced startup diagnostics logging
- [x] Update docker-compose.yml documentation
- [x] Build and test container
- [x] Create CHANGELOG.md

### 🔄 In Progress
- [ ] User-facing documentation updates
- [ ] Test suite updates

### ⏳ TODO
- [ ] Unit tests for `disconnect` tool
- [ ] Unit tests for enhanced status reporting
- [ ] Integration tests for auth lifecycle
- [ ] Update README.md with new features
- [ ] Add examples to documentation
- [ ] Update API documentation

---

## Future Enhancements (Under Consideration)

### Authentication Flow Improvements
- Session timeout configuration
- Automatic session refresh before expiration
- Multi-device support tracking
- Authentication webhook notifications

### Developer Experience
- Interactive authentication status dashboard
- Real-time connection state notifications
- Enhanced debugging mode with verbose logging
- Container health check improvements

### Security & Compliance
- Session audit trail export
- Compliance reporting for message retention
- Access control lists for specific contacts/groups
- Two-factor authentication support

---

**Contributors:** Benjamin Alloul
**Date Created:** 2026-04-01
**Last Updated:** 2026-04-01
