/**
 * Chat Tools
 *
 * list_chats, catch_up, mark_messages_read
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { resolveRecipient } from '../utils/fuzzy-match.js';
import { LIMITS } from '../security/permissions.js';
import type { MessageStore } from '../whatsapp/store.js';
import { WhatsAppClient } from '../whatsapp/client.js';
import type { AuditLogger } from '../security/audit.js';
import { PermissionManager } from '../security/permissions.js';
import { formatTimestamp, formatTimeOnly } from '../utils/timezone.js';

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
          ? formatTimestamp(c.last_message_at)
          : 'never';
        const preview = c.last_message_preview
          ? `: ${c.last_message_preview.substring(0, 60)}${c.last_message_preview.length > 60 ? '...' : ''}`
          : '';
        
        // Show JID mapping info for non-group chats
        const jidInfo = c.is_group ? c.jid : (() => {
          const mapping = store.getJidMapping(c.jid);
          if (mapping && (mapping.phoneJid || mapping.phoneNumber)) {
            const parts = [c.jid];
            if (mapping.phoneJid && mapping.phoneJid !== c.jid) {parts.push(mapping.phoneJid);}
            if (mapping.phoneNumber) {parts.push(`(${mapping.phoneNumber})`);}
            return parts.join(' ↔ ');
          }
          return c.jid;
        })();
        
        return `${type} ${c.name || c.jid}${unread}\n     Last: ${time}${preview}\n     JID: ${jidInfo}`;
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
    }
  );

  // ── catch_up ─────────────────────────────────────────────────

  server.registerTool(
    'catch_up',
    {
      description: 'Get an intelligent summary of recent WhatsApp activity. Shows active chats with unread counts, recent messages directed at you, questions awaiting your response, and pending approval requests. Much more useful than reading raw message lists.',
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
          const time = formatTimeOnly(m.timestamp);
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
          ? formatTimestamp(c.last_message_at)
          : 'never';
            return `  - ${type} ${c.name || c.jid} (last: ${time})`;
          });
          output += `\n\nChats involving ${matches[0].name || matches[0].jid}:\n${chatLines.join('\n')}`;
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
    }
  );

  // ── migrate_duplicate_chats (temporary admin tool) ─────────────────────────
  // TODO: REMOVE THIS TOOL AFTER MIGRATION - Temporary tool for one-time migration only.
  //       Once users have run the migration (or automatic mapping handles it), this tool
  //       should be removed from the codebase. Do NOT include in production releases.
  //       Related: docs/TODO-CODEBASE-TRACKER.md - CLEANUP-001

  server.registerTool(
    'migrate_duplicate_chats',
    {
      description: 'Migrate existing duplicate chat entries by creating contact mappings. This backfills the contact_mappings table for chats that have both @lid and @s.whatsapp.net JID formats. Run this once to unify existing duplicate contacts.',
      inputSchema: {
        dry_run: z.boolean().default(false).describe('If true, only report what would be migrated without making changes').optional()
      },
      annotations: { readOnlyHint: false }
    },

    async ({ dry_run = false }: { dry_run?: boolean }) => {
      const toolCheck = permissions.isToolEnabled('migrate_duplicate_chats');
      if (!toolCheck.allowed) {
        return { content: [{ type: 'text', text: toolCheck.error ?? 'Tool disabled' }], isError: true };
      }

      try {
        // Get all non-group chats
        const allChats = store.db!.prepare(`
          SELECT jid, name
          FROM chats
          WHERE is_group = 0
        `).all() as Array<{ jid: string; name: string | null }>;

        const lidChats = allChats.filter((c) => c.jid.endsWith('@lid'));
        const phoneChats = allChats.filter((c) => c.jid.endsWith('@s.whatsapp.net'));

        const mappingsToCreate: Array<{
          lidJid: string;
          phoneJid: string;
          phoneNumber: string;
          contactName: string;
        }> = [];

        // Match by extracting phone number from LID and finding corresponding phone JID
        for (const lid of lidChats) {
          const lidPhone = lid.jid.match(/^([0-9]+)@/)?.[1];
          if (!lidPhone || !lid.name) {continue;}

          // Look for phone chat with matching number (either as JID or as name)
          const phoneMatch = phoneChats.find((p) => {
            const phoneNum = p.jid.match(/^([0-9]+)@/)?.[1];
            // Match if: phone JID number matches start of LID number AND (name matches OR name IS the number)
            return phoneNum && (
              lidPhone.startsWith(phoneNum) || 
              p.name === phoneNum ||
              p.name === lid.name
            );
          });

          if (phoneMatch) {
            const phoneNumber = phoneMatch.jid.split('@')[0];
            mappingsToCreate.push({
              lidJid: lid.jid,
              phoneJid: phoneMatch.jid,
              phoneNumber: phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`,
              contactName: lid.name
            });
          }
        }

        if (dry_run) {
          if (mappingsToCreate.length === 0) {
            return {
              content: [
                {
                  type: 'text',
                  text: `DRY RUN: No duplicate contacts found.\n\n` +
                    `This could mean:\n` +
                    `1. Contacts are already unified\n` +
                    `2. Duplicates don't have matching phone numbers\n` +
                    `3. Names don't match between duplicates\n\n` +
                    `Note: Mappings will be created automatically when you send/receive messages.`
                }
              ]
            };
          }

          return {
            content: [
              {
                type: 'text',
                text: `DRY RUN: Found ${mappingsToCreate.length} duplicate contact(s) to migrate:\n\n` +
                  mappingsToCreate.map((m) => 
                    `**${m.contactName}**\n` +
                    `  LID: ${m.lidJid}\n` +
                    `  Phone JID: ${m.phoneJid}\n` +
                    `  Phone: ${m.phoneNumber}\n`
                  ).join('\n') +
                  `\n\nCall migrate_duplicate_chats again (without dry_run) to create these mappings.`
              }
            ]
          };
        }

        // Perform actual migration
        let migrated = 0;
        for (const mapping of mappingsToCreate) {
          try {
            store.upsertContactMapping(
              mapping.lidJid,
              mapping.phoneJid,
              mapping.phoneNumber,
              mapping.contactName
            );
            migrated++;
          } catch (err) {
            console.error(`Failed to create mapping for ${mapping.contactName}:`, (err as Error).message);
          }
        }

        // Also run the standard migration for name-based matches
        const standardResult = store.migrateDuplicateChats();
        migrated += standardResult.migrated;

        audit.log('migrate_duplicate_chats', 'migrated', { migrated });

        return {
          content: [
            {
              type: 'text',
              text: `Migration complete!\n\n` +
                `✅ Migrated: ${migrated} contact mapping(s) created\n\n` +
                `Next steps:\n` +
                `1. Run \`list_chats\` to verify contacts are now unified\n` +
                `2. Each contact should appear only once\n` +
                `3. Future messages will automatically create mappings`
            }
          ]
        };
      } catch (error) {
        audit.log('migrate_duplicate_chats', 'failed', { error: (error as Error).message }, false);
        return {
          content: [{ type: 'text', text: `Migration failed: ${(error as Error).message}` }],
          isError: true
        };
      }
    }
  );
}
