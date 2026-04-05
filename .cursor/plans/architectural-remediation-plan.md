# Architectural Remediation Plan (TO-DO)

## Goal
Address the highest-risk architectural, security, reliability, and documentation gaps identified in the full repository review.

## Current Status
- Completed: 13/13 checklist items
- Remaining: 0 items

## Priority 1 - Critical

- [x] Enforce `DISABLED_TOOLS` checks in all tool handlers.
  - Files: `src/tools/groups.ts`, `src/tools/contacts.ts`, `src/tools/reactions.ts`, `src/tools/wait.ts`
  - Done when: every registered tool has a first-step `permissions.isToolEnabled('<tool>')` gate.

- [x] Do not require encryption key in production startup; require explicit documented insecure override behavior.
  - Files: `src/index.ts`, `src/security/crypto.ts`, docs in `SECURITY.md` and `README.md`
  - Done when: service supports startup without `DATA_ENCRYPTION_KEY` only through an explicit insecure override that is clearly documented in `SECURITY.md` and `README.md`.

## Priority 2 - High

- [x] Reconcile tool contract drift (34 vs runtime tools).
  - Files: `whatsapp-mcp-docker-server.yaml`, `README.md`, `docs/API.md`, `docs/architecture/OVERVIEW.md`
  - Done when: tool count and list are consistent across code, manifest, and docs.

- [x] Harden `download_media` authorization with chat binding.
  - Files: `src/tools/media.ts`, `src/whatsapp/client.ts`
  - Done when: handler validates `message_id` belongs to the requested/authorized chat before returning media.

- [x] Standardize test execution across local and CI.
  - Files: `package.json`, `Dockerfile`, `.github/workflows/security-audit.yml`
  - Done when: one canonical command is used in both CI and local workflows.

- [x] Fix broken E2E and benchmark script paths.
  - File: `package.json`
  - Done when: `test:auth`, `test:e2e`, and `test:bench` reference existing `.ts` files and run successfully in `tester-container`.

- [x] Define and enforce read/export access policy (not only send policy).
  - Files: `src/security/permissions.ts`, `src/tools/chats.ts`, `src/tools/media.ts`, `src/tools/contacts.ts`
  - Done when: policy explicitly covers read/export/download/enumeration operations and is enforced uniformly.

## Priority 3 - Medium

- [x] Add missing integration tests for high-impact tools.
  - Files: `test/integration/tools.test.ts` (and new focused tests as needed)
  - Targets: `disconnect`, `export_chat_data`, `migrate_duplicate_chats`, `send_file` success path.

- [x] Improve lifecycle and health coverage.
  - Files: `src/index.ts`, `src/healthcheck.ts`, corresponding tests
  - Done when: startup/shutdown and health behavior have direct automated tests.

- [x] Remove timing-based flake points in integration tests.
  - Files: `test/integration/wait.test.ts`, relevant polling tests
  - Done when: event-driven synchronization replaces brittle fixed sleeps where feasible.

- [x] Align security defaults documentation with runtime constants.
  - Files: `SECURITY.md`, `src/constants.ts`, `README.md`
  - Done when: rate limit defaults and auth defaults are internally consistent and code-backed.

- [x] Fix stale contributor/setup docs (`catalog.yaml`, test command mismatches).
  - Files: `CONTRIBUTING.md`, `CLAUDE.md`, `docs/testing/TESTING.md`, `docs/guides/DEVELOPER.md`
  - Done when: docs reference real manifests and valid commands only.

## Documentation Hygiene

- [x] Add/refresh `docs` indexing for active vs archived bug docs.
  - Files: `docs/README.md`, `docs/bugs/archived/README.md`

- [x] Mark historical plans as historical/superseded where appropriate.
  - Files: `docs/DOCUMENTATION-UPDATE-PLAN.md`, migration plan docs

## Suggested Execution Order

1. Policy enforcement and explicit insecure-override encryption policy
2. Tool contract reconciliation and media access hardening
3. Test pipeline/script fixes
4. Coverage additions
5. Documentation cleanup and archival hygiene
