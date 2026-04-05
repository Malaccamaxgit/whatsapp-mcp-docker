# Docker Operations — WhatsApp MCP Docker

## ⚠️ Never stop gateway-managed containers with `docker stop`

The MCP Gateway (Docker MCP Toolkit) manages the `whatsapp-mcp-docker` container when it is registered in a profile with `longLived: true`. If you stop that container externally using `docker stop` or `docker compose down`, the gateway's stdio process dies and **all MCP tools stop working** (EOF errors). Reloading the Claude Code session is required to recover.

**Prohibited while the gateway is active:**
```powershell
docker stop <gateway-container-name>   # kills the gateway stdio process
docker compose down                    # same effect
```

**Safe alternatives:**

| Goal | Safe command |
|------|-------------|
| Restart the WhatsApp server | `docker mcp profile server remove <profile> whatsapp-mcp-docker` then re-add |
| Reload after a code rebuild | `docker compose build`, then restart Claude Code — the gateway picks up the new image on next tool call |
| Full reset | Disconnect first (`docker mcp client disconnect claude-code`), then `docker compose down -v`, then reconnect |

**Recovery if you accidentally stop gateway containers:**
1. Restart the Claude Code session
2. Run `docker mcp client connect claude-code --profile <your-profile>` again
3. Call `authenticate` to restore the WhatsApp session

---

## Rebuild after code changes

> **If the MCP gateway is active, rebuild the image only — do not `up` it.** The gateway picks up the new image on its next container restart. Then restart the Claude Code session.

```powershell
docker compose build
```

Use `--no-cache` only after Dockerfile changes:
```powershell
docker compose build --no-cache
```

## View logs

```powershell
# Follow live
docker compose logs -f whatsapp-mcp-docker

# Last 50 lines
docker compose logs --tail 50 whatsapp-mcp-docker
```

## Reset all data (nuclear option)

```powershell
# Disconnect MCP client first, then:
docker compose down -v
# Reconnect and rebuild:
docker compose build
docker mcp client connect claude-code --profile default-with-portainer
```

To reset just the session without wiping messages, delete only the session file inside the `whatsapp-sessions` volume.

## MCP Toolkit — register or update

### First-time setup (already done — profile: default-with-portainer)

```powershell
# 1. Build
docker compose build

# 2. Generate and store encryption key
$key = docker run --rm node:22-alpine node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
docker mcp secret set "whatsapp-mcp-docker.data_encryption_key=$key"

# 3. Create catalog entry
docker mcp catalog create my-custom-mcp-servers `
  --title "My Custom MCP Servers" `
  --server file://./whatsapp-mcp-docker-server.yaml

# 4. Add to profile
docker mcp profile server add default-with-portainer `
  --server file://./whatsapp-mcp-docker-server.yaml

# 5. Apply config
docker mcp profile config default-with-portainer `
  --set whatsapp-mcp-docker.rate_limit_per_min=60 `
  --set whatsapp-mcp-docker.message_retention_days=90 `
  --set whatsapp-mcp-docker.send_read_receipts=true `
  --set whatsapp-mcp-docker.auto_read_receipts=true `
  --set whatsapp-mcp-docker.presence_mode=available `
  --set whatsapp-mcp-docker.welcome_group_name=WhatsAppMCP `
  --set whatsapp-mcp-docker.auth_wait_for_link=false `
  --set whatsapp-mcp-docker.auth_link_timeout_sec=120 `
  --set whatsapp-mcp-docker.auth_poll_interval_sec=5 `
  --set whatsapp-mcp-docker.timezone=America/Toronto

# 6. Connect Claude Code
docker mcp client connect claude-code --profile default-with-portainer
```

### Update catalog/profile after YAML changes

```powershell
docker mcp catalog create my-custom-mcp-servers `
  --title "My Custom MCP Servers" `
  --server file://./whatsapp-mcp-docker-server.yaml

docker mcp profile server remove default-with-portainer whatsapp-mcp-docker
docker mcp profile server add default-with-portainer `
  --server file://./whatsapp-mcp-docker-server.yaml
```

## Check volumes exist

```powershell
docker volume ls | Select-String whatsapp
```

Expected: `whatsapp-sessions`, `whatsapp-audit`.
