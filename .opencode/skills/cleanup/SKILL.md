---
name: cleanup
description: Full teardown of the WhatsApp MCP Docker environment. Removes the server from the MCP profile, deletes the encryption secret, stops containers, removes volumes, removes images, prunes build cache, and removes the custom catalog. Use when the user asks to clean up, tear down, uninstall, or remove the WhatsApp MCP Docker server.
---

# WhatsApp MCP Docker: Full Cleanup

## Gather the context first

Run these two commands. Record the output. They give the real profile and catalog
names on this machine.

```powershell
docker mcp profile ls
docker mcp catalog ls
```

- The profile name comes from `docker mcp profile ls`. Use the profile that hosts
  opencode. The default is `common_core`.
- The catalog name comes from `docker mcp catalog ls`. Use the entry that is not
  `mcp/docker-mcp-catalog:latest`. That entry is Docker's official catalog. Do not
  remove it.

## Warn the user first

Before any step, tell the user:

> MCP tools stop responding during cleanup. After the cleanup, restart the
> opencode service. Cleanup also deletes all WhatsApp session, message, and audit
> data in the named volumes. You must authenticate again.

Then ask for confirmation.

## Cleanup steps

Run the steps in this exact order.

### Step 1: remove the server from the MCP profile

```powershell
docker mcp profile server remove <PROFILE> whatsapp-mcp-docker
```

Ignore an error if `whatsapp-mcp-docker` is not registered.

### Step 2: remove the encryption secret

```powershell
docker mcp secret rm whatsapp-mcp-docker.data_encryption_key
docker mcp secret ls
```

Ignore an error if the secret does not exist.

### Step 3: stop containers and remove the named volumes

Run from the project root.

```powershell
docker compose down -v --remove-orphans
```

This step removes the `whatsapp-mcp-docker` container, the `tester-container`
container, and the `whatsapp-sessions` and `whatsapp-audit` volumes.

### Step 4: remove the Docker image

```powershell
docker rmi malaccamax/whatsapp-mcp-docker:latest
```

Ignore a `No such image` error.

### Step 5: prune the dangling build-cache layers

The multi-stage Dockerfile creates intermediate `builder` and `test` stage
layers. `compose down` does not remove them.

```powershell
docker image prune -f
```

### Step 6: remove the custom MCP catalog

```powershell
docker mcp catalog remove <CATALOG>:latest
```

Use the catalog name from the first step. Do not remove
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
- No whatsapp containers, volumes, or images exist.
- The custom catalog is absent.

## Reminder at the end

> Cleanup is complete. Restart the opencode service now. To reinstall, run the
> `reinitiate` skill or the `docker-ops` skill.

## Shortcut: run the script

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
