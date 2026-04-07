/**
 * Integration tests for Contact & User Info Tools
 *
 * Covers: get_user_info, is_on_whatsapp, get_profile_picture, set_contact_name, sync_contact_names
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestServer } from './helpers/test-server.js';
import { MessageStore } from '../../src/whatsapp/store.js';
import { initEncryption } from '../../src/security/crypto.js';

const CHAT_JID = '15145551234@s.whatsapp.net';
const GROUP_JID = '120363001234@g.us';

describe('Contact & User Info Tools (integration)', () => {
  let ctx: Awaited<ReturnType<typeof createTestServer>>;

  before(async () => {
    initEncryption(null);
    const store = new MessageStore(':memory:');
    store.upsertChat(CHAT_JID, 'John Smith', false, 1000, 'Hi');
    store.upsertChat(GROUP_JID, 'Engineering Team', true, 2000, 'Build passed');
    ctx = await createTestServer({ store });
  });

  after(async () => {
    if (ctx) {await ctx.cleanup();}
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
      (ctx.waClient as unknown as { setBehavior: (method: string, impl: (...args: unknown[]) => unknown) => void }).setBehavior('getUserInfo', async () => ({}));
      const result = await ctx.client.callTool({
        name: 'get_user_info',
        arguments: { phones: ['+15145551234'] }
      });
      assert.equal(result.isError, undefined);
      assert.match(result.content[0].text, /no information found/i);
      (ctx.waClient as unknown as { resetBehaviors: () => void }).resetBehaviors();
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
      (ctx.waClient as unknown as { _connected: boolean; _probeVerified: boolean })._connected = false;
      (ctx.waClient as unknown as { _probeVerified: boolean })._probeVerified = false;
      const result = await ctx.client.callTool({
        name: 'get_user_info',
        arguments: { phones: ['+15145551234'] }
      });
      assert.ok(result.isError);
      assert.match(result.content[0].text, /not connected/i);
      (ctx.waClient as unknown as { _connected: boolean })._connected = true;
      (ctx.waClient as unknown as { _probeVerified: boolean })._probeVerified = true;
    });

    it('stores retrieved names when save_names is true', async () => {
      const bareJid = '15555559876@s.whatsapp.net';
      ctx.store.upsertChat(bareJid, bareJid, false, 1200, 'hey');
      const result = await ctx.client.callTool({
        name: 'get_user_info',
        arguments: { phones: ['+15555559876'], save_names: true }
      });
      assert.equal(result.isError, undefined);
      const row = ctx.store.getChatByJid(bareJid);
      assert.ok(row);
      assert.equal(row!.name, 'Mock User');
    });
  });

  // ── sync_contact_names ─────────────────────────────────────────────────────

  describe('sync_contact_names', () => {
    it('returns no contacts when contacts array is empty', async () => {
      const result = await ctx.client.callTool({
        name: 'sync_contact_names',
        arguments: { contacts: [] }
      });
      assert.equal(result.isError, undefined);
      assert.match(result.content[0].text, /no contacts to sync/i);
    });

    it('syncs unnamed chats and stores profile names', async () => {
      const bareJid = '16666660777@s.whatsapp.net';
      ctx.store.upsertChat(bareJid, bareJid, false, 1100, 'x');
      const result = await ctx.client.callTool({
        name: 'sync_contact_names',
        arguments: {}
      });
      assert.equal(result.isError, undefined);
      assert.match(result.content[0].text, /names updated/i);
      const row = ctx.store.getChatByJid(bareJid);
      assert.ok(row);
      assert.equal(row!.name, 'Mock User');
    });

    it('uses phone JID from contact mapping when syncing an @lid chat', async () => {
      const lid = '138053771370999@lid';
      const phoneJid = '15145559999@s.whatsapp.net';
      ctx.store.upsertChat(lid, lid, false, 1050, 'm');
      ctx.store.upsertContactMapping(lid, phoneJid, '+15145559999', null);
      (ctx.waClient as unknown as { setBehavior: (method: string, impl: (...args: unknown[]) => unknown) => void }).setBehavior(
        'getUserInfo',
        async (jids: string[]) => {
          const out: Record<string, { name: string; status: string }> = {};
          if (jids.includes(phoneJid)) {
            out[phoneJid] = { name: 'From Phone Lookup', status: '' };
          }
          return out;
        }
      );
      const result = await ctx.client.callTool({
        name: 'sync_contact_names',
        arguments: { contacts: [lid] }
      });
      assert.equal(result.isError, undefined);
      assert.match(result.content[0].text, /From Phone Lookup/);
      const row = ctx.store.getChatByJid(lid);
      assert.ok(row);
      assert.equal(row!.name, 'From Phone Lookup');
      (ctx.waClient as unknown as { resetBehaviors: () => void }).resetBehaviors();
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
      (ctx.waClient as unknown as { setBehavior: (method: string, impl: (...args: unknown[]) => unknown) => void }).setBehavior('isOnWhatsApp', async (phones: string[]) =>
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
      (ctx.waClient as unknown as { resetBehaviors: () => void }).resetBehaviors();
    });

    it('rejects a local phone number via Zod PhoneSchema', async () => {
      const result = await ctx.client.callTool({
        name: 'is_on_whatsapp',
        arguments: { phones: ['0612345678'] }
      });
      assert.ok(result.isError);
    });

    it('returns error when not connected', async () => {
      (ctx.waClient as unknown as { _connected: boolean; _probeVerified: boolean })._connected = false;
      (ctx.waClient as unknown as { _probeVerified: boolean })._probeVerified = false;
      const result = await ctx.client.callTool({
        name: 'is_on_whatsapp',
        arguments: { phones: ['+15145551234'] }
      });
      assert.ok(result.isError);
      (ctx.waClient as unknown as { _connected: boolean })._connected = true;
      (ctx.waClient as unknown as { _probeVerified: boolean })._probeVerified = true;
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
      (ctx.waClient as unknown as { setBehavior: (method: string, impl: (...args: unknown[]) => unknown) => void }).setBehavior('getProfilePicture', async () => null);
      const result = await ctx.client.callTool({
        name: 'get_profile_picture',
        arguments: { target: CHAT_JID }
      });
      assert.equal(result.isError, undefined);
      assert.match(result.content[0].text, /no profile picture/i);
      (ctx.waClient as unknown as { resetBehaviors: () => void }).resetBehaviors();
    });

    it('returns error when not connected', async () => {
      (ctx.waClient as unknown as { _connected: boolean; _probeVerified: boolean })._connected = false;
      (ctx.waClient as unknown as { _probeVerified: boolean })._probeVerified = false;
      const result = await ctx.client.callTool({
        name: 'get_profile_picture',
        arguments: { target: CHAT_JID }
      });
      assert.ok(result.isError);
      (ctx.waClient as unknown as { _connected: boolean })._connected = true;
      (ctx.waClient as unknown as { _probeVerified: boolean })._probeVerified = true;
    });
  });

  // ── set_contact_name ────────────────────────────────────────────────────────

  describe('set_contact_name', () => {
    it('stores a custom name and list_chats displays it', async () => {
      const lid = '138053771370743@lid';
      ctx.store.upsertChat(lid, 'Push Name', false, 8000, 'hey');
      const setResult = await ctx.client.callTool({
        name: 'set_contact_name',
        arguments: { jid: lid, name: 'Kapso AI' }
      });
      assert.equal(setResult.isError, undefined);
      const listResult = await ctx.client.callTool({
        name: 'list_chats',
        arguments: { filter: 'Kapso', limit: 20, page: 0 }
      });
      assert.equal(listResult.isError, undefined);
      assert.match(listResult.content[0].text, /Kapso AI/);
    });

    it('clears custom name when name is empty', async () => {
      const lid = '138053771370744@lid';
      ctx.store.upsertChat(lid, 'Restored Push', false, 9000, 'x');
      await ctx.client.callTool({
        name: 'set_contact_name',
        arguments: { jid: lid, name: 'Temporary' }
      });
      assert.equal(ctx.store.getDisplayNameForJid(lid), 'Temporary');
      const clearResult = await ctx.client.callTool({
        name: 'set_contact_name',
        arguments: { jid: lid, name: '' }
      });
      assert.equal(clearResult.isError, undefined);
      assert.match(clearResult.content[0].text, /cleared/i);
      assert.equal(ctx.store.getDisplayNameForJid(lid), 'Restored Push');
    });

    it('accepts E.164 phone and resolves to user JID', async () => {
      const setResult = await ctx.client.callTool({
        name: 'set_contact_name',
        arguments: { jid: '+15145551234', name: 'Renamed Local' }
      });
      assert.equal(setResult.isError, undefined);
      assert.equal(ctx.store.getCustomContactName(CHAT_JID), 'Renamed Local');
    });
  });
});
