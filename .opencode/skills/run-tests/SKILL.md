---
name: run-tests
description: Run unit, integration, or E2E tests for the WhatsApp MCP Docker project. All tests run inside the Docker tester-container, never on the host. Use when the user asks to run tests, check test results, set up E2E authentication, or run a specific test file.
---

# Run Tests: WhatsApp MCP Docker

Run all tests inside `tester-container`. Never run `npm test` on the host. It
exits 1 because the Linux-only binary is missing. The `_guard` script also blocks
the run unless `NODE_ENV=test`.

## Build the test container first

Required before the first run and after code changes:

```bash
docker compose --profile test build tester-container
```

## Run all tests (unit + integration)

```bash
docker compose --profile test run --rm tester-container npm run test:all
```

## Run a specific layer

```bash
# Unit tests only
docker compose --profile test run --rm tester-container npm run test:unit

# Integration tests only
docker compose --profile test run --rm tester-container npm run test:integration

# Single test file
docker compose --profile test run --rm tester-container npx tsx --test test/unit/crypto.test.ts
```

## E2E tests (live WhatsApp session)

```bash
# Step 1: one-time auth (saves the session to .test-data/ on the host)
docker compose --profile test run --rm tester-container npm run test:auth

# Step 2: run live tests (read-only, no messages sent)
docker compose --profile test run --rm tester-container npm run test:e2e
```

Re-authenticate after about 20 days. The WhatsApp session expires at that point.

## Lint and format (inside the container)

```bash
docker compose --profile test run --rm tester-container npm run lint
docker compose --profile test run --rm tester-container npm run format:check
```

## Test layers at a glance

| Layer | Location | What it covers |
|-------|----------|----------------|
| Unit | `test/unit/` | Pure functions: phone, fuzzy-match, crypto, file-guard, permissions, audit, store |
| Integration | `test/integration/` | MCP protocol through a mock WhatsApp client and in-memory transport |
| E2E | `test/e2e/` | Live WhatsApp session (read-only) |

## Notes

- The `npm run test:*` scripts use `tsx`. Do not run tests with `node --test`. It
  cannot resolve `.ts` files because `tsconfig.test.json` sets `noEmit: true`.
- Rebuild the test container after you change a `.ts` file, a `.test.ts` file, or
  `package.json`.
