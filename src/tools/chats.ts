/**
 * Chat Tools
 *
 * list_chats, catch_up, mark_messages_read
 */

import { z } from 'zod';
import { resolveRecipient } from '../utils/fuzzy-match.js';
import { LIMITS } from '../security/permissions.js';
import type { MessageStore } from '../whatsapp/store.js';
import { WhatsAppClient } from '../whatsapp/client.js';
import type { AuditLogger } from '../security/audit.js';
import { PermissionManager } from '../security/permissions.js';

interface ChatToolDependencies {
  server: {
    tool: (name: string, description: string, schema: Record<string, unknown>, handler: (...args: unknown[]) => unknown, options?: { annotations?: Record<string, unknown> }) => void;
  };
  waClient: WhatsAppClient;
  store: MessageStore;
  permissions: PermissionManager;
  audit: AuditLogger;
}

export function registerChatTools(
  server: ChatToolDependencies['server'],
  waClient: WhatsAppClient,
  store: MessageStore,
  permissions: PermissionManager,
  audit: AuditLogger
): void {
  // ── list_chats ───────────────────────────────────────────────

  server.tool(
    'list_chats',
    'List WhatsApp conversations sorted by recent activity. Shows last message preview, unread count, and timestamps. Filter by name or restrict to groups only.',
    {
      filter: z
        .string()
        .max(LIMITS.MAX_FILTER_LENGTH)
        .describe('Filter chats by name (substring match)')
        .optional(),
      groups_only: z.boolean().default(false).describe('Only show group chats').optional(),
      limit: z.number().default(20).describe('Maximum chats to return (default 20)').optional(),
      page: z.number().default(0).describe('Page number for pagination (default 0)').optional()
    },
    async ({ filter, groups_only = false, limit = 20, page = 0 }) => {
      const toolCheck = permissions.isToolEnabled('list_chats');
      if (!toolCheck.allowed) {
        return { content: [{ type: 'text', text: toolCheck.error }], isError: true };
      }
      const safeLimit = Math.min(limit || 20, 100);
      const offset = (page || 0) * safeLimit;
      const chats = store.listChats({
        filter,
        groupsOnly: groups_only,
        limit: safeLimit,
        offset
      });

      if (chats.length === 0) {
        const qualifier = filter ? ` matching "${filter}"` : '';
        return {
          content: [
            {
              type: 'text',
              text: `No chats found${qualifier}. ${waClient.isConnected() ? 'Messages will appear as they arrive.' : 'Connect first using the authenticate tool.'}`
            }
          ]
        };
      }

      const lines = chats.map((c) => {
        const type = c.is_group ? '[Group]' : '[Chat]';
        const unread = c.unread_count > 0 ? ` (${c.unread_count} unread)` : '';
        const time = c.last_message_at
          ? new Date(c.last_message_at * 1000).toLocaleString()
          : 'never';
        const preview = c.last_message_preview
          ? `: ${c.last_message_preview.substring(0, 60)}${c.last_message_preview.length > 60 ? '...' : ''}`
          : '';
        return `${type} ${c.name || c.jid}${unread}\n     Last: ${time}${preview}\n     JID: ${c.jid}`;
      });

      const pageInfo = page > 0 ? ` (page ${page})` : '';
      const hasMore =
        chats.length === safeLimit
          ? `\n\nMore chats may be available — use page=${(page || 0) + 1}.`
          : '';

      return {
        content: [
          {
            type: 'text',
            text: `Conversations (${chats.length})${pageInfo}:\n\n${lines.join('\n\n')}${hasMore}`
          }
        ]
      };
    },
    { annotations: { readOnlyHint: true } }
  );

  // ── catch_up ─────────────────────────────────────────────────

  server.tool(
    'catch_up',
    'Get an intelligent summary of recent WhatsApp activity. Shows active chats with unread counts, recent messages directed at you, questions awaiting your response, and pending approval requests. Much more useful than reading raw message lists.',
    {
      since: z
        .enum(['1h', '4h', 'today', '24h', 'this_week'])
        .default('today')
        .describe('Time window for the summary (default "today")')
        .optional()
    },
    async ({ since = 'today' }) => {
      const toolCheck = permissions.isToolEnabled('catch_up');
      if (!toolCheck.allowed) {
        return { content: [{ type: 'text', text: toolCheck.error }], isError: true };
      }

      const now = Math.floor(Date.now() / 1000);
      const sinceMap: Record<string, number> = {
        '1h': now - 3600,
        '4h': now - 14400,
        today: now - (now % 86400),
        '24h': now - 86400,
        this_week: now - 604800
      };
      const sinceTs = sinceMap[since] || sinceMap['today'];

      const data = store.getCatchUpData(sinceTs);
      const sections: string[] = [];

      // Active chats
      if (data.activeChats.length > 0) {
        const chatLines = data.activeChats.map((c) => {
          const name = c.name || c.jid;
          const type = c.is_group ? '(group)' : '';
          const unread = c.unread_count > 0 ? ` — ${c.unread_count} unread` : '';
          return `  - ${name} ${type}${unread} [${c.recent_messages} recent messages]`;
        });
        sections.push(`Active Chats:\n${chatLines.join('\n')}`);
      } else {
        sections.push('Active Chats: None in this period.');
      }

      // Questions
      if (data.questions.length > 0) {
        const qLines = data.questions.slice(0, 10).map((m) => {
          const sender = m.sender_name || m.sender_jid?.split('@')[0] || '?';
          const chatName = m.chat_name || m.chat_jid;
          const time = new Date(m.timestamp * 1000).toLocaleTimeString();
          return `  - [${chatName}] ${sender} (${time}): ${m.body?.substring(0, 120) || ''}`;
        });
        sections.push(
          `Questions Awaiting Response (${data.questions.length}):\n${qLines.join('\n')}`
        );
      }

      // Unread summary
      if (data.recentUnread.length > 0) {
        sections.push(
          `Unread Messages: ${data.recentUnread.length} total from ${new Set(data.recentUnread.map((m) => m.chat_jid)).size} chats.`
        );

        const highlights = data.recentUnread.slice(0, 5).map((m) => {
          const sender = m.sender_name || m.sender_jid?.split('@')[0] || '?';
          const chatName = m.chat_name || m.chat_jid;
          return `  - [${chatName}] ${sender}: ${m.body?.substring(0, 100) || '[media]'}`;
        });
        sections.push(`Recent Highlights:\n${highlights.join('\n')}`);
      } else {
        sections.push('Unread Messages: None.');
      }

      // Pending approvals
      if (data.pendingApprovals.length > 0) {
        const aLines = data.pendingApprovals.map((a) => {
          const remaining = Math.max(
            0,
            Math.round((a.created_at + a.timeout_ms - Date.now()) / 1000)
          );
          return `  - [${a.id}] "${a.action}" — ${remaining}s remaining`;
        });
        sections.push(`Pending Approvals (${data.pendingApprovals.length}):\n${aLines.join('\n')}`);
      }

      audit.log('catch_up', 'summary', {
        since,
        chats: data.activeChats.length,
        unread: data.recentUnread.length
      });

      return {
        content: [
          {
            type: 'text',
            text: `WhatsApp Activity Summary (${since}):\n\n${sections.join('\n\n')}`
          }
        ]
      };
    },
    { annotations: { readOnlyHint: true } }
  );

  // ── search_contacts ──────────────────────────────────────────

  server.tool(
    'search_contacts',
    'Search WhatsApp contacts and groups by name or phone number. Returns matching contacts with their JIDs, and optionally lists all chats involving a specific contact (including group chats they participate in).',
    {
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
    async ({ query, include_chats = false, limit = 20 }) => {
      const toolCheck = permissions.isToolEnabled('search_contacts');
      if (!toolCheck.allowed) {
        return { content: [{ type: 'text', text: toolCheck.error }], isError: true };
      }

      const chats = store.getAllChatsForMatching();
      const lowerQuery = query.toLowerCase();

      const matches = chats
        .filter((c) => {
          const nameMatch = c.name?.toLowerCase().includes(lowerQuery);
          const jidMatch = c.jid.includes(query.replace(/[^0-9]/g, ''));
          return nameMatch || jidMatch;
        })
        .slice(0, Math.min(limit || 20, 50));

      if (matches.length === 0) {
        return {
          content: [{ type: 'text', text: `No contacts found matching "${query}".` }]
        };
      }

      const lines = matches.map((c) => {
        const isGroup = c.jid.endsWith('@g.us');
        const phone = isGroup ? '' : ` (${c.jid.split('@')[0]})`;
        return `  - ${c.name || c.jid}${phone} → ${c.jid}${isGroup ? ' [Group]' : ''}`;
      });

      let output = `Contacts matching "${query}" (${matches.length}):\n\n${lines.join('\n')}`;

      if (include_chats && matches.length === 1) {
        const contactChats = store.getContactChats(matches[0].jid, 10);
        if (contactChats.length > 0) {
          const chatLines = contactChats.map((c) => {
            const type = c.is_group ? '[Group]' : '[Chat]';
            const time = c.last_message_at
              ? new Date(c.last_message_at * 1000).toLocaleString()
              : 'never';
            return `  - ${type} ${c.name || c.jid} (last: ${time})`;
          });
          output += `\n\nChats involving ${matches[0].name || matches[0].jid}:\n${chatLines.join('\n')}`;
        }
      }

      return {
        content: [{ type: 'text', text: output }]
      };
    },
    { annotations: { readOnlyHint: true } }
  );

  // ── mark_messages_read ───────────────────────────────────────

  server.tool(
    'mark_messages_read',
    'Mark messages as read in a WhatsApp chat. Prevents them from appearing as unread in catch_up. Specify a chat to mark all messages in it, or provide specific message IDs.',
    {
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
    async ({ chat, message_ids }) => {
      const toolCheck = permissions.isToolEnabled('mark_messages_read');
      if (!toolCheck.allowed) {
        return { content: [{ type: 'text', text: toolCheck.error }], isError: true };
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
        } else if (result.candidates.length > 0) {
          const list = result.candidates.map((c) => `  - "${c.name}" → ${c.jid}`).join('\n');
          return {
            content: [{ type: 'text', text: `${result.error}\n\n${list}` }],
            isError: true
          };
        } else {
          return {
            content: [{ type: 'text', text: result.error }],
            isError: true
          };
        }
      }

      const count = await waClient.markMessagesRead({ chatJid, messageIds: message_ids ?? [], senderJid: null });
      audit.log('mark_messages_read', 'marked', { chat: chatJid, count });

      return {
        content: [
          {
            type: 'text',
            text: `Marked ${count} message(s) as read.`
          }
        ]
      };
    },
    { annotations: { idempotentHint: true, readOnlyHint: true } }
  );

  // ── export_chat_data ─────────────────────────────────────────

  server.tool(
    'export_chat_data',
    'Export complete chat history for a specific contact or group. Supports JSON and CSV formats. Designed for PIPEDA individual access rights compliance. Returns up to 10,000 most recent messages.',
    {
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
    async ({ jid, format = 'json' }) => {
      const toolCheck = permissions.isToolEnabled('export_chat_data');
      if (!toolCheck.allowed) {
        return { content: [{ type: 'text', text: toolCheck.error }], isError: true };
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
          return {
            content: [
              {
                type: 'text',
                text: `Chat data exported to CSV format:\n\nChat: ${chatInfo}\nExported: ${exportData.exportedAt}\n\nPreview (first 500 chars):\n${exportData.data?.substring(0, 500) || ''}...`
              }
            ]
          };
        }

        // JSON format - return summary (full data too large for response)
        return {
          content: [
            {
              type: 'text',
              text: `Chat data exported to JSON format:\n\nChat: ${chatInfo}\nFormat: ${format}\nExported: ${exportData.exportedAt}\nMessages: ${exportData.messageCount}\n\nNote: Full JSON data available via programmatic access. This response contains metadata only.`
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
    },
    { annotations: { readOnlyHint: true } }
  );
}
