---
name: run-tests
description: Run unit, integration, or E2E tests for the WhatsApp MCP Docker project. All tests run inside the Docker tester-container — never on the host. Use when the user asks to run tests, check test results, set up E2E authentication, or run a specific test file.
---

# Run Tests — WhatsApp MCP Docker

All tests run inside `tester-container`. Never use `npm test` on the host (Linux-only binary; exits 1).

## Build the test container first

Required before first run, or after code changes:

```bash
docker compose --profile test build tester-container
```

## Run all tests (unit + integration)

```bash
docker compose --profile test run --rm tester-container
```

## Run a specific layer

```bash
# Unit tests only
docker compose --profile test run --rm tester-container node --test test/unit/*.test.js

# Integration tests only
docker compose --profile test run --rm tester-container node --test test/integration/*.test.js

# Single test file
docker compose --profile test run --rm tester-container node --test test/unit/crypto.test.js
```

## E2E tests (live WhatsApp session)

```bash
# Step 1 — one-time auth (saves session to .test-data/ on host)
docker compose --profile test run --rm tester-container node test/e2e/setup-auth.js

# Step 2 — run live tests (read-only, no messages sent)
docker compose --profile test run --rm tester-container node --test test/e2e/live.test.js
```

Re-authenticate after ~20 days (WhatsApp session expiry).

## Lint / Format (inside container)

```bash
docker compose --profile test run --rm tester-container npx eslint src/
docker compose --profile test run --rm tester-container npx prettier --check src/
```

## Test layers at a glance

| Layer | Location | What it covers |
|-------|----------|----------------|
| Unit | `test/unit/` | Pure functions: phone, fuzzy-match, crypto, file-guard, permissions, audit, store |
| Integration | `test/integration/` | MCP protocol via mock WhatsApp client + in-memory transport |
| E2E | `test/e2e/` | Live WhatsApp session (read-only) |
