/**
 * Group Management Tools
 *
 * create_group, get_group_info, get_joined_groups, get_group_invite_link,
 * join_group, leave_group, update_group_participants,
 * set_group_name, set_group_topic
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { resolveRecipient, type Chat } from '../utils/fuzzy-match.js';
import { toJid, isGroupJid } from '../utils/phone.js';
import { PhoneArraySchema } from '../utils/zod-schemas.js';
import type { MessageStore } from '../whatsapp/store.js';
import type { WhatsAppClient } from '../whatsapp/client.js';
import type { AuditLogger } from '../security/audit.js';
import type { PermissionManager } from '../security/permissions.js';

interface TextContent {
  type: 'text';
  text: string;
}

interface McpResult {
  content: TextContent[];
  isError?: boolean;
}

interface GroupParticipant {
  jid: string;
  isAdmin: boolean;
  isSuperAdmin: boolean;
}

interface GroupInfo {
  name?: string;
  topic?: string;
  participants: GroupParticipant[];
  isLocked?: boolean;
  isAnnounce?: boolean;
}

interface JoinedGroup {
  name?: string;
  jid: string;
  participants?: GroupParticipant[];
}

interface CreateGroupResult {
  jid: string;
  inviteLink?: string;
}

interface UpdateParticipantsResult {
  jid: string;
  error?: string;
}

interface JoinGroupResult {
  jid?: string;
}

const notConnected = (): McpResult => ({
  content: [{ type: 'text', text: 'WhatsApp not connected. Use the authenticate tool first.' }],
  isError: true
});

export function registerGroupTools(
  server: McpServer,
  waClient: WhatsAppClient,
  store: MessageStore,
  permissions: PermissionManager,
  audit: AuditLogger
): void {
  // ── create_group ──────────────────────────────────────────────

  server.registerTool(
    'create_group',
    {
      description: 'Create a new WhatsApp group with the given name and participant phone numbers or JIDs. Returns the new group JID and invite link.',
      inputSchema: {
        name: z.string().min(1).max(100).describe('Group name (1–100 characters)'),
        participants: PhoneArraySchema(1, 256).describe('Phone numbers (E.164) or JIDs of participants to add')
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (async ({ name, participants }: { name: string; participants: string[] }) => {
      if (!waClient.isConnected()) return notConnected();

      const rateCheck = permissions.checkRateLimit();
      if (!rateCheck.allowed) {
        return { content: [{ type: 'text', text: rateCheck.error }], isError: true };
      }

      try {
        const jids = participants.map((p) => (p.includes('@') ? p : toJid(p))).filter((j): j is string => j !== null);
        const result = await waClient.createGroup(name, jids) as CreateGroupResult;
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
        const errorMsg = err instanceof Error ? err.message : String(err || '');
        audit.log('create_group', 'failed', { name, error: errorMsg }, false);
        return { content: [{ type: 'text', text: `Failed to create group: ${errorMsg}` }], isError: true };
      }
    }) as any
  );

  // ── get_group_info ────────────────────────────────────────────

  server.registerTool(
    'get_group_info',
    {
      description: 'Get detailed information about a WhatsApp group: name, description, participants, admin list, and settings.',
      inputSchema: {
        group: z.string().max(200).describe('Group name (fuzzy match) or group JID ending in @g.us')
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (async ({ group }: { group: string }) => {
      if (!waClient.isConnected()) return notConnected();

      try {
        const jid = await resolveGroupJid(group, store, waClient);
        if (!jid) {
          return { content: [{ type: 'text', text: `Group not found: "${group}"` }], isError: true };
        }

        const info = await waClient.getGroupInfo(jid) as GroupInfo;
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
        const errorMsg = err instanceof Error ? err.message : String(err || '');
        return { content: [{ type: 'text', text: `Failed to get group info: ${errorMsg}` }], isError: true };
      }
    }) as any
  );

  // ── get_joined_groups ─────────────────────────────────────────

  server.registerTool(
    'get_joined_groups',
    {
      description: 'List all WhatsApp groups this account is a member of, with participant counts and admin status.',
      inputSchema: {}
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (async () => {
      if (!waClient.isConnected()) return notConnected();

      try {
        const groups = await waClient.getJoinedGroups() as JoinedGroup[];
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
        const errorMsg = err instanceof Error ? err.message : String(err || '');
        return { content: [{ type: 'text', text: `Failed to list groups: ${errorMsg}` }], isError: true };
      }
    }) as any
  );

  // ── get_group_invite_link ─────────────────────────────────────

  server.registerTool(
    'get_group_invite_link',
    {
      description: 'Get the invite link for a WhatsApp group. Anyone with the link can join. Requires admin privileges.',
      inputSchema: {
        group: z.string().max(200).describe('Group name (fuzzy match) or JID ending in @g.us')
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (async ({ group }: { group: string }) => {
      if (!waClient.isConnected()) return notConnected();

      try {
        const jid = await resolveGroupJid(group, store, waClient);
        if (!jid) {
          return { content: [{ type: 'text', text: `Group not found: "${group}"` }], isError: true };
        }

        const link = await waClient.getGroupInviteLink(jid) as string;
        audit.log('get_group_invite_link', 'read', { jid });
        const fullLink = typeof link === 'string' && link.startsWith('https://')
          ? link
          : `https://chat.whatsapp.com/${link}`;
        return {
          content: [{ type: 'text', text: `Invite link for ${jid}:\n${fullLink}` }]
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err || '');
        return { content: [{ type: 'text', text: `Failed to get invite link: ${errorMsg}` }], isError: true };
      }
    }) as any
  );

  // ── join_group ────────────────────────────────────────────────

  server.registerTool(
    'join_group',
    {
      description: 'Join a WhatsApp group using an invite link (https://chat.whatsapp.com/...) or an invite code.',
      inputSchema: {
        link: z
          .string()
          .max(300)
          .describe('Full invite URL (https://chat.whatsapp.com/CODE) or just the invite code')
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (async ({ link }: { link: string }) => {
      if (!waClient.isConnected()) return notConnected();

      const rateCheck = permissions.checkRateLimit();
      if (!rateCheck.allowed) {
        return { content: [{ type: 'text', text: rateCheck.error }], isError: true };
      }

      try {
        let code: string;
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
        const result = await waClient.joinGroupWithLink(code) as JoinGroupResult;
        audit.log('join_group', 'joined', { link: code, jid: result?.jid });
        return {
          content: [{ type: 'text', text: `Joined group successfully.\nJID: ${result?.jid || 'unknown'}` }]
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err || '');
        audit.log('join_group', 'failed', { error: errorMsg }, false);
        return { content: [{ type: 'text', text: `Failed to join group: ${errorMsg}` }], isError: true };
      }
    }) as any
  );

  // ── leave_group ───────────────────────────────────────────────

  server.registerTool(
    'leave_group',
    {
      description: 'Leave a WhatsApp group. This action is permanent — you will need an invite to rejoin.',
      inputSchema: {
        group: z.string().max(200).describe('Group name (fuzzy match) or JID ending in @g.us')
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (async ({ group }: { group: string }) => {
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
        const errorMsg = err instanceof Error ? err.message : String(err || '');
        audit.log('leave_group', 'failed', { error: errorMsg }, false);
        return { content: [{ type: 'text', text: `Failed to leave group: ${errorMsg}` }], isError: true };
      }
    }) as any
  );

  // ── update_group_participants ─────────────────────────────────

  server.registerTool(
    'update_group_participants',
    {
      description: 'Add, remove, promote to admin, or demote participants in a WhatsApp group. Requires admin privileges for most actions.',
      inputSchema: {
        group: z.string().max(200).describe('Group name (fuzzy match) or JID ending in @g.us'),
        action: z
          .enum(['add', 'remove', 'promote', 'demote'])
          .describe('Action to perform on the participants'),
        participants: PhoneArraySchema(1, 50).describe('Phone numbers (E.164) or JIDs of participants')
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (async ({ group, action, participants }: { group: string; action: string; participants: string[] }) => {
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

        const jids = participants.map((p) => (p.includes('@') ? p : toJid(p))).filter((j): j is string => j !== null);
        const result = await waClient.updateGroupParticipants(jid, jids, action) as UpdateParticipantsResult[];
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
        const errorMsg = err instanceof Error ? err.message : String(err || '');
        audit.log('update_group_participants', 'failed', { error: errorMsg }, false);
        return { content: [{ type: 'text', text: `Failed to update participants: ${errorMsg}` }], isError: true };
      }
    }) as any
  );

  // ── set_group_name ────────────────────────────────────────────

  server.registerTool(
    'set_group_name',
    {
      description: 'Change the name of a WhatsApp group. Requires admin privileges.',
      inputSchema: {
        group: z.string().max(200).describe('Group name (fuzzy match) or JID ending in @g.us'),
        name: z.string().min(1).max(100).describe('New group name')
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (async ({ group, name }: { group: string; name: string }) => {
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
        const errorMsg = err instanceof Error ? err.message : String(err || '');
        return { content: [{ type: 'text', text: `Failed to set group name: ${errorMsg}` }], isError: true };
      }
    }) as any
  );

  // ── set_group_topic ───────────────────────────────────────────

  server.registerTool(
    'set_group_topic',
    {
      description: 'Set or update the description/topic of a WhatsApp group. Requires admin privileges.',
      inputSchema: {
        group: z.string().max(200).describe('Group name (fuzzy match) or JID ending in @g.us'),
        topic: z.string().max(512).describe('New group description (max 512 characters, empty string to clear)')
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (async ({ group, topic }: { group: string; topic: string }) => {
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
        const errorMsg = err instanceof Error ? err.message : String(err || '');
        return { content: [{ type: 'text', text: `Failed to set group topic: ${errorMsg}` }], isError: true };
      }
    }) as any
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function resolveGroupJid(group: string, store: MessageStore, waClient: WhatsAppClient): Promise<string | null> {
  if (isGroupJid(group)) return group;

  // Try store first (fast, no network)
  const chats = store.getAllChatsForMatching();
  const { resolved } = resolveRecipient(group, chats);
  if (resolved && isGroupJid(resolved)) return resolved;

  // Fall back to live group list from WhatsApp
  try {
    const groups = await waClient.getJoinedGroups() as JoinedGroup[];
    const match = groups.find(
      (g) => g.name?.toLowerCase() === group.toLowerCase() || g.jid === group
    );
    return match?.jid || null;
  } catch {
    return null;
  }
}
