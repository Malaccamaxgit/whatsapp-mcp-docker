/**
 * Message Action Tools
 *
 * send_reaction, edit_message, delete_message, create_poll
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PermissionManager } from '../security/permissions.js';
import type { MessageStore } from '../whatsapp/store.js';
import type { WhatsAppClient } from '../whatsapp/client.js';
import type { AuditLogger } from '../security/audit.js';
import { resolveRecipient } from '../utils/fuzzy-match.js';
import { toJid } from '../utils/phone.js';
import { LIMITS } from '../security/permissions.js';

interface ApprovalResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

function notConnected (): ApprovalResult {
  return {
    content: [{ type: 'text', text: 'WhatsApp not connected. Use the authenticate tool first.' }],
    isError: true
  };
}

function resolveJid (target: string, store: MessageStore): string | null {
  if (target.includes('@')) {return target;}
  const chats = store.getAllChatsForMatching();
  const { resolved } = resolveRecipient(target, chats);
  return resolved || (target.match(/^\+?\d{7,15}$/) ? toJid(target) : null);
}

export function registerReactionTools (
  server: McpServer,
  waClient: WhatsAppClient,
  store: MessageStore,
  permissions: PermissionManager,
  audit: AuditLogger
): void {
  // ── send_reaction ─────────────────────────────────────────────

  const sendReactionHandler = async ({
    chat,
    message_id,
    emoji
  }: {
    chat: string;
    message_id: string;
    emoji: string;
  }): Promise<ApprovalResult> => {
    const toolCheck = permissions.isToolEnabled('send_reaction');
    if (!toolCheck.allowed) {
      return { content: [{ type: 'text', text: toolCheck.error ?? 'Tool disabled' }], isError: true };
    }
    if (!waClient.isConnected()) {return notConnected();}

    const rateCheck = permissions.checkRateLimit();
    if (!rateCheck.allowed) {
      return { content: [{ type: 'text', text: rateCheck.error ?? 'Rate limit exceeded' }], isError: true };
    }

    try {
      const resolvedJid = resolveJid(chat, store);
      if (!resolvedJid) {
        return { content: [{ type: 'text', text: `Chat not found: "${chat}"` }], isError: true };
      }

      const storedMessage = store.getMessageById(message_id);
      const storedMessageChatJid = storedMessage?.chat_jid || null;
      const jid = storedMessageChatJid || resolvedJid;
      const chatMismatch = Boolean(storedMessageChatJid && storedMessageChatJid !== resolvedJid);

      await waClient.sendReaction(jid, message_id, emoji);
      const action = emoji ? `reacted with ${emoji}` : 'removed reaction';
      audit.log('send_reaction', action, {
        jid,
        message_id,
        emoji,
        chat_input: chat,
        resolved_jid: resolvedJid,
        stored_message_chat_jid: storedMessageChatJid,
        chat_mismatch: chatMismatch
      });
      return {
        content: [{ type: 'text', text: `Reaction ${emoji ? `"${emoji}"` : 'removed'} on message ${message_id}.` }]
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err || '');
      audit.log('send_reaction', 'failed', { error: errorMsg }, false);
      return { content: [{ type: 'text', text: `Failed to send reaction: ${errorMsg}` }], isError: true };
    }
  };

  server.registerTool(
    'send_reaction',
    {
      description: 'React to a WhatsApp message with an emoji. Use an empty string to remove an existing reaction.',
      inputSchema: {
        chat: z.string().max(200).describe('Chat name, phone number, or JID containing the message'),
        message_id: z.string().max(200).describe('Message ID to react to (from list_messages output)'),
        emoji: z
          .string()
          .max(10)
          .describe('Emoji to react with (e.g. "👍", "❤️", "😂"). Empty string removes the reaction.')
      },
      annotations: { destructiveHint: false, openWorldHint: true }
    },

    sendReactionHandler as any
  );

  // ── edit_message ──────────────────────────────────────────────

  const editMessageHandler = async ({
    chat,
    message_id,
    new_text
  }: {
    chat: string;
    message_id: string;
    new_text: string;
  }): Promise<ApprovalResult> => {
    const toolCheck = permissions.isToolEnabled('edit_message');
    if (!toolCheck.allowed) {
      return { content: [{ type: 'text', text: toolCheck.error ?? 'Tool disabled' }], isError: true };
    }
    if (!waClient.isConnected()) {return notConnected();}

    const rateCheck = permissions.checkRateLimit();
    if (!rateCheck.allowed) {
      return { content: [{ type: 'text', text: rateCheck.error ?? 'Rate limit exceeded' }], isError: true };
    }

    try {
      const jid = resolveJid(chat, store);
      if (!jid) {
        return { content: [{ type: 'text', text: `Chat not found: "${chat}"` }], isError: true };
      }

      await waClient.editMessage(jid, message_id, new_text);
      audit.log('edit_message', 'edited', { jid, message_id });
      return { content: [{ type: 'text', text: `Message ${message_id} edited successfully.` }] };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err || '');
      audit.log('edit_message', 'failed', { error: errorMsg }, false);
      return { content: [{ type: 'text', text: `Failed to edit message: ${errorMsg}` }], isError: true };
    }
  };

  server.registerTool(
    'edit_message',
    {
      description: 'Edit a previously sent WhatsApp message. Only works on messages sent by this account within the last ~15 minutes.',
      inputSchema: {
        chat: z.string().max(200).describe('Chat name, phone number, or JID containing the message'),
        message_id: z.string().max(200).describe('Message ID to edit (from list_messages output)'),
        new_text: z
          .string()
          .max(LIMITS.MAX_MESSAGE_LENGTH)
          .describe('New message text to replace the original')
      },
      annotations: { destructiveHint: false, openWorldHint: true }
    },

    editMessageHandler as any
  );

  // ── delete_message ────────────────────────────────────────────

  const deleteMessageHandler = async ({
    chat,
    message_id
  }: {
    chat: string;
    message_id: string;
  }): Promise<ApprovalResult> => {
    const toolCheck = permissions.isToolEnabled('delete_message');
    if (!toolCheck.allowed) {
      return { content: [{ type: 'text', text: toolCheck.error ?? 'Tool disabled' }], isError: true };
    }
    if (!waClient.isConnected()) {return notConnected();}

    const rateCheck = permissions.checkRateLimit();
    if (!rateCheck.allowed) {
      return { content: [{ type: 'text', text: rateCheck.error ?? 'Rate limit exceeded' }], isError: true };
    }

    try {
      const jid = resolveJid(chat, store);
      if (!jid) {
        return { content: [{ type: 'text', text: `Chat not found: "${chat}"` }], isError: true };
      }

      await waClient.revokeMessage(jid, message_id);
      audit.log('delete_message', 'deleted', { jid, message_id });
      return { content: [{ type: 'text', text: `Message ${message_id} deleted for everyone.` }] };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err || '');
      audit.log('delete_message', 'failed', { error: errorMsg }, false);
      return { content: [{ type: 'text', text: `Failed to delete message: ${errorMsg}` }], isError: true };
    }
  };

  server.registerTool(
    'delete_message',
    {
      description: 'Delete a WhatsApp message for everyone in the chat (revoke). Only works on messages sent by this account.',
      inputSchema: {
        chat: z.string().max(200).describe('Chat name, phone number, or JID containing the message'),
        message_id: z.string().max(200).describe('Message ID to delete (from list_messages output)')
      },
      annotations: { destructiveHint: true, openWorldHint: true }
    },

    deleteMessageHandler as any
  );

  // ── create_poll ───────────────────────────────────────────────

  const createPollHandler = async ({
    to,
    question,
    options,
    allow_multiple,
    short_name
  }: {
    to: string;
    question: string;
    options: string[];
    allow_multiple?: boolean;
    short_name?: string;
  }): Promise<ApprovalResult> => {
    const toolCheck = permissions.isToolEnabled('create_poll');
    if (!toolCheck.allowed) {
      return { content: [{ type: 'text', text: toolCheck.error ?? 'Tool disabled' }], isError: true };
    }
    if (!waClient.isConnected()) {return notConnected();}

    const rateCheck = permissions.checkRateLimit();
    if (!rateCheck.allowed) {
      return { content: [{ type: 'text', text: rateCheck.error ?? 'Rate limit exceeded' }], isError: true };
    }

    try {
      const jid = resolveJid(to, store);
      if (!jid) {
        return { content: [{ type: 'text', text: `Chat not found: "${to}"` }], isError: true };
      }

      const result = await waClient.createPoll(jid, question, options, allow_multiple ?? false);
      const pollId = result?.id;

      if (pollId) {
        const pollBody = `Poll: ${question}\n${options.map((o) => `  - ${o}`).join('\n')}`;
        store.addMessage({
          id: pollId,
          chatJid: jid,
          senderJid: waClient.jid ?? null,
          senderName: null,
          body: pollBody,
          timestamp: Math.floor(Date.now() / 1000),
          isFromMe: true,
          hasMedia: false,
          mediaType: null,
          pollMetadata: {
            pollCreationMessageKey: pollId,
            voteOptions: options
          }
        });
        if (short_name) {
          store.upsertPollShortName({ chatJid: jid, shortName: short_name, pollMessageId: pollId });
        }
      }

      audit.log('create_poll', 'sent', { jid, question, optionCount: options.length, shortName: short_name });
      const lines = [
        `Poll sent to ${jid}.`,
        `Question: "${question}"`,
        `Options: ${options.map((o, i) => `${i + 1}. ${o}`).join(', ')}`,
        `Multiple answers: ${allow_multiple ? 'yes' : 'no'}`,
        `Message ID: ${pollId || 'unknown'}`
      ];
      if (short_name) {
        lines.push(`Short name: ${short_name} (use with get_poll_results or list_polls)`);
      }
      return {
        content: [
          {
            type: 'text',
            text: lines.join('\n')
          }
        ]
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err || '');
      audit.log('create_poll', 'failed', { error: errorMsg }, false);
      return { content: [{ type: 'text', text: `Failed to create poll: ${errorMsg}` }], isError: true };
    }
  };

  server.registerTool(
    'create_poll',
    {
      description: 'Send a poll to a WhatsApp chat. Participants can vote on one or more options.',
      inputSchema: {
        to: z.string().max(200).describe('Recipient: contact name, group name, phone number, or JID'),
        question: z.string().min(1).max(255).describe('Poll question'),
        options: z
          .array(z.string().min(1).max(100))
          .min(2)
          .max(12)
          .describe('Poll answer options (2–12 options, max 100 chars each)'),
        allow_multiple: z
          .boolean()
          .optional()
          .default(false)
          .describe('Allow participants to select multiple answers (default: false)'),
        short_name: z
          .string()
          .min(1)
          .max(64)
          .regex(/^[a-zA-Z0-9_-]+$/, 'Use only letters, digits, underscore, and hyphen')
          .optional()
          .describe(
            'Optional label for this poll in this chat — use instead of the long message id with get_poll_results'
          )
      },
      annotations: { destructiveHint: false, openWorldHint: true }
    },

    createPollHandler as any
  );
}
