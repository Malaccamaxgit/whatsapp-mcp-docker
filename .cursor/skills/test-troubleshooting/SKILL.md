---
name: test-troubleshooting
description: >-
  Troubleshoot Docker test container build and test execution issues for WhatsApp MCP
  Server. Covers cached builds, missing files, tsx module resolution, and test failures.
  Use when tests fail to run, files are not found in containers, or builds use stale cache.
---

# Test Container Troubleshooting — WhatsApp MCP Docker

## Common Issues and Solutions

### Issue 1: Test Container Uses Cached Build (Files Not Updated)

**Symptom:**
- You added/modified a file (e.g., `src/utils/timezone.ts`)
- Test container build says "CACHED" for all layers
- Tests fail with "Cannot find module" or old behavior
- File exists on host but not in container

**Example Error:**
```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/src/utils/timezone.js'
```

**Root Cause:**
Docker build cache doesn't detect file changes if:
- File was added after the layer was cached
- File modification time didn't change (touch without content change)
- COPY layer used cached version

**Solution:**

#### Option A: Force Rebuild (Recommended)
```bash
# Remove the image completely
docker rmi whatsapp-mcp-docker-tester-container:latest

# Rebuild (will not use cache for changed layers)
docker compose --profile test build tester-container
```

#### Option B: Touch the File to Invalidate Cache
```powershell
# PowerShell - rewrite file to change timestamp
(Get-Content src/utils/timezone.ts) | Set-Content src/utils/timezone.ts

# Then rebuild
docker compose --profile test build tester-container
```

#### Option C: Use --no-cache (Slow, Full Rebuild)
```bash
docker compose --profile test build --no-cache tester-container
```

**Prevention:**
- Always check build output for "COPY src/" layer — if it says "CACHED", the container has old files
- After adding new files, explicitly remove and rebuild: `docker rmi <image> && docker compose build`
- Use `docker compose run --rm tester-container find src -name "*.ts"` to verify files exist in container

---

### Issue 2: Tests Work with `npm run test:unit` but Fail with `node --test`

**Symptom:**
```bash
# This works:
docker compose run --rm tester-container npm run test:unit

# This fails:
docker compose run --rm tester-container node --test test/unit/timezone.test.ts
```

**Error:**
```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/src/utils/phone.js'
```

**Root Cause:**
- `npm run test:unit` uses **`tsx`** which resolves `.ts` files directly
- `node --test` expects **compiled `.js` files** (which don't exist with `noEmit: true`)
- Your `tsconfig.test.json` has `"noEmit": true` — no `.js` files are generated

**Solution:**

**Always use `tsx` for running tests:**
```bash
# ✅ Correct - uses tsx (TypeScript executor)
docker compose run --rm tester-container npm run test:unit
docker compose run --rm tester-container npx tsx --test test/unit/*.test.ts

# ❌ Wrong - node can't resolve .ts files
docker compose run --rm tester-container node --test test/unit/timezone.test.ts
```

**Why this happens:**
- `tsx` is a TypeScript executor that transpiles in-memory
- It reads `.ts` files directly, no compilation step needed
- `node` expects pre-compiled JavaScript

**Prevention:**
- Use npm scripts: `npm run test:unit`, `npm run test:all`
- If running individual tests, always use `npx tsx --test`
- Remember: `noEmit: true` means no `.js` files exist for `node` to run

---

### Issue 3: File Exists on Host but Not in Container

**Symptom:**
```bash
# File exists on host
ls src/utils/timezone.ts  # ✅ Exists

# File missing in container
docker compose run --rm tester-container ls src/utils/timezone.ts
# ❌ No such file or directory
```

**Root Cause:**
- Docker COPY happened before file was created
- Build cache used old layer
- File in `.dockerignore` (check carefully!)

**Diagnosis:**
```bash
# 1. Check if file is in .dockerignore
cat .dockerignore | grep -v "^#" | grep -v "^$"

# 2. Check what was actually copied in build
docker compose build tester-container 2>&1 | grep "COPY src"

# 3. List files in container
docker compose run --rm tester-container find src/utils -name "*.ts"
```

**Solution:**

#### Step 1: Verify File is Not Ignored
```bash
# Check .dockerignore - these are excluded from build context
cat .dockerignore

# Common mistakes:
# ❌ src/utils/*.ts    (would ignore timezone.ts)
# ❌ **/timezone.*    (would ignore timezone.ts and timezone.test.ts)
```

#### Step 2: Force Docker to Re-copy Files
```bash
# Stop any running containers
docker compose down

# Remove the image
docker rmi whatsapp-mcp-docker-tester-container:latest

# Rebuild
docker compose --profile test build tester-container

# Verify file exists
docker compose run --rm tester-container ls -la src/utils/timezone.*
```

**Prevention:**
- Keep `.dockerignore` minimal — only exclude `node_modules`, `.git`, `*.md`, `dist/`
- After adding new files, always rebuild: `docker rmi <image> && docker compose build`
- Use `docker compose run --rm tester-container find . -name "<filename>"` to verify

---

### Issue 4: Test Passes Locally but Fails in Container

**Symptom:**
- Tests pass on host (if you could run them)
- Same tests fail in Docker container
- Different behavior with timezones, paths, or permissions

**Root Cause:**
- Different environment (TZ, NODE_ENV, file permissions)
- Missing dependencies in container
- Different Node.js version

**Diagnosis:**
```bash
# Check container environment
docker compose run --rm tester-container env | grep -E "TZ|NODE_ENV"

# Check Node version
docker compose run --rm tester-container node --version

# Check file permissions
docker compose run --rm tester-container ls -la test/unit/
```

**Solution:**

#### Timezone Issues
```bash
# Container TZ might differ from host
docker compose run --rm tester-container echo $TZ

# Set TZ in docker-compose.yml
environment:
  - TZ=America/Toronto
```

#### Permission Issues
```bash
# Files owned by root in container
docker compose run --rm tester-container ls -la test/

# Fix in Dockerfile
RUN chown -R node:node /app/test
```

**Prevention:**
- Always run tests in the container, not on host
- Set `TZ` environment variable explicitly in `docker-compose.yml`
- Use `USER node` in Dockerfile to avoid root ownership

---

### Issue 5: Tests Cached but Code Changed

**Symptom:**
- You changed test assertions
- Tests still pass with old behavior
- Test output shows old line numbers or messages

**Root Cause:**
- npm or tsx cached test results
- Docker layer cache

**Solution:**
```bash
# Clear npm cache (inside container)
docker compose run --rm tester-container npm cache clean --force

# Remove tsx cache
docker compose run --rm tester-container rm -rf node_modules/.vite

# Remove and rebuild image
docker rmi whatsapp-mcp-docker-tester-container:latest
docker compose --profile test build tester-container
```

**Prevention:**
- Add `rm -rf node_modules/.vite` to Dockerfile test stage if caching persists
- Use `--force-rm` flag: `docker compose run --rm tester-container ...`

---

## Quick Reference Commands

### Check if File Exists in Container
```bash
docker compose run --rm tester-container find . -name "timezone.ts"
docker compose run --rm tester-container ls -la src/utils/
```

### Force Rebuild Test Container
```bash
docker rmi whatsapp-mcp-docker-tester-container:latest
docker compose --profile test build tester-container
```

### Run Tests (Correct Way)
```bash
# All unit tests
docker compose --profile test run --rm tester-container npm run test:unit

# Single test file
docker compose --profile test run --rm tester-container npx tsx --test test/unit/timezone.test.ts

# All tests
docker compose --profile test run --rm tester-container npm run test:all
```

### Check Build Cache
```bash
# Watch for "CACHED" in build output
docker compose build tester-container 2>&1 | grep -E "CACHED|COPY"

# If all layers say "CACHED", container has old files
```

### Inspect Container Environment
```bash
# Check timezone
docker compose run --rm tester-container date

# Check environment variables
docker compose run --rm tester-container env | grep -E "TZ|NODE"

# Check Node.js version
docker compose run --rm tester-container node --version
```

---

## Best Practices

### 1. Always Rebuild After Adding Files
```bash
# After adding src/utils/newfile.ts or test/unit/newfile.test.ts:
docker rmi whatsapp-mcp-docker-tester-container:latest
docker compose --profile test build tester-container
```

### 2. Use npm Scripts, Not Direct node Commands
```bash
# ✅ Good - uses tsx
npm run test:unit

# ❌ Bad - node can't resolve .ts files
node --test test/unit/timezone.test.ts
```

### 3. Verify Files in Container
```bash
# After build, always verify:
docker compose run --rm tester-container find src test -name "*.ts" | wc -l
```

### 4. Clear Caches Periodically
```bash
# If tests behave strangely:
docker compose run --rm tester-container rm -rf node_modules/.vite
docker rmi whatsapp-mcp-docker-tester-container:latest
docker compose --profile test build tester-container
```

### 5. Document Test Requirements
When adding new tests, note in comments:
```typescript
/**
 * Timezone Formatting Tests
 * 
 * Run: docker compose run --rm tester-container npm run test:unit
 * 
 * Note: Uses tsx for TypeScript execution. Do not run with `node --test`
 * as noEmit: true means no .js files are generated.
 */
```

---

## Related Issues

- `docs/bugs/BUG-timezone-formatting.md` — Timezone implementation
- `docs/testing/TIMEZONE-TESTS.md` — Timezone test documentation
- `tsconfig.test.json` — Test TypeScript configuration (`noEmit: true`)
- `Dockerfile` (test stage) — Test container build instructions

---

## When to Use This Skill

Use this troubleshooting guide when:
- ✅ Tests fail with "Cannot find module" errors
- ✅ Build output shows "CACHED" for all layers
- ✅ Files exist on host but not in container
- ✅ Tests work with npm scripts but fail with direct `node` commands
- ✅ Test behavior differs between host and container
- ✅ After adding new source or test files
- ✅ Tests use stale code despite rebuilds

**Remember:** Docker build cache is both a blessing (fast builds) and a curse (stale files). When in doubt, **remove the image and rebuild!**
