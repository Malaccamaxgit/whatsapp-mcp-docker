/**
 * Message Action Tools
 *
 * send_reaction, edit_message, delete_message, create_poll
 */

import { z } from 'zod';
import { resolveRecipient } from '../utils/fuzzy-match.js';
import { toJid } from '../utils/phone.js';
import { LIMITS } from '../security/permissions.js';

const notConnected = () => ({
  content: [{ type: 'text', text: 'WhatsApp not connected. Use the authenticate tool first.' }],
  isError: true
});

export function registerReactionTools(server, waClient, store, permissions, audit) {
  // ── send_reaction ─────────────────────────────────────────────

  server.tool(
    'send_reaction',
    'React to a WhatsApp message with an emoji. Use an empty string to remove an existing reaction.',
    {
      chat: z.string().max(200).describe('Chat name, phone number, or JID containing the message'),
      message_id: z.string().max(200).describe('Message ID to react to (from list_messages output)'),
      emoji: z
        .string()
        .max(10)
        .describe('Emoji to react with (e.g. "👍", "❤️", "😂"). Empty string removes the reaction.')
    },
    async ({ chat, message_id, emoji }) => {
      if (!waClient.isConnected()) return notConnected();

      const rateCheck = permissions.checkRateLimit();
      if (!rateCheck.allowed) {
        return { content: [{ type: 'text', text: rateCheck.error }], isError: true };
      }

      try {
        const jid = resolveJid(chat, store);
        if (!jid) {
          return { content: [{ type: 'text', text: `Chat not found: "${chat}"` }], isError: true };
        }

        await waClient.sendReaction(jid, message_id, emoji);
        const action = emoji ? `reacted with ${emoji}` : 'removed reaction';
        audit.log('send_reaction', action, { jid, message_id, emoji });
        return {
          content: [{ type: 'text', text: `Reaction ${emoji ? `"${emoji}"` : 'removed'} on message ${message_id}.` }]
        };
      } catch (err) {
        audit.log('send_reaction', 'failed', { error: err.message }, false);
        return { content: [{ type: 'text', text: `Failed to send reaction: ${err.message}` }], isError: true };
      }
    },
    { annotations: { destructiveHint: false, openWorldHint: true } }
  );

  // ── edit_message ──────────────────────────────────────────────

  server.tool(
    'edit_message',
    'Edit a previously sent WhatsApp message. Only works on messages sent by this account within the last ~15 minutes.',
    {
      chat: z.string().max(200).describe('Chat name, phone number, or JID containing the message'),
      message_id: z.string().max(200).describe('Message ID to edit (from list_messages output)'),
      new_text: z
        .string()
        .max(LIMITS.MAX_MESSAGE_LENGTH)
        .describe('New message text to replace the original')
    },
    async ({ chat, message_id, new_text }) => {
      if (!waClient.isConnected()) return notConnected();

      const rateCheck = permissions.checkRateLimit();
      if (!rateCheck.allowed) {
        return { content: [{ type: 'text', text: rateCheck.error }], isError: true };
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
        audit.log('edit_message', 'failed', { error: err.message }, false);
        return { content: [{ type: 'text', text: `Failed to edit message: ${err.message}` }], isError: true };
      }
    },
    { annotations: { destructiveHint: false, openWorldHint: true } }
  );

  // ── delete_message ────────────────────────────────────────────

  server.tool(
    'delete_message',
    'Delete a WhatsApp message for everyone in the chat (revoke). Only works on messages sent by this account.',
    {
      chat: z.string().max(200).describe('Chat name, phone number, or JID containing the message'),
      message_id: z.string().max(200).describe('Message ID to delete (from list_messages output)')
    },
    async ({ chat, message_id }) => {
      if (!waClient.isConnected()) return notConnected();

      const rateCheck = permissions.checkRateLimit();
      if (!rateCheck.allowed) {
        return { content: [{ type: 'text', text: rateCheck.error }], isError: true };
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
        audit.log('delete_message', 'failed', { error: err.message }, false);
        return { content: [{ type: 'text', text: `Failed to delete message: ${err.message}` }], isError: true };
      }
    },
    { annotations: { destructiveHint: true, openWorldHint: true } }
  );

  // ── create_poll ───────────────────────────────────────────────

  server.tool(
    'create_poll',
    'Send a poll to a WhatsApp chat. Participants can vote on one or more options.',
    {
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
        .describe('Allow participants to select multiple answers (default: false)')
    },
    async ({ to, question, options, allow_multiple }) => {
      if (!waClient.isConnected()) return notConnected();

      const rateCheck = permissions.checkRateLimit();
      if (!rateCheck.allowed) {
        return { content: [{ type: 'text', text: rateCheck.error }], isError: true };
      }

      try {
        const jid = resolveJid(to, store);
        if (!jid) {
          return { content: [{ type: 'text', text: `Chat not found: "${to}"` }], isError: true };
        }

        const result = await waClient.createPoll(jid, question, options, allow_multiple);
        audit.log('create_poll', 'sent', { jid, question, optionCount: options.length });
        return {
          content: [
            {
              type: 'text',
              text: [
                `Poll sent to ${jid}.`,
                `Question: "${question}"`,
                `Options: ${options.map((o, i) => `${i + 1}. ${o}`).join(', ')}`,
                `Multiple answers: ${allow_multiple ? 'yes' : 'no'}`,
                `Message ID: ${result?.id || 'unknown'}`
              ].join('\n')
            }
          ]
        };
      } catch (err) {
        audit.log('create_poll', 'failed', { error: err.message }, false);
        return { content: [{ type: 'text', text: `Failed to create poll: ${err.message}` }], isError: true };
      }
    },
    { annotations: { destructiveHint: false, openWorldHint: true } }
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveJid(target, store) {
  if (target.includes('@')) return target;
  const chats = store.getAllChatsForMatching();
  const { resolved } = resolveRecipient(target, chats);
  return resolved || (target.match(/^\+?\d{7,15}$/) ? toJid(target) : null);
}
