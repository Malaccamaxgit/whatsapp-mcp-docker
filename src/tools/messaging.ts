/**
 * Messaging Tools
 *
 * send_message, list_messages, search_messages
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { resolveRecipient } from '../utils/fuzzy-match.js';
import { toJid } from '../utils/phone.js';
import { LIMITS } from '../security/permissions.js';
import type { PermissionManager } from '../security/permissions.js';
import type { MessageStore } from '../whatsapp/store.js';
import type { WhatsAppClient } from '../whatsapp/client.js';
import type { AuditLogger } from '../security/audit.js';

interface TextContent {
  type: 'text';
  text: string;
}

interface McpResult {
  content: TextContent[];
  isError?: boolean;
}

interface MessageWithContext {
  id: string;
  chat_jid: string;
  sender_jid: string | null;
  sender_name: string | null;
  body: string | null;
  timestamp: number;
  is_from_me: number;
  has_media: number;
  media_type: string | null;
}

interface MessageContext {
  before: MessageRow[];
  message: MessageRow | null;
  after: MessageRow[];
}

interface MessageRow {
  id: string;
  chat_jid: string;
  sender_jid: string | null;
  sender_name: string | null;
  body: string | null;
  timestamp: number;
  is_from_me: number;
  has_media: number;
  media_type: string | null;
}

interface ChatInfo {
  jid: string;
  name: string | null;
  is_group: number;
}

export function registerMessagingTools(
  server: McpServer,
  waClient: WhatsAppClient,
  store: MessageStore,
  permissions: PermissionManager,
  audit: AuditLogger
): void {
  // ── send_message ─────────────────────────────────────────────

  server.registerTool(
    'send_message',
    {
      description: "Send a WhatsApp message. Supports fuzzy matching on contact or group names — you don't need the exact name or phone number. If multiple matches are found, returns candidates for disambiguation.",
      inputSchema: {
        to: z
          .string()
          .max(200)
          .describe('Recipient: contact name, group name, phone number (e.g. +1234567890), or JID'),
        message: z
          .string()
          .max(LIMITS.MAX_MESSAGE_LENGTH)
          .describe(`The message text to send (max ${LIMITS.MAX_MESSAGE_LENGTH} chars)`)
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (async ({ to, message }: { to: string; message: string }) => {
      const toolCheck = permissions.isToolEnabled('send_message');
      if (!toolCheck.allowed) {
        return { content: [{ type: 'text', text: toolCheck.error }], isError: true };
      }
      if (!waClient.isConnected()) {
        return {
          content: [
            { type: 'text', text: 'WhatsApp not connected. Use the authenticate tool first.' }
          ],
          isError: true
        };
      }

      const chats = store.getAllChatsForMatching();
      const { resolved, candidates, error } = resolveRecipient(to, chats);

      if (!resolved && candidates.length > 0) {
        const list = candidates.map((c) => `  - "${c.name}" → ${c.jid}`).join('\n');
        return {
          content: [
            {
              type: 'text',
              text: `${error}\n\n${list}\n\nCall send_message again with the exact JID as the "to" parameter.`
            }
          ],
          isError: true
        };
      }

      if (!resolved) {
        return {
          content: [{ type: 'text', text: error || `Could not resolve recipient "${to}".` }],
          isError: true
        };
      }

      const jid = resolved.includes('@') ? resolved : toJid(resolved);

      const contactCheck = permissions.canSendTo(jid);
      if (!contactCheck.allowed) {
        return { content: [{ type: 'text', text: contactCheck.error }], isError: true };
      }

      const rateCheck = permissions.checkRateLimit();
      if (!rateCheck.allowed) {
        return { content: [{ type: 'text', text: rateCheck.error }], isError: true };
      }

      try {
        const result = await waClient.sendMessage(jid, message);
        audit.log('send_message', 'sent', { to: jid, messageId: result.id });

        const chatName = (store.getChatByJid(jid) as ChatInfo | null)?.name || to;
        return {
          content: [
            {
              type: 'text',
              text: `Message sent to ${chatName} (${jid}).\nMessage ID: ${result.id}`
            }
          ]
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error || '');
        audit.log('send_message', 'failed', { to: jid, error: errorMsg }, false);
        return {
          content: [{ type: 'text', text: `Failed to send message: ${errorMsg}` }],
          isError: true
        };
      }
    }) as any
  );

  // ── list_messages ────────────────────────────────────────────

  server.registerTool(
    'list_messages',
    {
      description: 'Get messages from a specific WhatsApp chat. Supports date range filtering. Returns messages in chronological order with sender info. Use fuzzy name matching to find the chat.',
      inputSchema: {
        chat: z
          .string()
          .max(200)
          .describe('Chat to read: contact name, group name, phone number, or JID'),
        limit: z
          .number()
          .default(50)
          .describe('Maximum messages to return (default 50, max 200)')
          .optional(),
        page: z.number().default(0).describe('Page number for pagination (default 0)').optional(),
        before: z
          .string()
          .describe('Only messages before this date/time (ISO 8601 or natural like "2026-03-28")')
          .optional(),
        after: z
          .string()
          .describe('Only messages after this date/time (ISO 8601 or natural like "2026-03-01")')
          .optional(),
        include_context: z
          .boolean()
          .default(false)
          .describe('Include surrounding messages for each result for conversational context')
          .optional(),
        context_messages: z
          .number()
          .default(2)
          .describe(
            'Number of messages to include before and after each result when include_context is true'
          )
          .optional()
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (async ({
      chat,
      limit = 50,
      page = 0,
      before,
      after,
      include_context = false,
      context_messages = 2
    }: {
      chat: string;
      limit?: number;
      page?: number;
      before?: string;
      after?: string;
      include_context?: boolean;
      context_messages?: number;
    }) => {
      const toolCheck = permissions.isToolEnabled('list_messages');
      if (!toolCheck.allowed) {
        return { content: [{ type: 'text', text: toolCheck.error }], isError: true };
      }

      const chats = store.getAllChatsForMatching();
      const { resolved, candidates, error } = resolveRecipient(chat, chats);

      if (!resolved && candidates.length > 0) {
        const list = candidates.map((c) => `  - "${c.name}" → ${c.jid}`).join('\n');
        return {
          content: [{ type: 'text', text: `${error}\n\n${list}` }],
          isError: true
        };
      }
      if (!resolved) {
        return { content: [{ type: 'text', text: error }], isError: true };
      }

      const safeLimit = Math.min(limit || 50, 200);
      const offset = (page || 0) * safeLimit;
      const beforeTs = before ? Math.floor(new Date(before).getTime() / 1000) : undefined;
      const afterTs = after ? Math.floor(new Date(after).getTime() / 1000) : undefined;

      const messages = store.listMessages({
        chatJid: resolved,
        limit: safeLimit,
        offset,
        before: beforeTs,
        after: afterTs
      });

      if (messages.length === 0) {
        return {
          content: [{ type: 'text', text: 'No messages found for the specified criteria.' }]
        };
      }

      const chatInfo = store.getChatByJid(resolved);
      const chatName = (chatInfo as ChatInfo | null)?.name || resolved;

      const formatMsg = (m: MessageRow, prefix = '') => {
        const dir = m.is_from_me
          ? 'You'
          : m.sender_name || m.sender_jid?.split('@')[0] || 'Unknown';
        const time = new Date(m.timestamp * 1000).toLocaleString();
        const body = m.body
          ? m.body.substring(0, 200)
          : m.has_media
            ? `[${m.media_type || 'media'}] (id: ${m.id})`
            : '[empty]';
        return `${prefix}[${time}] ${dir}: ${body}`;
      };

      let output: string;
      if (include_context) {
        const contextLines: string[] = [];
        for (const m of messages) {
          const ctx = store.getMessageContext(m.id, context_messages, context_messages) as MessageContext | null;
          if (ctx) {
            for (const b of ctx.before) contextLines.push(formatMsg(b, '  '));
            contextLines.push(formatMsg(ctx.message as MessageRow, '→ '));
            for (const a of ctx.after) contextLines.push(formatMsg(a, '  '));
            contextLines.push('');
          } else {
            contextLines.push(formatMsg(m));
          }
        }
        output = contextLines.join('\n');
      } else {
        output = messages.map((m) => formatMsg(m)).join('\n');
      }

      audit.log('list_messages', 'read', { chat: resolved, count: messages.length, page });

      const pageInfo = page > 0 ? ` (page ${page})` : '';
      const hasMore =
        messages.length === safeLimit
          ? `\n\nMore messages may be available — use page=${(page || 0) + 1} to see the next page.`
          : '';

      return {
        content: [
          {
            type: 'text',
            text: `Messages from ${chatName} (${messages.length})${pageInfo}:\n\n${output}${hasMore}`
          }
        ]
      };
    }) as any
  );

  // ── search_messages ──────────────────────────────────────────

  server.registerTool(
    'search_messages',
    {
      description: 'Full-text search across all WhatsApp messages using SQLite FTS5. Supports keywords, phrases, and boolean operators (AND, OR, NOT). Optionally scope the search to a specific chat.',
      inputSchema: {
        query: z
          .string()
          .max(LIMITS.MAX_SEARCH_QUERY_LENGTH)
          .describe('Search query — keywords, "exact phrase", or boolean (word1 AND word2)'),
        chat: z
          .string()
          .max(200)
          .describe('Optional: scope search to a specific chat (name, number, or JID)')
          .optional(),
        limit: z.number().default(20).describe('Maximum results to return (default 20)').optional(),
        page: z.number().default(0).describe('Page number for pagination (default 0)').optional(),
        include_context: z
          .boolean()
          .default(false)
          .describe('Include surrounding messages for conversational context')
          .optional()
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (async ({
      query,
      chat,
      limit = 20,
      page = 0,
      include_context = false
    }: {
      query: string;
      chat?: string;
      limit?: number;
      page?: number;
      include_context?: boolean;
    }) => {
      const toolCheck = permissions.isToolEnabled('search_messages');
      if (!toolCheck.allowed) {
        return { content: [{ type: 'text', text: toolCheck.error }], isError: true };
      }

      let chatJid: string | null = null;
      if (chat) {
        const chats = store.getAllChatsForMatching();
        const result = resolveRecipient(chat, chats);
        if (result.resolved) chatJid = result.resolved;
      }

      const safeLimit = Math.min(limit || 20, 100);
      const offset = (page || 0) * safeLimit;

      const messages = store.searchMessages({
        query,
        chatJid: chatJid || undefined,
        limit: safeLimit,
        offset
      });

      if (messages.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `No messages found matching "${query}".${chat ? ` (scoped to "${chat}")` : ''}`
            }
          ]
        };
      }

      let lines: string[];
      if (include_context) {
        lines = [];
        for (const m of messages) {
          const ctx = store.getMessageContext(m.id, 1, 1) as MessageContext | null;
          const chatInfo = store.getChatByJid(m.chat_jid);
          const chatName = (chatInfo as ChatInfo | null)?.name || m.chat_jid;
          if (ctx) {
            for (const b of ctx.before) {
              const s = b.is_from_me ? 'You' : b.sender_name || b.sender_jid?.split('@')[0] || '?';
              lines.push(`  [${chatName}] ${s}: ${b.body?.substring(0, 100)}`);
            }
            const sender = m.is_from_me
              ? 'You'
              : m.sender_name || m.sender_jid?.split('@')[0] || '?';
            const time = new Date(m.timestamp * 1000).toLocaleString();
            lines.push(`→ [${chatName}] [${time}] ${sender}: ${m.body?.substring(0, 150)}`);
            for (const a of ctx.after) {
              const s = a.is_from_me ? 'You' : a.sender_name || a.sender_jid?.split('@')[0] || '?';
              lines.push(`  [${chatName}] ${s}: ${a.body?.substring(0, 100)}`);
            }
            lines.push('');
          }
        }
      } else {
        lines = messages.map((m) => {
          const chatInfo = store.getChatByJid(m.chat_jid);
          const chatName = (chatInfo as ChatInfo | null)?.name || m.chat_jid;
          const sender = m.is_from_me ? 'You' : m.sender_name || m.sender_jid?.split('@')[0] || '?';
          const time = new Date(m.timestamp * 1000).toLocaleString();
          return `[${chatName}] [${time}] ${sender}: ${m.body?.substring(0, 150)}`;
        });
      }

      audit.log('search_messages', 'searched', { query, results: messages.length, page });

      const pageInfo = page > 0 ? ` (page ${page})` : '';
      const hasMore =
        messages.length === safeLimit
          ? `\n\nMore results may be available — use page=${(page || 0) + 1}.`
          : '';

      return {
        content: [
          {
            type: 'text',
            text: `Search results for "${query}" (${messages.length} matches)${pageInfo}:\n\n${lines.join('\n')}${hasMore}`
          }
        ]
      };
    }) as any
  );
}
