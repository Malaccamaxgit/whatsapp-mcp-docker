/**
 * Integration tests for Group Management Tools
 *
 * Covers: create_group, get_group_info, get_joined_groups, get_group_invite_link,
 *         join_group, leave_group, update_group_participants, set_group_name, set_group_topic
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestServer } from './helpers/test-server.js';
import { MessageStore } from '../../src/whatsapp/store.js';
import { initEncryption } from '../../src/security/crypto.js';

const GROUP_JID = '120363001234@g.us';
const GROUP_JID_2 = '120363005678@g.us';

describe('Group Management Tools (integration)', () => {
  let ctx: Awaited<ReturnType<typeof createTestServer>>;

  before(async () => {
    initEncryption(null);
    const store = new MessageStore(':memory:');
    store.upsertChat(GROUP_JID, 'Engineering Team', true, 3000, 'Build passed');
    store.upsertChat(GROUP_JID_2, 'WhatsAppMCP', true, 4000, 'Hello');
    store.upsertChat('15145551234@s.whatsapp.net', 'John Smith', false, 1000, 'Hi');
    ctx = await createTestServer({ store });
  });

  after(async () => {
    if (ctx) {await ctx.cleanup();}
  });

  // ── create_group ────────────────────────────────────────────────────────────

  describe('create_group', () => {
    it('creates a group and returns its JID', async () => {
      const result = await ctx.client.callTool({
        name: 'create_group',
        arguments: { name: 'Test Group', participants: ['+15145551234'] }
      });
      assert.equal(result.isError, undefined);
      const text = result.content[0].text;
      assert.match(text, /created successfully/i);
      assert.match(text, /@g\.us/);
    });

    it('returns error when not connected', async () => {
      ctx.waClient._connected = false;
      const result = await ctx.client.callTool({
        name: 'create_group',
        arguments: { name: 'Test Group', participants: ['+15145551234'] }
      });
      assert.ok(result.isError);
      assert.match(result.content[0].text, /not connected/i);
      ctx.waClient._connected = true;
    });

    it('returns error on invalid phone number in participants', async () => {
      // Zod PhoneSchema should reject local number before handler runs
      const result = await ctx.client.callTool({
        name: 'create_group',
        arguments: { name: 'Test Group', participants: ['0612345678'] }
      });
      assert.ok(result.isError);
    });

    it('propagates underlying client errors', async () => {
      ctx.waClient.setBehavior('createGroup', () => {
        throw new Error('group creation failed');
      });
      const result = await ctx.client.callTool({
        name: 'create_group',
        arguments: { name: 'Bad Group', participants: ['+15145551234'] }
      });
      assert.ok(result.isError);
      assert.match(result.content[0].text, /group creation failed/);
      ctx.waClient.resetBehaviors();
    });
  });

  // ── get_group_info ──────────────────────────────────────────────────────────

  describe('get_group_info', () => {
    before(() => {
      ctx.waClient.setBehavior('getGroupInfo', async (jid) => ({
        name: 'Engineering Team',
        topic: 'CI/CD discussions',
        participants: [
          { jid: '15145551234@s.whatsapp.net', isAdmin: true },
          { jid: '15145559999@s.whatsapp.net', isSuperAdmin: false, isAdmin: false }
        ],
        isLocked: false,
        isAnnounce: false
      }));
    });

    after(() => ctx.waClient.resetBehaviors());

    it('returns participants and admins by JID', async () => {
      const result = await ctx.client.callTool({
        name: 'get_group_info',
        arguments: { group: GROUP_JID }
      });
      assert.equal(result.isError, undefined);
      const text = result.content[0].text;
      assert.match(text, /Engineering Team/);
      assert.match(text, /admin/i);
      assert.match(text, /15145551234/);
    });

    it('returns group info by fuzzy name', async () => {
      const result = await ctx.client.callTool({
        name: 'get_group_info',
        arguments: { group: 'Engineering' }
      });
      assert.equal(result.isError, undefined);
      assert.match(result.content[0].text, /Engineering Team/);
    });

    it('returns error when group not found', async () => {
      ctx.waClient.setBehavior('getJoinedGroups', async () => []);
      const result = await ctx.client.callTool({
        name: 'get_group_info',
        arguments: { group: 'NonExistentGroup12345' }
      });
      assert.ok(result.isError);
      assert.match(result.content[0].text, /not found/i);
      ctx.waClient.setBehavior('getJoinedGroups', null);
    });
  });

  // ── get_joined_groups ───────────────────────────────────────────────────────

  describe('get_joined_groups', () => {
    it('lists all joined groups', async () => {
      const result = await ctx.client.callTool({
        name: 'get_joined_groups',
        arguments: {}
      });
      assert.equal(result.isError, undefined);
      const text = result.content[0].text;
      assert.match(text, /Engineering Team|WhatsAppMCP/);
      assert.match(text, /@g\.us/);
    });

    it('handles an empty group list', async () => {
      ctx.waClient.setBehavior('getJoinedGroups', async () => []);
      const result = await ctx.client.callTool({
        name: 'get_joined_groups',
        arguments: {}
      });
      assert.equal(result.isError, undefined);
      assert.match(result.content[0].text, /not a member/i);
      ctx.waClient.resetBehaviors();
    });

    it('returns error when not connected', async () => {
      ctx.waClient._connected = false;
      const result = await ctx.client.callTool({
        name: 'get_joined_groups',
        arguments: {}
      });
      assert.ok(result.isError);
      ctx.waClient._connected = true;
    });
  });

  // ── get_group_invite_link ───────────────────────────────────────────────────

  describe('get_group_invite_link', () => {
    it('returns the invite link for a known group JID', async () => {
      const result = await ctx.client.callTool({
        name: 'get_group_invite_link',
        arguments: { group: GROUP_JID }
      });
      assert.equal(result.isError, undefined);
      assert.match(result.content[0].text, /chat\.whatsapp\.com\//);
      assert.match(result.content[0].text, /ABC123INVITELINK/);
    });

    it('returns error when client throws', async () => {
      ctx.waClient.setBehavior('getGroupInviteLink', () => {
        throw new Error('not an admin');
      });
      const result = await ctx.client.callTool({
        name: 'get_group_invite_link',
        arguments: { group: GROUP_JID }
      });
      assert.ok(result.isError);
      assert.match(result.content[0].text, /not an admin/);
      ctx.waClient.resetBehaviors();
    });
  });

  // ── join_group ──────────────────────────────────────────────────────────────

  describe('join_group', () => {
    it('joins via full URL', async () => {
      const result = await ctx.client.callTool({
        name: 'join_group',
        arguments: { link: 'https://chat.whatsapp.com/ABC123' }
      });
      assert.equal(result.isError, undefined);
      assert.match(result.content[0].text, /joined/i);
    });

    it('joins via bare code', async () => {
      const result = await ctx.client.callTool({
        name: 'join_group',
        arguments: { link: 'DEF456' }
      });
      assert.equal(result.isError, undefined);
    });

    it('returns error when client throws', async () => {
      ctx.waClient.setBehavior('joinGroupWithLink', () => {
        throw new Error('invalid invite link');
      });
      const result = await ctx.client.callTool({
        name: 'join_group',
        arguments: { link: 'BADLINK' }
      });
      assert.ok(result.isError);
      assert.match(result.content[0].text, /invalid invite link/);
      ctx.waClient.resetBehaviors();
    });
  });

  // ── leave_group ─────────────────────────────────────────────────────────────

  describe('leave_group', () => {
    it('leaves by JID', async () => {
      const result = await ctx.client.callTool({
        name: 'leave_group',
        arguments: { group: GROUP_JID }
      });
      assert.equal(result.isError, undefined);
      assert.match(result.content[0].text, /left group/i);
    });

    it('leaves by fuzzy name', async () => {
      const result = await ctx.client.callTool({
        name: 'leave_group',
        arguments: { group: 'Engineering' }
      });
      assert.equal(result.isError, undefined);
    });

    it('returns error when client throws', async () => {
      ctx.waClient.setBehavior('leaveGroup', () => {
        throw new Error('cannot leave');
      });
      const result = await ctx.client.callTool({
        name: 'leave_group',
        arguments: { group: GROUP_JID }
      });
      assert.ok(result.isError);
      ctx.waClient.resetBehaviors();
    });
  });

  // ── update_group_participants ───────────────────────────────────────────────

  describe('update_group_participants', () => {
    it('adds participants', async () => {
      const result = await ctx.client.callTool({
        name: 'update_group_participants',
        arguments: {
          group: GROUP_JID,
          action: 'add',
          participants: ['+15145551234']
        }
      });
      assert.equal(result.isError, undefined);
      assert.match(result.content[0].text, /add/i);
    });

    it('removes participants', async () => {
      const result = await ctx.client.callTool({
        name: 'update_group_participants',
        arguments: {
          group: GROUP_JID,
          action: 'remove',
          participants: ['15145551234@s.whatsapp.net']
        }
      });
      assert.equal(result.isError, undefined);
    });

    it('promotes participants to admin', async () => {
      const result = await ctx.client.callTool({
        name: 'update_group_participants',
        arguments: {
          group: GROUP_JID,
          action: 'promote',
          participants: ['+15145551234']
        }
      });
      assert.equal(result.isError, undefined);
    });

    it('rejects invalid action via Zod enum', async () => {
      const result = await ctx.client.callTool({
        name: 'update_group_participants',
        arguments: {
          group: GROUP_JID,
          action: 'kick',
          participants: ['+15145551234']
        }
      });
      assert.ok(result.isError);
    });

    it('rejects invalid phone in participants list', async () => {
      const result = await ctx.client.callTool({
        name: 'update_group_participants',
        arguments: {
          group: GROUP_JID,
          action: 'add',
          participants: ['0612345678']
        }
      });
      assert.ok(result.isError);
    });
  });

  // ── set_group_name ──────────────────────────────────────────────────────────

  describe('set_group_name', () => {
    it('renames a group by JID', async () => {
      const result = await ctx.client.callTool({
        name: 'set_group_name',
        arguments: { group: GROUP_JID, name: 'New Name' }
      });
      assert.equal(result.isError, undefined);
      assert.match(result.content[0].text, /New Name/);
    });

    it('renames a group by fuzzy name', async () => {
      const result = await ctx.client.callTool({
        name: 'set_group_name',
        arguments: { group: 'Engineering', name: 'Renamed Team' }
      });
      assert.equal(result.isError, undefined);
    });

    it('rejects an empty name via Zod min(1)', async () => {
      const result = await ctx.client.callTool({
        name: 'set_group_name',
        arguments: { group: GROUP_JID, name: '' }
      });
      assert.ok(result.isError);
    });
  });

  // ── set_group_topic ─────────────────────────────────────────────────────────

  describe('set_group_topic', () => {
    it('sets a description', async () => {
      const result = await ctx.client.callTool({
        name: 'set_group_topic',
        arguments: { group: GROUP_JID, topic: 'Daily standups and CI/CD' }
      });
      assert.equal(result.isError, undefined);
      assert.match(result.content[0].text, /updated/i);
    });

    it('clears the description with empty string', async () => {
      const result = await ctx.client.callTool({
        name: 'set_group_topic',
        arguments: { group: GROUP_JID, topic: '' }
      });
      assert.equal(result.isError, undefined);
      assert.match(result.content[0].text, /cleared/i);
    });
  });
});
