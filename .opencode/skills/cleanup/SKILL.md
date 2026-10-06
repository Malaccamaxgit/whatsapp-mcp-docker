---
name: cleanup
description: Full teardown of the WhatsApp MCP Docker environment. Removes the server from the MCP profile, deletes the encryption secret, stops containers, removes volumes, removes images, prunes build cache, and removes the custom catalog. Use when the user asks to clean up, tear down, uninstall, or remove the WhatsApp MCP Docker server.
---

# WhatsApp MCP Docker: Full Cleanup

## Context to gather first

Run these two commands first and record the output. They give the real profile
and catalog names on this machine.

```powershell
docker mcp profile ls
docker mcp catalog ls
```

- Profile name, from `docker mcp profile ls`. Use the profile that hosts
  opencode, which is `common_core` by default.
- Catalog name, from `docker mcp catalog ls`. Use the entry that is not
  `mcp/docker-mcp-catalog:latest`, which is Docker's official catalog. Do not
  remove that one.

## Warn the user first

Before any step, tell the user:

> MCP tools will stop responding during cleanup. After I finish, you must
> restart the opencode service. This also deletes all WhatsApp session, message,
> and audit data in the named volumes, so you will need to authenticate again.

Then confirm they want to proceed.

## Cleanup steps, in this exact order

### Step 1: remove from the MCP profile

```powershell
docker mcp profile server remove <PROFILE> whatsapp-mcp-docker
```

Ignore errors if `whatsapp-mcp-docker` was not registered.

### Step 2: remove the encryption secret

```powershell
docker mcp secret rm whatsapp-mcp-docker.data_encryption_key
docker mcp secret ls
```

Ignore errors if the secret did not exist.

### Step 3: stop containers and remove named volumes

Run from the project root.

```powershell
docker compose down -v --remove-orphans
```

This removes the `whatsapp-mcp-docker` container, the `tester-container`
container if running, and the `whatsapp-sessions` and `whatsapp-audit` volumes.

### Step 4: remove the Docker image

```powershell
docker rmi malaccamax/whatsapp-mcp-docker:latest
```

Ignore `No such image` errors.

### Step 5: prune dangling build-cache layers

The multi-stage Dockerfile creates intermediate `builder` and `test` stage
layers that `compose down` does not remove.

```powershell
docker image prune -f
```

### Step 6: remove the custom MCP catalog

```powershell
docker mcp catalog remove <CATALOG>:latest
```

Use the catalog name found in the first step. Do not remove
`mcp/docker-mcp-catalog:latest`.

## Verification

```powershell
docker mcp profile server ls
docker mcp secret ls
docker ps -a --filter "name=whatsapp"
docker volume ls --filter "name=whatsapp"
docker images --filter "reference=*whatsapp*"
docker mcp catalog ls
```

Expected results:

- `whatsapp-mcp-docker` is absent from the profile server list.
- `whatsapp-mcp-docker.data_encryption_key` is absent from the secrets.
- No whatsapp containers, volumes, or images.
- The custom catalog is absent.

## Reminder to the user at the end

> Cleanup complete. Restart the opencode service now. To reinstall, run the
> `reinitiate` or `docker-ops` skill.

## Shortcut: use the script instead

```powershell
.\scripts\cleanup.ps1
.\scripts\cleanup.ps1 -Force
.\scripts\cleanup.ps1 -DryRun
.\scripts\cleanup.ps1 -Profile common_core -Catalog my-catalog
```

Linux and macOS equivalent:

```bash
chmod +x scripts/cleanup.sh
./scripts/cleanup.sh
```
