# Docker Test Container — Quick Reference

**For:** WhatsApp MCP Docker Project  
**Container:** `tester-container`  
**Purpose:** Run tests in isolated Docker environment with all dependencies

---

## 🚀 Common Commands

### Build Test Container
```bash
# After code changes
docker compose --profile test build tester-container

# Force rebuild (remove cache)
docker rmi whatsapp-mcp-docker-tester-container:latest
docker compose --profile test build tester-container
```

### Run Tests
```bash
# All unit tests
docker compose --profile test run --rm tester-container npm run test:unit

# All integration tests
docker compose --profile test run --rm tester-container npm run test:integration

# All tests (unit + integration)
docker compose --profile test run --rm tester-container npm run test:all

# Single test file
docker compose --profile test run --rm tester-container npx tsx --test test/unit/timezone.test.ts
```

### Verify Files in Container
```bash
# Check if file exists
docker compose run --rm tester-container find . -name "timezone.ts"

# List all test files
docker compose run --rm tester-container find test -name "*.test.ts"

# Count TypeScript files
docker compose run --rm tester-container find src test -name "*.ts" | wc -l
```

---

## ⚠️ Troubleshooting

### "Cannot find module" Error
```bash
# ❌ Wrong - node can't resolve .ts files
docker compose run --rm tester-container node --test test/unit/timezone.test.ts

# ✅ Correct - use tsx
docker compose run --rm tester-container npx tsx --test test/unit/timezone.test.ts

# ✅ Or use npm script
docker compose run --rm tester-container npm run test:unit
```

### Files Not Found in Container
```bash
# 1. Remove old image
docker rmi whatsapp-mcp-docker-tester-container:latest

# 2. Rebuild
docker compose --profile test build tester-container

# 3. Verify file exists
docker compose run --rm tester-container ls -la src/utils/timezone.ts
```

### Tests Using Stale Code
```bash
# Clear tsx cache
docker compose run --rm tester-container rm -rf node_modules/.vite

# Rebuild
docker rmi whatsapp-mcp-docker-tester-container:latest
docker compose --profile test build tester-container
```

---

## 🔍 Diagnosis Commands

### Check Build Cache
```bash
# Watch for "CACHED" - means old files
docker compose build tester-container 2>&1 | grep -E "CACHED|COPY"
```

### Check Container Environment
```bash
# Timezone
docker compose run --rm tester-container date

# Environment variables
docker compose run --rm tester-container env | grep -E "TZ|NODE"

# Node.js version
docker compose run --rm tester-container node --version
```

### Check File Permissions
```bash
docker compose run --rm tester-container ls -la test/unit/
```

---

## 📝 Key Concepts

### Why `noEmit: true`?
- Tests run with **`tsx`** (TypeScript executor)
- No `.js` files generated — faster builds
- Less disk space — no duplicate files
- **Cannot use `node --test`** — needs `tsx`

### Docker Build Cache
- **Good:** Fast rebuilds when nothing changed
- **Bad:** Stale files if cache not invalidated
- **Solution:** `docker rmi <image>` to force rebuild

### File Copy Timing
- Docker copies files at **build time**
- Changes after build → need rebuild
- Always verify: `docker compose run --rm tester-container find . -name "<file>"`

---

## 🎯 Best Practices

1. **After adding files:** Always rebuild
   ```bash
   docker rmi whatsapp-mcp-docker-tester-container:latest
   docker compose --profile test build tester-container
   ```

2. **Use npm scripts:** Don't run `node` directly
   ```bash
   ✅ npm run test:unit
   ❌ node --test test/unit/*.test.ts
   ```

3. **Verify before debugging:**
   ```bash
   docker compose run --rm tester-container find src test -name "*.ts" | wc -l
   ```

4. **Clear caches periodically:**
   ```bash
   docker compose run --rm tester-container rm -rf node_modules/.vite
   ```

5. **Watch build output:** If all layers say "CACHED", you have old files!

---

## 📚 Related Documentation

- `.cursor/skills/test-troubleshooting/SKILL.md` — Full troubleshooting guide
- `docs/testing/TIMEZONE-TESTS.md` — Timezone test documentation
- `tsconfig.test.json` — Test TypeScript config (`noEmit: true`)
- `Dockerfile` (test stage) — Container build instructions

---

## 🆘 Quick Fix Checklist

When tests fail unexpectedly:

- [ ] Did you rebuild after adding files? `docker rmi && docker compose build`
- [ ] Are you using `tsx` not `node`? `npx tsx --test` not `node --test`
- [ ] Do files exist in container? `docker compose run --rm tester-container find .`
- [ ] Is build cache stale? Check for "CACHED" in build output
- [ ] Is timezone correct? `docker compose run --rm tester-container date`
- [ ] Are permissions OK? `docker compose run --rm tester-container ls -la`

**When in doubt:** Remove image and rebuild!

```bash
docker rmi whatsapp-mcp-docker-tester-container:latest
docker compose --profile test build tester-container
```
