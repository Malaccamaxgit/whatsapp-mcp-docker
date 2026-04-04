/**
 * E2E Tests — Live WhatsApp Session
 *
 * These tests use a real WhatsApp session persisted in .test-data/.
 * Run the auth setup first:
 *   docker compose run --rm tester-container npm run test:auth
 *
 * Only read-only operations are tested to avoid spamming contacts
 * and triggering WhatsApp rate limits.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTestServer } from '../integration/helpers/test-server.js';
import { MessageStore } from '../../src/whatsapp/store.js';
import { initEncryption } from '../../src/security/crypto.js';
import { WhatsAppClient } from '../../src/whatsapp/client.js';

const TEST_DATA_DIR = resolve(process.cwd(), '.test-data');
const SESSION_DB = resolve(TEST_DATA_DIR, 'session.db');

const sessionExists = existsSync(SESSION_DB);

if (!sessionExists) {
  console.error('[SKIP] live.test.ts: No session found at .test-data/session.db');
  console.error('       Run: docker compose run --rm tester-container npm run test:auth');
}

describe('E2E: Live WhatsApp session', { skip: !sessionExists && 'session not available' }, () => {
  let ctx: Awaited<ReturnType<typeof createTestServer>> | undefined;
  let waClient: WhatsAppClient | undefined;

  before(async () => {
    initEncryption(null);

    process.env.STORE_PATH = TEST_DATA_DIR;

    const store = new MessageStore(resolve(TEST_DATA_DIR, 'messages.db'));

    waClient = new WhatsAppClient({
      storePath: TEST_DATA_DIR,
      messageStore: store,
      onConnected: () => {}
    });

    await waClient.initialize();

    ctx = await createTestServer({
      waClient,
      store,
      storePath: TEST_DATA_DIR
    });
  });

  after(async () => {
    if (waClient) await waClient.disconnect();
    if (ctx) await ctx.cleanup();
  });

  describe('get_connection_status', () => {
    it('reports connected with a valid JID', async () => {
      const result = await ctx!.client.callTool({
        name: 'get_connection_status',
        arguments: {}
      });
      const text = result.content[0].text;
      assert.ok(
        text.includes('connected') || text.includes('Connected'),
        `Expected "connected" in: ${text.substring(0, 200)}`
      );
    });
  });

  describe('list_chats', () => {
    it('returns at least one chat', async () => {
      const result = await ctx!.client.callTool({
        name: 'list_chats',
        arguments: {}
      });
      const text = result.content[0].text;
      assert.ok(text.length > 10, 'Expected chat list to have content');
    });
  });

  describe('search_messages', () => {
    it('can execute a search query', async () => {
      const result = await ctx!.client.callTool({
        name: 'search_messages',
        arguments: { query: 'hello' }
      });
      assert.ok(result.content[0].text.length > 0);
    });
  });

  describe('search_contacts', () => {
    it('can search for contacts', async () => {
      const result = await ctx!.client.callTool({
        name: 'search_contacts',
        arguments: { query: 'a' }
      });
      assert.ok(result.content[0].text.length > 0);
    });
  });

  describe('catch_up', () => {
    it('returns a summary', async () => {
      const result = await ctx!.client.callTool({
        name: 'catch_up',
        arguments: {}
      });
      assert.ok(result.content[0].text.length > 0);
    });
  });
});
