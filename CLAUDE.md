# whatsapp-mcp-docker — TypeScript Migration

## START HERE

Before doing any migration work, **read `JS-to-TS-Migration-Plan.md`** — it contains the full step-by-step plan, file order, code examples, and Docker config changes. Do not start converting files without reading it first.

## Determine Current Progress

At the start of each session, figure out where the migration stands:
1. Check for `.ts` files in `src/` — if none exist, you're still at Step 0 (scaffolding)
2. Check if `tsconfig.json` exists — if not, Step 0 is incomplete
3. Count `.ts` vs `.js` files in `src/` to gauge progress through Steps 1-5
4. Check `git log --oneline -10` for stage-summary commits

## Key Rules

- **No `git push`** until migration is 100% complete, tested, and user explicitly authorizes
- **Commit after each file** (or logical batch) for easy rollback
- **All testing inside Docker** — never run tests locally outside the container
- **Stop at each stage boundary** — run verification gate, commit, output status, wait for user approval

## Conversion Guardrails

- **No `any` escape hatches** — use proper types, `unknown`, or generics. `any` is only acceptable for genuinely untyped third-party callbacks where no `@types/` package exists.
- **No logic changes** — a conversion commit must ONLY rename the file + add type annotations. Do not refactor, restructure, or "improve" code while converting. The following are logic changes and are **NOT** allowed:
  - Extracting inline handlers into factory functions or named functions
  - Removing `isError: false` from success responses (even if redundant, leave it)
  - Adding defensive `instanceof Error` guards that weren't in the original JS
  - Touching any file other than the one being converted (see "No cross-file changes" below)
  - **Exception — `server.tool()` → `server.registerTool()`**: the remaining `.js` tool files use `server.tool()` (old MCP SDK v1 positional API). All already-converted `.ts` files use `server.registerTool()` (current API). When converting Steps 4d–4g, migrate each call as part of the conversion — this is a required consistency fix, not a logic change. See the transformation recipe in **Known Type Pitfalls** below.
- **No cross-file changes** — converting `foo.js` must only produce `foo.ts`. If you discover that another file needs a change to make `foo.ts` compile (e.g. adding a getter to a class), that change goes in a **separate commit**. Do not silently bundle changes to unrelated files. If truly blocked, note the dependency and ask for guidance.
- **No import path changes** — `.js` extensions in imports resolve to `.ts` automatically via `NodeNext`. Leave all import paths exactly as they are.
- **No new abstractions** — don't introduce interfaces, type aliases, or utility types unless they directly annotate existing code.
- **Preserve JSDoc** — keep existing JSDoc comments; they serve as documentation even after adding TS types.
- **Do NOT delete the `.js` file until the verification gate passes** — keep the original `.js` alongside the new `.ts` until `tsc --noEmit` and the full test suite both pass. If a test fails you will need to read the original `.js` to diagnose what changed. Only delete the `.js` after a green build and test run.

## Error Recovery

If `tsc --noEmit` fails after a conversion:
1. Read the error message carefully — it tells you the file and line
2. Fix only the type error, do not change logic
3. Re-run `tsc --noEmit` until it passes
4. If stuck after 3 attempts on the same error, revert the file (`git checkout -- <file>`) and note the issue in the status block

If the test suite fails after a conversion:
1. Check if the failure is in the file you just converted or elsewhere
2. If elsewhere, your conversion likely broke an import — check the error path
3. If in your converted file, revert and re-examine the original JS for implicit behavior you may have changed

## Verification Gate (run at every stage boundary)

1. Rebuild with `--no-cache` — must pass:
   ```
   docker compose build --no-cache tester-container
   ```
   **Why `--no-cache`**: the builder stage runs `RUN npx tsc` with real `node_modules`. A cached image may hide new type errors introduced by the latest conversion. Always rebuild from scratch at stage boundaries.
2. Full test suite — must pass:
   ```
   docker compose run --rm tester-container npm run test:all
   ```
3. Commit with stage-summary message
4. Output status: files converted, tests passing/failing, deferred issues

**Lint is NOT a per-stage gate check.** Pre-existing formatting errors in original JS carry over into converted TS files and will not be fixed during conversion (that would violate the "no logic changes" rule). A single `npm run lint:fix` pass is deferred until after Step 11 (ESLint 9 migration), so fixes are made against the final linter config. If `npm run lint` fails at a stage boundary, note it as a known-deferred issue and continue.

## Import Path Convention

ESM imports use `.js` extensions. TypeScript `NodeNext` module resolution auto-resolves `.js` imports to `.ts` files — **no import paths need to change**.

## Quick Reference

- **Test command**: `docker compose run --rm tester-container npm run test:all`
- **Lint command**: `docker compose run --rm tester-container npm run lint`
- **Type patterns**: Use `z.infer<typeof schema>` for Zod types; MCP SDK and whatsmeow-node ship `.d.ts` files

## Known Type Pitfalls (discovered during migration)

These patterns appeared during Steps 1-3 and are likely to recur in Steps 4-6:

**`better-sqlite3` — `.get()` returns `unknown`, can't chain property access**
```typescript
// ❌ fails: Property 'count' does not exist on type 'unknown'
const n = db.prepare('SELECT COUNT(*) as count FROM t').get().count;
// ✓ fix: cast the get() result
const n = (db.prepare('SELECT COUNT(*) as count FROM t').get() as { count: number }).count;
```

**Generic functions with `unknown[]` parameter — cast the RESULT, not the argument**
```typescript
// ❌ fails: TypeScript can't infer T from unknown[] param; local variable stays Record<string,unknown>[]
const rows = this._decryptRows(stmt.all() as MessageRow[]);   // cast inside → ignored
// ✓ fix: cast the return value
const rows = this._decryptRows(stmt.all()) as MessageRow[];   // cast outside → works
// Note: return-statement context (e.g. `return this._decryptRows(...)`) DOES propagate T correctly.
// The issue only bites local `const` variables used downstream.
```

**`err?.message` on `Error | string` union**
```typescript
// ❌ fails: Property 'message' does not exist on type 'string'
const msg = err?.message || String(err);
// ✓ fix:
const msg = err instanceof Error ? err.message : String(err || '');
```

**Conflicting package type — use double cast**
```typescript
// ❌ fails: neither type is sufficiently related to the other
const client = createClient(opts) as WhatsmeowClient;
// ✓ fix:
const client = createClient(opts) as unknown as WhatsmeowClient;
```

**`FileHandle` — import from the right module**
```typescript
// ❌ fails: Namespace '"node:fs"' has no exported member 'FileHandle'
let fh: import('node:fs').FileHandle;
// ✓ fix:
let fh: import('node:fs/promises').FileHandle;
```

**`server.tool()` → `server.registerTool()` — required migration for Steps 4d–4g**

The remaining `.js` tool files use the old MCP SDK v1 positional API. Convert each call to the current API as part of the TS conversion:
```typescript
// ❌ old: server.tool(name, description, schema, handler)
server.tool(
  'send_message',
  'Send a WhatsApp message.',
  { to: z.string(), message: z.string() },
  async ({ to, message }) => { /* ... */ }
);

// ✓ new: server.registerTool(name, { description, inputSchema }, handler)
server.registerTool(
  'send_message',
  {
    description: 'Send a WhatsApp message.',
    inputSchema: { to: z.string(), message: z.string() }
  },
  async ({ to, message }) => { /* ... */ }
);
```
Key differences: `description` moves from positional arg → object key; third positional `schema` → `inputSchema` inside the config object; handler stays as the last positional arg.

**External API call signature errors — cast vs fix**

When `tsc` reports a type error on a `waClient` or SDK method call, follow this decision tree:

1. **Read the reference `.js` file first.** If the original `.js` uses *different* arguments than the `.ts` you're writing, the `.ts` has a bug from an earlier conversion — fix the call to match the `.js`.
2. **If both `.js` and `.ts` use the same arguments** and `tsc` still complains, the type definition is stricter than the runtime. Use a type cast; **do not change the arguments**:
   ```typescript
   // ❌ changes runtime behavior — args are now different
   await waClient.sendMessage(jid, message);
   // ✓ cast — same args as the original JS, just compiles cleanly
   await (waClient as unknown as { sendMessage(j: string, m: unknown): Promise<void> })
     .sendMessage(jid, { conversation: message });
   ```
3. **Never rename a method** (e.g. `sendPollCreation` → `createPoll`) during conversion. If a method is missing from the type definitions, cast the client to `unknown` first and call it. If the method genuinely no longer exists in the library, that is a separate fix commit — not part of the type conversion.

## Operator Guide — Copy-Paste Prompts

Use `/clear` between each sub-step. Paste the prompt for the current sub-step.

### Step 0 — Scaffolding
```
Execute Step 0 (Scaffolding) of the TypeScript migration. Read JS-to-TS-Migration-Plan.md for the full details. Create tsconfig.json, tsconfig.test.json, src/env.d.ts, update package.json scripts and devDependencies, update .eslintrc.json, update .gitignore and .dockerignore. Follow CLAUDE.md rules.
```

### Step 1 — Leaf Utilities
```
Step 1a: Convert src/utils/debug.js, src/utils/phone.js, and src/utils/fuzzy-match.js to TypeScript. Read JS-to-TS-Migration-Plan.md for the worked example and per-file process. Follow CLAUDE.md rules.
```
```
Step 1b: Convert src/constants.js and src/utils/zod-schemas.js to TypeScript. Follow CLAUDE.md rules.
```
```
Step 1c: Convert src/utils/errors.js and src/healthcheck.js to TypeScript. Follow CLAUDE.md rules.
```

### Step 2 — Security Layer
```
Step 2a: Convert src/security/crypto.js and src/security/audit.js to TypeScript. Follow CLAUDE.md rules.
```
```
Step 2b: Convert src/security/file-guard.js and src/security/permissions.js to TypeScript. Follow CLAUDE.md rules.
```

### Step 3 — WhatsApp Layer
```
Step 3a: Convert src/whatsapp/store.js to TypeScript. This is a complex file with SQLite and FTS5. Follow CLAUDE.md rules.
```
```
Step 3b: Convert src/whatsapp/client.js to TypeScript. This is the most complex file — carefully type event callbacks and whatsmeow-node interactions. Follow CLAUDE.md rules.
```

### Step 4 — Tool Modules
```
Step 4a: Convert src/tools/status.js, src/tools/wait.js, and src/tools/contacts.js to TypeScript. Follow CLAUDE.md rules.
```
```
Step 4b: Convert src/tools/approvals.js and src/tools/reactions.js to TypeScript. Follow CLAUDE.md rules.
```
```
Step 4c: Convert src/tools/auth.js to TypeScript. Follow CLAUDE.md rules.
```
```
Step 4d: Convert src/tools/messaging.js to TypeScript. Follow CLAUDE.md rules.
```
```
Step 4e: Convert src/tools/chats.js to TypeScript. Follow CLAUDE.md rules.
```
```
Step 4f: Convert src/tools/media.js to TypeScript. Follow CLAUDE.md rules.
```
```
Step 4g: Convert src/tools/groups.js to TypeScript. Follow CLAUDE.md rules.
```

### Step 5 — Server Core
```
Step 5: Convert src/server.js and src/index.js to TypeScript. These import everything — all dependencies are already converted. Follow CLAUDE.md rules.
```

### Step 6 — Tests
```
Step 6a: Convert test/integration/helpers/fixtures.js and test/integration/helpers/test-server.js to TypeScript. Follow CLAUDE.md rules.
```
```
Step 6b: Convert test/integration/helpers/mock-wa-client.js to TypeScript. Follow CLAUDE.md rules.
```
```
Step 6c: Convert test/unit/phone.test.js, test/unit/zod-schemas.test.js, and test/unit/permissions.test.js to TypeScript. Follow CLAUDE.md rules.
```
```
Step 6d: Convert test/unit/audit.test.js and test/unit/crypto.test.js to TypeScript. Follow CLAUDE.md rules.
```
```
Step 6e: Convert test/unit/errors.test.js and test/unit/file-guard.test.js to TypeScript. Follow CLAUDE.md rules.
```
```
Step 6f: Convert test/unit/fuzzy-match.test.js to TypeScript. Follow CLAUDE.md rules.
```
```
Step 6g: Convert test/integration/wait.test.js, test/integration/contacts.test.js, and test/integration/media-encryption.test.js to TypeScript. Follow CLAUDE.md rules.
```
```
Step 6h: Convert test/integration/reactions.test.js and test/integration/media-download-flow.test.js to TypeScript. Follow CLAUDE.md rules.
```
```
Step 6i: Convert test/integration/approvals-edge-cases.test.js to TypeScript. Follow CLAUDE.md rules.
```
```
Step 6j: Convert test/integration/tools.test.js to TypeScript. Follow CLAUDE.md rules.
```
```
Step 6k: Convert test/integration/groups.test.js, test/e2e/live.test.js, test/e2e/setup-auth.js, and test/benchmarks/performance.test.js to TypeScript. Follow CLAUDE.md rules.
```

### Step 7 — Strict Mode
```
Step 7: Enable strict mode in tsconfig.json (set "strict": true, remove "allowJs": true). Fix all resulting type errors. Read JS-to-TS-Migration-Plan.md for details. Follow CLAUDE.md rules.
```

### Steps 8-10 — Infrastructure
```
Step 8: Update the Dockerfile for TypeScript build pipeline. Read JS-to-TS-Migration-Plan.md Step 8 for the exact Dockerfile changes. Follow CLAUDE.md rules.
```
```
Step 9: Update CI/CD workflows. Replace node --check with tsc --noEmit in security-audit.yml. Read JS-to-TS-Migration-Plan.md Step 9. Follow CLAUDE.md rules.
```
```
Step 10: Final cleanup — remove any remaining .js source files, verify dist/ in .gitignore and .dockerignore, verify healthcheck. Read JS-to-TS-Migration-Plan.md Step 10. Follow CLAUDE.md rules.
```

### Step 11 — ESLint 8 → 9
```
Step 11: Migrate ESLint 8 → 9. Bump `eslint` to `^9.x` and add `@eslint/js@^9.x` in package.json devDependencies. Create `eslint.config.js` (flat config, ESM) from the exact template in JS-to-TS-Migration-Plan.md Step 11. Delete `.eslintrc.json`. Verify inside Docker: `npm run lint` must pass with no errors. Follow CLAUDE.md rules.
```
