---
name: docker-ops
description: Docker operations for the WhatsApp MCP Docker project. Rebuild after code changes, view logs, reset data, register with the MCP Toolkit catalog, and manage profiles. Use when the user asks about rebuilding the container, viewing logs, resetting WhatsApp session data, or registering or updating the MCP Toolkit catalog entry.
---

# Docker Operations: WhatsApp MCP Docker

## Never stop a Gateway-managed container with `docker stop`

The MCP Gateway (Docker MCP Toolkit) manages the `whatsapp-mcp-docker` container
when the server is registered in a profile with `longLived: true`. If you stop
that container externally with `docker stop` or `docker compose down`, the
Gateway stdio process dies, and all MCP tools stop working with EOF errors. A
restart of the opencode service is required to recover.

Prohibited while the Gateway is active:

```bash
docker stop <gateway-container-name>   # kills the Gateway stdio process
docker compose down                    # same effect
```

Safe alternatives:

| Goal | Safe command |
|------|--------------|
| Restart the WhatsApp server | `docker mcp profile server remove <profile> whatsapp-mcp-docker`, then add it again |
| Reload after a code rebuild | `docker compose build --no-cache`, then restart the opencode service. The Gateway uses the new image on its next container restart. |
| Full reset | Disconnect the Gateway first, then `docker compose down -v`, then reconnect |

Recovery after an accidental stop:

1. Restart the opencode service.
2. Confirm the server is still registered in the profile.
3. Call `authenticate` to restore the WhatsApp session.

## Rebuild after code changes

If the Gateway is active, rebuild the image only. Do not run `docker compose up`.
The Gateway picks up the new image on the next container restart.

Critical: always build with `--no-cache`. BuildKit layer caching can cache the
`npx tsc` step even when `COPY src/` changes, and a cached `dist/` produces bugs
such as `getContact is not a function`.

```bash
docker compose build --no-cache
```

If you are not using the MCP Gateway (standalone mode only):

```bash
docker compose up -d --build --no-cache
```

## View logs

```bash
docker compose logs -f whatsapp-mcp-docker
docker compose logs --tail 50 whatsapp-mcp-docker
```

## Reset all data (nuclear option)

```bash
# Stop containers and delete volumes (session, messages, audit)
docker compose down -v
docker compose up -d --build
```

To reset only the session without wiping messages, delete the session file
inside the `whatsapp-sessions` volume.

## MCP Toolkit: register or update

### Discover the real profile and catalog names first

```bash
docker mcp profile ls
docker mcp catalog ls
```

- Profile: use the profile that hosts opencode. The global opencode config runs
  the Gateway with `--profile common_core`, so use `common_core` unless the user
  says otherwise.
- Catalog: use the custom catalog for this project, for example `my-catalog`. Do
  not remove `mcp/docker-mcp-catalog:latest`, which is Docker's official catalog.

### First-time setup

```bash
# 1. Build
docker compose build --no-cache

# 2. Create the catalog entry, so it appears in Docker Desktop, MCP Toolkit, Catalog
docker mcp catalog create my-catalog \
  --title "Ben's Tools" \
  --server file://./whatsapp-mcp-docker-server.yaml

# 3. Add the server to the profile
docker mcp profile server add common_core \
  --server file://./whatsapp-mcp-docker-server.yaml

# 4. Apply default configuration
docker mcp profile config common_core \
  --set whatsapp-mcp-docker.rate_limit_per_min=60 \
  --set whatsapp-mcp-docker.message_retention_days=90 \
  --set whatsapp-mcp-docker.send_read_receipts=true \
  --set whatsapp-mcp-docker.auto_read_receipts=true \
  --set whatsapp-mcp-docker.presence_mode=available \
  --set whatsapp-mcp-docker.welcome_group_name=WhatsAppMCP \
  --set whatsapp-mcp-docker.auth_wait_for_link=false \
  --set whatsapp-mcp-docker.auth_link_timeout_sec=120 \
  --set whatsapp-mcp-docker.auth_poll_interval_sec=5
```

PowerShell: replace the `\` line continuation with a backtick.

opencode does not use `docker mcp client connect`. It starts the Gateway itself
through the `MCP_DOCKER` entry in `~/.config/opencode/opencode.jsonc`. After a
registration change, restart the opencode service so it reconnects.

### Update the catalog and profile after YAML changes

```bash
docker mcp catalog create my-catalog \
  --title "Ben's Tools" \
  --server file://./whatsapp-mcp-docker-server.yaml

docker mcp profile server remove common_core whatsapp-mcp-docker
docker mcp profile server add common_core --server file://./whatsapp-mcp-docker-server.yaml
```

## Encryption key (one-time setup)

```bash
# Generate a strong key
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Store it securely, never commit it to git
docker mcp secret set whatsapp-mcp-docker.data_encryption_key
```

## Check volumes exist

```bash
docker volume ls | Select-String whatsapp
```

Expected: `whatsapp-sessions`, `whatsapp-audit`.
