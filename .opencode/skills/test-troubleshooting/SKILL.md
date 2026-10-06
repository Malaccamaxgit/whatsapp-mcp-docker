---
name: test-troubleshooting
description: Troubleshoot Docker test container build and test execution issues for the WhatsApp MCP server. Covers cached builds, missing files, tsx module resolution, and test failures. Use when tests fail to run, files are not found in containers, or builds use stale cache.
---

# Test Container Troubleshooting: WhatsApp MCP Docker

## Common issues and solutions

### Issue 1: the test container uses a cached build (files not updated)

Symptoms:

- You added or modified a file, for example `src/utils/timezone.ts`.
- The test container build says `CACHED` for all layers.
- Tests fail with `Cannot find module`, or show old behavior.
- The file exists on the host but not in the container.

Example error:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/src/utils/timezone.ts'
```

Root cause: the Docker build cache does not detect some file changes. This
happens when you add a file after a layer is cached, or when a modification time
does not change.

Solution, in order of preference:

```bash
# Option A: force a rebuild of the test image
docker rmi whatsapp-mcp-docker-tester-container:latest
docker compose --profile test build tester-container
```

```powershell
# Option B: touch the file to invalidate the cache, then rebuild
(Get-Content src/utils/timezone.ts) | Set-Content src/utils/timezone.ts
docker compose --profile test build tester-container
```

```bash
# Option C: full rebuild, slow
docker compose --profile test build --no-cache tester-container
```

Prevention: check the build output for the `COPY src/` layer. If it says
`CACHED`, the container has old files. After you add files, remove the image and
rebuild.

### Issue 2: tests work with `npm run test:unit` but fail with `node --test`

Symptoms:

```bash
# Works
docker compose run --rm tester-container npm run test:unit

# Fails
docker compose run --rm tester-container node --test test/unit/timezone.test.ts
```

Error: `Cannot find module '/app/src/utils/phone.ts'`.

Root cause: `npm run test:*` uses `tsx`. `tsx` resolves `.ts` files directly.
`node --test` expects compiled output. `tsconfig.test.json` sets `noEmit: true`,
so no compiled test output exists.

Solution: always use `tsx` for tests.

```bash
# Correct
docker compose run --rm tester-container npm run test:unit
docker compose run --rm tester-container npx tsx --test test/unit/*.test.ts

# Wrong
docker compose run --rm tester-container node --test test/unit/timezone.test.ts
```

### Issue 3: the file exists on the host but not in the container

Symptoms:

```bash
ls src/utils/timezone.ts                                   # exists on host
docker compose run --rm tester-container ls src/utils/timezone.ts   # missing
```

Root cause: the `COPY` ran before the file existed, the build cache was reused,
or the file is in `.dockerignore`.

Diagnosis:

```bash
cat .dockerignore | grep -v "^#" | grep -v "^$"
docker compose build tester-container 2>&1 | grep "COPY src"
docker compose run --rm tester-container find src/utils -name "*.ts"
```

Solution: stop containers, remove the image, and rebuild.

```bash
docker compose down
docker rmi whatsapp-mcp-docker-tester-container:latest
docker compose --profile test build tester-container
docker compose run --rm tester-container ls -la src/utils/timezone.*
```

### Issue 4: the test passes on the host but fails in the container

Root cause: a different environment, for example `TZ`, `NODE_ENV`, file
permissions, or the Node.js version.

Diagnosis:

```bash
docker compose run --rm tester-container env | grep -E "TZ|NODE_ENV"
docker compose run --rm tester-container node --version
docker compose run --rm tester-container ls -la test/unit/
```

Solution: set `TZ` in `docker-compose.yml`. Use `USER node` in the Dockerfile so
files are not owned by root.

### Issue 5: tests are cached but the code changed

Symptoms: you changed test assertions, but the old behavior still passes.

Solution:

```bash
docker compose run --rm tester-container npm cache clean --force
docker compose run --rm tester-container rm -rf node_modules/.vite
docker rmi whatsapp-mcp-docker-tester-container:latest
docker compose --profile test build tester-container
```

## Quick reference commands

```bash
# Check if a file exists in the container
docker compose run --rm tester-container ls -la src/utils/

# Force rebuild the test container
docker rmi whatsapp-mcp-docker-tester-container:latest
docker compose --profile test build tester-container

# Run tests the correct way
docker compose --profile test run --rm tester-container npm run test:all
docker compose --profile test run --rm tester-container npm run test:unit

# Check build cache
docker compose build tester-container 2>&1 | grep -E "CACHED|COPY"

# Inspect the container environment
docker compose run --rm tester-container date
docker compose run --rm tester-container env | grep -E "TZ|NODE"
```

## Best practices

1. Always rebuild after you add files.
2. Use npm scripts, not direct `node` commands.
3. Verify files in the container after a build.
4. Clear caches when tests behave strangely.

## Container writes and host pollution

The tester-container copies source at build time. It does not bind-mount the repo
by default. A tool that writes files (`eslint --fix`, `prettier --write`) changes
the container copy. The change is lost when the container exits.

To persist fixes to the host, bind-mount the source over the image copies:

```bash
docker compose --profile test run --rm \
  -v "${PWD}/src:/app/src" \
  -v "${PWD}/test:/app/test" \
  -v "${PWD}/eslint.config.js:/app/eslint.config.js" \
  tester-container npm run lint:fix
```

PowerShell: use backticks for the line continuation.

To verify a command that installs dependencies (for example the CI step
`npm install --include=dev`), copy the repo into a throwaway container instead of
bind-mounting. This keeps Linux `node_modules` off the host:

```bash
docker run --rm -v "${PWD}:/src:ro" node:20 sh -c "mkdir -p /w && (cd /src && tar cf - --exclude=.git --exclude=node_modules .) | (cd /w && tar xf -) && cd /w && npm install --include=dev"
```

On glibc this install step succeeds. npm skips the musl-only dependency
`@whatsmeow-node/linux-x64-musl`.

## When to use this skill

- Tests fail with `Cannot find module` errors.
- Build output shows `CACHED` for all layers.
- Files exist on the host but not in the container.
- Tests work with npm scripts but fail with direct `node` commands.
- Test behavior differs between the host and the container.
