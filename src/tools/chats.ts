/**
 * Chat Tools
 *
 * list_chats, catch_up, mark_messages_read, search_contacts, export_chat_data
 * (display names use MessageStore.getDisplayNameForJid — custom names from set_contact_name)
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { resolveRecipient } from '../utils/fuzzy-match.js';
import { LIMITS } from '../security/permissions.js';
import type { MessageStore } from '../whatsapp/store.js';
import { WhatsAppClient } from '../whatsapp/client.js';
import type { AuditLogger } from '../security/audit.js';
import { PermissionManager } from '../security/permissions.js';
import {
  describeCatchUpWindow,
  formatMessageLineTimeContext,
  formatTimestamp,
  getStartOfCalendarDayInTimezoneSeconds,
  getUserTimezone
} from '../utils/timezone.js';
import { getJidTypeInfo } from '../utils/jid-utils.js';

export function registerChatTools (
  server: McpServer,
  waClient: WhatsAppClient,
  store: MessageStore,
  permissions: PermissionManager,
  audit: AuditLogger
): void {
  // ── list_chats ───────────────────────────────────────────────

  server.registerTool(
    'list_chats',
    {
      description: 'List WhatsApp conversations sorted by recent activity. Shows last message preview, unread count, and timestamps. Filter by name or restrict to groups only.',
      inputSchema: {
        filter: z
          .string()
          .max(LIMITS.MAX_FILTER_LENGTH)
          .describe('Filter chats by name (substring match)')
          .optional(),
        groups_only: z.boolean().default(false).describe('Only show group chats').optional(),
        limit: z.number().default(20).describe('Maximum chats to return (default 20)').optional(),
        page: z.number().default(0).describe('Page number for pagination (default 0)').optional()
      },
      annotations: { readOnlyHint: true }
    },

    async ({ filter, groups_only = false, limit = 20, page = 0 }: any) => {
      const toolCheck = permissions.isToolEnabled('list_chats');
      if (!toolCheck.allowed) {
        return { content: [{ type: 'text', text: toolCheck.error ?? 'Tool disabled' }], isError: true };
      }
      const safeLimit = Math.min(limit || 20, 100);
      const offset = (page || 0) * safeLimit;

      // Use unified chat listing to merge duplicate JID entries
      const chats = store.getAllChatsUnified({
        filter,
        groupsOnly: groups_only,
        limit: safeLimit,
        offset
      });
      const readableChats = chats.filter((c) => permissions.canReadFrom(c.jid).allowed);

      if (readableChats.length === 0) {
        const qualifier = filter ? ` matching "${filter}"` : '';
        return {
          content: [
            {
              type: 'text',
              text: `No accessible chats found${qualifier}. ${waClient.isConnected() ? 'Messages will appear as they arrive.' : 'Connect first using the authenticate tool.'}`
            }
          ]
        };
      }

      const lines = readableChats.map((c) => {
        const type = c.is_group ? '[Group]' : '[Chat]';
        const unread = c.unread_count > 0 ? ` (${c.unread_count} unread)` : '';
        const time = c.last_message_at
          ? formatTimestamp(c.last_message_at)
          : 'never';
        const preview = c.last_message_preview
          ? `: ${c.last_message_preview.substring(0, 60)}${c.last_message_preview.length > 60 ? '...' : ''}`
          : '';

        // Phase 4: Show multi-device info for non-group chats
        const jidInfo = c.is_group ? c.jid : (() => {
          // Try new multi-device schema first
          const contact = store.getContactByJid(c.jid);
          if (contact) {
            const parts = [c.jid];

            // Add device count info
            if (contact.devices.length > 1) {
              parts.push(`[${contact.devices.length} devices]`);
            }

            // Add phone number if available
            if (contact.phoneNumber) {
              parts.push(`(${contact.phoneNumber})`);
            }

            // Show primary device if set
            const primaryDevice = contact.devices.find((d) => d.isPrimary);
            if (primaryDevice) {
              parts.push(`primary: ${primaryDevice.lidJid}`);
            }

            return parts.join(' ');
          }

          // Fallback to legacy mapping
          const mapping = store.getJidMapping(c.jid);
          if (mapping && (mapping.phoneJid || mapping.phoneNumber)) {
            const parts = [c.jid];
            if (mapping.phoneJid && mapping.phoneJid !== c.jid) {parts.push(mapping.phoneJid);}
            if (mapping.phoneNumber) {parts.push(`(${mapping.phoneNumber})`);}
            return parts.join(' ↔ ');
          }
          return c.jid;
        })();

        // Add JID type label (User, LID, or Group)
        const jidType = getJidTypeInfo(c.jid);

        const displayName = store.getDisplayNameForJid(c.jid);
        return `${type} ${displayName}${unread}\n     Last: ${time}${preview}\n     JID: ${jidInfo} ${jidType.shortLabel}`;
      });

      const pageInfo = page > 0 ? ` (page ${page})` : '';
      const hasMore =
        readableChats.length === safeLimit
          ? `\n\nMore chats may be available — use page=${(page || 0) + 1}.`
          : '';

      return {
        content: [
          {
            type: 'text',
            text: `Conversations (${readableChats.length})${pageInfo}:\n\n${lines.join('\n\n')}${hasMore}`
          }
        ]
      };
    }
  );

  // ── catch_up ─────────────────────────────────────────────────

  server.registerTool(
    'catch_up',
    {
      description:
        'Get an intelligent summary of recent WhatsApp activity. Shows active chats with unread counts, last activity timestamps (relative and absolute), recent messages directed at you with status and time context, questions awaiting your response, and pending approval requests. Much more useful than reading raw message lists.',
      inputSchema: {
        since: z
          .enum(['1h', '4h', 'today', '24h', 'this_week'])
          .default('today')
          .describe('Time window for the summary (default "today")')
          .optional()
      },
      annotations: { readOnlyHint: true }
    },

    async ({ since = 'today' }: any) => {
      const toolCheck = permissions.isToolEnabled('catch_up');
      if (!toolCheck.allowed) {
        return { content: [{ type: 'text', text: toolCheck.error ?? 'Tool disabled' }], isError: true };
      }

      const now = Math.floor(Date.now() / 1000);
      const sinceMap: Record<string, number> = {
        '1h': now - 3600,
        '4h': now - 14400,
        today: getStartOfCalendarDayInTimezoneSeconds(),
        '24h': now - 86400,
        this_week: now - 604800
      };
      const sinceTs = sinceMap[since] ?? sinceMap['today'];

      const data = store.getCatchUpData(sinceTs);
      const readableJids = new Set(
        store
          .getAllChatsForMatching()
          .filter((c) => permissions.canReadFrom(c.jid).allowed)
          .map((c) => c.jid)
      );
      const filteredData = {
        activeChats: data.activeChats.filter((c) => readableJids.has(c.jid)),
        questions: data.questions.filter((m) => readableJids.has(m.chat_jid)),
        recentUnread: data.recentUnread.filter((m) => readableJids.has(m.chat_jid)),
        pendingApprovals: data.pendingApprovals.filter((a) => readableJids.has(a.to_jid))
      };
      const sections: string[] = [];

      // Active chats
      if (filteredData.activeChats.length > 0) {
        const chatLines = filteredData.activeChats.map((c) => {
          const name = store.getDisplayNameForJid(c.jid);
          const type = c.is_group ? '(group)' : '';
          const unread = c.unread_count > 0 ? ` — ${c.unread_count} unread` : '';
          const last =
            c.last_message_at !== null
              ? ` · last activity ${formatMessageLineTimeContext(c.last_message_at, now)}`
              : '';
          return `  - ${name} ${type}${unread} [${c.recent_messages} messages in window]${last}`;
        });
        sections.push(`Active Chats:\n${chatLines.join('\n')}`);
      } else {
        sections.push('Active Chats: None in this period.');
      }

      // Questions
      if (filteredData.questions.length > 0) {
        const qLines = filteredData.questions.slice(0, 10).map((m) => {
          const sender = m.sender_name || m.sender_jid?.split('@')[0] || '?';
          const chatName = store.getDisplayNameForJid(m.chat_jid);
          const timeCtx = formatMessageLineTimeContext(m.timestamp, now);
          return `  - [${chatName}] ${sender} @ ${timeCtx} · status: awaiting your reply\n    ${m.body?.substring(0, 120) || ''}`;
        });
        sections.push(
          `Questions Awaiting Response (${filteredData.questions.length}):\n${qLines.join('\n')}`
        );
      }

      // Unread summary
      if (filteredData.recentUnread.length > 0) {
        sections.push(
          `Unread Messages: ${filteredData.recentUnread.length} total from ${new Set(filteredData.recentUnread.map((m) => m.chat_jid)).size} chats.`
        );

        const highlights = filteredData.recentUnread.slice(0, 5).map((m) => {
          const sender = m.sender_name || m.sender_jid?.split('@')[0] || '?';
          const chatName = store.getDisplayNameForJid(m.chat_jid);
          const timeCtx = formatMessageLineTimeContext(m.timestamp, now);
          return `  - [${chatName}] ${sender} @ ${timeCtx} · status: unread\n    ${m.body?.substring(0, 100) || '[media]'}`;
        });
        sections.push(`Recent Highlights:\n${highlights.join('\n')}`);
      } else {
        sections.push('Unread Messages: None.');
      }

      // Pending approvals
      if (filteredData.pendingApprovals.length > 0) {
        const aLines = filteredData.pendingApprovals.map((a) => {
          const remaining = Math.max(
            0,
            Math.round((a.created_at + a.timeout_ms - Date.now()) / 1000)
          );
          const createdSec = Math.floor(a.created_at / 1000);
          const createdCtx = formatMessageLineTimeContext(createdSec, now);
          return `  - [${a.id}] "${a.action}" · status: ${a.status} · created ${createdCtx} · ${remaining}s remaining`;
        });
        sections.push(`Pending Approvals (${filteredData.pendingApprovals.length}):\n${aLines.join('\n')}`);
      }

      audit.log('catch_up', 'summary', {
        since,
        chats: filteredData.activeChats.length,
        unread: filteredData.recentUnread.length
      });

      const headerLines = [
        `WhatsApp Activity Summary (${since})`,
        `Generated: ${formatTimestamp(now)} (${getUserTimezone()})`,
        describeCatchUpWindow(since, sinceTs, now)
      ];

      return {
        content: [
          {
            type: 'text',
            text: `${headerLines.join('\n')}\n\n${sections.join('\n\n')}`
          }
        ]
      };
    }
  );

  // ── search_contacts ──────────────────────────────────────────

  server.registerTool(
    'search_contacts',
    {
      description: 'Search WhatsApp contacts and groups by name or phone number. Returns matching contacts with their JIDs, and optionally lists all chats involving a specific contact (including group chats they participate in).',
      inputSchema: {
        query: z
          .string()
          .max(LIMITS.MAX_SEARCH_QUERY_LENGTH)
          .describe('Search term to match against contact names or phone numbers'),
        include_chats: z
          .boolean()
          .default(false)
          .describe('Also return all chats involving the matched contact')
          .optional(),
        limit: z.number().default(20).describe('Maximum results to return (default 20)').optional()
      },
      annotations: { readOnlyHint: true }
    },

    async ({ query, include_chats = false, limit = 20 }: any) => {
      const toolCheck = permissions.isToolEnabled('search_contacts');
      if (!toolCheck.allowed) {
        return { content: [{ type: 'text', text: toolCheck.error ?? 'Tool disabled' }], isError: true };
      }

      const chats = store.getAllChatsUnifiedForMatching();
      const lowerQuery = query.toLowerCase();

      const matches = chats
        .filter((c) => {
          const display = store.getDisplayNameForJid(c.jid);
          const nameMatch = display.toLowerCase().includes(lowerQuery);
          const jidMatch = c.jid.includes(query.replace(/[^0-9]/g, ''));
          const readable = permissions.canReadFrom(c.jid).allowed;
          return readable && (nameMatch || jidMatch);
        })
        .slice(0, Math.min(limit || 20, 50));

      if (matches.length === 0) {
        return {
          content: [{ type: 'text', text: `No contacts found matching "${query}".` }]
        };
      }

      const lines = matches.map((c) => {
        const display = store.getDisplayNameForJid(c.jid);
        const jidType = getJidTypeInfo(c.jid);
        const phone = jidType.type === 'group' ? '' : ` (${c.jid.split('@')[0]})`;
        const unread = c.unread_count && c.unread_count > 0 ? ` [${c.unread_count} unread]` : '';
        const lastMsgTime = c.last_message_at
          ? formatTimestamp(c.last_message_at)
          : 'never';
        const preview = c.last_message_preview
          ? ` — ${c.last_message_preview.substring(0, 60)}${c.last_message_preview.length > 60 ? '...' : ''}`
          : '';
        return `  - ${display}${phone}${unread} → ${c.jid} ${jidType.shortLabel}\n     Last: ${lastMsgTime}${preview}`;
      });

      let output = `Contacts matching "${query}" (${matches.length}):\n\n${lines.join('\n')}`;

      if (include_chats && matches.length === 1) {
        const primaryJid = matches[0].jid;
        const primaryDisplay = store.getDisplayNameForJid(primaryJid);
        const contactChats = store.getContactChats(primaryJid, 10);
        if (contactChats.length > 0) {
          const chatLines = contactChats.map((c) => {
            const type = c.is_group ? '[Group]' : '[Chat]';
            const time = c.last_message_at
              ? formatTimestamp(c.last_message_at)
              : 'never';
            const lineDisplay = store.getDisplayNameForJid(c.jid);
            return `  - ${type} ${lineDisplay} (last: ${time})`;
          });
          output += `\n\nChats involving ${primaryDisplay}:\n${chatLines.join('\n')}`;
        }
      }

      return {
        content: [{ type: 'text', text: output }]
      };
    }
  );

  // ── mark_messages_read ───────────────────────────────────────

  server.registerTool(
    'mark_messages_read',
    {
      description: 'Mark messages as read in a WhatsApp chat. Prevents them from appearing as unread in catch_up. Specify a chat to mark all messages in it, or provide specific message IDs.',
      inputSchema: {
        chat: z
          .string()
          .max(200)
          .describe('Chat name, phone number, or JID to mark as read')
          .optional(),
        message_ids: z
          .array(z.string())
          .max(LIMITS.MAX_MARK_READ_IDS)
          .describe(`Specific message IDs to mark as read (max ${LIMITS.MAX_MARK_READ_IDS})`)
          .optional()
      },
      annotations: { idempotentHint: true, readOnlyHint: true }
    },

    async ({ chat, message_ids }: any) => {
      const toolCheck = permissions.isToolEnabled('mark_messages_read');
      if (!toolCheck.allowed) {
        return { content: [{ type: 'text', text: toolCheck.error ?? 'Tool disabled' }], isError: true };
      }

      if (!chat && (!message_ids || message_ids.length === 0)) {
        return {
          content: [
            {
              type: 'text',
              text: 'Please provide either a chat name/JID or specific message IDs to mark as read.'
            }
          ],
          isError: true
        };
      }

      let chatJid: string | null = null;
      if (chat) {
        const chats = store.getAllChatsForMatching();
        const result = resolveRecipient(chat, chats);
        if (result.resolved) {
          chatJid = result.resolved;
          const readCheck = permissions.canReadFrom(chatJid);
          if (!readCheck.allowed) {
            return { content: [{ type: 'text', text: readCheck.error ?? 'Read access denied' }], isError: true };
          }
        } else if (result.candidates.length > 0) {
          const list = result.candidates.map((c) => `  - "${c.name}" → ${c.jid}`).join('\n');
          return {
            content: [{ type: 'text', text: `${result.error}\n\n${list}` }],
            isError: true
          };
        } else {
          return {
            content: [{ type: 'text', text: result.error ?? 'Could not resolve chat' }],
            isError: true
          };
        }
      } else if (permissions.hasContactRestrictions && message_ids?.length) {
        return {
          content: [{
            type: 'text',
            text: 'When ALLOWED_CONTACTS is set, provide "chat" for mark_messages_read so access policy can be enforced.'
          }],
          isError: true
        };
      }

      const count = await waClient.markMessagesRead({ chatJid: chatJid ?? undefined, messageIds: message_ids ?? [], senderJid: undefined });
      audit.log('mark_messages_read', 'marked', { chat: chatJid, count });

      return {
        content: [
          {
            type: 'text',
            text: `Marked ${count} message(s) as read.`
          }
        ]
      };
    }
  );

  // ── export_chat_data ─────────────────────────────────────────

  server.registerTool(
    'export_chat_data',
    {
      description: 'Export complete chat history for a specific contact or group. Supports JSON and CSV formats. Designed for PIPEDA individual access rights compliance. Returns up to 10,000 most recent messages.',
      inputSchema: {
        jid: z
          .string()
          .max(200)
          .describe('Chat JID to export (use list_chats to find JIDs)'),
        format: z
          .enum(['json', 'csv'])
          .default('json')
          .describe('Export format: json (structured) or csv (spreadsheet-compatible)')
          .optional()
      },
      annotations: { readOnlyHint: true }
    },

    async ({ jid, format = 'json' }: any) => {
      const toolCheck = permissions.isToolEnabled('export_chat_data');
      if (!toolCheck.allowed) {
        return { content: [{ type: 'text', text: toolCheck.error ?? 'Tool disabled' }], isError: true };
      }
      const readCheck = permissions.canReadFrom(jid);
      if (!readCheck.allowed) {
        return { content: [{ type: 'text', text: readCheck.error ?? 'Read access denied' }], isError: true };
      }

      try {
        const exportData = store.exportChatData(jid, format as 'json' | 'csv');

        if (exportData.error) {
          return {
            content: [{ type: 'text', text: `Export failed: ${exportData.error}` }],
            isError: true
          };
        }

        audit.log('export_chat_data', 'exported', {
          jid,
          format,
          messageCount: exportData.messageCount
        });

        const chatInfo = `${exportData.chatName || jid} (${exportData.messageCount} messages)`;

        if (format === 'csv') {
          // Show headers and first few rows instead of raw truncation
          const previewRows = exportData.data?.split('\n') || [];
          const headers = previewRows[0] || '';
          const sampleRows = previewRows.slice(1, 6); // First 5 data rows
          const preview = [headers, ...sampleRows].join('\n');
          const remaining = previewRows.length - 1 - sampleRows.length;

          return {
            content: [
              {
                type: 'text',
                text: `Chat data exported to CSV format:\n\nChat: ${chatInfo}\nExported: ${exportData.exportedAt}\n\nColumn Headers:\n  ${headers}\n\nSample Rows (first 5 of ${previewRows.length - 1}):\n${preview.split('\n').map((row, i) => i === 0 ? `  ${row}` : `  ${row}`).join('\n')}\n\n${remaining > 0 ? `... and ${remaining} more rows. Full CSV data available via programmatic access.` : ''}`
              }
            ]
          };
        }

        // JSON format - show sample messages
        const sampleMessages = exportData.messages?.slice(0, 5) || [];
        const messagePreview = sampleMessages.map((m) => {
          const sender = m.sender.name || m.sender.jid?.split('@')[0] || 'Unknown';
          const time = new Date(m.timestamp).toLocaleString();
          const mediaInfo = m.hasMedia ? ` [${m.mediaType || 'media'}]` : '';
          const body = m.body || '[no text]';
          return `  - [${time}] ${sender}:${mediaInfo} ${body.substring(0, 100)}${body.length > 100 ? '...' : ''}`;
        }).join('\n');

        const remaining = (exportData.messageCount || 0) - sampleMessages.length;

        return {
          content: [
            {
              type: 'text',
              text: `Chat data exported to JSON format:\n\nChat: ${chatInfo}\nFormat: ${format}\nExported: ${exportData.exportedAt}\n\nSample Messages (first ${sampleMessages.length} of ${exportData.messageCount}):\n${messagePreview}\n\n${remaining > 0 ? `... and ${remaining} more messages. ` : ''}Full JSON data available via programmatic access.`
            }
          ]
        };
      } catch (error) {
        audit.log('export_chat_data', 'failed', { jid, format, error: (error as Error).message }, false);
        return {
          content: [{ type: 'text', text: `Export failed: ${(error as Error).message}` }],
          isError: true
        };
      }
    }
  );
}
