/**
 * Integration tests for Contact & User Info Tools
 *
 * Covers: get_user_info, is_on_whatsapp, get_profile_picture
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestServer } from './helpers/test-server.js';
import { MessageStore } from '../../src/whatsapp/store.js';
import { initEncryption } from '../../src/security/crypto.js';

const CHAT_JID = '15145551234@s.whatsapp.net';
const GROUP_JID = '120363001234@g.us';

describe('Contact & User Info Tools (integration)', () => {
  let ctx;

  before(async () => {
    initEncryption(null);
    const store = new MessageStore(':memory:');
    store.upsertChat(CHAT_JID, 'John Smith', false, 1000, 'Hi');
    store.upsertChat(GROUP_JID, 'Engineering Team', true, 2000, 'Build passed');
    ctx = await createTestServer({ store });
  });

  after(async () => {
    if (ctx) await ctx.cleanup();
  });

  // ── get_user_info ───────────────────────────────────────────────────────────

  describe('get_user_info', () => {
    it('returns profile info for a valid phone number', async () => {
      const result = await ctx.client.callTool({
        name: 'get_user_info',
        arguments: { phones: ['+15145551234'] }
      });
      assert.equal(result.isError, undefined);
      const text = result.content[0].text;
      assert.match(text, /15145551234/);
      assert.match(text, /Mock User|Name:/i);
    });

    it('accepts JIDs directly', async () => {
      const result = await ctx.client.callTool({
        name: 'get_user_info',
        arguments: { phones: ['15145551234@s.whatsapp.net'] }
      });
      assert.equal(result.isError, undefined);
      assert.match(result.content[0].text, /15145551234/);
    });

    it('returns info for multiple numbers', async () => {
      const result = await ctx.client.callTool({
        name: 'get_user_info',
        arguments: { phones: ['+15145551234', '+353871234567'] }
      });
      assert.equal(result.isError, undefined);
      const text = result.content[0].text;
      assert.match(text, /15145551234/);
      assert.match(text, /353871234567/);
    });

    it('handles empty result from client', async () => {
      ctx.waClient.setBehavior('getUserInfo', async () => ({}));
      const result = await ctx.client.callTool({
        name: 'get_user_info',
        arguments: { phones: ['+15145551234'] }
      });
      assert.equal(result.isError, undefined);
      assert.match(result.content[0].text, /no information found/i);
      ctx.waClient.resetBehaviors();
    });

    it('rejects a local (0-prefixed) phone number via Zod PhoneSchema', async () => {
      const result = await ctx.client.callTool({
        name: 'get_user_info',
        arguments: { phones: ['0612345678'] }
      });
      assert.ok(result.isError);
    });

    it('rejects an empty phones array via Zod min(1)', async () => {
      const result = await ctx.client.callTool({
        name: 'get_user_info',
        arguments: { phones: [] }
      });
      assert.ok(result.isError);
    });

    it('rejects more than 20 phones via Zod max(20)', async () => {
      const result = await ctx.client.callTool({
        name: 'get_user_info',
        arguments: { phones: Array.from({ length: 21 }, (_, i) => `+1514555${String(i).padStart(4, '0')}`) }
      });
      assert.ok(result.isError);
    });

    it('returns error when not connected', async () => {
      ctx.waClient._connected = false;
      const result = await ctx.client.callTool({
        name: 'get_user_info',
        arguments: { phones: ['+15145551234'] }
      });
      assert.ok(result.isError);
      assert.match(result.content[0].text, /not connected/i);
      ctx.waClient._connected = true;
    });
  });

  // ── is_on_whatsapp ──────────────────────────────────────────────────────────

  describe('is_on_whatsapp', () => {
    it('returns on-WhatsApp status for a number', async () => {
      const result = await ctx.client.callTool({
        name: 'is_on_whatsapp',
        arguments: { phones: ['+15145551234'] }
      });
      assert.equal(result.isError, undefined);
      const text = result.content[0].text;
      assert.match(text, /on WhatsApp|✅/);
    });

    it('checks multiple numbers at once', async () => {
      const result = await ctx.client.callTool({
        name: 'is_on_whatsapp',
        arguments: { phones: ['+15145551234', '+447911123456'] }
      });
      assert.equal(result.isError, undefined);
      const text = result.content[0].text;
      assert.match(text, /15145551234/);
      assert.match(text, /447911123456/);
    });

    it('handles a mix of exists/not-exists', async () => {
      ctx.waClient.setBehavior('isOnWhatsApp', async (phones) =>
        phones.map((p, i) => ({
          jid: `${p.replace(/\D/g, '')}@s.whatsapp.net`,
          phone: p,
          exists: i === 0 // first one exists, rest don't
        }))
      );
      const result = await ctx.client.callTool({
        name: 'is_on_whatsapp',
        arguments: { phones: ['+15145551234', '+15145559999'] }
      });
      assert.equal(result.isError, undefined);
      const text = result.content[0].text;
      assert.match(text, /✅/);
      assert.match(text, /❌/);
      ctx.waClient.resetBehaviors();
    });

    it('rejects a local phone number via Zod PhoneSchema', async () => {
      const result = await ctx.client.callTool({
        name: 'is_on_whatsapp',
        arguments: { phones: ['0612345678'] }
      });
      assert.ok(result.isError);
    });

    it('returns error when not connected', async () => {
      ctx.waClient._connected = false;
      const result = await ctx.client.callTool({
        name: 'is_on_whatsapp',
        arguments: { phones: ['+15145551234'] }
      });
      assert.ok(result.isError);
      ctx.waClient._connected = true;
    });
  });

  // ── get_profile_picture ─────────────────────────────────────────────────────

  describe('get_profile_picture', () => {
    it('returns a URL for a user JID', async () => {
      const result = await ctx.client.callTool({
        name: 'get_profile_picture',
        arguments: { target: CHAT_JID }
      });
      assert.equal(result.isError, undefined);
      assert.match(result.content[0].text, /https?:\/\//);
    });

    it('returns a URL for a group JID', async () => {
      const result = await ctx.client.callTool({
        name: 'get_profile_picture',
        arguments: { target: GROUP_JID }
      });
      assert.equal(result.isError, undefined);
      assert.match(result.content[0].text, /https?:\/\//);
    });

    it('returns a URL for a phone number', async () => {
      const result = await ctx.client.callTool({
        name: 'get_profile_picture',
        arguments: { target: '+15145551234' }
      });
      assert.equal(result.isError, undefined);
    });

    it('returns a URL for a contact name match', async () => {
      const result = await ctx.client.callTool({
        name: 'get_profile_picture',
        arguments: { target: 'John Smith' }
      });
      assert.equal(result.isError, undefined);
    });

    it('reports no picture when client returns null', async () => {
      ctx.waClient.setBehavior('getProfilePicture', async () => null);
      const result = await ctx.client.callTool({
        name: 'get_profile_picture',
        arguments: { target: CHAT_JID }
      });
      assert.equal(result.isError, undefined);
      assert.match(result.content[0].text, /no profile picture/i);
      ctx.waClient.resetBehaviors();
    });

    it('returns error when not connected', async () => {
      ctx.waClient._connected = false;
      const result = await ctx.client.callTool({
        name: 'get_profile_picture',
        arguments: { target: CHAT_JID }
      });
      assert.ok(result.isError);
      ctx.waClient._connected = true;
    });
  });
});
