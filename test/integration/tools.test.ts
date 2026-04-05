import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { createTestServer } from './helpers/test-server.js';
import { createMockWaClient } from './helpers/mock-wa-client.js';
import { MessageStore } from '../../src/whatsapp/store.js';
import { initEncryption } from '../../src/security/crypto.js';

describe('MCP Tools (integration)', () => {
  let ctx: Awaited<ReturnType<typeof createTestServer>>;

  before(async () => {
    initEncryption(null);
    const store = new MessageStore(':memory:');

    store.upsertChat('15145551234@s.whatsapp.net', 'John Smith', false, 1000, 'Hi');
    store.upsertChat('353871234567@s.whatsapp.net', 'Jane Doe', false, 2000, 'Hey');
    store.upsertChat('120363001234@g.us', 'Engineering Team', true, 3000, 'Build passed');

    store.addMessage({
      id: 'int-msg-1',
      chatJid: '15145551234@s.whatsapp.net',
      senderJid: '15145551234@s.whatsapp.net',
      senderName: 'John Smith',
      body: 'The project deadline is next Friday',
      timestamp: 1000,
      isFromMe: false,
      hasMedia: false
    });
    store.addMessage({
      id: 'int-msg-2',
      chatJid: '353871234567@s.whatsapp.net',
      senderJid: '353871234567@s.whatsapp.net',
      senderName: 'Jane Doe',
      body: 'Can you review the pull request?',
      timestamp: 2000,
      isFromMe: false,
      hasMedia: false
    });

    ctx = await createTestServer({ store });
  });

  after(async () => {
    if (ctx) {await ctx.cleanup();}
  });

  describe('get_connection_status', () => {
    it('returns connected status and stats', async () => {
      const result = await ctx.client.callTool({
        name: 'get_connection_status',
        arguments: {}
      });
      const text = result.content[0].text;
      assert.ok(text.includes('Connected: Yes') || text.includes('Ready'));
    });
  });

  describe('list_chats', () => {
    it('returns chat list', async () => {
      const result = await ctx.client.callTool({
        name: 'list_chats',
        arguments: {}
      });
      const text = result.content[0].text;
      assert.ok(
        text.includes('John Smith') || text.includes('Jane Doe') || text.includes('Engineering')
      );
    });

    it('filters chats by name', async () => {
      const result = await ctx.client.callTool({
        name: 'list_chats',
        arguments: { filter: 'Engineer' }
      });
      const text = result.content[0].text;
      assert.ok(text.includes('Engineering'));
    });
  });

  describe('search_messages', () => {
    it('finds messages by keyword', async () => {
      const result = await ctx.client.callTool({
        name: 'search_messages',
        arguments: { query: 'deadline' }
      });
      const text = result.content[0].text;
      assert.ok(text.includes('deadline') || text.includes('Friday'));
    });

    it('returns no results for non-matching query', async () => {
      const result = await ctx.client.callTool({
        name: 'search_messages',
        arguments: { query: 'xyznonexistent' }
      });
      const text = result.content[0].text;
      assert.ok(text.includes('0') || text.includes('No'));
    });
  });

  describe('send_message', () => {
    it('sends a message via fuzzy name match', async () => {
      const result = await ctx.client.callTool({
        name: 'send_message',
        arguments: { to: 'John Smith', message: 'Hello from tests' }
      });
      assert.equal(result.isError, undefined);
      const sent = ctx.waClient.getSentMessages();
      assert.ok(sent.length >= 1);
    });

    it('sends to a group by name', async () => {
      const result = await ctx.client.callTool({
        name: 'send_message',
        arguments: { to: 'Engineering Team', message: 'Build passed!' }
      });
      assert.equal(result.isError, undefined);
    });
  });

  describe('list_messages', () => {
    it('returns messages for a chat', async () => {
      const result = await ctx.client.callTool({
        name: 'list_messages',
        arguments: { chat: '15145551234@s.whatsapp.net' }
      });
      const text = result.content[0].text;
      assert.ok(text.includes('deadline') || text.includes('project'));
    });

    it('includes message ID in output', async () => {
      const result = await ctx.client.callTool({
        name: 'list_messages',
        arguments: { chat: '15145551234@s.whatsapp.net' }
      });
      const text = result.content[0].text;
      assert.ok(text.includes('ID:'), 'Output should include message ID field');
      assert.ok(text.includes('int-msg-1'), 'Output should include the actual message ID');
    });

    it('includes read status in output', async () => {
      const result = await ctx.client.callTool({
        name: 'list_messages',
        arguments: { chat: '15145551234@s.whatsapp.net' }
      });
      const text = result.content[0].text;
      assert.ok(text.includes('Read:'), 'Output should include read status field');
    });
  });

  describe('search_contacts', () => {
    it('finds contacts by name', async () => {
      const result = await ctx.client.callTool({
        name: 'search_contacts',
        arguments: { query: 'John' }
      });
      const text = result.content[0].text;
      assert.ok(text.includes('John') || text.includes('15145551234'));
    });

    it('includes unread_count, last_message_at, and last_message_preview in output', async () => {
      // Add a chat with unread messages and a preview
      ctx.store.upsertChat('15145559876@s.whatsapp.net', 'Test Contact', false, 5000, 'This is a test message preview');
      ctx.store.addMessage({
        id: 'test-msg-unread',
        chatJid: '15145559876@s.whatsapp.net',
        senderJid: '15145559876@s.whatsapp.net',
        senderName: 'Test Contact',
        body: 'This is a test message',
        timestamp: 5000,
        isFromMe: false,
        hasMedia: false
      });
      ctx.store.incrementUnread('15145559876@s.whatsapp.net');

      const result = await ctx.client.callTool({
        name: 'search_contacts',
        arguments: { query: 'Test Contact' }
      });
      const text = result.content[0].text;
      
      // Verify the new fields are present in the output
      assert.ok(text.includes('unread'), 'Output should include unread count indicator');
      assert.ok(text.includes('Last:'), 'Output should include last message timestamp');
      assert.ok(text.includes('test message'), 'Output should include message preview');
    });
  });

  describe('catch_up', () => {
    it('returns activity summary', async () => {
      const result = await ctx.client.callTool({
        name: 'catch_up',
        arguments: {}
      });
      assert.ok(result.content[0].text.length > 0);
    });
  });

  describe('request_approval', () => {
    it('creates an approval request', async () => {
      const result = await ctx.client.callTool({
        name: 'request_approval',
        arguments: {
          to: 'John Smith',
          action: 'Deploy v2.0',
          details: 'Production deployment'
        }
      });
      const text = result.content[0].text;
      assert.ok(text.includes('approval') || text.includes('Approval'));
    });
  });

  describe('check_approvals', () => {
    it('lists pending approvals', async () => {
      const result = await ctx.client.callTool({
        name: 'check_approvals',
        arguments: {}
      });
      assert.ok(result.content[0].text.length > 0);
    });
  });

  describe('export_chat_data', () => {
    it('exports chat data in json format', async () => {
      const result = await ctx.client.callTool({
        name: 'export_chat_data',
        arguments: { jid: '15145551234@s.whatsapp.net', format: 'json' }
      });
      assert.equal(result.isError, undefined);
      assert.match(result.content[0].text, /exported to JSON format/i);
    });
  });

  describe('mark_messages_read', () => {
    it('marks messages as read by chat name', async () => {
      const result = await ctx.client.callTool({
        name: 'mark_messages_read',
        arguments: { chat: 'John Smith' }
      });
      assert.equal(result.isError, undefined);
      assert.ok(result.content[0].text.includes('Marked'));
    });

    it('marks messages as read by JID', async () => {
      const result = await ctx.client.callTool({
        name: 'mark_messages_read',
        arguments: { chat: '15145551234@s.whatsapp.net' }
      });
      assert.equal(result.isError, undefined);
    });

    it('marks specific message IDs', async () => {
      const result = await ctx.client.callTool({
        name: 'mark_messages_read',
        arguments: { message_ids: ['int-msg-1'] }
      });
      assert.equal(result.isError, undefined);
    });

    it('rejects when neither chat nor message_ids provided', async () => {
      const result = await ctx.client.callTool({
        name: 'mark_messages_read',
        arguments: {}
      });
      assert.ok(result.isError);
    });
  });

  describe('download_media', () => {
    it('downloads media from a message', async () => {
      const result = await ctx.client.callTool({
        name: 'download_media',
        arguments: { message_id: 'int-msg-1' }
      });
      assert.equal(result.isError, undefined);
      const text = result.content[0].text;
      assert.ok(text.includes('downloaded') || text.includes('Path'));
    });

    it('fails when not connected', async () => {
      ctx.waClient._connected = false;
      ctx.waClient._probeVerified = false;
      const result = await ctx.client.callTool({
        name: 'download_media',
        arguments: { message_id: 'int-msg-1' }
      });
      assert.ok(result.isError);
      assert.ok(
        result.content[0].text.includes('not connected') ||
          result.content[0].text.includes('Not connected')
      );
      ctx.waClient._connected = true;
      ctx.waClient._probeVerified = true;
    });
  });

  describe('send_file', () => {
    it('sends a valid image file', async () => {
      const dir = '/tmp';
      const filePath = `${dir}/integration-send-file.jpg`;
      // Minimal JPEG-like bytes (SOI + APP0 marker + padding)
      const jpegBytes = Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
        0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01
      ]);
      await mkdir(dir, { recursive: true });
      await writeFile(filePath, jpegBytes);

      try {
        const result = await ctx.client.callTool({
          name: 'send_file',
          arguments: {
            to: 'John Smith',
            file_path: filePath,
            media_type: 'image',
            caption: 'integration image'
          }
        });
        assert.equal(result.isError, undefined);
        assert.match(result.content[0].text, /sent to/i);
      } finally {
        await rm(filePath, { force: true });
      }
    });

    it('rejects when not connected', async () => {
      ctx.waClient._connected = false;
      ctx.waClient._probeVerified = false;
      const result = await ctx.client.callTool({
        name: 'send_file',
        arguments: {
          to: 'John Smith',
          file_path: '/data/store/media/test.jpg',
          media_type: 'image'
        }
      });
      assert.ok(result.isError);
      assert.ok(
        result.content[0].text.includes('not connected') ||
          result.content[0].text.includes('Not connected')
      );
      ctx.waClient._connected = true;
      ctx.waClient._probeVerified = true;
    });

    it('rejects dangerous file extensions', async () => {
      const result = await ctx.client.callTool({
        name: 'send_file',
        arguments: {
          to: 'John Smith',
          file_path: '/data/store/media/malware.exe',
          media_type: 'document'
        }
      });
      assert.ok(result.isError);
    });
  });

  describe('tool disabling', () => {
    it('rejects disabled tools', async () => {
      ctx.permissions.disabledTools.add('list_chats');

      const result = await ctx.client.callTool({
        name: 'list_chats',
        arguments: {}
      });
      assert.ok(result.isError);
      assert.match(result.content[0].text, /disabled/i);

      ctx.permissions.disabledTools.delete('list_chats');
    });
  });

  describe('rate limiting', () => {
    it('enforces message rate limit', async () => {
      const origLimit = ctx.permissions.rateLimit;
      ctx.permissions.rateLimit = 1;
      ctx.permissions._sendTimestamps = [];

      await ctx.client.callTool({
        name: 'send_message',
        arguments: { to: 'John Smith', message: 'First' }
      });

      const result = await ctx.client.callTool({
        name: 'send_message',
        arguments: { to: 'John Smith', message: 'Second' }
      });
      assert.ok(result.isError);
      assert.match(result.content[0].text, /rate limit/i);

      ctx.permissions.rateLimit = origLimit;
      ctx.permissions._sendTimestamps = [];
    });
  });

  describe('get_connection_status (disconnected)', () => {
    it('shows logout reason when disconnected', async () => {
      ctx.waClient.simulateLogout('connection_lost');
      const result = await ctx.client.callTool({
        name: 'get_connection_status',
        arguments: {}
      });
      const text = result.content[0].text;
      assert.ok(text.includes('Connected: No'));
      assert.ok(text.includes('connection_lost') || text.includes('connection lost'));

      // Restore
      ctx.waClient._connected = true;
      ctx.waClient.jid = '15145559999@s.whatsapp.net';
      ctx.waClient._logoutReason = null;
      ctx.waClient._probeVerified = true;
    });

    it('shows generic message when no logout reason', async () => {
      ctx.waClient._connected = false;
      ctx.waClient._logoutReason = null;
      const result = await ctx.client.callTool({
        name: 'get_connection_status',
        arguments: {}
      });
      const text = result.content[0].text;
      assert.ok(text.includes('Connected: No'));
      assert.ok(text.includes('authenticate'));

      ctx.waClient._connected = true;
      ctx.waClient._probeVerified = true;
    });
  });

  describe('mark_messages_read (with receipts)', () => {
    it('calls markMessagesRead on waClient', async () => {
      const result = await ctx.client.callTool({
        name: 'mark_messages_read',
        arguments: { chat: 'John Smith' }
      });
      assert.equal(result.isError, undefined);
      assert.ok(result.content[0].text.includes('Marked'));
    });

    it('sends receipts for specific message IDs', async () => {
      const receiptsBefore = ctx.waClient.getReadReceipts().length;
      const result = await ctx.client.callTool({
        name: 'mark_messages_read',
        arguments: { message_ids: ['int-msg-1'] }
      });
      assert.equal(result.isError, undefined);
      const receiptsAfter = ctx.waClient.getReadReceipts().length;
      assert.ok(receiptsAfter >= receiptsBefore);
    });
  });

  describe('send_message (disconnected)', () => {
    it('returns not connected error', async () => {
      ctx.waClient._connected = false;
      ctx.waClient._probeVerified = false;
      const result = await ctx.client.callTool({
        name: 'send_message',
        arguments: { to: 'John Smith', message: 'test' }
      });
      assert.ok(result.isError);
      assert.ok(
        result.content[0].text.includes('not connected') ||
          result.content[0].text.includes('Not connected')
      );
      ctx.waClient._connected = true;
      ctx.waClient._probeVerified = true;
    });
  });

  describe('authenticate', () => {
    it('returns pairing code immediately when waitForLink is false', async () => {
      const origPair = ctx.waClient.requestPairingCode.bind(ctx.waClient);
      ctx.waClient._connected = false;
      ctx.waClient._probeVerified = false;
      ctx.waClient.jid = null;
      ctx.waClient.requestPairingCode = async () => ({
        alreadyConnected: false,
        code: '8765-4321',
        waitForConnection: Promise.resolve()
      });

      const result = await ctx.client.callTool({
        name: 'authenticate',
        arguments: { phoneNumber: '+15145551234', waitForLink: false }
      });
      assert.equal(result.isError, undefined);
      const text = result.content.map((c) => c.text || '').join('\n');
      assert.ok(text.includes('8765-4321'));
      assert.ok(!text.includes('Linked successfully'));

      ctx.waClient.requestPairingCode = origPair;
      ctx.waClient._connected = true;
      ctx.waClient._probeVerified = true;
      ctx.waClient.jid = '15145559999@s.whatsapp.net';
    });

    it('polls until connected and appends success when waitForLink is true', async () => {
      const origPair = ctx.waClient.requestPairingCode.bind(ctx.waClient);
      ctx.waClient._connected = false;
      ctx.waClient._probeVerified = false;
      ctx.waClient.jid = null;
      ctx.waClient.requestPairingCode = async () => {
        setTimeout(() => {
          ctx.waClient._connected = true;
          ctx.waClient._probeVerified = true;
          ctx.waClient.jid = '15145551234@s.whatsapp.net';
        }, 800);
        return {
          alreadyConnected: false,
          code: '1111-2222',
          waitForConnection: Promise.resolve()
        };
      };

      const result = await ctx.client.callTool({
        name: 'authenticate',
        arguments: {
          phoneNumber: '+15145551234',
          waitForLink: true,
          linkTimeoutSec: 15,
          pollIntervalSec: 2
        }
      });
      assert.equal(result.isError, undefined);
      const text = result.content.map((c) => c.text || '').join('\n');
      assert.ok(text.includes('Linked successfully'), text);
      assert.ok(text.includes('15145551234@s.whatsapp.net'), text);

      ctx.waClient.requestPairingCode = origPair;
      ctx.waClient._connected = true;
      ctx.waClient._probeVerified = true;
      ctx.waClient.jid = '15145559999@s.whatsapp.net';
    });
  });

  describe('disconnect', () => {
    it('disconnects and reports success', async () => {
      const result = await ctx.client.callTool({
        name: 'disconnect',
        arguments: {}
      });
      assert.equal(result.isError, undefined);
      assert.match(result.content[0].text, /disconnect|logged out|session/i);

      // Restore connection state for any future assertions.
      ctx.waClient._connected = true;
      ctx.waClient._probeVerified = true;
      ctx.waClient.jid = '15145559999@s.whatsapp.net';
    });
  });
});
