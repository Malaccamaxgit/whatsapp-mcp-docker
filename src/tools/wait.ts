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
import { formatTimestamp } from '../utils/timezone.js';

interface MessageWaiter {
  filter: (msg: StoredMessage) => boolean;
  resolve: (result: StoredMessage | null) => void;
}

export function registerWaitTools (
  server: McpServer,
  waClient: WhatsAppClient,
  store: MessageStore,
  permissions: PermissionManager,
  audit: AuditLogger
): void {
  const wait_for_message_handler = async ({ timeout, chat, from_phone }: { timeout: number; chat?: string; from_phone?: string }) => {
    const toolCheck = permissions.isToolEnabled('wait_for_message');
    if (!toolCheck.allowed) {
      return {
        content: [{ type: 'text', text: toolCheck.error ?? 'Tool disabled' }],
        isError: true
      };
    }

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
      if (chatJidFilter && chatJidFilter.includes('@')) {
        const readCheck = permissions.canReadFrom(chatJidFilter);
        if (!readCheck.allowed) {
          return {
            content: [{ type: 'text', text: readCheck.error ?? 'Read access denied' }],
            isError: true
          };
        }
      }
    }

    let senderFilter: string | null = null;
    if (from_phone) {
      const digits = from_phone.replace(/[^0-9]/g, '');
      senderFilter = digits ? digits : from_phone;
    }

    const filter = (msg: StoredMessage): boolean => {
      if (chatJidFilter && msg.chatJid !== chatJidFilter) {return false;}
      if (senderFilter) {
        const jid = msg.senderJid || msg.chatJid || '';
        if (!jid.includes(senderFilter)) {return false;}
      }
      return true;
    };

    const timeoutMs = timeout * 1000;

    // TODO: Investigate timeout issue when chat filter uses @lid JIDs
    // Issue observed: wait_for_message with chat="44612043436101@lid" timed out even though
    // messages were arriving from that exact JID. Possible causes:
    //
    // 1. JID mismatch: The filter compares msg.chatJid !== chatJidFilter, but the incoming
    //    message may have a different JID format (e.g., with/without @lid suffix, or
    //    normalized differently in the store vs the raw event).
    //
    // 2. Timing issue: The waiter is added AFTER the message arrives, causing a race
    //    condition. The message was received at 20:48:14, but the waiter may have been
    //    registered after that timestamp.
    //
    // 3. Filter logic: The chat parameter resolution at lines 36-49 may not correctly
    //    handle @lid JIDs. The fuzzy match logic looks for exact JID match first, but
    //    @lid JIDs may be stored differently in getAllChatsForMatching().
    //
    // 4. Waiver removal: Line 74 splices the waiter on timeout, but if the message
    //    arrives between the timeout check and splice, the waiter may be removed
    //    before _notifyMessageWaiters() can resolve it.
    //
    // Debug steps:
    // - Add DEBUG logging to show the filter JID vs actual msg.chatJid for each incoming message
    // - Log when waiters are added/removed with their filter criteria
    // - Compare the chat JID format in the store vs the raw message event
    // - Test with and without the chat filter to isolate the issue
    //
    // Workaround: Use wait_for_message without the chat filter (any message), then
    // filter the result manually. Or use a shorter timeout and retry.

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

      // TODO: Investigate timeout issues with wait_for_message
      //
      // Reported issue (2026-04-04): Tool returned "Error: Aborted" after showing
      // "Running Wait For Message in MCP_DOCKER" with correct parameters:
      //   - chat: 44612043436101@lid
      //   - timeout: 300
      //
      // The previous message from this chat (Séverine Godet) was received successfully
      // at 20:48:14, but the subsequent wait timed out even though the user confirmed
      // they wanted to continue waiting.
      //
      // Possible causes to investigate:
      //
      // 1. **Cursor MCP Gateway timeout**: The MCP client (Cursor) may have a tool-call
      //    timeout that fires before the wait_for_message tool completes. Even though
      //    timeout=300s was set, Cursor or the Docker MCP Gateway might have a shorter
      //    internal timeout (e.g., 60-120s) that aborts the tool call.
      //
      // 2. **Waiter registration race condition**: The message waiter may not be
      //    properly registered before messages arrive. Check if there's a gap between
      //    when addMessageWaiter() is called and when _handleIncomingMessage() starts
      //    dispatching to waiters.
      //
      // 3. **Chat JID filter mismatch**: The filter uses exact JID match
      //    (msg.chatJid !== chatJidFilter). If the incoming message has a different
      //    JID format (e.g., @lid vs @s.whatsapp.net, or participant vs sender),
      //    the filter would reject it even though it's from the same conversation.
      //
      // 4. **Aborted by user action**: The "Error: Aborted" message suggests the tool
      //    call was cancelled externally (user stopped it, Cursor reloaded, gateway
      //    restarted) rather than a natural timeout. Check MCP Gateway logs for
      //    cancellation events.
      //
      // 5. **Message already consumed**: If another tool (e.g., catch_up,
      //    request_approval listener) consumed the message before wait_for_message
      //    could process it, the waiter would timeout.
      //
      // Debug steps:
      // - Add DEBUG=wait logging to trace waiter registration and message dispatch
      // - Check Docker MCP Gateway logs for tool call cancellation reasons
      // - Log the filter parameters and incoming message JIDs to verify matching
      // - Test with timeout=60 (default) vs timeout=300 to see if longer waits fail
      //
      // Related: docs/bugs/BUG-self-account-messages-not-received.md (event handling)

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
      `Time: ${formatTimestamp(msg.timestamp)}`,
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

    wait_for_message_handler as any
  );
}
