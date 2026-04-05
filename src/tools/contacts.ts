/**
 * Contact & User Info Tools
 *
 * get_user_info, is_on_whatsapp, get_profile_picture
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PermissionManager } from '../security/permissions.js';
import type { MessageStore } from '../whatsapp/store.js';
import type { WhatsAppClient } from '../whatsapp/client.js';
import type { AuditLogger } from '../security/audit.js';
import { toJid } from '../utils/phone.js';
import { PhoneArraySchema } from '../utils/zod-schemas.js';

interface OnWhatsAppResult {
  jid?: string;
  query?: string;
  phone?: string;
  number?: string;
  name?: string;
  exists?: boolean;
  IsIn?: boolean;
  isIn?: boolean;
  registered?: boolean;
}

interface GetProfilePictureResult {
  url?: string;
  URL?: string;
  profilePictureURL?: string;
}

export function registerContactTools (
  server: McpServer,
  waClient: WhatsAppClient,
  store: MessageStore,
  permissions: PermissionManager,
  audit: AuditLogger
): void {
  // ── get_user_info ─────────────────────────────────────────────

  const get_user_info_handler = async ({ phones }: { phones: string[] }) => {
    const toolCheck = permissions.isToolEnabled('get_user_info');
    if (!toolCheck.allowed) {
      return { content: [{ type: 'text', text: toolCheck.error ?? 'Tool disabled' }], isError: true };
    }

    if (!waClient.isConnected()) {
      return notConnected();
    }

    try {
      const jids = phones.map((p) => (p.includes('@') ? p : toJid(p)!));
      for (const jid of jids) {
        const readCheck = permissions.canReadFrom(jid);
        if (!readCheck.allowed) {
          return { content: [{ type: 'text', text: readCheck.error ?? 'Read access denied' }], isError: true };
        }
      }
      const results = await waClient.getUserInfo(jids);
      audit.log('get_user_info', 'read', { count: jids.length });

      if (!results || Object.keys(results).length === 0) {
        return { content: [{ type: 'text', text: 'No information found for the provided numbers.' }] };
      }

      const lines = Object.entries(results).map(([jid, info]) => {
        const parts = [`${jid}:`];
        if (info?.name) {parts.push(`  Name: ${info.name}`);}
        if (info?.status) {parts.push(`  Status: ${info.status}`);}
        if (info?.isBusiness) {parts.push('  Type: Business account');}
        if (parts.length === 1) {parts.push('  (no public info available)');}
        return parts.join('\n');
      });

      return { content: [{ type: 'text', text: lines.join('\n\n') }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err || '');
      return { content: [{ type: 'text', text: `Failed to get user info: ${msg}` }], isError: true };
    }
  };

  server.registerTool(
    'get_user_info',
    {
      description: 'Get WhatsApp profile information for one or more phone numbers: display name, status, and business details if available.',
      inputSchema: {
        phones: PhoneArraySchema(1, 20).describe('Phone numbers in E.164 format (e.g. ["+14155552671"])')
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true }
    },

    get_user_info_handler as any
  );

  // ── is_on_whatsapp ────────────────────────────────────────────

  const is_on_whatsapp_handler = async ({ phones }: { phones: string[] }) => {
    const toolCheck = permissions.isToolEnabled('is_on_whatsapp');
    if (!toolCheck.allowed) {
      return { content: [{ type: 'text', text: toolCheck.error ?? 'Tool disabled' }], isError: true };
    }

    if (!waClient.isConnected()) {
      return notConnected();
    }

    try {
      for (const phone of phones) {
        const jid = phone.includes('@') ? phone : toJid(phone);
        if (!jid) {
          return { content: [{ type: 'text', text: `Invalid phone number: "${phone}"` }], isError: true };
        }
        const readCheck = permissions.canReadFrom(jid);
        if (!readCheck.allowed) {
          return { content: [{ type: 'text', text: readCheck.error ?? 'Read access denied' }], isError: true };
        }
      }
      const results = await waClient.isOnWhatsApp(phones);
      audit.log('is_on_whatsapp', 'checked', { count: phones.length });

      const lines = (results as OnWhatsAppResult[]).map((r) => {
        const exists = r.exists ?? r.IsIn ?? r.isIn ?? r.registered ?? false;
        const status = exists ? '✅ on WhatsApp' : '❌ not on WhatsApp';
        const identifier = r.jid || r.query || r.phone || r.number || '?';
        return `  ${identifier}: ${status}${r.name ? ` — ${r.name}` : ''}`;
      });

      return { content: [{ type: 'text', text: `Results:\n${lines.join('\n')}` }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err || '');
      return { content: [{ type: 'text', text: `Failed to check: ${msg}` }], isError: true };
    }
  };

  server.registerTool(
    'is_on_whatsapp',
    {
      description: 'Check whether one or more phone numbers have WhatsApp accounts. Useful before sending a message to a new contact.',
      inputSchema: {
        phones: PhoneArraySchema(1, 50).describe('Phone numbers to check in E.164 format (e.g. ["+14155552671", "+447911123456"])')
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true }
    },

    is_on_whatsapp_handler as any
  );

  // ── get_profile_picture ───────────────────────────────────────

  const get_profile_picture_handler = async ({ target }: { target: string }) => {
    const toolCheck = permissions.isToolEnabled('get_profile_picture');
    if (!toolCheck.allowed) {
      return { content: [{ type: 'text', text: toolCheck.error ?? 'Tool disabled' }], isError: true };
    }

    if (!waClient.isConnected()) {
      return notConnected();
    }

    try {
      let jid: string;
      if (target.includes('@')) {
        jid = target;
      } else if (target.match(/^\+?\d{7,15}$/)) {
        jid = toJid(target)!;
      } else {
        const chats = store.getAllChatsForMatching();
        const match = chats.find(
          (c) => c.name?.toLowerCase() === target.toLowerCase()
        );
        jid = match?.jid || toJid(target)!;
      }

      const readCheck = permissions.canReadFrom(jid);
      if (!readCheck.allowed) {
        return { content: [{ type: 'text', text: readCheck.error ?? 'Read access denied' }], isError: true };
      }

      const result = await waClient.getProfilePicture(jid);
      audit.log('get_profile_picture', 'read', { jid });

      const url = typeof result === 'string'
        ? result
        : (result as GetProfilePictureResult)?.url || (result as GetProfilePictureResult)?.URL || (result as GetProfilePictureResult)?.profilePictureURL || null;

      if (!url) {
        return { content: [{ type: 'text', text: `No profile picture set for ${jid}.` }] };
      }

      return {
        content: [{ type: 'text', text: `Profile picture URL for ${jid}:\n${url}` }]
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err || '');
      return { content: [{ type: 'text', text: `Failed to get profile picture: ${msg}` }], isError: true };
    }
  };

  server.registerTool(
    'get_profile_picture',
    {
      description: "Get the profile picture URL for a contact or group. Returns the direct image URL from WhatsApp's CDN.",
      inputSchema: {
        target: z.string().max(200).describe('Phone number, contact name, group name, or JID')
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true }
    },

    get_profile_picture_handler as any
  );
}

function notConnected () {
  return {
    content: [{ type: 'text', text: 'WhatsApp not connected. Use the authenticate tool first.' }],
    isError: true
  };
}
