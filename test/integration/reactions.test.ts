/**
 * Integration tests for Message Action Tools
 *
 * Covers: send_reaction, edit_message, delete_message, create_poll
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestServer } from './helpers/test-server.js';
import { MessageStore } from '../../src/whatsapp/store.js';
import { initEncryption } from '../../src/security/crypto.js';
import { WhatsAppClient } from '../../src/whatsapp/client.js';

const CHAT_JID = '15145551234@s.whatsapp.net';
const GROUP_JID = '120363001234@g.us';
const MSG_ID = 'test-msg-id-001';

type TestContext = Awaited<ReturnType<typeof createTestServer>>;

describe('Message Action Tools (integration)', () => {
  let ctx: TestContext;

  before(async () => {
    initEncryption(null);
    const store = new MessageStore(':memory:');
    store.upsertChat(CHAT_JID, 'John Smith', false, 1000, 'Hi');
    store.upsertChat(GROUP_JID, 'Engineering Team', true, 2000, 'Build passed');
    store.addMessage({
      id: MSG_ID,
      chatJid: CHAT_JID,
      senderJid: '15145559999@s.whatsapp.net',
      senderName: 'Me',
      body: 'Original message text',
      timestamp: 1000,
      isFromMe: true,
      hasMedia: false,
      mediaType: null
    });
    ctx = await createTestServer({ store });
  });

  after(async () => {
    if (ctx) {await ctx.cleanup();}
  });

  // ── send_reaction ───────────────────────────────────────────────────────────

  describe('send_reaction', () => {
    it('reacts with an emoji by JID', async () => {
      const result = await ctx.client.callTool({
        name: 'send_reaction',
        arguments: { chat: CHAT_JID, message_id: MSG_ID, emoji: '👍' }
      });
      assert.equal(result.isError, undefined);
      assert.match(result.content[0].text, /👍/);
      assert.match(result.content[0].text, new RegExp(MSG_ID));
    });

    it('reacts by fuzzy chat name', async () => {
      const result = await ctx.client.callTool({
        name: 'send_reaction',
        arguments: { chat: 'John Smith', message_id: MSG_ID, emoji: '❤️' }
      });
      assert.equal(result.isError, undefined);
    });

    it('removes a reaction with empty emoji', async () => {
      const result = await ctx.client.callTool({
        name: 'send_reaction',
        arguments: { chat: CHAT_JID, message_id: MSG_ID, emoji: '' }
      });
      assert.equal(result.isError, undefined);
      assert.match(result.content[0].text, /removed/i);
    });

    it('reacts in a group', async () => {
      const result = await ctx.client.callTool({
        name: 'send_reaction',
        arguments: { chat: GROUP_JID, message_id: MSG_ID, emoji: '🎉' }
      });
      assert.equal(result.isError, undefined);
    });

    it('returns error when not connected', async () => {
      (ctx.waClient as WhatsAppClient & { _connected: boolean })._connected = false;
      const result = await ctx.client.callTool({
        name: 'send_reaction',
        arguments: { chat: CHAT_JID, message_id: MSG_ID, emoji: '👍' }
      });
      assert.ok(result.isError);
      assert.match(result.content[0].text, /not connected/i);
      (ctx.waClient as WhatsAppClient & { _connected: boolean })._connected = true;
    });

    it('propagates client errors', async () => {
      ctx.waClient.setBehavior('sendReaction', () => {
        throw new Error('message too old to react');
      });
      const result = await ctx.client.callTool({
        name: 'send_reaction',
        arguments: { chat: CHAT_JID, message_id: MSG_ID, emoji: '😂' }
      });
      assert.ok(result.isError);
      assert.match(result.content[0].text, /message too old/);
      ctx.waClient.resetBehaviors();
    });
  });

  // ── edit_message ────────────────────────────────────────────────────────────

  describe('edit_message', () => {
    it('edits a message by JID', async () => {
      const result = await ctx.client.callTool({
        name: 'edit_message',
        arguments: { chat: CHAT_JID, message_id: MSG_ID, new_text: 'Corrected message text' }
      });
      assert.equal(result.isError, undefined);
      assert.match(result.content[0].text, /edited successfully/i);
    });

    it('edits by fuzzy chat name', async () => {
      const result = await ctx.client.callTool({
        name: 'edit_message',
        arguments: { chat: 'John Smith', message_id: MSG_ID, new_text: 'Another edit' }
      });
      assert.equal(result.isError, undefined);
    });

    it('returns error when not connected', async () => {
      (ctx.waClient as WhatsAppClient & { _connected: boolean })._connected = false;
      const result = await ctx.client.callTool({
        name: 'edit_message',
        arguments: { chat: CHAT_JID, message_id: MSG_ID, new_text: 'Test' }
      });
      assert.ok(result.isError);
      (ctx.waClient as WhatsAppClient & { _connected: boolean })._connected = true;
    });

    it('propagates client errors', async () => {
      ctx.waClient.setBehavior('editMessage', () => {
        throw new Error('edit window expired');
      });
      const result = await ctx.client.callTool({
        name: 'edit_message',
        arguments: { chat: CHAT_JID, message_id: MSG_ID, new_text: 'Too late' }
      });
      assert.ok(result.isError);
      assert.match(result.content[0].text, /edit window expired/);
      ctx.waClient.resetBehaviors();
    });
  });

  // ── delete_message ──────────────────────────────────────────────────────────

  describe('delete_message', () => {
    it('deletes a message for everyone', async () => {
      const result = await ctx.client.callTool({
        name: 'delete_message',
        arguments: { chat: CHAT_JID, message_id: MSG_ID }
      });
      assert.equal(result.isError, undefined);
      assert.match(result.content[0].text, /deleted for everyone/i);
    });

    it('deletes by fuzzy chat name', async () => {
      const result = await ctx.client.callTool({
        name: 'delete_message',
        arguments: { chat: 'John Smith', message_id: MSG_ID }
      });
      assert.equal(result.isError, undefined);
    });

    it('returns error when not connected', async () => {
      (ctx.waClient as WhatsAppClient & { _connected: boolean })._connected = false;
      const result = await ctx.client.callTool({
        name: 'delete_message',
        arguments: { chat: CHAT_JID, message_id: MSG_ID }
      });
      assert.ok(result.isError);
      (ctx.waClient as WhatsAppClient & { _connected: boolean })._connected = true;
    });

    it('propagates client errors', async () => {
      ctx.waClient.setBehavior('revokeMessage', () => {
        throw new Error('cannot revoke others messages');
      });
      const result = await ctx.client.callTool({
        name: 'delete_message',
        arguments: { chat: CHAT_JID, message_id: MSG_ID }
      });
      assert.ok(result.isError);
      assert.match(result.content[0].text, /cannot revoke/);
      ctx.waClient.resetBehaviors();
    });
  });

  // ── create_poll ─────────────────────────────────────────────────────────────

  describe('create_poll', () => {
    it('sends a poll to a 1:1 chat', async () => {
      const result = await ctx.client.callTool({
        name: 'create_poll',
        arguments: {
          to: CHAT_JID,
          question: 'Best release day?',
          options: ['Monday', 'Wednesday', 'Friday']
        }
      });
      assert.equal(result.isError, undefined);
      const text = result.content[0].text;
      assert.match(text, /Best release day/);
      assert.match(text, /Monday/);
      assert.match(text, /Friday/);
    });

    it('sends a poll to a group by name', async () => {
      const result = await ctx.client.callTool({
        name: 'create_poll',
        arguments: {
          to: 'Engineering Team',
          question: 'Next sprint theme?',
          options: ['Performance', 'Security']
        }
      });
      assert.equal(result.isError, undefined);
    });

    it('sends a multi-select poll', async () => {
      const result = await ctx.client.callTool({
        name: 'create_poll',
        arguments: {
          to: CHAT_JID,
          question: 'Preferred stack?',
          options: ['Node.js', 'Python', 'Go', 'Rust'],
          allow_multiple: true
        }
      });
      assert.equal(result.isError, undefined);
      assert.match(result.content[0].text, /Multiple answers: yes/i);
    });

    it('rejects fewer than 2 options via Zod min(2)', async () => {
      const result = await ctx.client.callTool({
        name: 'create_poll',
        arguments: {
          to: CHAT_JID,
          question: 'One option?',
          options: ['Only this']
        }
      });
      assert.ok(result.isError);
    });

    it('rejects more than 12 options via Zod max(12)', async () => {
      const result = await ctx.client.callTool({
        name: 'create_poll',
        arguments: {
          to: CHAT_JID,
          question: 'Too many?',
          options: Array.from({ length: 13 }, (_, i) => `Option ${i + 1}`)
        }
      });
      assert.ok(result.isError);
    });

    it('returns error when not connected', async () => {
      (ctx.waClient as WhatsAppClient & { _connected: boolean })._connected = false;
      const result = await ctx.client.callTool({
        name: 'create_poll',
        arguments: {
          to: CHAT_JID,
          question: 'Ready?',
          options: ['Yes', 'No']
        }
      });
      assert.ok(result.isError);
      (ctx.waClient as WhatsAppClient & { _connected: boolean })._connected = true;
    });
  });
});
