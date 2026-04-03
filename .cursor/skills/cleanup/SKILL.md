---
name: cleanup
description: Full teardown of the WhatsApp MCP Docker environment — removes the server from the MCP profile, deletes the encryption secret, stops containers, removes volumes, removes images, prunes build cache, and removes the custom catalog. Use when the user asks to clean up, tear down, uninstall, or remove the WhatsApp MCP Docker server.
---

# WhatsApp MCP Docker — Full Cleanup

## Context you need before starting

Run these two commands first and record the outputs — they tell you the real profile
and catalog names on this machine:

```powershell
docker mcp profile ls
docker mcp catalog ls
```

- **Profile name** — from `docker mcp profile ls`. Default: `default-with-portainer`.
- **Catalog name** — from `docker mcp catalog ls`. Look for the entry that is NOT
  `mcp/docker-mcp-catalog:latest` (that is Docker's official catalog, do not remove it).
  Default: `my-custom-mcp-servers`.

## Warn the user first

Before executing any step, tell the user:

> "MCP tools in Cursor will stop responding during cleanup.
> After I'm done, reload the Cursor window with **Ctrl+Shift+P → Reload Window**."

Then confirm they want to proceed.

---

## Cleanup steps — execute in this exact order

### Step 1 — Remove from MCP profile

Removes whatsapp-mcp-docker from the profile so the gateway stops managing it.

```powershell
docker mcp profile server remove <PROFILE> whatsapp-mcp-docker
```

- Ignore errors if whatsapp-mcp-docker was not registered in the profile.

---

### Step 2 — Remove encryption secret from keychain

```powershell
docker mcp secret rm whatsapp-mcp-docker.data_encryption_key
```

- Confirm it is gone:
  ```powershell
  docker mcp secret ls
  ```
- Ignore errors if the secret did not exist.

---

### Step 3 — Stop containers and remove named volumes

Run from the project root directory:

```powershell
docker compose down -v --remove-orphans
```

This removes:
- `whatsapp-mcp-docker` container
- `tester-container` container (if running)
- `whatsapp-sessions` volume
- `whatsapp-audit` volume

- Ignore errors if containers or volumes were already absent.

---

### Step 4 — Remove Docker images

```powershell
docker rmi malaccamax/whatsapp-mcp-docker:latest
```

- Ignore "No such image" errors.

---

### Step 5 — Prune dangling build-cache layers

The multi-stage Dockerfile creates intermediate `builder` and `test` stage layers that
`compose down` does not remove. Clean them up:

```powershell
docker image prune -f
```

---

### Step 6 — Remove the custom MCP catalog

```powershell
docker mcp catalog remove <CATALOG>:latest
```

- Use the catalog name found in Step 0 (e.g. `my-custom-mcp-servers:latest`).
- Do **not** remove `mcp/docker-mcp-catalog:latest` — that is Docker's official catalog.
- Ignore errors if the catalog was already removed.

---

## Verification

After all steps, run these to confirm everything is gone:

```powershell
docker mcp profile server ls
docker mcp secret ls
docker ps -a --filter "name=whatsapp"
docker volume ls --filter "name=whatsapp"
docker images --filter "reference=*whatsapp*"
docker mcp catalog ls
```

Expected results:
- `whatsapp-mcp-docker` absent from profile server list
- `whatsapp-mcp-docker.data_encryption_key` absent from secrets
- No whatsapp containers
- No whatsapp volumes
- No whatsapp images
- Custom catalog absent from catalog list

---

## Reminder to user at the end

> "Cleanup complete. Please reload the Cursor window now:
> **Ctrl+Shift+P → Reload Window**
>
> To reinstall, follow the setup instructions in `docs/README.md`."

---

## Shortcut — use the script instead

If the user prefers a one-command approach, direct them to the PowerShell script:

```powershell
.\scripts\cleanup.ps1
```

Or with options:

```powershell
# Skip confirmation prompt
.\scripts\cleanup.ps1 -Force

# See what would happen without making changes
.\scripts\cleanup.ps1 -DryRun

# Override profile or catalog name
.\scripts\cleanup.ps1 -Profile my-profile -Catalog my-catalog
```

Linux/macOS equivalent:

```bash
chmod +x scripts/cleanup.sh
./scripts/cleanup.sh
```
