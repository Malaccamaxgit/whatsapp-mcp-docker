/**
 * Test Server Helper
 *
 * Creates an in-process MCP server + client pair connected via streams.
 * Uses the real createServer factory with a mock WhatsApp client.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../../../src/server.js';
import { createMockWaClient } from './mock-wa-client.js';
import { MessageStore } from '../../../src/whatsapp/store.js';
import { AuditLogger } from '../../../src/security/audit.js';
import { PermissionManager } from '../../../src/security/permissions.js';
import { WhatsAppClient } from '../../../src/whatsapp/client.js';

type TestServerOptions = {
  waClient?: WhatsAppClient;
  store?: MessageStore;
  permissions?: PermissionManager;
  audit?: AuditLogger;
  encryptionKey?: string | null;
  storePath?: string;
};

type TestServerResult = {
  client: Client;
  mcpServer: ReturnType<typeof createServer>['mcpServer'];
  store: MessageStore;
  audit: AuditLogger;
  permissions: PermissionManager;
  waClient: WhatsAppClient;
  cleanup: () => Promise<void>;
};

/**
 * Create an in-memory transport for testing.
 * @returns Linked pair of InMemoryTransport instances
 */
export async function createInMemoryTransport(): Promise<[InMemoryTransport, InMemoryTransport]> {
  return InMemoryTransport.createLinkedPair();
}

/**
 * Spin up an MCP server + client pair for testing.
 *
 * @param options
 * @param options.waClient - Mock WhatsApp client (default: createMockWaClient())
 * @param options.store - MessageStore instance
 * @param options.permissions - PermissionManager instance
 * @returns Test server result with client, mcpServer, store, audit, permissions, waClient, cleanup
 */
export async function createTestServer(options: TestServerOptions = {}): Promise<TestServerResult> {
  const waClient = options.waClient ?? createMockWaClient();

  const { mcpServer, store, audit, permissions } = createServer({
    version: '0.0.0-test',
    waClient,
    store: options.store,
    audit: options.audit,
    permissions: options.permissions,
    encryptionKey: options.encryptionKey ?? null,
    storePath: options.storePath
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client({ name: 'test-client', version: '1.0.0' });

  await mcpServer.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    client,
    mcpServer,
    store,
    audit,
    permissions,
    waClient,
    async cleanup() {
      await client.close();
      await mcpServer.close();
      if (store?.close) store.close();
      if (audit?.close) audit.close();
    }
  };
}
