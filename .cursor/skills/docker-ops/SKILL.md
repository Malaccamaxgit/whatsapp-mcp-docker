---
name: docker-ops
description: Docker operations for the WhatsApp MCP Docker project — rebuild after code changes, view logs, reset data, register with MCP Toolkit catalog, and manage profiles. Use when the user asks about rebuilding the container, viewing logs, resetting WhatsApp session data, or registering/updating the MCP Toolkit catalog entry.
---

# Docker Operations — WhatsApp MCP Docker

## ⚠️ Never stop gateway-managed containers with `docker stop`

The MCP Gateway (Docker MCP Toolkit) manages the `whatsapp-mcp-docker` container when it is registered in a profile with `longLived: true`. If you stop that container externally using `docker stop` or `docker compose down`, the gateway's stdio process dies and **all MCP tools in Cursor stop working** (EOF errors). Reloading the Cursor window is required to recover.

**Prohibited while the gateway is active:**
```bash
docker stop <gateway-container-name>   # kills the gateway stdio process
docker compose down                    # same effect
```

**Safe alternatives:**

| Goal | Safe command |
|------|-------------|
| Restart the WhatsApp server | `docker mcp profile server remove <profile> whatsapp-mcp-docker` then re-add |
| Reload after a code rebuild | Rebuild with `docker compose build`, then reload the Cursor window — the gateway picks up the new image on next tool call |
| Full reset | Stop gateway first by disconnecting Cursor (`docker mcp client disconnect cursor`), then `docker compose down -v`, then reconnect |

**Recovery if you accidentally stop gateway containers:**
1. `Ctrl+Shift+P` → **Reload Window** in Cursor
2. Run `docker mcp client connect cursor --profile <your-profile>` again
3. Call `authenticate` to restore the WhatsApp session

---

## Rebuild after code changes

> **Note:** If Cursor's MCP tools are active (gateway running), rebuild the image only — do not `up` it. The gateway will use the new image on its next container restart. Then reload the Cursor window.

```bash
docker compose build
```

If you are **not** using the MCP Gateway (standalone mode only), you can bring up the compose container too:
```bash
docker compose up -d --build
```

Use `--no-cache` only after Dockerfile changes (slow):
```bash
docker compose build --no-cache
```

## View logs

```bash
# Follow live
docker compose logs -f whatsapp-mcp-docker

# Last 50 lines
docker compose logs --tail 50 whatsapp-mcp-docker
```

## Reset all data (nuclear option)

```bash
# Stops containers + deletes volumes (session, messages, audit)
docker compose down -v
docker compose up -d --build
```

To reset just the session without wiping messages, delete only the session file inside the `whatsapp-sessions` volume.

## MCP Toolkit — register or update

### First-time setup

```bash
# 1. Build
docker compose build

# 2. Create catalog entry (appears in Docker Desktop → MCP Toolkit → Catalog)
docker mcp catalog create my-custom-mcp-servers \
  --title "My Custom MCP Servers" \
  --server file://./whatsapp-mcp-docker-server.yaml

# 3. Add to a profile
docker mcp profile server add <your-profile> \
  --server file://./whatsapp-mcp-docker-server.yaml

# 4. Apply default config
docker mcp profile config <your-profile> \
  --set whatsapp-mcp-docker.rate_limit_per_min=10 \
  --set whatsapp-mcp-docker.message_retention_days=90 \
  --set whatsapp-mcp-docker.send_read_receipts=true \
  --set whatsapp-mcp-docker.auto_read_receipts=true \
  --set whatsapp-mcp-docker.presence_mode=available \
  --set whatsapp-mcp-docker.welcome_group_name=WhatsAppMCP \
  --set whatsapp-mcp-docker.auth_wait_for_link=false \
  --set whatsapp-mcp-docker.auth_link_timeout_sec=120 \
  --set whatsapp-mcp-docker.auth_poll_interval_sec=5

# 5. Connect Cursor
docker mcp client connect cursor --profile <your-profile>
```

> PowerShell: replace `\` line continuation with a backtick `` ` ``.

### Update catalog/profile after YAML changes

```bash
docker mcp catalog create my-custom-mcp-servers \
  --title "My Custom MCP Servers" \
  --server file://./whatsapp-mcp-docker-server.yaml

docker mcp profile server remove <profile> whatsapp-mcp-docker
docker mcp profile server add <profile> --server file://./whatsapp-mcp-docker-server.yaml
```

## Encryption key (one-time setup)

```bash
# Generate a strong key
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Store securely (preferred — never commit to git)
docker mcp secret set whatsapp-mcp-docker.data_encryption_key
```

## Check volumes exist

```bash
docker volume ls | grep whatsapp
```

Expected: `whatsapp-sessions`, `whatsapp-audit`.
