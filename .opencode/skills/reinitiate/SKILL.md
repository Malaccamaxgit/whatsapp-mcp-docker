---
name: reinitiate
description: Full teardown, then a fresh build and Docker MCP Toolkit registration for the WhatsApp MCP server. Runs project cleanup, then compose build, encryption secret, catalog create, profile add and config. Use when the user asks to reinitiate, reconfigure, reinstall from scratch, reset and redeploy, clean slate WhatsApp MCP, or run cleanup plus setup in one go.
---

# Reinitiate: Cleanup, Build, and Docker MCP Toolkit Deploy

This skill resets the project end to end. The result is the same as the `cleanup`
skill followed by the deploy sequence in the `docker-ops` skill.

## Before starting

Tell the user:

- MCP tools may stop during cleanup. After cleanup, the user must restart the
  opencode service.
- Cleanup removes all WhatsApp session, message, and audit data in the named
  volumes. The user must authenticate again.

## Step 0: discover the profile and catalog names

```bash
docker mcp profile ls
docker mcp catalog ls
```

- The profile comes from `docker mcp profile ls`. Use the profile that hosts
  opencode. The default is `common_core`.
- The catalog comes from `docker mcp catalog ls`. Use the custom catalog for this
  project. Do not use `mcp/docker-mcp-catalog:latest`, which is Docker's official
  catalog.

## Phase A: cleanup (full teardown)

Preferred: run the script from the repository root.

```powershell
cd <repo-root>
.\scripts\cleanup.ps1 -Force -Profile common_core -Catalog my-catalog
```

```bash
cd <repo-root>
chmod +x scripts/cleanup.sh
./scripts/cleanup.sh --force --profile common_core --catalog my-catalog
```

If the script is absent, run the steps in the `cleanup` skill in order: profile
server remove, secret rm, `docker compose down -v`, `docker rmi`,
`docker image prune -f`, catalog remove. Ignore benign errors for resources that
are already absent.

## Phase B: build

Run from the repository root. This directory holds `docker-compose.yml` and
`whatsapp-mcp-docker-server.yaml`.

Always use `--no-cache`. BuildKit layer caching can cache the TypeScript compile
even when a source file changes.

```bash
docker compose build --no-cache
```

Do not run `docker compose up -d` when the MCP Gateway manages the server. Build
only.

The compose file tags `malaccamax/whatsapp-mcp-docker:latest`. This tag matches
`whatsapp-mcp-docker-server.yaml`. The Gateway uses this image after the redeploy.

## Phase C: encryption secret (new key)

Set a new key after cleanup. Cleanup removes the old secret.

Recommended: use Python. This avoids `require()` escaping issues on Windows.

```powershell
$key = docker run --rm python:3-alpine python3 -c "import base64,os; print(base64.b64encode(os.urandom(32)).decode())"
docker mcp secret set "whatsapp-mcp-docker.data_encryption_key=$key"
```

Or use Node.js:

```powershell
$key = docker run --rm node:22-alpine node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
docker mcp secret set "whatsapp-mcp-docker.data_encryption_key=$key"
```

bash and zsh:

```bash
docker run --rm node:22-alpine node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" | docker mcp secret set whatsapp-mcp-docker.data_encryption_key
```

Verify with `docker mcp secret ls`.

## Phase D: catalog, profile, and configuration

Run from the repository root. The `file://./whatsapp-mcp-docker-server.yaml` path
resolves from there.

PowerShell, with backticks for line continuation:

```powershell
docker mcp catalog create my-catalog `
  --title "Ben's Tools" `
  --server file://./whatsapp-mcp-docker-server.yaml

docker mcp profile server add common_core `
  --server file://./whatsapp-mcp-docker-server.yaml

docker mcp profile config common_core `
  --set whatsapp-mcp-docker.rate_limit_per_min=60 `
  --set whatsapp-mcp-docker.message_retention_days=90 `
  --set whatsapp-mcp-docker.send_read_receipts=true `
  --set whatsapp-mcp-docker.auto_read_receipts=true `
  --set whatsapp-mcp-docker.presence_mode=available `
  --set whatsapp-mcp-docker.welcome_group_name=WhatsAppMCP `
  --set whatsapp-mcp-docker.auth_wait_for_link=false `
  --set whatsapp-mcp-docker.auth_link_timeout_sec=120 `
  --set whatsapp-mcp-docker.auth_poll_interval_sec=5
```

Re-running `docker mcp catalog create` with the same name replaces the entry.

## Phase E: reconnect opencode

opencode does not use `docker mcp client connect`. It starts the Gateway itself
through the `MCP_DOCKER` entry in `~/.config/opencode/opencode.jsonc`, on profile
`common_core`. After the registration changes, restart the opencode service so it
reconnects.

## Aftercare

1. Restart the opencode service.
2. Run `authenticate` with an E.164 phone number. The user can also ask the agent
   to run it.
3. If tools are missing, run `docker mcp profile activate common_core`. Also
   check the profile server list.

## Checklist

- [ ] Profile and catalog names confirmed.
- [ ] Cleanup completed.
- [ ] `docker compose build --no-cache` run from the repo root, no `compose up`.
- [ ] New `whatsapp-mcp-docker.data_encryption_key` set and verified.
- [ ] Catalog created, server added to the profile, `docker mcp profile config` applied.
- [ ] opencode service restarted.
- [ ] User reminded to re-authenticate WhatsApp.
