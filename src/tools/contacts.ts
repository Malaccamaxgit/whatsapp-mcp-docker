/**
 * Contact & User Info Tools
 *
 * get_user_info, is_on_whatsapp, get_profile_picture, set_contact_name, sync_contact_names
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PermissionManager } from '../security/permissions.js';
import type { MessageStore } from '../whatsapp/store.js';
import type { WhatsAppClient } from '../whatsapp/client.js';
import type { AuditLogger } from '../security/audit.js';
import { toJid } from '../utils/phone.js';
import { PhoneArraySchema } from '../utils/zod-schemas.js';
import { registerTool, type ToolInput, type McpResult } from '../utils/mcp-types.js';

const SYNC_RATE_LIMIT_DELAY_MS = 500;

function pickNameFromUserInfo (results: unknown, jids: string[]): string | null {
  const o = results as Record<string, { name?: string } | undefined> | null;
  if (!o || typeof o !== 'object') {return null;}
  for (const jid of jids) {
    if (!jid) {continue;}
    const n = o[jid]?.name;
    if (typeof n === 'string' && n.trim()) {return n.trim();}
  }
  return null;
}

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

  const getUserInfoInputSchema = {
    phones: PhoneArraySchema(1, 20).describe('Phone numbers in E.164 format (e.g. ["+14155552671"])'),
    save_names: z
      .boolean()
      .optional()
      .default(false)
      .describe('If true, store retrieved profile names in the local database (same rules as sync: does not override custom names from set_contact_name)')
  };

  const get_user_info_handler = async ({ phones, save_names: saveNames }: ToolInput<typeof getUserInfoInputSchema>): Promise<McpResult> => {
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
      audit.log('get_user_info', 'read', { count: jids.length, save_names: Boolean(saveNames) });

      if (!results || Object.keys(results).length === 0) {
        return { content: [{ type: 'text', text: 'No information found for the provided numbers.' }] };
      }

      if (saveNames) {
        for (const [jid, info] of Object.entries(results as Record<string, { name?: string }>)) {
          if (info?.name && typeof info.name === 'string') {
            store.updateChatName(jid, info.name.trim());
          }
        }
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

  registerTool(server, 'get_user_info', {
    description:
      'Get WhatsApp profile information for one or more phone numbers: display name, status, and business details if available. Optionally store retrieved names in the local chat database (save_names).',
    inputSchema: getUserInfoInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
  }, get_user_info_handler);

  // ── is_on_whatsapp ────────────────────────────────────────────

  const isOnWhatsAppInputSchema = {
    phones: PhoneArraySchema(1, 50).describe('Phone numbers to check in E.164 format (e.g. ["+14155552671", "+447911123456"])')
  };

  const is_on_whatsapp_handler = async ({ phones }: ToolInput<typeof isOnWhatsAppInputSchema>): Promise<McpResult> => {
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

  registerTool(server, 'is_on_whatsapp', {
    description: 'Check whether one or more phone numbers have WhatsApp accounts. Useful before sending a message to a new contact.',
    inputSchema: isOnWhatsAppInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true }
  }, is_on_whatsapp_handler
  );

  // ── get_profile_picture ───────────────────────────────────────

  const getProfilePictureInputSchema = {
    target: z.string().max(200).describe('Phone number, contact name, group name, or JID')
  };

  const get_profile_picture_handler = async ({ target }: ToolInput<typeof getProfilePictureInputSchema>): Promise<McpResult> => {
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

  registerTool(server, 'get_profile_picture', {
    description: "Get the profile picture URL for a contact or group. Returns the direct image URL from WhatsApp's CDN.",
    inputSchema: getProfilePictureInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true }
  }, get_profile_picture_handler);

  // ── sync_contact_names ───────────────────────────────────────

  const syncContactNamesInputSchema = {
    contacts: z
      .array(z.string().max(200))
      .max(50)
      .optional()
      .describe('Optional JIDs or phone numbers to sync; omit to sync all chats that have no display name yet'),
    force: z
      .boolean()
      .optional()
      .default(false)
      .describe('If true, re-fetch and update stored names even when a non-JID name is already present')
  };

  const sync_contact_names_handler = async ({
    contacts: contactInputs,
    force = false
  }: ToolInput<typeof syncContactNamesInputSchema>): Promise<McpResult> => {
    const toolCheck = permissions.isToolEnabled('sync_contact_names');
    if (!toolCheck.allowed) {
      return { content: [{ type: 'text', text: toolCheck.error ?? 'Tool disabled' }], isError: true };
    }

    if (!waClient.isConnected()) {
      return notConnected();
    }

    const jidsToSync: string[] = [];
    const seen = new Set<string>();

    const pushJid = (jid: string | null) => {
      if (!jid || seen.has(jid)) {return;}
      seen.add(jid);
      jidsToSync.push(jid);
    };

    if (contactInputs !== undefined && contactInputs.length === 0) {
      return { content: [{ type: 'text', text: 'No contacts to sync.' }] };
    }

    if (contactInputs && contactInputs.length > 0) {
      for (const raw of contactInputs) {
        let resolved: string | null = null;
        try {
          const t = raw.trim();
          if (!t) {continue;}
          resolved = t.includes('@') ? t : toJid(t)!;
        } catch {
          continue;
        }
        if (!resolved) {continue;}
        if (store.getCustomContactName(resolved)) {continue;}
        if (!force) {
          const display = store.getDisplayNameForJid(resolved);
          if (display !== resolved) {continue;}
        }
        pushJid(resolved);
      }
    } else {
      const allChats = store.getAllChatsForMatching();
      for (const chat of allChats) {
        if (chat.is_group === 1) {continue;}
        if (store.getCustomContactName(chat.jid)) {continue;}
        if (force) {
          pushJid(chat.jid);
        } else if (chat.name === chat.jid) {
          pushJid(chat.jid);
        }
      }
    }

    if (jidsToSync.length === 0) {
      return { content: [{ type: 'text', text: 'No contacts to sync.' }] };
    }

    const results: { jid: string; name: string | null; status: string }[] = [];

    for (let i = 0; i < jidsToSync.length; i++) {
      if (i > 0) {
        await new Promise((r) => setTimeout(r, SYNC_RATE_LIMIT_DELAY_MS));
      }

      const jid = jidsToSync[i]!;
      const readCheck = permissions.canReadFrom(jid);
      if (!readCheck.allowed) {
        results.push({ jid, name: null, status: `error: ${readCheck.error ?? 'Read access denied'}` });
        continue;
      }

      try {
        const mapping = store.getJidMapping(jid);
        const queryJid = mapping?.phoneJid || jid;

        const info = await waClient.getUserInfo([queryJid]);
        let name = pickNameFromUserInfo(info, [queryJid, jid]);

        if (!name && typeof waClient.resolveContactName === 'function') {
          name = await waClient.resolveContactName(jid);
        }

        if (name) {
          store.updateChatName(jid, name, { force });
          results.push({ jid, name, status: 'updated' });
        } else {
          results.push({ jid, name: null, status: 'no_name_available' });
        }
      } catch (err) {
        results.push({
          jid,
          name: null,
          status: `error: ${err instanceof Error ? err.message : String(err || '')}`
        });
      }
    }

    audit.log('sync_contact_names', 'synced', { count: results.length, force });

    const updated = results.filter((r) => r.status === 'updated');
    const noName = results.filter((r) => r.status === 'no_name_available');
    const errors = results.filter((r) => r.status.startsWith('error'));

    const lines = [
      `Synced ${results.length} contacts:`,
      `${updated.length} names updated`,
      `${noName.length} have no profile name`,
      errors.length > 0 ? `${errors.length} errors` : null
    ].filter(Boolean) as string[];

    if (updated.length > 0) {
      lines.push('', 'Updated:');
      for (const r of updated.slice(0, 10)) {
        lines.push(`  ${r.jid} → "${r.name}"`);
      }
      if (updated.length > 10) {
        lines.push(`  ... and ${updated.length - 10} more`);
      }
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  };

  registerTool(server, 'sync_contact_names', {
    description:
      'Fetch WhatsApp profile names and store them locally for chats that still show as raw JIDs. Syncs all such contacts, or specific JIDs/phone numbers. Use force to refresh names even when a push name is already stored. Does not override custom names from set_contact_name.',
    inputSchema: syncContactNamesInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
  }, sync_contact_names_handler);

  // ── set_contact_name ─────────────────────────────────────────

  const setContactNameInputSchema = {
    jid: z
      .string()
      .max(200)
      .describe('JID (e.g. 123@s.whatsapp.net, 456@lid, 789@g.us) or phone number in E.164 format'),
    name: z
      .string()
      .max(100)
      .describe('Display name to show, or empty string to remove the custom name')
  };

  const set_contact_name_handler = async ({ jid, name }: ToolInput<typeof setContactNameInputSchema>): Promise<McpResult> => {
    const toolCheck = permissions.isToolEnabled('set_contact_name');
    if (!toolCheck.allowed) {
      return { content: [{ type: 'text', text: toolCheck.error ?? 'Tool disabled' }], isError: true };
    }

    const raw = jid.trim();
    if (!raw) {
      return { content: [{ type: 'text', text: 'JID or phone number is required' }], isError: true };
    }

    let resolvedJid: string;
    try {
      resolvedJid = raw.includes('@') ? raw : toJid(raw)!;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err || '');
      return { content: [{ type: 'text', text: `Invalid phone number or JID: ${msg}` }], isError: true };
    }

    if (!resolvedJid) {
      return { content: [{ type: 'text', text: `Invalid phone number: "${jid}"` }], isError: true };
    }

    const readCheck = permissions.canReadFrom(resolvedJid);
    if (!readCheck.allowed) {
      return { content: [{ type: 'text', text: readCheck.error ?? 'Read access denied' }], isError: true };
    }

    store.setCustomContactName(resolvedJid, name);
    const trimmed = name.trim();
    audit.log('set_contact_name', 'updated', { jid: resolvedJid, name: trimmed || null });

    if (!trimmed) {
      return { content: [{ type: 'text', text: `Custom name cleared for ${resolvedJid}.` }] };
    }

    return {
      content: [{ type: 'text', text: `Contact name set: ${resolvedJid} → "${trimmed}"` }]
    };
  };

  registerTool(server, 'set_contact_name', {
    description:
      'Set a custom display name for a contact or group JID (stored locally). Overrides push names in list_chats, search, and catch_up. Use an empty name to clear.',
    inputSchema: setContactNameInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }, set_contact_name_handler);
}

function notConnected (): McpResult {
  return {
    content: [{ type: 'text', text: 'WhatsApp not connected. Use the authenticate tool first.' }],
    isError: true
  };
}
