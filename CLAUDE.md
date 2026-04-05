# whatsapp-mcp-docker — TypeScript Project Reference

**Migration Status:** Complete (2026-04-03)  
**Source files:** 26 `.ts` files in `src/` (100% TypeScript)  
**Test files:** 16 `.ts` files in `test/`

---

## Quick Reference

| Task | Command |
|------|---------|
| Build | `docker compose build` |
| Test | `docker compose --profile test run --rm tester-container` |
| Type check | `docker compose --profile test run --rm tester-container npx tsc --noEmit` |
| Lint | `docker compose --profile test run --rm tester-container npm run lint` |
| Dev mode | `docker compose run --rm -e NODE_ENV=development whatsapp-mcp-docker npx tsx --watch src/index.ts` |

---

## Project Structure

```
src/
├── index.ts              # Entry point, stdio transport, lifecycle
├── server.ts             # Server factory (createServer) for tools + security wiring
├── whatsapp/
│   ├── client.ts         # whatsmeow-node wrapper, events, media
│   └── store.ts          # SQLite persistence, FTS5, encryption, auto-purge
├── tools/
│   ├── auth.ts           # disconnect, authenticate (with auth rate limiting)
│   ├── status.ts         # get_connection_status
│   ├── messaging.ts      # send_message, list_messages, search_messages
│   ├── chats.ts          # list_chats, search_contacts, catch_up, mark_messages_read, export_chat_data
│   ├── media.ts          # download_media, send_file (with file security)
│   ├── approvals.ts      # request_approval, check_approvals
│   ├── groups.ts         # create_group, get_group_info, get_joined_groups, get_group_invite_link,
│   │                     #   join_group, leave_group, update_group_participants,
│   │                     #   set_group_name, set_group_topic
│   ├── reactions.ts      # send_reaction, edit_message, delete_message, create_poll
│   ├── contacts.ts       # get_user_info, is_on_whatsapp, get_profile_picture
│   └── wait.ts           # wait_for_message
├── security/
│   ├── audit.ts          # SQLite audit log with file fallback
│   ├── crypto.ts         # AES-256-GCM field-level encryption
│   ├── file-guard.ts     # Path confinement, extension/magic checks, quota
│   └── permissions.ts    # Whitelist, rate limit, tool disable, auth throttle
└── utils/
    ├── fuzzy-match.ts    # Levenshtein + substring matching
    ├── phone.ts          # E.164 validation, JID conversion
    ├── errors.ts         # Error classification and structured error responses
    ├── zod-schemas.ts    # Shared Zod schemas (PhoneArraySchema)
    └── debug.ts          # Debug logging utility
```

---

## TypeScript Configuration

**tsconfig.json** — Main configuration:
- `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`
- `strict: true` — Full strict mode enabled
- `esModuleInterop: true`, `allowSyntheticDefaultImports: true`
- `outDir: ./dist` — Compiled output

**tsconfig.test.json** — Test configuration:
- Extends main config
- Includes `test/` directory
- Same strict settings

**src/env.d.ts** — Ambient type declarations for environment variables and external modules.

---

## Type Patterns

### Zod Schema Inference
```typescript
import { z } from 'zod';

const schema = z.object({
  to: z.string().describe('Recipient'),
  message: z.string().describe('Message text')
});

type SendMessageInput = z.infer<typeof schema>;
```

### better-sqlite3 — `.get()` returns `unknown`
```typescript
// ❌ fails: Property 'count' does not exist on type 'unknown'
const n = db.prepare('SELECT COUNT(*) as count FROM t').get().count;

// ✓ fix: cast the get() result
const n = (db.prepare('SELECT COUNT(*) as count FROM t').get() as { count: number }).count;
```

### Generic function results — cast the RESULT, not the argument
```typescript
// ❌ fails: TypeScript can't infer T from unknown[] param
const rows = this._decryptRows(stmt.all() as MessageRow[]);

// ✓ fix: cast the return value
const rows = this._decryptRows(stmt.all()) as MessageRow[];
```

### External API calls — double cast when types conflict
```typescript
// ✓ fix for conflicting package types
const client = createClient(opts) as unknown as WhatsmeowClient;
```

### Error union types
```typescript
// ✓ handle Error | string union properly
const msg = err instanceof Error ? err.message : String(err || '');
```

### FileHandle — import from correct module
```typescript
// ✓ correct import
let fh: import('node:fs/promises').FileHandle;
```

---

## Tool Registration API

All tools use `server.registerTool()` (current MCP SDK API):

```typescript
server.registerTool(
  'send_message',
  {
    description: 'Send a WhatsApp message.',
    inputSchema: { to: z.string(), message: z.string() }
  },
  async ({ to, message }) => {
    // Handler implementation
  } as any  // Acceptable cast for untyped SDK callback
);
```

**Key differences from old `server.tool()`:**
- `description` moves from positional arg → object key
- Third positional `schema` → `inputSchema` inside config object
- Handler stays as last positional arg

---

## Development Guidelines

### Adding a New Tool

1. Create `src/tools/<name>.ts`
2. Export registration function: `export function registerXTools(server, waClient, store, permissions, audit)`
3. Use `server.registerTool()` pattern above
4. Wire in `src/server.ts`: `registerXTools(mcpServer, waClient, store, permissions, audit)`
5. Add to `whatsapp-mcp-docker-server.yaml`
6. Add tests in `test/integration/tools.test.ts`
7. Update README.md tool table

### Type Safety Rules

- **No `any`** unless genuinely untyped third-party callback (e.g., `server.registerTool()` handler)
- **Use `unknown`** for untyped values, narrow with type guards
- **Prefer `z.infer<>`** over manual type definitions for Zod schemas
- **Cast sparingly** — only when type definitions are stricter than runtime

### Import Path Convention

ESM imports use `.js` extensions. TypeScript `NodeNext` auto-resolves to `.ts`:

```typescript
// ✓ correct — keep .js extension
import { foo } from './utils/foo.js';
import { bar } from '../security/bar.js';
```

---

## Build & Test

### Docker Build Pipeline

```dockerfile
# Stage 1: prod-deps — npm install --omit=dev only, never touched by dev tools
# Stage 2: builder  — full npm install + npx tsc (compiles src/ → dist/)
# Stage 3: test     — copies node_modules from builder, src/ + test/ files
# Stage 4: runtime  — copies node_modules from prod-deps, dist/ from builder
#                     npm/npx removed; zlib patched; ~80 MB
CMD ["node", "dist/index.js"]
```

### Verification Gate

```bash
# Type check
docker compose --profile test run --rm tester-container npx tsc --noEmit

# Full test suite
docker compose --profile test run --rm tester-container

# Lint
docker compose --profile test run --rm tester-container npm run lint
```

---

## Historical Documents

- `docs/archive/README.md` — Archived migration-era document index
- `JS-to-TS-Migration-Plan.md` — Migration plan (historical record)
- `docs/DOCUMENTATION-UPDATE-PLAN.md` — Post-migration docs cleanup plan (historical record)

---

## MCP Client Usage

All 33 tools available via MCP. Key categories:

| Category | Tools |
|----------|-------|
| Authentication | `authenticate`, `disconnect`, `get_connection_status` |
| Messaging | `send_message`, `list_messages`, `search_messages`, `get_poll_results` |
| Chats | `list_chats`, `search_contacts`, `catch_up`, `mark_messages_read`, `export_chat_data` |
| Media | `download_media`, `send_file` |
| Groups | `create_group`, `get_group_info`, `get_joined_groups`, `get_group_invite_link`, `join_group`, `leave_group`, `update_group_participants`, `set_group_name`, `set_group_topic` |
| Actions | `send_reaction`, `edit_message`, `delete_message`, `create_poll` |
| Contacts | `get_user_info`, `is_on_whatsapp`, `get_profile_picture` |
| Approvals | `request_approval`, `check_approvals` |
| Workflow | `wait_for_message` |

---

**AI Authors:** Qwen3-Coder-Next • MiniMax-M2.7 • Qwen3.5 • Nemotron-3-Super  
**Director:** Benjamin Alloul — [Benjamin.Alloul@gmail.com](mailto:Benjamin.Alloul@gmail.com)
