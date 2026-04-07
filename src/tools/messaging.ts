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
import { formatTimestamp } from '../utils/timezone.js';
import { registerTool } from '../utils/mcp-types.js';
import { withToolInfoErrorHint } from './tool-info.js';

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
  is_read: number;
  has_media: number;
  media_type: string | null;
  media_filename: string | null;
}

interface ChatInfo {
  jid: string;
  name: string | null;
  is_group: number;
}

export function registerMessagingTools (
  server: McpServer,
  waClient: WhatsAppClient,
  store: MessageStore,
  permissions: PermissionManager,
  audit: AuditLogger
): void {
  // ── send_message ─────────────────────────────────────────────

  registerTool(server, 'send_message', {
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
  }, async ({ to, message }) => {
      const toolCheck = permissions.isToolEnabled('send_message');
      if (!toolCheck.allowed) {
        return { content: [{ type: 'text', text: toolCheck.error ?? 'Tool disabled' }], isError: true };
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
        const list = candidates.map((c) => `  - "${c.name ?? c.jid}" → ${c.jid}`).join('\n');
        return {
          content: [
            {
              type: 'text',
              text: `${error ?? 'Ambiguous recipient'}\n\n${list}\n\nCall send_message again with the exact JID as the "to" parameter.`
            }
          ],
          isError: true
        };
      }

      if (!resolved) {
        // TODO: Automatically convert phone numbers to JID format when fuzzy matching fails.
        // If "to" looks like a phone number (starts with + or contains digits only),
        // validate it with validatePhoneNumber() and convert to JID format (NNNNNNNNNNN@s.whatsapp.net).
        // This would allow send_message to work with new contacts not yet in the chat list.
        // Current workaround: users must manually use JID format (e.g., "33680940027@s.whatsapp.net").
        // See: docs/bugs/BUG-self-account-messages-not-received.md for related issues.
        return {
          content: [{ type: 'text', text: withToolInfoErrorHint(error ?? `Could not resolve recipient "${to}".`, 'send_message') }],
          isError: true
        };
      }

      const jid = resolved.includes('@') ? resolved : toJid(resolved);
      if (!jid) {
        return {
          content: [{ type: 'text', text: `Invalid phone number: "${resolved}"` }],
          isError: true
        };
      }

      const contactCheck = permissions.canSendTo(jid);
      if (!contactCheck.allowed) {
        return { content: [{ type: 'text', text: contactCheck.error ?? 'Cannot send to this contact' }], isError: true };
      }

      const rateCheck = permissions.checkRateLimit();
      if (!rateCheck.allowed) {
        return { content: [{ type: 'text', text: rateCheck.error ?? 'Rate limit exceeded' }], isError: true };
      }

      try {
        const result = await waClient.sendMessage(jid, message);
        audit.log('send_message', 'sent', { to: jid, messageId: result.id });

        const chatName = (store.getChatByJid(jid) as ChatInfo | null)?.name ?? to;
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
  });

  // ── list_messages ────────────────────────────────────────────

  registerTool(server, 'list_messages', {
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
  }, async ({
    chat,
    limit = 50,
    page = 0,
    before,
    after,
    include_context = false,
    context_messages = 2
  }) => {
      const toolCheck = permissions.isToolEnabled('list_messages');
      if (!toolCheck.allowed) {
        return { content: [{ type: 'text', text: toolCheck.error ?? 'Tool disabled' }], isError: true };
      }

      const chats = store.getAllChatsForMatching();
      const { resolved, candidates, error } = resolveRecipient(chat, chats);

      if (!resolved && candidates.length > 0) {
        const list = candidates.map((c) => `  - "${c.name ?? c.jid}" → ${c.jid}`).join('\n');
        return {
          content: [{ type: 'text', text: `${error ?? 'Ambiguous recipient'}\n\n${list}` }],
          isError: true
        };
      }
      if (!resolved) {
        return {
          content: [{ type: 'text', text: withToolInfoErrorHint(error ?? 'Could not resolve chat', 'list_messages') }],
          isError: true
        };
      }
      const readCheck = permissions.canReadFrom(resolved);
      if (!readCheck.allowed) {
        return { content: [{ type: 'text', text: readCheck.error ?? 'Read access denied' }], isError: true };
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
        const time = formatTimestamp(m.timestamp);
        const readStatus = m.is_read ? 'yes' : 'no';
        
        let content: string;
        if (m.body) {
          content = m.body.substring(0, 200);
        } else if (m.has_media) {
          const mediaDesc = `[${m.media_type || 'media'}${m.media_filename ? `: ${m.media_filename}` : ''}]`;
          content = mediaDesc;
        } else {
          content = '[empty]';
        }
        
        return `${prefix}[${time}] ${dir}\n${prefix}  ID: ${m.id}\n${prefix}  Read: ${readStatus}\n${prefix}  ${content}`;
      };

      let output: string;
      if (include_context) {
        const contextLines: string[] = [];
        for (const m of messages) {
          const ctx = store.getMessageContext(m.id, context_messages, context_messages) as MessageContext | null;
          if (ctx) {
            for (const b of ctx.before) {contextLines.push(formatMsg(b, '  '));}
            contextLines.push(formatMsg(ctx.message as MessageRow, '→ '));
            for (const a of ctx.after) {contextLines.push(formatMsg(a, '  '));}
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
  });

  // ── search_messages ──────────────────────────────────────────

  registerTool(server, 'search_messages', {
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
  }, async ({
    query,
    chat,
    limit = 20,
    page = 0,
    include_context = false
  }) => {
      const toolCheck = permissions.isToolEnabled('search_messages');
      if (!toolCheck.allowed) {
        return { content: [{ type: 'text', text: toolCheck.error ?? 'Tool disabled' }], isError: true };
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
        }
      } else if (permissions.hasContactRestrictions) {
        return {
          content: [{
            type: 'text',
            text: withToolInfoErrorHint(
              'When ALLOWED_CONTACTS is set, provide "chat" for search_messages so access policy can be enforced.',
              'search_messages'
            )
          }],
          isError: true
        };
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
            const time = formatTimestamp(m.timestamp);
            const mediaInfo = m.has_media ? ` [${m.media_type || 'media'}${m.media_filename ? `: ${m.media_filename}` : ''}]` : '';
            const readStatus = m.is_read ? '' : ' (unread)';
            lines.push(`→ [${chatName}] [${time}] ${sender}: ${m.body?.substring(0, 150) || mediaInfo}${readStatus} (id: ${m.id})`);
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
          const time = formatTimestamp(m.timestamp);
          const mediaInfo = m.has_media ? ` [${m.media_type || 'media'}${m.media_filename ? `: ${m.media_filename}` : ''}]` : '';
          const readStatus = m.is_read ? '' : ' (unread)';
          return `[${chatName}] [${time}] ${sender}: ${m.body?.substring(0, 150) || mediaInfo}${readStatus} (id: ${m.id})`;
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
  });

  // ── Poll tools (disabled — ephemeral container / gateway limitation) ──
  // See POLL_LIMITATIONS.md for details.
  /*

  // ── get_poll_results ─────────────────────────────────────────

  const getPollResultsInput = z
    .object({
      poll_message_id: z
        .string()
        .optional()
        .describe('Message ID of the poll creation message (from create_poll or list_messages)'),
      short_name: z
        .string()
        .min(1)
        .max(64)
        .regex(/^[a-zA-Z0-9_-]+$/, 'Use only letters, digits, underscore, and hyphen')
        .optional()
        .describe('Short name registered for this poll in this chat (from create_poll)'),
      chat: z.string().max(200).describe('Chat name, phone number, or JID where the poll was sent')
    })
    .superRefine((data, ctx) => {
      if (!data.poll_message_id && !data.short_name) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Provide either poll_message_id or short_name',
          path: ['poll_message_id']
        });
      }
    });

  server.registerTool(
    'get_poll_results',
    {
      description:
        'Get poll results including vote counts for each option. Identify the poll by message id or by the short_name from create_poll.',
      inputSchema: getPollResultsInput
    },

    (async ({
      poll_message_id,
      short_name,
      chat
    }: {
      poll_message_id?: string;
      short_name?: string;
      chat: string;
    }) => {
      const toolCheck = permissions.isToolEnabled('get_poll_results');
      if (!toolCheck.allowed) {
        return { content: [{ type: 'text', text: toolCheck.error ?? 'Tool disabled' }], isError: true };
      }

      const chats = store.getAllChatsForMatching();
      const { resolved, candidates, error } = resolveRecipient(chat, chats);

      if (!resolved && candidates.length > 0) {
        const list = candidates.map((c) => `  - "${c.name ?? c.jid}" → ${c.jid}`).join('\n');
        return {
          content: [{ type: 'text', text: `${error ?? 'Ambiguous recipient'}\n\n${list}` }],
          isError: true
        };
      }
      if (!resolved) {
        return { content: [{ type: 'text', text: error ?? 'Could not resolve chat' }], isError: true };
      }
      const readCheck = permissions.canReadFrom(resolved);
      if (!readCheck.allowed) {
        return { content: [{ type: 'text', text: readCheck.error ?? 'Read access denied' }], isError: true };
      }

      let effectivePollId: string;
      if (poll_message_id) {
        effectivePollId = poll_message_id;
      } else if (short_name) {
        const id = store.getPollMessageIdByShortName(resolved, short_name);
        if (!id) {
          return {
            content: [
              {
                type: 'text',
                text: `No poll registered with short name "${short_name}" in this chat. Use create_poll with short_name or pass poll_message_id.`
              }
            ],
            isError: true
          };
        }
        effectivePollId = id;
      } else {
        return {
          content: [{ type: 'text', text: 'Provide either poll_message_id or short_name.' }],
          isError: true
        };
      }

      // Get the poll creation message
      const pollMsg = store
        .listMessages({ chatJid: resolved, limit: 100, offset: 0 })
        .find((m) => m.id === effectivePollId);

      if (!pollMsg) {
        return {
          content: [{ type: 'text', text: `Poll message not found: ${effectivePollId}` }],
          isError: true
        };
      }

      if (!pollMsg.body || !pollMsg.body.startsWith('Poll: ')) {
        return {
          content: [{ type: 'text', text: `Message ${effectivePollId} is not a poll.` }],
          isError: true
        };
      }

      // Parse poll question and options from the message body
      const lines = pollMsg.body.split('\n');
      const question = lines[0].replace('Poll: ', '');
      const options: string[] = [];
      for (let i = 1; i < lines.length; i++) {
        if (lines[i].startsWith('  - ')) {
          options.push(lines[i].slice(4).trim());
        }
      }

      // Get all votes for this poll
      const votes = store.getPollVotes(effectivePollId, resolved);

      // Count votes per option
      const voteCounts = new Map<string, number>();
      for (const opt of options) {
        voteCounts.set(opt, 0);
      }

      const votesByOption = new Map<string, Array<{ voter_jid: string; voter_name: string | null; timestamp: number }>>();
      for (const opt of options) {
        votesByOption.set(opt, []);
      }

      for (const vote of votes) {
        // Handle multiple selections if present
        const selectedOptions = vote.vote_option ? [vote.vote_option] : [];
        for (const selectedOpt of selectedOptions) {
          if (voteCounts.has(selectedOpt)) {
            voteCounts.set(selectedOpt, (voteCounts.get(selectedOpt) || 0) + 1);
            votesByOption.get(selectedOpt)!.push({
              voter_jid: vote.voter_jid,
              voter_name: vote.voter_name,
              timestamp: vote.timestamp
            });
          }
        }
      }

      // Build output with limitation notice
      const totalVotes = votes.length;
      let output = `Poll: ${question}\n\n`;
      output += `Total votes: ${totalVotes}\n`;
      
      // Add server start time context if there are votes
      if (totalVotes > 0) {
        const earliestVote = votes.reduce((min, v) => v.timestamp < min ? v.timestamp : min, votes[0].timestamp);
        const latestVote = votes.reduce((max, v) => v.timestamp > max ? v.timestamp : max, votes[0].timestamp);
        output += `Votes received: ${formatTimestamp(earliestVote)} to ${formatTimestamp(latestVote)}\n\n`;
      } else {
        output += '\n';
      }
      
      output += 'Results:\n';

      for (const opt of options) {
        const count = voteCounts.get(opt) || 0;
        const percentage = totalVotes > 0 ? ((count / totalVotes) * 100).toFixed(1) : '0.0';
        const barLen = totalVotes > 0 ? Math.round((count / totalVotes) * 10) : 0;
        const bar = '█'.repeat(barLen) + '░'.repeat(10 - barLen);
        output += `  ${opt}: ${count} votes (${percentage}%)\n`;
        output += `    [${bar}]\n`;

        const voters = votesByOption.get(opt) || [];
        if (voters.length > 0) {
          output += `    Voters:\n`;
          for (const v of voters) {
            const voterName = v.voter_name || v.voter_jid.split('@')[0];
            const time = formatTimestamp(v.timestamp);
            output += `      - ${voterName} at ${time}\n`;
          }
        }
      }

      // Add limitation notice at the end
      output += '\n';
      output += '----------------------------------------\n';
      output += 'Note: This shows votes received by this server.\n';
      output += 'WhatsApp may not sync all votes to secondary devices.\n';
      output += 'For complete results, check the poll in WhatsApp.\n';
      output += '----------------------------------------\n';

      audit.log('get_poll_results', 'read', { pollId: effectivePollId, totalVotes });

      return {
        content: [
          {
            type: 'text',
            text: output
          }
        ]
      };
    }) as any
  );

  // ── debug_poll_votes ─────────────────────────────────────────

  server.registerTool(
    'debug_poll_votes',
    {
      description:
        'Debug tool: Check poll vote storage and recent poll-related messages. Use for troubleshooting missing votes.',
      inputSchema: {
        poll_message_id: z.string().optional().describe('Specific poll message ID to debug'),
        short_name: z.string().optional().describe('Short name of poll to debug'),
        chat: z.string().optional().describe('Chat to scope debug to')
      }
    },

    (async ({ poll_message_id, short_name, chat }: {
      poll_message_id?: string;
      short_name?: string;
      chat?: string;
    }) => {
      const toolCheck = permissions.isToolEnabled('debug_poll_votes');
      if (!toolCheck.allowed) {
        return { content: [{ type: 'text', text: toolCheck.error ?? 'Tool disabled' }], isError: true };
      }

      let output = '🔍 Poll Vote Debug Report\n\n';

      // If chat is provided, resolve it
      let resolvedJid: string | null = null;
      if (chat) {
        const chats = store.getAllChatsForMatching();
        const { resolved, error } = resolveRecipient(chat, chats);
        if (resolved) {
          resolvedJid = resolved;
          output += `Chat: ${chat} → ${resolvedJid}\n\n`;
        } else {
          output += `Chat: ${chat} → NOT FOUND (${error})\n\n`;
        }
      }

      // Resolve poll message ID
      let effectivePollId: string | null = poll_message_id || null;
      if (short_name && resolvedJid) {
        const id = store.getPollMessageIdByShortName(resolvedJid, short_name);
        if (id) {
          effectivePollId = id;
          output += `Short name "${short_name}" → Poll ID: ${id}\n\n`;
        } else {
          output += `Short name "${short_name}" → NOT FOUND in this chat\n\n`;
        }
      }

      // Get poll message if ID is known
      if (effectivePollId && resolvedJid) {
        const pollMsg = store
          .listMessages({ chatJid: resolvedJid, limit: 200, offset: 0 })
          .find((m) => m.id === effectivePollId);

        if (pollMsg) {
          output += '📊 Poll Message:\n';
          output += `  ID: ${pollMsg.id}\n`;
          output += `  Body: ${pollMsg.body?.substring(0, 200)}\n`;
          output += `  Timestamp: ${formatTimestamp(pollMsg.timestamp)}\n\n`;
        } else {
          output += '❌ Poll message not found in database\n\n';
        }

        // Get stored votes
        const votes = store.getPollVotes(effectivePollId, resolvedJid);
        output += `🗳️  Stored Votes: ${votes.length}\n`;
        
        if (votes.length > 0) {
          output += '\nVote Details:\n';
          for (const vote of votes) {
            output += `  - Voter: ${vote.voter_name || vote.voter_jid}\n`;
            output += `    Option: ${vote.vote_option}\n`;
            output += `    Time: ${formatTimestamp(vote.timestamp)}\n`;
          }
        } else {
          output += '  (No votes stored in database)\n';
        }
        output += '\n';
      }

      // Check all polls in resolved chat
      if (resolvedJid) {
        const allPolls = store.listPollShortNamesForChat(resolvedJid);
        output += `📋 All Registered Polls in ${resolvedJid}: ${allPolls.length}\n`;
        for (const poll of allPolls) {
          const voteCount = store.getPollVotes(poll.poll_message_id, resolvedJid).length;
          output += `  - ${poll.short_name} → ${poll.poll_message_id} (${voteCount} votes)\n`;
        }
        output += '\n';
      }

      output += '💡 Tip: Check container logs for [WA-POLL] messages to see if votes are arriving\n';
      output += '   Run: docker compose logs -f whatsapp-mcp-docker | Select-String "WA-POLL"\n\n';
      
      output += '⚠️  Known Limitation:\n';
      output += '   WhatsApp may not forward poll vote updates to secondary devices.\n';
      output += '   This server can only show votes it actually receives in real-time.\n';
      output += '   For accurate poll results, check directly in the WhatsApp app.\n';

      return {
        content: [{ type: 'text', text: output }]
      };
    }) as any
  );

  // ── list_polls ───────────────────────────────────────────────

  server.registerTool(
    'list_polls',
    {
      description:
        'List polls that have a short name registered in a chat (from create_poll). Shows short_name, message id, and registration time.',
      inputSchema: {
        chat: z.string().max(200).describe('Chat name, phone number, or JID')
      }
    },

    (async ({ chat }: { chat: string }) => {
      const toolCheck = permissions.isToolEnabled('list_polls');
      if (!toolCheck.allowed) {
        return { content: [{ type: 'text', text: toolCheck.error ?? 'Tool disabled' }], isError: true };
      }

      const chats = store.getAllChatsForMatching();
      const { resolved, candidates, error } = resolveRecipient(chat, chats);

      if (!resolved && candidates.length > 0) {
        const list = candidates.map((c) => `  - "${c.name ?? c.jid}" → ${c.jid}`).join('\n');
        return {
          content: [{ type: 'text', text: `${error ?? 'Ambiguous recipient'}\n\n${list}` }],
          isError: true
        };
      }
      if (!resolved) {
        return { content: [{ type: 'text', text: error ?? 'Could not resolve chat' }], isError: true };
      }
      const readCheck = permissions.canReadFrom(resolved);
      if (!readCheck.allowed) {
        return { content: [{ type: 'text', text: readCheck.error ?? 'Read access denied' }], isError: true };
      }

      const rows = store.listPollShortNamesForChat(resolved);
      if (rows.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `No short-named polls in this chat. Create one with create_poll and the short_name argument.`
            }
          ]
        };
      }

      const lines = rows.map((r) => {
        const t = formatTimestamp(r.created_at);
        return `  - ${r.short_name} → message id ${r.poll_message_id} (registered ${t})`;
      });

      audit.log('list_polls', 'read', { chatJid: resolved, count: rows.length });

      return {
        content: [
          {
            type: 'text',
            text: `Polls with short names in ${resolved}:\n\n${lines.join('\n')}`
          }
        ]
      };
    }) as any
  );
  */
}
