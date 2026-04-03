/**
 * Wait Tools
 *
 * wait_for_message — block until a matching incoming message arrives or timeout
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PermissionManager } from '../security/permissions.js';
import type { MessageStore } from '../whatsapp/store.js';
import type { WhatsAppClient, StoredMessage } from '../whatsapp/client.js';
import type { AuditLogger } from '../security/audit.js';

interface MessageWaiter {
  filter: (msg: StoredMessage) => boolean;
  resolve: (result: StoredMessage | null) => void;
}

export function registerWaitTools(
  server: McpServer,
  waClient: WhatsAppClient,
  store: MessageStore,
  permissions: PermissionManager,
  audit: AuditLogger
): void {
  const wait_for_message_handler = async ({ timeout, chat, from_phone }: { timeout: number; chat?: string; from_phone?: string }) => {
    if (!waClient.isConnected()) {
      return {
        content: [{ type: 'text', text: 'WhatsApp not connected. Use the authenticate tool first.' }],
        isError: true
      };
    }

    // Build optional filter
    let chatJidFilter: string | null = null;
    if (chat) {
      // Resolve chat to a JID via the store
      const chats = store.getAllChatsForMatching();
      const lowerChat = chat.toLowerCase();

      // Exact JID match first, then name fuzzy match
      const matched =
        chats.find((c) => c.jid === chat) ||
        chats.find((c) => c.jid?.toLowerCase() === lowerChat) ||
        chats.find((c) => c.name?.toLowerCase() === lowerChat) ||
        chats.find((c) => c.name?.toLowerCase().includes(lowerChat));

      chatJidFilter = matched?.jid || chat;
    }

    let senderFilter: string | null = null;
    if (from_phone) {
      const digits = from_phone.replace(/[^0-9]/g, '');
      senderFilter = digits ? digits : from_phone;
    }

    const filter = (msg: StoredMessage): boolean => {
      if (chatJidFilter && msg.chatJid !== chatJidFilter) return false;
      if (senderFilter) {
        const jid = msg.senderJid || msg.chatJid || '';
        if (!jid.includes(senderFilter)) return false;
      }
      return true;
    };

    const timeoutMs = timeout * 1000;

    const msg = await new Promise<StoredMessage | null>((resolve) => {
      const timer = setTimeout(() => {
        // Remove this waiter from the list (it may have already been removed by a match)
        const waClientWithWaiters = waClient as WhatsAppClient & { _messageWaiters?: MessageWaiter[] };
        const idx = waClientWithWaiters._messageWaiters?.findIndex((w) => w.resolve === wrappedResolve);
        if (idx !== undefined && idx !== -1) {
          waClientWithWaiters._messageWaiters?.splice(idx, 1);
        }
        resolve(null);
      }, timeoutMs);

      const wrappedResolve = (result: StoredMessage | null): void => {
        clearTimeout(timer);
        resolve(result);
      };

      const waClientWithAddWaiter = waClient as WhatsAppClient & { addMessageWaiter?: (f: typeof filter, r: typeof wrappedResolve) => void };
      waClientWithAddWaiter.addMessageWaiter?.(filter, wrappedResolve);
    });

    if (!msg) {
      const filterDesc = [
        chat ? `chat="${chat}"` : null,
        from_phone ? `from="${from_phone}"` : null
      ]
        .filter(Boolean)
        .join(', ');
      const desc = filterDesc ? ` matching ${filterDesc}` : '';
      return {
        content: [
          {
            type: 'text',
            text: `No message${desc} received within ${timeout} seconds.`
          }
        ],
        isError: true
      };
    }

    audit.log('wait_for_message', 'received', {
      from: msg.senderJid,
      chat: msg.chatJid,
      hasMedia: msg.hasMedia
    });

    const lines = [
      `Message received from ${msg.senderName || msg.senderJid}`,
      `Chat: ${msg.chatJid}`,
      `Time: ${new Date(msg.timestamp * 1000).toISOString()}`,
      `Body: ${msg.body || '(no text)'}`,
      `Has media: ${msg.hasMedia ? `yes (${msg.mediaType || 'unknown type'})` : 'no'}`,
      `Message ID: ${msg.id}`
    ];

    return {
      content: [{ type: 'text', text: lines.join('\n') }]
    };
  };

  server.registerTool(
    'wait_for_message',
    {
      description: [
        'Block until an incoming WhatsApp message arrives, then return it.',
        'Use during interactive tests or workflows: tell the user to send a message, call this tool,',
        'and the AI receives the message automatically without the user typing in Cursor.',
        'Optional filters scope the wait to a specific chat or sender.'
      ].join(' '),
      inputSchema: {
        timeout: z
          .number()
          .int()
          .min(1)
          .max(300)
          .default(60)
          .describe('Seconds to wait for a message before timing out (1–300, default 60)'),
        chat: z
          .string()
          .max(200)
          .optional()
          .describe(
            'Only match messages from this chat (contact name, phone number, or JID). Omit to match any chat.'
          ),
        from_phone: z
          .string()
          .max(50)
          .optional()
          .describe('Only match messages from this sender phone number or JID. Omit to match any sender.')
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    wait_for_message_handler as any
  );
}
