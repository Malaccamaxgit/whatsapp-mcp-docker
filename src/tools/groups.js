/**
 * Group Management Tools
 *
 * create_group, get_group_info, get_joined_groups, get_group_invite_link,
 * join_group, leave_group, update_group_participants,
 * set_group_name, set_group_topic
 */

import { z } from 'zod';
import { resolveRecipient } from '../utils/fuzzy-match.js';
import { toJid, isGroupJid } from '../utils/phone.js';
import { PhoneArraySchema } from '../utils/zod-schemas.js';

const notConnected = () => ({
  content: [{ type: 'text', text: 'WhatsApp not connected. Use the authenticate tool first.' }],
  isError: true
});

export function registerGroupTools(server, waClient, store, permissions, audit) {
  // ── create_group ──────────────────────────────────────────────

  server.tool(
    'create_group',
    'Create a new WhatsApp group with the given name and participant phone numbers or JIDs. Returns the new group JID and invite link.',
    {
      name: z.string().min(1).max(100).describe('Group name (1–100 characters)'),
      participants: PhoneArraySchema(1, 256).describe('Phone numbers (E.164) or JIDs of participants to add')
    },
    async ({ name, participants }) => {
      if (!waClient.isConnected()) return notConnected();

      const rateCheck = permissions.checkRateLimit();
      if (!rateCheck.allowed) {
        return { content: [{ type: 'text', text: rateCheck.error }], isError: true };
      }

      try {
        const jids = participants.map((p) => (p.includes('@') ? p : toJid(p)));
        const result = await waClient.createGroup(name, jids);
        audit.log('create_group', 'created', { name, jid: result.jid, participants: jids.length });
        return {
          content: [
            {
              type: 'text',
              text: [
                `Group "${name}" created successfully.`,
                `  JID: ${result.jid}`,
                `  Participants: ${jids.length}`,
                result.inviteLink ? `  Invite link: ${result.inviteLink}` : ''
              ]
                .filter(Boolean)
                .join('\n')
            }
          ]
        };
      } catch (err) {
        audit.log('create_group', 'failed', { name, error: err.message }, false);
        return { content: [{ type: 'text', text: `Failed to create group: ${err.message}` }], isError: true };
      }
    },
    { annotations: { destructiveHint: false, openWorldHint: true } }
  );

  // ── get_group_info ────────────────────────────────────────────

  server.tool(
    'get_group_info',
    'Get detailed information about a WhatsApp group: name, description, participants, admin list, and settings.',
    {
      group: z.string().max(200).describe('Group name (fuzzy match) or group JID ending in @g.us')
    },
    async ({ group }) => {
      if (!waClient.isConnected()) return notConnected();

      try {
        const jid = await resolveGroupJid(group, store, waClient);
        if (!jid) {
          return { content: [{ type: 'text', text: `Group not found: "${group}"` }], isError: true };
        }

        const info = await waClient.getGroupInfo(jid);
        audit.log('get_group_info', 'read', { jid });

        const admins = info.participants.filter((p) => p.isAdmin || p.isSuperAdmin).map((p) => p.jid);
        const members = info.participants.map((p) => {
          const role = p.isSuperAdmin ? ' [owner]' : p.isAdmin ? ' [admin]' : '';
          return `  - ${p.jid}${role}`;
        });

        return {
          content: [
            {
              type: 'text',
              text: [
                `Group: ${info.name || '(no name)'}`,
                `JID: ${jid}`,
                info.topic ? `Description: ${info.topic}` : '',
                `Participants (${info.participants.length}):`,
                ...members,
                `Admins: ${admins.join(', ') || 'none'}`,
                info.isLocked ? 'Settings: locked (only admins can change)' : '',
                info.isAnnounce ? 'Mode: announce (only admins can send)' : ''
              ]
                .filter(Boolean)
                .join('\n')
            }
          ]
        };
      } catch (err) {
        return { content: [{ type: 'text', text: `Failed to get group info: ${err.message}` }], isError: true };
      }
    },
    { annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true } }
  );

  // ── get_joined_groups ─────────────────────────────────────────

  server.tool(
    'get_joined_groups',
    'List all WhatsApp groups this account is a member of, with participant counts and admin status.',
    {},
    async () => {
      if (!waClient.isConnected()) return notConnected();

      try {
        const groups = await waClient.getJoinedGroups();
        audit.log('get_joined_groups', 'read', { count: groups.length });

        if (groups.length === 0) {
          return { content: [{ type: 'text', text: 'Not a member of any groups.' }] };
        }

        const lines = groups.map((g) => {
          const adminMark = g.participants?.some((p) => (p.isAdmin || p.isSuperAdmin) && p.jid === waClient.jid) ? ' [admin]' : '';
          return `  ${g.name || g.jid}${adminMark} — ${g.participants?.length ?? '?'} members — ${g.jid}`;
        });

        return {
          content: [{ type: 'text', text: `Joined groups (${groups.length}):\n${lines.join('\n')}` }]
        };
      } catch (err) {
        return { content: [{ type: 'text', text: `Failed to list groups: ${err.message}` }], isError: true };
      }
    },
    { annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true } }
  );

  // ── get_group_invite_link ─────────────────────────────────────

  server.tool(
    'get_group_invite_link',
    'Get the invite link for a WhatsApp group. Anyone with the link can join. Requires admin privileges.',
    {
      group: z.string().max(200).describe('Group name (fuzzy match) or JID ending in @g.us')
    },
    async ({ group }) => {
      if (!waClient.isConnected()) return notConnected();

      try {
        const jid = await resolveGroupJid(group, store, waClient);
        if (!jid) {
          return { content: [{ type: 'text', text: `Group not found: "${group}"` }], isError: true };
        }

        const link = await waClient.getGroupInviteLink(jid);
        audit.log('get_group_invite_link', 'read', { jid });
        const fullLink = typeof link === 'string' && link.startsWith('https://')
          ? link
          : `https://chat.whatsapp.com/${link}`;
        return {
          content: [{ type: 'text', text: `Invite link for ${jid}:\n${fullLink}` }]
        };
      } catch (err) {
        return { content: [{ type: 'text', text: `Failed to get invite link: ${err.message}` }], isError: true };
      }
    },
    { annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true } }
  );

  // ── join_group ────────────────────────────────────────────────

  server.tool(
    'join_group',
    'Join a WhatsApp group using an invite link (https://chat.whatsapp.com/...) or an invite code.',
    {
      link: z
        .string()
        .max(300)
        .describe('Full invite URL (https://chat.whatsapp.com/CODE) or just the invite code')
    },
    async ({ link }) => {
      if (!waClient.isConnected()) return notConnected();

      const rateCheck = permissions.checkRateLimit();
      if (!rateCheck.allowed) {
        return { content: [{ type: 'text', text: rateCheck.error }], isError: true };
      }

      try {
        let code;
        try {
          const url = new URL(link.trim());
          if (url.hostname !== 'chat.whatsapp.com') {
            return {
              content: [{ type: 'text', text: 'Invalid WhatsApp group link: unrecognized host.' }],
              isError: true
            };
          }
          code = url.pathname.replace(/^\//, '').trim();
        } catch {
          // Not a full URL — treat as a raw invite code
          code = link.trim();
        }
        const result = await waClient.joinGroupWithLink(code);
        audit.log('join_group', 'joined', { link: code, jid: result?.jid });
        return {
          content: [{ type: 'text', text: `Joined group successfully.\nJID: ${result?.jid || 'unknown'}` }]
        };
      } catch (err) {
        audit.log('join_group', 'failed', { error: err.message }, false);
        return { content: [{ type: 'text', text: `Failed to join group: ${err.message}` }], isError: true };
      }
    },
    { annotations: { destructiveHint: false, openWorldHint: true } }
  );

  // ── leave_group ───────────────────────────────────────────────

  server.tool(
    'leave_group',
    'Leave a WhatsApp group. This action is permanent — you will need an invite to rejoin.',
    {
      group: z.string().max(200).describe('Group name (fuzzy match) or JID ending in @g.us')
    },
    async ({ group }) => {
      if (!waClient.isConnected()) return notConnected();

      try {
        const jid = await resolveGroupJid(group, store, waClient);
        if (!jid) {
          return { content: [{ type: 'text', text: `Group not found: "${group}"` }], isError: true };
        }

        await waClient.leaveGroup(jid);
        audit.log('leave_group', 'left', { jid });
        return { content: [{ type: 'text', text: `Left group ${jid}.` }] };
      } catch (err) {
        audit.log('leave_group', 'failed', { error: err.message }, false);
        return { content: [{ type: 'text', text: `Failed to leave group: ${err.message}` }], isError: true };
      }
    },
    { annotations: { destructiveHint: true, openWorldHint: true } }
  );

  // ── update_group_participants ─────────────────────────────────

  server.tool(
    'update_group_participants',
    'Add, remove, promote to admin, or demote participants in a WhatsApp group. Requires admin privileges for most actions.',
    {
      group: z.string().max(200).describe('Group name (fuzzy match) or JID ending in @g.us'),
      action: z
        .enum(['add', 'remove', 'promote', 'demote'])
        .describe('Action to perform on the participants'),
      participants: PhoneArraySchema(1, 50).describe('Phone numbers (E.164) or JIDs of participants')
    },
    async ({ group, action, participants }) => {
      if (!waClient.isConnected()) return notConnected();

      const rateCheck = permissions.checkRateLimit();
      if (!rateCheck.allowed) {
        return { content: [{ type: 'text', text: rateCheck.error }], isError: true };
      }

      try {
        const jid = await resolveGroupJid(group, store, waClient);
        if (!jid) {
          return { content: [{ type: 'text', text: `Group not found: "${group}"` }], isError: true };
        }

        const jids = participants.map((p) => (p.includes('@') ? p : toJid(p)));
        const result = await waClient.updateGroupParticipants(jid, jids, action);
        audit.log('update_group_participants', action, { jid, count: jids.length });

        const outcomes = result?.map((r) => `  - ${r.jid}: ${r.error || 'ok'}`).join('\n') || '';
        return {
          content: [
            {
              type: 'text',
              text: `${action} completed for ${jids.length} participant(s) in ${jid}.\n${outcomes}`.trim()
            }
          ]
        };
      } catch (err) {
        audit.log('update_group_participants', 'failed', { error: err.message }, false);
        return { content: [{ type: 'text', text: `Failed to update participants: ${err.message}` }], isError: true };
      }
    },
    { annotations: { destructiveHint: false, openWorldHint: true } }
  );

  // ── set_group_name ────────────────────────────────────────────

  server.tool(
    'set_group_name',
    'Change the name of a WhatsApp group. Requires admin privileges.',
    {
      group: z.string().max(200).describe('Group name (fuzzy match) or JID ending in @g.us'),
      name: z.string().min(1).max(100).describe('New group name')
    },
    async ({ group, name }) => {
      if (!waClient.isConnected()) return notConnected();

      try {
        const jid = await resolveGroupJid(group, store, waClient);
        if (!jid) {
          return { content: [{ type: 'text', text: `Group not found: "${group}"` }], isError: true };
        }

        await waClient.setGroupName(jid, name);
        audit.log('set_group_name', 'updated', { jid, name });
        return { content: [{ type: 'text', text: `Group name updated to "${name}".` }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Failed to set group name: ${err.message}` }], isError: true };
      }
    },
    { annotations: { destructiveHint: false, openWorldHint: true } }
  );

  // ── set_group_topic ───────────────────────────────────────────

  server.tool(
    'set_group_topic',
    'Set or update the description/topic of a WhatsApp group. Requires admin privileges.',
    {
      group: z.string().max(200).describe('Group name (fuzzy match) or JID ending in @g.us'),
      topic: z.string().max(512).describe('New group description (max 512 characters, empty string to clear)')
    },
    async ({ group, topic }) => {
      if (!waClient.isConnected()) return notConnected();

      try {
        const jid = await resolveGroupJid(group, store, waClient);
        if (!jid) {
          return { content: [{ type: 'text', text: `Group not found: "${group}"` }], isError: true };
        }

        await waClient.setGroupTopic(jid, topic);
        audit.log('set_group_topic', 'updated', { jid });
        return {
          content: [
            { type: 'text', text: topic ? `Group description updated.` : `Group description cleared.` }
          ]
        };
      } catch (err) {
        return { content: [{ type: 'text', text: `Failed to set group topic: ${err.message}` }], isError: true };
      }
    },
    { annotations: { destructiveHint: false, openWorldHint: true } }
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function resolveGroupJid(group, store, waClient) {
  if (isGroupJid(group)) return group;

  // Try store first (fast, no network)
  const chats = store.getAllChatsForMatching();
  const { resolved } = resolveRecipient(group, chats);
  if (resolved && isGroupJid(resolved)) return resolved;

  // Fall back to live group list from WhatsApp
  try {
    const groups = await waClient.getJoinedGroups();
    const match = groups.find(
      (g) => g.name?.toLowerCase() === group.toLowerCase() || g.jid === group
    );
    return match?.jid || null;
  } catch {
    return null;
  }
}
