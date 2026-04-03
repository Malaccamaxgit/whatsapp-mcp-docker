# Scripts

This directory contains helper scripts for common Docker and project operations.

---

## cleanup.ps1 / cleanup.sh — Full environment teardown

Removes everything the project created in Docker and Docker MCP Toolkit:

| Step | What is removed |
|------|----------------|
| 1 | `whatsapp-mcp-docker` from the MCP Toolkit profile |
| 2 | `whatsapp-mcp-docker.data_encryption_key` from the OS keychain |
| 3 | Containers + named volumes (`whatsapp-sessions`, `whatsapp-audit`) |
| 4 | Docker images (`malaccamax/whatsapp-mcp-docker:latest`) |
| 5 | Dangling build-cache layers from multi-stage builds |
| 6 | Custom MCP catalog (`my-custom-mcp-servers`) |

### Windows (PowerShell)

```powershell
# Interactive (asks for confirmation)
.\scripts\cleanup.ps1

# Skip confirmation
.\scripts\cleanup.ps1 -Force

# Preview — no changes made
.\scripts\cleanup.ps1 -DryRun

# Override profile or catalog name
.\scripts\cleanup.ps1 -Profile my-profile -Catalog my-catalog
```

### Linux/macOS (Bash)

```bash
chmod +x scripts/cleanup.sh
./scripts/cleanup.sh

# Skip confirmation
./scripts/cleanup.sh --force

# Preview — no changes made
./scripts/cleanup.sh --dry-run

# Override profile or catalog name
./scripts/cleanup.sh --profile my-profile --catalog my-catalog
```

> **Reload Cursor after cleanup** (`Ctrl+Shift+P → Reload Window`) — the MCP gateway
> process exits when containers are removed, so other MCP tools will show EOF errors
> until Cursor reconnects.

---

## test.ps1 / test.sh — Run tests

### Windows (PowerShell)

```powershell
.\scripts\test.ps1
```

### Linux/macOS (Bash)

```bash
chmod +x scripts/test.sh
./scripts/test.sh
```

### npm (Cross-platform)

```bash
npm run docker:test
```

## 📋 What the test scripts do

Each script automatically:

1. ✅ **Rebuilds** the test container (mandatory for latest code)
2. ✅ **Runs** all unit and integration tests
3. ✅ **Reports** results with clear pass/fail summary

## ⚠️ Why Rebuild is Mandatory

The test container copies source files during the Docker build process. Without rebuilding:

- ❌ Test changes won't be included
- ❌ Source code changes won't be reflected
- ❌ Helper function updates won't be available
- ❌ You'll test stale code from previous build

**Always rebuild before testing!**

##  Understanding Test Output

```
# tests 314
# suites 115
# pass 281
# fail 33
```

- **tests**: Total individual test cases
- **suites**: Test suite groups
- **pass**: Successful tests
- **fail**: Failed tests (investigate these)

## 🎯 Running Specific Tests

### Unit Tests Only

```bash
docker compose --profile test run --rm tester-container node --test test/unit/*.test.js
```

### Integration Tests Only

```bash
docker compose --profile test run --rm tester-container node --test test/integration/*.test.js
```

### Single Test File

```bash
docker compose run --rm tester-container node --test test/unit/crypto.test.js
```

### Tests Matching Pattern

```bash
docker compose run --rm tester-container node --test test/unit/*.test.js
```

## 🔧 Troubleshooting

### "Cannot find module" errors

**Cause:** Test container has stale code  
**Solution:** Rebuild container

```bash
docker compose --profile test build tester-container
```

### Permission denied errors

**Cause:** File ownership mismatch  
**Solution:** Fix ownership in container

```bash
docker compose run --rm tester-container chown -R node:node /app
```

### Tests pass locally but fail in CI

**Cause:** Platform differences or stale build  
**Solution:** Clean rebuild

```bash
docker compose --profile test build --no-cache tester-container
```

## 📝 Best Practices

1. ✅ **Always run tests before committing**
2. ✅ **Rebuild container after any code change**
3. ✅ **Run full test suite (`test:all`) for major changes**
4. ✅ **Run specific tests for focused development**
5. ✅ **Check test coverage for new features**

---

**See Also:**
- [TEST_RESULTS.md](../TEST_RESULTS.md) - Latest test results summary
- [CONTRIBUTING.md](../CONTRIBUTING.md) - Development guidelines
- [docs/guides/DEVELOPER.md](../docs/guides/DEVELOPER.md) - Developer handbook
