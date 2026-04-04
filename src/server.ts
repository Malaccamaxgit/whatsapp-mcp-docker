/**
 * Server Factory
 *
 * Creates and wires the MCP server with all tools, security, and store.
 * Extracted from index.js to allow programmatic instantiation for testing.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListPromptsRequestSchema,
  SetLevelRequestSchema,
  PingRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { MessageStore } from './whatsapp/store.js';
import { AuditLogger } from './security/audit.js';
import { PermissionManager } from './security/permissions.js';
import { initEncryption } from './security/crypto.js';
import { registerAuthTools } from './tools/auth.js';
import { registerStatusTools } from './tools/status.js';
import { registerMessagingTools } from './tools/messaging.js';
import { registerChatTools } from './tools/chats.js';
import { registerApprovalTools } from './tools/approvals.js';
import { registerMediaTools } from './tools/media.js';
import { registerGroupTools } from './tools/groups.js';
import { registerReactionTools } from './tools/reactions.js';
import { registerContactTools } from './tools/contacts.js';
import { registerWaitTools } from './tools/wait.js';
import type { WhatsAppClient } from './whatsapp/client.js';

export interface CreateServerOptions {
  version?: string;
  waClient: WhatsAppClient;
  store?: MessageStore;
  audit?: AuditLogger;
  permissions?: PermissionManager;
  storePath?: string;
  encryptionKey?: string;
}

export interface CreateServerResult {
  mcpServer: McpServer;
  store: MessageStore;
  audit: AuditLogger;
  permissions: PermissionManager;
}

/**
 * Create a fully wired MCP server instance.
 *
 * @param {CreateServerOptions} options
 * @returns {CreateServerResult}
 */
export function createServer ({
  version = '0.0.0-test',
  waClient,
  store,
  audit,
  permissions,
  storePath,
  encryptionKey
}: CreateServerOptions = {} as CreateServerOptions): CreateServerResult {
  const sp = storePath || process.env.STORE_PATH || '/data/store';

  if (encryptionKey !== undefined) {
    initEncryption(encryptionKey);
  }

  const resolvedStore = store || new MessageStore(`${sp}/messages.db`);
  const resolvedAudit = audit || new AuditLogger();
  const resolvedPermissions = permissions || new PermissionManager();

  const mcpServer = new McpServer({
    name: 'whatsapp-mcp-docker',
    version
  });

  // Handle optional MCP protocol methods that the Docker MCP Gateway probes during
  // initialization. Without these handlers the SDK returns -32601 "Method not found",
  // which causes the gateway to mark the connection as closing and reject all
  // subsequent tool calls with "client is closing: EOF".
  // We must declare the capabilities first; the SDK enforces this before allowing
  // setRequestHandler for resource/prompt/logging schemas.
  mcpServer.server.registerCapabilities({ resources: {}, prompts: {}, logging: {} });
  mcpServer.server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [] }));
  mcpServer.server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ resourceTemplates: [] }));
  mcpServer.server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [] }));
  mcpServer.server.setRequestHandler(SetLevelRequestSchema, async () => ({}));
  mcpServer.server.setRequestHandler(PingRequestSchema, async () => ({}));

  registerAuthTools(mcpServer, waClient, resolvedPermissions, resolvedAudit);
  registerStatusTools(mcpServer, waClient, resolvedStore, resolvedPermissions);
  registerMessagingTools(mcpServer, waClient, resolvedStore, resolvedPermissions, resolvedAudit);
  registerChatTools(mcpServer, waClient, resolvedStore, resolvedPermissions, resolvedAudit);
  registerApprovalTools(mcpServer, waClient, resolvedStore, resolvedPermissions, resolvedAudit);
  registerMediaTools(mcpServer, waClient, resolvedStore, resolvedPermissions, resolvedAudit);
  registerGroupTools(mcpServer, waClient, resolvedStore, resolvedPermissions, resolvedAudit);
  registerReactionTools(mcpServer, waClient, resolvedStore, resolvedPermissions, resolvedAudit);
  registerContactTools(mcpServer, waClient, resolvedStore, resolvedPermissions, resolvedAudit);
  registerWaitTools(mcpServer, waClient, resolvedStore, resolvedPermissions, resolvedAudit);

  return {
    mcpServer,
    store: resolvedStore,
    audit: resolvedAudit,
    permissions: resolvedPermissions
  };
}
