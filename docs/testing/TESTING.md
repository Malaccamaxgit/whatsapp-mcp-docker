---
layout: default
title: Testing Guide
parent: Guides
nav_order: 4
description: "Test strategy, layers (unit/integration/E2E), Docker test runner, and commands."
---

# Testing Guide

> **Testing documentation for WhatsApp MCP Server**

## Test Strategy

This project uses a **four-layer testing strategy** to ensure reliability and correctness:

```
┌─────────────────────────────────────────┐
│           Test Pyramid                   │
├─────────────────────────────────────────┤
│         E2E Tests (Live WhatsApp)        │  ← Fewest, slowest
│              Integration                 │
│              Unit Tests                  │  ← Most, fastest
│           Benchmarks                     │
└─────────────────────────────────────────┘
```

## Test Structure

```
test/
├── unit/                    # Pure logic tests (fast, isolated)
│   ├── crypto.test.ts
│   ├── file-guard.test.ts
│   ├── fuzzy-match.test.ts
│   ├── permissions.test.ts
│   ├── phone.test.ts
│   └── (legacy JS migration-era property test archived)
│
├── integration/             # MCP protocol tests (mock WhatsApp)
│   ├── tools.test.ts
│   ├── approvals-edge-cases.test.ts
│   ├── media-download-flow.test.ts
│   ├── media-encryption.test.ts
│   └── helpers/
│       ├── fixtures.ts
│       ├── mock-wa-client.ts
│       └── test-server.ts
│
├── e2e/                     # Live WhatsApp tests (read-only)
│   ├── setup-auth.ts
│   └── live.test.ts
│
└── benchmarks/              # Performance tests
    └── performance.test.ts
```

## Running Tests

### Prerequisites

```bash
# Build the test image (tester-container is behind the 'test' Compose profile)
docker compose --profile test build tester-container
```

### Unit Tests

Fast, isolated tests with no external dependencies:

```bash
# Run unit tests only
docker compose --profile test run --rm tester-container npx tsx --test test/unit/*.test.ts

# Run a specific test file
docker compose --profile test run --rm tester-container npx tsx --test test/unit/crypto.test.ts
```

### Integration Tests

Tests the full MCP tool chain with a mock WhatsApp client:

```bash
docker compose --profile test run --rm tester-container npx tsx --test test/integration/*.test.ts
```

### E2E Tests

**⚠️ Warning:** Requires an authenticated WhatsApp session. Read-only operations only.

```bash
# One-time auth setup
docker compose --profile test run --rm tester-container npx tsx test/e2e/setup-auth.ts

# Run live tests (uses .test-data/ for session persistence)
docker compose --profile test run --rm tester-container npx tsx --test test/e2e/live.test.ts
```

### Benchmarks

Performance regression testing:

```bash
docker compose --profile test run --rm tester-container npx tsx --test test/benchmarks/performance.test.ts
```

### All Tests

Run everything (unit + integration) — this is the default CMD for the test container:

```bash
docker compose --profile test run --rm tester-container
```

## Test Coverage

### Well-Tested Areas ✅

| Module | Coverage | Quality |
|--------|----------|---------|
| MessageStore | Excellent | CRUD, FTS, encryption, auto-purge |
| Crypto | Comprehensive | Round-trip, edge cases, unicode |
| File Guard | Strong | Path traversal, magic bytes, quotas |
| Fuzzy Match | Complete | Scoring, JID matching, ambiguity |
| Phone Utils | Thorough | E.164 validation, JID conversion |
| Permissions | Good | Rate limiting, whitelisting |

### Critical Paths Tested ✅

- ✅ Message sending with retry logic
- ✅ Error classification (transient vs permanent)
- ✅ Connection state management
- ✅ Media download validation
- ✅ File upload security checks
- ✅ Approval workflow detection
- ✅ Concurrent database access
- ✅ Session reconnection logic

### Media Encryption Tests ✅

The `test/integration/media-encryption.test.ts` file provides comprehensive coverage for field-level encryption:

| Test Case | Coverage Area |
|-----------|---------------|
| `should encrypt media_raw_json on write and decrypt on read` | Basic encryption/decryption cycle |
| `should handle media metadata encryption with special characters` | Unicode and emoji handling |
| `should handle mixed encrypted and plaintext media metadata` | Legacy plaintext migration |
| `should encrypt chat last_message_preview` | Chat preview encryption |
| `should handle approval encryption end-to-end` | Approval workflow encryption |
| `should maintain FTS5 search with encrypted bodies` | FTS5 + encryption compatibility |

**Key Findings:**
- All 6 test cases pass ✅
- Encryption is verified both in application layer (decrypted values) and database layer (prefixed values)
- FTS5 search maintains functionality with encrypted message bodies (stores plaintext separately)
- Legacy plaintext data coexists cleanly with encrypted data

### Test Metrics

These numbers were captured at a point in time and may be out of date — run the test container to get current counts:

```bash
docker compose --profile test run --rm tester-container
```



## Mock WhatsApp Client

The `createMockWaClient()` helper provides a fully-featured mock for testing:

```javascript
import { createMockWaClient } from '../integration/helpers/mock-wa-client.ts';

const mockClient = createMockWaClient();

// Configure behaviors
mockClient.setBehavior('sendMessage', async (jid, text) => {
  if (shouldFail) throw new Error('ECONNRESET');
  return { id: 'mock_123', timestamp: Date.now() };
});

// Set connection state
mockClient.setConnected(true);
mockClient.jid = '1234567890@s.whatsapp.net';

// Simulate scenarios
mockClient.simulateIncomingMessage({
  chatJid: '123@s.whatsapp.net',
  senderJid: '123@s.whatsapp.net',
  body: 'APPROVE approval_123',
  timestamp: Date.now()
});

// Inspect state
const sentMessages = mockClient.getSentMessages();
```

### Features

- ✅ Connection state management (`setConnected`, `isConnected`)
- ✅ Behavior configuration (`setBehavior`, `resetBehaviors`)
- ✅ Media download simulation (`setDownloadResult`)
- ✅ Message simulation (`simulateIncomingMessage`)
- ✅ State inspection (`getSentMessages`, `getReadReceipts`)
- ✅ Error simulation (throw proper Error objects)

## Dependency Injection

All major components support dependency injection for testability:

```javascript
// WhatsAppClient with mock injection
const client = new WhatsAppClient({
  storePath: '/tmp/test-store',
  messageStore: store,
  onMessage: () => {},
  onConnected: () => {},
  onDisconnected: () => {},
  client: mockClient,  // ✅ Inject mock
  config: {            // ✅ Override env vars
    SEND_READ_RECEIPTS: true,
    PRESENCE_MODE: 'available'
  },
  logger: console      // ✅ Custom logger
});
```

## Test Data Management

### In-Memory Databases

Unit tests use `:memory:` SQLite databases:

```javascript
const store = new MessageStore(':memory:');
const audit = new AuditLogger(':memory:');
```

### Persistent Test Data

E2E tests use `.test-data/` directory:

```bash
.test-data/
├── session.db      # WhatsApp session (persists across runs)
└── messages.db     # Message store
```

**Cleanup:**
```bash
# Remove all test data
rm -rf .test-data/
```

## Known Issues & Limitations

### Test Failures

Some tests may fail due to mock configuration gaps rather than real bugs. Run the test container to see the current status:

```bash
docker compose --profile test run --rm tester-container
```

Known areas with occasional failures:
- Pairing code flow edge cases
- Retry logic mock configurations
- Media metadata setup details

**Action Plan:** Fix incrementally as time permits.

### E2E Test Limitations

- Requires authenticated WhatsApp session
- Read-only operations only (no message sending)
- Session persists in `.test-data/`
- May fail if WhatsApp rate-limits test account

## Continuous Integration

### GitHub Actions

The security audit workflow runs on push and pull request:

```yaml
# .github/workflows/security-audit.yml (simplified)
name: Security Audit
on: [push, pull_request]
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v6
      - run: npm audit
      - run: tsc --noEmit  # TypeScript type check
      - run: docker compose --profile test build tester-container
      - run: docker compose --profile test run --rm tester-container
```

### Local Pre-commit

```bash
# Lint and format inside the test container
docker compose --profile test run --rm tester-container npx eslint src/
docker compose --profile test run --rm tester-container npx prettier --check src/
```

## Performance Benchmarks

### Current Benchmarks

| Operation | Target | Current | Status |
|-----------|--------|---------|--------|
| Message insert | <1ms | <1ms | ✅ |
| FTS search (1k msgs) | <100ms | <50ms | ✅ |
| List chats (100) | <20ms | <10ms | ✅ |
| Get message context | <5ms | <2ms | ✅ |

### Running Benchmarks

```bash
docker compose --profile test run --rm tester-container npx tsx --test test/benchmarks/performance.test.ts
```

**Output:**
```
▶ Performance Benchmarks
  ✔ MessageStore.addMessage: 0.8ms avg
  ✔ MessageStore.searchMessages: 45ms avg
  ✔ MessageStore.listChats: 8ms avg
```

## Authentication Testing

> These scenarios apply when manually testing the `authenticate` / `disconnect` / `get_connection_status` lifecycle via an MCP client (e.g. Cursor).

### Controlling Auto-Connect

To prevent automatic connection attempts during testing, set:

```yaml
environment:
  - AUTO_CONNECT_ON_STARTUP=false
```

This gives full control over when authentication happens.

### Deployment Scenarios

**Scenario A — Development / Interactive Testing**

```yaml
environment:
  - AUTO_CONNECT_ON_STARTUP=false
  - AUTH_WAIT_FOR_LINK=false
  - AUTH_LINK_TIMEOUT_SEC=60
```

Workflow: Start → call `authenticate` when ready → run tests → call `disconnect`. Repeat.

**Scenario B — Always-On / Production**

```yaml
environment:
  - AUTO_CONNECT_ON_STARTUP=true
  - AUTH_WAIT_FOR_LINK=false
  - AUTH_LINK_TIMEOUT_SEC=120
```

Workflow: Start (auto-connects if session exists) → call `authenticate` once → session persists across restarts.

**Scenario C — CI/CD Pipeline**

```yaml
environment:
  - AUTO_CONNECT_ON_STARTUP=false
  - DISABLED_TOOLS=send_message,send_file
  - MESSAGE_RETENTION_DAYS=0
```

Workflow: Start → mock auth or use test account → run automated tests → destroy container.

### Auth Lifecycle Test Cases

| # | Objective | Expected Result |
|---|-----------|----------------|
| T1 | Initial auth flow — QR/pairing code generation | `authenticate` returns code; after linking, status shows CONNECTED |
| T2 | Already authenticated detection | `authenticate` returns "Already authenticated"; no new QR |
| T3 | Authentication rate limiting | After several rapid attempts, returns rate-limit message with retry-after |
| T4 | Disconnect — clean session termination | `disconnect` returns success; status shows NOT AUTHENTICATED |
| T5 | Disconnect when not authenticated | Returns clear "Not currently authenticated" message; no error thrown |
| T6 | Re-authentication after disconnect | Full lifecycle: authenticate → disconnect → authenticate again works cleanly |

### Pre-Deployment Checklist

- [ ] Container starts successfully
- [ ] `get_connection_status` returns correct state
- [ ] `authenticate` generates QR or pairing code
- [ ] Connection established after linking
- [ ] `disconnect` clears session
- [ ] Re-authentication works after disconnect
- [ ] Send message after authentication
- [ ] Rate limiting enforced
- [ ] Audit logging works
- [ ] Session persists across container restarts

---

## Troubleshooting

### Test Fails with "Cannot find module"

**Cause:** Dependencies not installed in test container

**Fix:**
```bash
docker compose --profile test build tester-container
```

### E2E Tests Fail with "Not Authenticated"

**Cause:** No WhatsApp session in `.test-data/`

**Fix:**
```bash
docker compose --profile test run --rm tester-container npx tsx test/e2e/setup-auth.ts
```

### Tests Timeout

**Cause:** Mock client not properly configured

**Fix:** Check mock setup in test file, ensure `setConnected(true)` called

### SQLite Database Locked

**Cause:** Concurrent write operations

**Fix:** Already handled automatically by SQLite WAL mode. If persistent, add small delays between operations.

## Contributing Tests

### Test Naming Conventions

- Use descriptive names: `should_do_something_when_condition`
- Group related tests in `describe()` blocks
- Use `it()` for individual test cases

### Test Structure

```javascript
describe('FeatureName', () => {
  let component;
  
  beforeEach(() => {
    // Setup
  });
  
  afterEach(() => {
    // Cleanup
  });
  
  describe('methodName', () => {
    it('should do X when Y', () => {
      // Arrange
      // Act
      // Assert
    });
  });
});
```

### Mock Best Practices

1. Use `createMockWaClient()` instead of manual mocks
2. Configure behaviors with `setBehavior()` for specific scenarios
3. Reset behaviors in `afterEach()` to avoid test pollution
4. Use `setConnected()` to manage connection state
5. Inspect state with getter methods, not internal properties

### Code Coverage

While we don't enforce a specific coverage percentage, aim for:

- ✅ All critical paths tested
- ✅ Error scenarios covered
- ✅ Edge cases documented
- ✅ Security checks validated

## Historical Context

### Test Evolution

- **v0.0.1-v0.0.5:** Basic unit tests only (~50 tests)
- **v0.0.6-v0.0.9:** Added integration tests (~150 tests)
- **v0.1.0:** Full four-layer strategy (243 tests)
- **v0.1.1:** Mock client enhancements, DI support
- **v0.2.0:** TypeScript migration complete — all tests converted to `.ts`

### Note on Historical Test Files

Some previously planned test files were removed or consolidated during cleanup. The current test structure reflects what's actually in `test/` — see the Test Structure section above for the real file list.

## Resources

- [Node.js Test Runner Docs](https://nodejs.org/api/test.html)
- [MCP SDK Testing](https://modelcontextprotocol.io/docs/concepts/transports)
- [SQLite Testing Best Practices](https://www.sqlite.org/testing.html)
- [Mocking Strategies](https://martinfowler.com/articles/mocksArentStubs.html)
