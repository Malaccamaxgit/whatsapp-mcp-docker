---
name: reinitiate
description: >-
  Full teardown then fresh build and Docker MCP Toolkit registration for WhatsApp MCP
  Server — runs project cleanup (profile server removal, secret, volumes, image, custom
  catalog) then compose build, encryption secret, catalog create, profile add/config,
  and client connect. Use when the user asks to reinitiate, reinstall from scratch,
  reset and redeploy, clean slate WhatsApp MCP, or run cleanup plus setup in one go.
---

# Reinitiate — Cleanup + Build + Docker MCP Toolkit Deploy

End-to-end reset: **same outcome as** [cleanup](../cleanup/SKILL.md) **followed by** the deploy sequence in [docs/guides/DEVELOPER.md](../../../docs/guides/DEVELOPER.md) (Quick Start → MCP Toolkit commands).

## Before starting

Tell the user:

- MCP tools in the client may **stop** during cleanup; when finished they should **reload the MCP client** (Cursor: `Ctrl+Shift+P` → **Reload Window**).
- **All WhatsApp session, message, and audit data** in the named volumes is removed. They will need to **authenticate** again.

## 0) Discover profile and catalog names

Run from any directory:

```bash
docker mcp profile list
docker mcp catalog list
```

- **Profile** — Use the profile that should host WhatsApp (often `default` or `default-with-portainer`). Pass it to cleanup and all `docker mcp profile …` commands as `<your-profile>`.
- **Catalog** — The custom catalog created for this project is usually `my-custom-mcp-servers`. It must **not** be `mcp/docker-mcp-catalog:latest` (official Docker catalog — never remove that). If the user uses a different custom catalog name, pass it to the cleanup script.

## Phase A — Cleanup (full teardown)

**Preferred:** run the project script from the repository root (non-interactive):

```powershell
# Windows PowerShell — adjust -Profile / -Catalog if discovery (step 0) differs
cd <repo-root>
.\scripts\cleanup.ps1 -Force -Profile <your-profile> -Catalog my-custom-mcp-servers
```

```bash
# Linux/macOS — adjust --profile / --catalog if discovery (step 0) differs
cd <repo-root>
chmod +x scripts/cleanup.sh
./scripts/cleanup.sh --force --profile <your-profile> --catalog my-custom-mcp-servers
```

If the script is unavailable, execute the steps in [.cursor/skills/cleanup/SKILL.md](../cleanup/SKILL.md) in order (profile server remove → secret rm → `docker compose down -v` → `docker rmi` → `docker image prune -f` → `docker mcp catalog remove`).

Ignore benign errors for resources already absent.

## Phase B — Build

From the **repository root** (directory that contains `docker-compose.yml` and `whatsapp-mcp-docker-server.yaml`):

```bash
docker compose build
```

Do **not** run `docker compose up -d` when the MCP Gateway (Toolkit) will manage the server — only build. See [.cursor/skills/docker-ops/SKILL.md](../docker-ops/SKILL.md).

The compose file tags `malaccamax/whatsapp-mcp-docker:latest`, matching `whatsapp-mcp-docker-server.yaml`, so the gateway uses this image after redeploy.

## Phase C — Encryption secret (new key)

Set a **new** key after cleanup (cleanup removes the old secret).

**PowerShell** (pipes are unreliable with `docker mcp secret set` — use two steps):

**Recommended: Python** (avoids `require()` escaping issues on Windows):

```powershell
$key = docker run --rm python:3-alpine python3 -c "import base64,os; print(base64.b64encode(os.urandom(32)).decode())"
docker mcp secret set "whatsapp-mcp-docker.data_encryption_key=$key"
```

**Or: Node.js** (base64 chars `+`, `/`, `=` may cause issues in PowerShell):

```powershell
$key = docker run --rm node:22-alpine node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
docker mcp secret set "whatsapp-mcp-docker.data_encryption_key=$key"
```

**bash/zsh:**

```bash
docker run --rm node:22-alpine node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" | docker mcp secret set whatsapp-mcp-docker.data_encryption_key
```

Verify: `docker mcp secret ls` should list `whatsapp-mcp-docker.data_enc…`.

## Phase D — Catalog, profile, configuration

Run **from the repository root** so `file://./whatsapp-mcp-docker-server.yaml` resolves.

**PowerShell** (backticks for line continuation):

```powershell
docker mcp catalog create my-custom-mcp-servers `
  --title "My Custom MCP Servers" `
  --server file://./whatsapp-mcp-docker-server.yaml

docker mcp profile server add <your-profile> `
  --server file://./whatsapp-mcp-docker-server.yaml

docker mcp profile config <your-profile> `
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

**bash/zsh:** same commands with `\` continuations (see [DEVELOPER.md](../../../docs/guides/DEVELOPER.md) Quick Start).

Re-running `docker mcp catalog create` with the same name **replaces** the custom catalog entry (per project README).

## Phase E — Connect MCP client

```bash
docker mcp client connect cursor --profile <your-profile>
```

Use another client name if the user does not use Cursor (`claude-code`, `vscode`, etc. — see `docker mcp client connect --help`).

## Aftercare

1. User **reloads** the MCP client window/session.
2. User runs **authenticate** with an E.164 phone number (or asks the agent to).
3. If tools are missing, README notes **`docker mcp profile activate <your-profile>`** or the `mcp-activate-profile` meta-tool in some gateway setups.

## Checklist (agent)

- [ ] Profile and custom catalog name confirmed (`docker mcp profile list` / `docker mcp catalog list`).
- [ ] Cleanup completed (`cleanup.ps1 -Force` or manual steps).
- [ ] `docker compose build` from repo root (no `compose up` for gateway workflow).
- [ ] New `whatsapp-mcp-docker.data_encryption_key` set and verified.
- [ ] Catalog created, server added to profile, `docker mcp profile config` applied.
- [ ] `docker mcp client connect` for the right client and profile.
- [ ] User reminded to reload client and re-authenticate WhatsApp.

## Reference map

| Step | Canonical detail |
|------|------------------|
| Cleanup order / script | [.cursor/skills/cleanup/SKILL.md](../cleanup/SKILL.md), `scripts/cleanup.ps1` |
| Gateway-safe Docker usage | [.cursor/skills/docker-ops/SKILL.md](../docker-ops/SKILL.md) |
| Deploy command block | [docs/guides/DEVELOPER.md — Quick Start](../../../docs/guides/DEVELOPER.md#quick-start) |
| User-facing full setup | [README.md — Full Setup](../../../README.md) (encryption, UI, troubleshooting) |
