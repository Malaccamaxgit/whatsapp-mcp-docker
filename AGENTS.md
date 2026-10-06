# whatsapp-mcp-docker: TypeScript Project Reference

TypeScript MCP server for the Docker MCP Toolkit. It sends messages, searches
chats, runs approval workflows, and supports remote agent control.

**Migration status:** Complete (2026-04-03). The codebase is 100 percent
TypeScript.

---

## Quick Reference

| Task | Command |
|------|---------|
| Build | `docker compose build --no-cache` |
| Build test container | `docker compose --profile test build tester-container` |
| Test all | `docker compose --profile test run --rm tester-container npm run test:all` |
| Type check | `docker compose --profile test run --rm tester-container npm run typecheck` |
| Lint | `docker compose --profile test run --rm tester-container npm run lint` |
| Format check | `docker compose --profile test run --rm tester-container npm run format:check` |
| Dev mode | `docker compose run --rm -e NODE_ENV=development whatsapp-mcp-docker npx tsx --watch src/index.ts` |

---

## Docker-First Development

This project has Linux-only dependencies, for example
`@whatsmeow-node/linux-x64-musl`. They fail on Windows and macOS.

- **Never run `npm test` on the host.** It exits 1.
- Run every development, test, lint, and format command inside `tester-container`.
- Edit `package.json` by hand and rebuild, instead of running `npm install` on
  the host. Host and container platforms differ.
- Do not install eslint, prettier, or other dev tools globally on the host.

Allowed on the host: `docker compose` commands, `node scripts/*.js`
diagnostics, git operations, read-only `npx` tools, and file editing.

### Always build with `--no-cache`

BuildKit can cache the TypeScript compile step even when source files change.
A cached build serves stale `dist/` output and produces confusing failures. Use
`--no-cache` for every build.

The test container copies source files at build time. Rebuild it after you
change any `.ts`, `.test.ts`, or `package.json` file, or the tests run stale
code.

---

## Docker MCP Gateway Rules

The Docker MCP Toolkit Gateway manages the `whatsapp-mcp-docker` container when
the server is registered in a profile with `longLived: true`.

- Use MCP tools through the Gateway. Do not bypass it with `docker run`,
  `docker exec`, or `docker compose up`.
- **Never stop a Gateway-managed container with `docker stop` or
  `docker compose down`.** That kills the Gateway stdio process, and every MCP
  tool then fails with EOF errors.
- To restart the server, remove it from the profile and add it again.
- After a code rebuild, rebuild the image only. The Gateway uses the new image
  on its next container restart.

opencode reaches the Gateway by running the Gateway itself. The global opencode
config starts `docker mcp gateway run --profile common_core`, so opencode does
not use the `docker mcp client connect` flow.

Recovery after an accidental Gateway stop: restart the opencode service, then
call `authenticate` again.

---

## Project Structure

```text
src/
  index.ts            # Entry point, stdio transport, lifecycle
  server.ts           # createServer factory: tools and security wiring
  lifecycle.ts        # Startup and shutdown handling
  healthcheck.ts      # Container healthcheck entry
  constants.ts        # Shared constants
  env.d.ts            # Ambient type declarations
  whatsapp/
    client.ts         # whatsmeow-node wrapper, events, media
    store.ts          # SQLite persistence, FTS5, encryption, auto-purge
  tools/
    auth.ts           # disconnect, authenticate (with auth rate limiting)
    status.ts         # get_connection_status
    messaging.ts      # send_message, list_messages, search_messages,
                      #   get_poll_results, debug_poll_votes, list_polls
    chats.ts          # list_chats, catch_up, search_contacts,
                      #   mark_messages_read, export_chat_data
    media.ts          # download_media, send_file (with file security)
    approvals.ts      # request_approval, check_approvals
    groups.ts         # create_group, get_group_info, get_joined_groups,
                      #   get_group_invite_link, join_group, leave_group,
                      #   update_group_participants, set_group_name,
                      #   set_group_topic
    reactions.ts      # send_reaction, edit_message, delete_message,
                      #   create_poll
    contacts.ts       # get_user_info, is_on_whatsapp, get_profile_picture,
                      #   sync_contact_names, set_contact_name
    wait.ts           # wait_for_message
    tool-info.ts      # get_tool_info, description-hint wrapper
  security/
    audit.ts          # SQLite audit log with file fallback
    crypto.ts         # AES-256-GCM field-level encryption
    file-guard.ts     # Path confinement, extension and magic checks, quota
    permissions.ts    # Whitelist, rate limit, tool disable, auth throttle
  utils/
    mcp-types.ts      # registerTool wrapper, ToolInput, McpResult
    fuzzy-match.ts    # Levenshtein and substring matching
    phone.ts          # E.164 validation, JID conversion
    jid-utils.ts      # JID parsing helpers
    errors.ts         # Error classification and structured responses
    zod-schemas.ts    # Shared Zod schemas (PhoneArraySchema)
    timezone.ts       # Timestamp formatting
    debug.ts          # Debug logging utility
```

---

## TypeScript Configuration

`tsconfig.json` (main):

- `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`
- `strict: true`
- `esModuleInterop: true`, `allowSyntheticDefaultImports: true`
- `outDir: ./dist`

`tsconfig.test.json` extends the main config, includes `test/`, and keeps the
same strict settings with `noEmit: true`. Because `noEmit` is set, `node --test`
cannot run `.ts` tests. Use `tsx`.

`src/env.d.ts` holds ambient declarations for environment variables and
external modules.

---

## Type Patterns

### Zod schema inference

```typescript
import { z } from 'zod';

const schema = z.object({
  to: z.string().describe('Recipient'),
  message: z.string().describe('Message text')
});

type SendMessageInput = z.infer<typeof schema>;
```

### better-sqlite3: `.get()` returns `unknown`

```typescript
// Fails: Property 'count' does not exist on type 'unknown'
const n = db.prepare('SELECT COUNT(*) as count FROM t').get().count;

// Works: cast the get() result
const n = (db.prepare('SELECT COUNT(*) as count FROM t').get() as { count: number }).count;
```

### Generic function results: cast the result, not the argument

```typescript
// Fails: TypeScript cannot infer T from an unknown[] parameter
const rows = this._decryptRows(stmt.all() as MessageRow[]);

// Works: cast the return value
const rows = this._decryptRows(stmt.all()) as MessageRow[];
```

### External API calls: double cast when types conflict

```typescript
const client = createClient(opts) as unknown as WhatsmeowClient;
```

### Error union types

```typescript
const msg = err instanceof Error ? err.message : String(err || '');
```

### FileHandle import

```typescript
let fh: import('node:fs/promises').FileHandle;
```

---

## Tool Registration API

Use the typed wrapper `registerTool` from `src/utils/mcp-types.ts`. It removes
the `as any` casts that the raw SDK call would need at every handler.

```typescript
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { registerTool, type ToolInput, type McpResult } from '../utils/mcp-types.js';

const schema = {
  to: z.string().describe('Recipient'),
  message: z.string().describe('Message text')
};

export function registerExampleTools (server: McpServer): void {
  registerTool(server, 'send_message', {
    description: 'Send a WhatsApp message.',
    inputSchema: schema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
  }, async (args: ToolInput<typeof schema>): Promise<McpResult> => {
    // Handler implementation
    return { content: [{ type: 'text', text: 'Sent.' }] };
  });
}
```

Notes:

- `src/server.ts` wraps `mcpServer.registerTool` and appends a tool-info hint to
  every description. Do not add the hint by hand.
- Log to `stderr`, never `stdout`. `stdout` carries the MCP stdio transport.
- `src/tools/messaging.ts`, `src/tools/chats.ts`, and `src/tools/media.ts` still
  call `server.registerTool` directly. New code uses the wrapper.

---

## Adding a New Tool

1. Create or extend a file in `src/tools/`.
2. Export a registration function, for example
   `export function registerXTools(server, waClient, store, permissions, audit)`.
3. Use the `registerTool` wrapper.
4. Wire it in `src/server.ts`: `registerXTools(mcpServer, waClient, store, permissions, audit)`.
5. Add it to `whatsapp-mcp-docker-server.yaml`.
6. Add tests in `test/integration/tools.test.ts`.
7. Update the tool table in `README.md`.

Call `permissions.checkRateLimit()` for outbound actions, and log every action
with `audit.log(toolName, action, details)`.

---

## Type Safety Rules

- No `any`, unless a third-party callback is genuinely untyped.
- Use `unknown` for untyped values and narrow with type guards.
- Prefer `z.infer<>` over manual type definitions for Zod schemas.
- Cast sparingly, and only when type definitions are stricter than runtime.

---

## Import Path Convention

ESM imports keep the `.js` extension. TypeScript `NodeNext` resolves to `.ts`.

```typescript
import { foo } from './utils/foo.js';
import { bar } from '../security/bar.js';
```

---

## Build and Test

### Docker build pipeline

```dockerfile
# Stage 1: prod-deps  npm install --omit=dev only, never touched by dev tools
# Stage 2: builder    full npm install plus npx tsc (compiles src/ to dist/)
# Stage 3: test       copies node_modules from builder, plus src/ and test/ files
# Stage 4: runtime    copies node_modules from prod-deps and dist/ from builder
#                     npm and npx removed, zlib patched, about 80 MB
CMD ["node", "dist/index.js"]
```

### Verification gate

```bash
docker compose --profile test run --rm tester-container npm run typecheck
docker compose --profile test run --rm tester-container npm run test:all
docker compose --profile test run --rm tester-container npm run lint
```

---

## Git Commit Workflow

This repository uses GPG-signed commits with Kleopatra.

1. Stage changes with `git add .`.
2. Commit with `git commit -m "message"`.
3. Kleopatra prompts for the passphrase. Enter it in the Kleopatra window.

Rules:

- Do not bypass the GPG prompt.
- Do not use `--no-gpg-sign`.
- Do not pipe the passphrase through stdin.
- Tell the user when a commit needs their passphrase.

Key: Benjamin Alloul `<Benjamin.Alloul@gmail.com>`, key ID
`598E BCC2 F7CA D3BA`.

Verify the commit with `git log --oneline -1`.

---

## MCP Client Usage

All tools are exposed over MCP. Categories:

| Category | Tools |
|----------|-------|
| Authentication | `authenticate`, `disconnect`, `get_connection_status` |
| Messaging | `send_message`, `list_messages`, `search_messages`, `get_poll_results`, `debug_poll_votes`, `list_polls` |
| Chats | `list_chats`, `search_contacts`, `catch_up`, `mark_messages_read`, `export_chat_data` |
| Media | `download_media`, `send_file` |
| Groups | `create_group`, `get_group_info`, `get_joined_groups`, `get_group_invite_link`, `join_group`, `leave_group`, `update_group_participants`, `set_group_name`, `set_group_topic` |
| Actions | `send_reaction`, `edit_message`, `delete_message`, `create_poll` |
| Contacts | `get_user_info`, `is_on_whatsapp`, `get_profile_picture`, `sync_contact_names`, `set_contact_name` |
| Approvals | `request_approval`, `check_approvals` |
| Workflow | `wait_for_message` |
| Meta | `get_tool_info` |

---

## Project Skills

Procedures live in `.opencode/skills/`:

- `add-new-tool`: add an MCP tool across the four touch points.
- `run-tests`: run unit, integration, and E2E tests in the container.
- `test-troubleshooting`: fix stale builds and container test failures.
- `docker-ops`: rebuild, view logs, and manage the MCP Toolkit registration.
- `cleanup`: full teardown of the Docker environment.
- `reinitiate`: cleanup, then build and register from scratch.
- `troubleshoot-whatsapp`: diagnose connection, auth, search, and media issues.

---

**Maintained by:** Benjamin Alloul, Benjamin.Alloul@gmail.com
