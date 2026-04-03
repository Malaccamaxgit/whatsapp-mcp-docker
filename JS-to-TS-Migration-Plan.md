# TypeScript Migration Plan for whatsapp-mcp-docker

## Context

The project is a pure JavaScript ESM codebase (25 source files in `src/`, ~18 test files in `test/`) running as a Docker MCP server. It uses `node:test` for testing, runs exclusively inside Docker containers, and has a multi-stage Dockerfile (builder -> test -> runtime). The goal is a low-risk, incremental migration to TypeScript that keeps the app functional at every step, with all verification happening inside the existing Docker test infrastructure.

---

## Task Complexity by Stage

| Stage | Steps | Complexity | Notes |
|---|---|---|---|
| **Scaffolding** | 0 | Low | Config files only |
| **Leaf utilities** | 1a-1c | Low | Pure functions, no internal deps |
| **Security layer** | 2a-2b | Medium | SQLite, crypto, validation logic |
| **WhatsApp layer** | 3a-3b | High | Event callbacks, complex client wrapper |
| **Tool modules** | 4a-4g | Medium | Repetitive pattern, but each tool has unique validation |
| **Server core** | 5 | Medium | Imports everything, wiring types |
| **Test conversion** | 6a-6k | Low | Mechanical — adding types to describe/it/assert |
| **Strict mode** | 7 | High | `strictNullChecks` requires control-flow reasoning |
| **Infrastructure** | 8-10 | Low | Dockerfile, CI yaml, gitignore |

### Handoff Protocol

At each sub-step boundary the executing agent must:
1. **Run the verification gate** — `tsc --noEmit` + full test suite in Docker
2. **Commit all work locally** with a descriptive message (e.g., `chore(ts): convert debug, phone, fuzzy-match to TypeScript`)
3. **Output a status block** summarizing: files converted, tests passing/failing, any deferred issues
4. **Stop execution** — do not proceed to the next sub-step without user approval

---

## Strategy

### Core Approach
1. **`tsx` as the migration bridge**: During the mixed JS/TS phase, `tsx` runs both `.js` and `.ts` files transparently. ESM imports with `.js` extensions resolve to `.ts` files automatically.
2. **`tsc --noEmit` for type checking**: Validates types without emitting — the build step (`tsc`) is added to the Dockerfile only.
3. **Existing Docker test stage**: Add TypeScript tooling to `devDependencies` so the existing test stage picks them up. No separate migration container.
4. **Leaf-first conversion**: Convert files with no internal imports first, then work inward toward `index.js`.

### Import Path Convention
The codebase already uses `.js` extensions in ESM imports (e.g., `import { X } from './utils/phone.js'`). With TypeScript's `NodeNext` module resolution, `.js` extension imports resolve to `.ts` source files automatically. **No import paths need to change during migration.**

---

## Step-by-step Implementation

### Step 0: Preparation (scaffold TypeScript infrastructure)

**Files to create/modify:**

1. **`tsconfig.json`** (new):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "allowJs": true,
    "checkJs": false,
    "strict": false,
    "esModuleInterop": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": false
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

2. **`tsconfig.test.json`** (new) — for type-checking tests:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "outDir": "dist-test",
    "noEmit": true
  },
  "include": ["src/**/*", "test/**/*"]
}
```

3. **`package.json`** — add devDependencies and update scripts:
```
devDependencies additions:
  "typescript": "^5.7.0",
  "tsx": "^4.19.0",
  "@types/node": "^22.0.0",
  "@types/better-sqlite3": "^7.6.0",
  "@types/qrcode": "^1.5.0",
  "@typescript-eslint/parser": "^8.0.0",
  "@typescript-eslint/eslint-plugin": "^8.0.0"

Script changes:
  "build": "tsc",
  "typecheck": "tsc --noEmit",
  "typecheck:test": "tsc --noEmit -p tsconfig.test.json",
  "test":             "npm run _guard && tsx --test test/unit/*.test.{js,ts} test/integration/*.test.{js,ts}",
  "test:unit":        "npm run _guard && tsx --test test/unit/*.test.{js,ts}",
  "test:integration": "npm run _guard && tsx --test test/integration/*.test.{js,ts}",
  "test:all":         "npm run _guard && tsx --test test/unit/*.test.{js,ts} test/integration/*.test.{js,ts}",
  "test:e2e":         "npm run _guard && tsx --test test/e2e/live.test.{js,ts}",
  "test:bench":       "npm run _guard && tsx --test test/benchmarks/performance.test.{js,ts}",
```

4. **`.eslintrc.json`** — add TypeScript support:
```json
{
  "parser": "@typescript-eslint/parser",
  "plugins": ["@typescript-eslint"],
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended"
  ],
  "parserOptions": {
    "ecmaVersion": 2022,
    "sourceType": "module",
    "project": null
  },
  "rules": {
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    "no-unused-vars": "off"
  },
  "ignorePatterns": ["node_modules/", "dist/", "build/", "coverage/"]
}
```
Note: Remove `"*.test.js"` from `ignorePatterns` — tests should be linted too. Keep all existing style rules (curly, eqeqeq, quotes, indent, etc.).

5. **`src/env.d.ts`** (new) — type all `process.env` variables:
```typescript
declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV?: string;
    STORE_PATH?: string;
    AUDIT_DB_PATH?: string;
    AUDIT_FALLBACK_PATH?: string;
    DATA_ENCRYPTION_KEY?: string;
    RATE_LIMIT_PER_MIN?: string;
    DOWNLOAD_RATE_LIMIT_PER_MIN?: string;
    ALLOWED_CONTACTS?: string;
    DISABLED_TOOLS?: string;
    MESSAGE_RETENTION_DAYS?: string;
    SEND_READ_RECEIPTS?: string;
    AUTO_READ_RECEIPTS?: string;
    PRESENCE_MODE?: string;
    WELCOME_GROUP_NAME?: string;
    AUTO_CONNECT_ON_STARTUP?: string;
    AUTH_WAIT_FOR_LINK?: string;
    AUTH_LINK_TIMEOUT_SEC?: string;
    AUTH_POLL_INTERVAL_SEC?: string;
    DEBUG?: string;
    TZ?: string;
  }
}
```

6. **`.gitignore`** — add `dist/` and `dist-test/` (verify `dist/` is already there).

7. **`.dockerignore`** — add `dist/` and `dist-test/`.

**Validation gate**: Build the test container, run `tsc --noEmit` (should pass on all existing JS with `allowJs: true` and `strict: false`), run the full test suite with `tsx --test`.

---

### Step 1: Leaf Utilities

**Per-file process** (applies to all conversion steps):
1. Rename `*.js` -> `*.ts`
2. Add type annotations (parameters, return types, interfaces)
3. Run `tsc --noEmit` — must pass
4. Run full test suite via `tsx --test` — must pass
5. Commit locally

#### Worked Example: `src/utils/debug.js` -> `src/utils/debug.ts`

**Before** (`debug.js`):
```javascript
const enabled = process.env.DEBUG ? process.env.DEBUG.split(',') : [];

export function debug(namespace) {
  const isEnabled = enabled.includes('*') || enabled.includes(namespace);

  if (!isEnabled) {
    return () => {};
  }

  return (message, ...args) => {
    const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
    const prefix = `[${timestamp}] [${namespace.toUpperCase()}]`;
    console.error(prefix, message, ...args);
  };
}

export function isDebugEnabled(namespace) {
  return enabled.includes('*') || enabled.includes(namespace);
}

export function debugOnce(namespace, message, ...args) {
  const log = debug(namespace);
  log(message, ...args);
}

export default debug;
```

**After** (`debug.ts`):
```typescript
type LogFn = (message: string, ...args: unknown[]) => void;

const enabled: string[] = process.env.DEBUG ? process.env.DEBUG.split(',') : [];

export function debug(namespace: string): LogFn {
  const isEnabled = enabled.includes('*') || enabled.includes(namespace);

  if (!isEnabled) {
    return () => {};
  }

  return (message: string, ...args: unknown[]) => {
    const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
    const prefix = `[${timestamp}] [${namespace.toUpperCase()}]`;
    console.error(prefix, message, ...args);
  };
}

export function isDebugEnabled(namespace: string): boolean {
  return enabled.includes('*') || enabled.includes(namespace);
}

export function debugOnce(namespace: string, message: string, ...args: unknown[]): void {
  const log = debug(namespace);
  log(message, ...args);
}

export default debug;
```

**What changed and why:**
- Added a `LogFn` type alias for the return type of `debug()` — avoids repeating the signature
- All function parameters got explicit types (`string`, `unknown[]`)
- All return types annotated (`: LogFn`, `: boolean`, `: void`)
- Used `unknown` instead of `any` for variadic args — safer, and `console.error` accepts `unknown`
- **No logic changes, no import path changes, no refactoring** — only types added
- JSDoc comments preserved (omitted here for brevity but kept in actual file)

#### Sub-steps

**Step 1a** — standalone utils (~315 lines):

| File | Lines | Internal deps |
|------|-------|---------------|
| `src/utils/debug.js` | 59 | None |
| `src/utils/phone.js` | 111 | None |
| `src/utils/fuzzy-match.js` | 145 | None |

**Step 1b** — constants + schemas (~294 lines):

| File | Lines | Internal deps |
|------|-------|---------------|
| `src/constants.js` | 258 | None |
| `src/utils/zod-schemas.js` | 36 | phone.js (converted in 1a) |

**Step 1c** — error handling (~282 lines):

| File | Lines | Internal deps |
|------|-------|---------------|
| `src/utils/errors.js` | 224 | constants.js (converted in 1b) |
| `src/healthcheck.js` | 58 | None |

---

### Step 2: Security Layer

**Step 2a** — crypto + audit (~275 lines):

| File | Lines | Internal deps |
|------|-------|---------------|
| `src/security/crypto.js` | 89 | None (node:crypto only) |
| `src/security/audit.js` | 186 | better-sqlite3, node:fs |

**Step 2b** — file-guard + permissions (~410 lines):

| File | Lines | Internal deps |
|------|-------|---------------|
| `src/security/file-guard.js` | 208 | constants.js |
| `src/security/permissions.js` | 202 | constants.js |

---

### Step 3: WhatsApp Layer

These are the most complex source files. The `client.js` wrapper around whatsmeow-node will need careful typing of the event callbacks and message types.

**Step 3a** — message store (~200+ lines):

| File | Lines | Internal deps |
|------|-------|---------------|
| `src/whatsapp/store.js` | 200+ | crypto.js |

**Step 3b** — WhatsApp client (~200+ lines):

| File | Lines | Internal deps |
|------|-------|---------------|
| `src/whatsapp/client.js` | 200+ | phone.js, file-guard.js, crypto.js, errors.js, constants.js |

---

### Step 4: MCP Tool Modules

All tools follow a similar pattern (`registerXTools(mcpServer, waClient, store, permissions, audit)`).

**Step 4a** — simplest tools (~354 lines):

| File | Lines | Internal deps |
|------|-------|---------------|
| `src/tools/status.js` | 74 | None (args passed in) |
| `src/tools/wait.js` | 147 | None (args passed in) |
| `src/tools/contacts.js` | 133 | phone.js, zod-schemas.js |

**Step 4b** — medium tools (~297 lines):

| File | Lines | Internal deps |
|------|-------|---------------|
| `src/tools/approvals.js` | 100+ | fuzzy-match.js, permissions.js |
| `src/tools/reactions.js` | 197 | fuzzy-match.js, phone.js, permissions.js |

**Step 4c** — auth (~412 lines):

| File | Lines | Internal deps |
|------|-------|---------------|
| `src/tools/auth.js` | 412 | phone.js |

**Step 4d** — messaging (~351 lines):

| File | Lines | Internal deps |
|------|-------|---------------|
| `src/tools/messaging.js` | 351 | fuzzy-match.js, phone.js, permissions.js |

**Step 4e** — chats (~396 lines):

| File | Lines | Internal deps |
|------|-------|---------------|
| `src/tools/chats.js` | 396 | fuzzy-match.js, permissions.js |

**Step 4f** — media (~257 lines):

| File | Lines | Internal deps |
|------|-------|---------------|
| `src/tools/media.js` | 257 | fuzzy-match.js, phone.js, permissions.js, file-guard.js |

**Step 4g** — groups (~384 lines):

| File | Lines | Internal deps |
|------|-------|---------------|
| `src/tools/groups.js` | 384 | fuzzy-match.js, phone.js, zod-schemas.js |

---

### Step 5: Server Core

**Step 5** — entry points (~304 lines):

| File | Lines | Internal deps |
|------|-------|---------------|
| `src/server.js` | 99 | Imports all tool modules |
| `src/index.js` | 205 | server.js, client.js, store.js, audit.js, permissions.js, crypto.js |

---

### Step 6: Test Infrastructure

Test conversion is more mechanical (adding types to describe/it/assert patterns).

**Step 6a** — test helpers (~193 lines):

| File | Lines |
|------|-------|
| `test/integration/helpers/fixtures.js` | 129 |
| `test/integration/helpers/test-server.js` | 64 |

**Step 6b** — mock client (~537 lines):

| File | Lines |
|------|-------|
| `test/integration/helpers/mock-wa-client.js` | 537 |

**Step 6c** — small unit tests (~467 lines):

| File | Lines |
|------|-------|
| `test/unit/phone.test.js` | 150 |
| `test/unit/zod-schemas.test.js` | 130 |
| `test/unit/permissions.test.js` | 187 |

**Step 6d** — security unit tests (~456 lines):

| File | Lines |
|------|-------|
| `test/unit/audit.test.js` | 216 |
| `test/unit/crypto.test.js` | 240 |

**Step 6e** — validation unit tests (~538 lines):

| File | Lines |
|------|-------|
| `test/unit/errors.test.js` | 260 |
| `test/unit/file-guard.test.js` | 278 |

**Step 6f** — fuzzy match unit test (~559 lines):

| File | Lines |
|------|-------|
| `test/unit/fuzzy-match.test.js` | 559 |

**Step 6g** — small integration tests (~598 lines):

| File | Lines |
|------|-------|
| `test/integration/wait.test.js` | 148 |
| `test/integration/contacts.test.js` | 232 |
| `test/integration/media-encryption.test.js` | 218 |

**Step 6h** — medium integration tests (~575 lines):

| File | Lines |
|------|-------|
| `test/integration/reactions.test.js` | 276 |
| `test/integration/media-download-flow.test.js` | 299 |

**Step 6i** — approvals integration test (~356 lines):

| File | Lines |
|------|-------|
| `test/integration/approvals-edge-cases.test.js` | 356 |

**Step 6j** — tools integration test (~439 lines):

| File | Lines |
|------|-------|
| `test/integration/tools.test.js` | 439 |

**Step 6k** — groups + e2e/benchmarks (~377+ lines):

| File | Lines |
|------|-------|
| `test/integration/groups.test.js` | 377 |
| `test/e2e/live.test.js` | small |
| `test/e2e/setup-auth.js` | small |
| `test/benchmarks/performance.test.js` | small |

---

### Step 7: Enable strict mode and finalize

1. Enable `"strict": true` in `tsconfig.json`
2. Fix all strict-mode type errors (primarily `noImplicitAny`, `strictNullChecks`)
3. Remove `"allowJs": true` from tsconfig (all files are now `.ts`)
4. Verify `tsc --noEmit` passes with strict mode
5. Verify full test suite passes

---

### Step 8: Update Docker build pipeline

**`Dockerfile`** — modify all three stages:

**Builder stage** — add TypeScript compilation:
```dockerfile
FROM node:20-alpine AS builder
RUN apk add --no-cache python3 make g++ linux-headers
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force
# Install typescript for build only (not included in runtime)
RUN npm install typescript
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc
# Remove typescript after build
RUN npm uninstall typescript
```

**Test stage** — use `tsx --test`:
```dockerfile
FROM node:20-alpine AS test
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
RUN npm install --include=dev && npm cache clean --force
COPY tsconfig.json tsconfig.test.json ./
COPY src/ ./src/
COPY test/ ./test/
COPY .eslintrc.json .prettierrc ./
RUN mkdir -p /data/store /data/audit .test-data && chown -R node:node /data .test-data
ENV NODE_ENV=test STORE_PATH=/data/store AUDIT_DB_PATH=/data/audit/audit.db
USER node
CMD ["/bin/sh", "-c", "npx tsx --test test/unit/*.test.ts test/integration/*.test.ts"]
```

**Runtime stage** — run compiled output from `dist/`:
```dockerfile
# Copy compiled output instead of source
COPY --from=builder /app/dist ./dist/
COPY package.json package-lock.json ./

# Update MCP labels
LABEL io.modelcontextprotocol.server.command='["node","dist/index.js"]'

# Update CMD
CMD ["node", "dist/index.js"]
```

**`docker-compose.yml`** — no structural changes needed (the build target references stay the same).

**`package.json`** — update entry point:
```json
"main": "dist/index.js",
"scripts": {
  "start": "node dist/index.js",
  "dev": "tsx --watch src/index.ts",
  "healthcheck": "node dist/healthcheck.js"
}
```

---

### Step 9: Update CI/CD

**`.github/workflows/security-audit.yml`**:
- Change `node --check src/*.js` syntax checks to `npx tsc --noEmit` (type checker validates syntax and types in one step)
- The Docker build/test steps work unchanged since they use the Dockerfile stages

**`.github/workflows/publish.yml`**:
- No changes needed (it builds the full Dockerfile which now includes `tsc`)

---

### Step 10: Cleanup

1. Remove `allowJs` from tsconfig (done in Step 7)
2. Remove any remaining `.js` source files
3. Verify `dist/` is in `.gitignore` and `.dockerignore`
4. Verify healthcheck still works: `HEALTHCHECK CMD node dist/healthcheck.js`
5. Final full test run in Docker: `docker compose build tester-container && docker compose run --rm tester-container npm run test:all`
6. Final lint: `docker compose run --rm tester-container npm run lint`
7. Final type check: `docker compose run --rm tester-container npm run typecheck`

---

### Step 11: ESLint 8 → 9 Migration

ESLint 8 is EOL. ESLint 9 drops the legacy `.eslintrc.*` format entirely and requires a **flat config** (`eslint.config.js`).

**1. Update `package.json` devDependencies:**

| Package | Change |
|---|---|
| `eslint` | `^8.57.0` → `^9.x` |
| `@eslint/js` | Add `^9.x` (new — needed for `js.configs.recommended` in flat config) |
| `@typescript-eslint/parser` | Unchanged — v8 supports ESLint 9 |
| `@typescript-eslint/eslint-plugin` | Unchanged — v8 supports ESLint 9 |

**2. Create `eslint.config.js`** (ESM — project is `"type": "module"`):

```js
import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: null,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-unused-vars': 'off',
      'no-console': 'off',
      'curly': ['error', 'all'],
      'eqeqeq': ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-multiple-empty-lines': ['error', { max: 1, maxEOF: 0 }],
      'no-trailing-spaces': 'error',
      'eol-last': 'error',
      'semi': ['error', 'always'],
      'quotes': ['error', 'single', { avoidEscape: true }],
      'indent': ['error', 2, { SwitchCase: 1 }],
      'comma-dangle': ['error', 'never'],
      'space-before-function-paren': ['error', 'always'],
      'space-in-parens': ['error', 'never'],
      'array-bracket-spacing': 'error',
      'object-curly-spacing': ['error', 'always'],
      'key-spacing': 'error',
      'no-multi-spaces': 'error',
      'space-infix-ops': 'error',
      'space-unary-ops': 'error',
      'func-call-spacing': 'error',
      'keyword-spacing': 'error',
      'space-before-blocks': 'error',
      'no-floating-decimal': 'error',
      'no-implicit-coercion': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-return-await': 'error',
      'require-await': 'error',
    },
  },
  {
    ignores: ['node_modules/', 'dist/', 'build/', 'coverage/'],
  },
];
```

Notes:
- `*.test.js` is removed from ignores — all test files are `.ts` by this step
- `no-spaced-func` is **removed** — it was dropped in ESLint 9 (superseded by `func-call-spacing`, already present)

**3. Delete `.eslintrc.json`**

**4. Verification:**

```
docker compose build --no-cache tester-container
docker compose run --rm tester-container npm run lint
```

No lint errors and no ESLint deprecation warnings in the build output = pass.

**Note:** Pre-existing formatting issues from the original JS files carry over into converted TS files. These are intentionally deferred — fixing them during conversion would mix formatting commits with type-annotation commits. Step 11 is the right place to resolve them: after switching to the final ESLint 9 config, run `npm run lint:fix` to auto-fix all formatting issues in one commit, then verify manually for any that require a hand-fix.

---

## Critical Files to Modify

| File | Nature of change |
|---|---|
| `tsconfig.json` | New — TypeScript configuration |
| `tsconfig.test.json` | New — Test-specific TS config |
| `src/env.d.ts` | New — ProcessEnv type augmentation |
| `package.json` | Add devDeps, update scripts, update main |
| `.eslintrc.json` | Add TS parser and plugin → deleted in Step 11 |
| `eslint.config.js` | New (Step 11) — flat config replacing `.eslintrc.json` |
| `.gitignore` | Ensure `dist/` is excluded |
| `.dockerignore` | Ensure `dist/` is excluded |
| `Dockerfile` | Add `tsc` build step, change CMD to `dist/` |
| `.github/workflows/security-audit.yml` | Replace `node --check` with `tsc --noEmit` |
| All 25 `src/**/*.js` files | Rename to `.ts`, add type annotations |
| All 18 `test/**/*.js` files | Rename to `.ts`, add type annotations |
| `test/integration/helpers/*.js` | Rename to `.ts`, add type annotations |

---

## Reusable Patterns Already in the Codebase

- **Zod schemas** (`src/utils/zod-schemas.js`): Already provides runtime validation. Use `z.infer<typeof schema>` to derive TypeScript types from existing schemas instead of duplicating type definitions.
- **MCP SDK types**: `@modelcontextprotocol/sdk` ships `.d.ts` files — `McpServer`, `StdioServerTransport`, request schemas are all typed.
- **whatsmeow-node types**: `@whatsmeow-node/whatsmeow-node` ships `.d.ts` files — `createClient` and event types are available.
- **JSDoc comments**: Many functions already have `@param`/`@returns` JSDoc — use these as the basis for TypeScript annotations.

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `tsx --test` glob mismatch during mixed phase | Use `{js,ts}` glob patterns in test scripts |
| Native module type mismatches (`better-sqlite3`) | `@types/better-sqlite3` + `skipLibCheck: true` |
| `node:test` incompatibility with `tsx` | `tsx` is a transparent ESM loader — `node:test` API is unaffected |
| Import resolution breaks (`.js` -> `.ts`) | `NodeNext` module resolution handles this natively |
| Accidental push of incomplete migration | Policy: no `git push` until user explicitly authorizes |
| CI breaks on TypeScript files | CI uses Docker stages which will be updated in Step 9 |
| Strict mode reveals hundreds of errors | Enable strict AFTER full conversion, fix incrementally |

---

## Verification Plan

After each file conversion:
1. `tsc --noEmit` passes (type check)
2. Full test suite passes via `tsx --test` in Docker

After full migration complete:
1. `npm run typecheck` — zero errors with `strict: true`
2. `npm run lint` — zero lint errors
3. `npm run test:all` — all unit + integration tests pass in Docker
4. `npm run build` — `tsc` produces `dist/` successfully
5. Docker production image builds and starts (`node dist/index.js`)
6. Healthcheck passes in running container
7. Manually test MCP tools via Docker MCP Toolkit (authenticate, send_message, list_chats)

---

## Policy

- **No `git push`** until migration is 100% complete, tested, and user explicitly authorizes
- **Commit after each file** (or logical batch) for easy rollback
- **All testing inside Docker** — never run tests locally outside the container
