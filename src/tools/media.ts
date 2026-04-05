/**
 * Media Tools
 *
 * download_media, send_file
 */

import { z } from 'zod';
import { stat } from 'node:fs/promises';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { resolveRecipient } from '../utils/fuzzy-match.js';
import { toJid } from '../utils/phone.js';
import { LIMITS, type PermissionManager } from '../security/permissions.js';
import type { WhatsAppClient } from '../whatsapp/client.js';
import type { MessageStore } from '../whatsapp/store.js';
import type { AuditLogger } from '../security/audit.js';
import {
  validateUploadPath,
  checkExtension,
  verifyMagicBytes,
  checkMediaQuota
} from '../security/file-guard.js';

export function registerMediaTools (
  server: McpServer,
  waClient: WhatsAppClient,
  store: MessageStore,
  permissions: PermissionManager,
  audit: AuditLogger
) {
  server.registerTool(
    'download_media',
    {
      description: 'Download media (image, video, audio, document) from a WhatsApp message. Provide the message ID and chat identifier. The media is saved to persistent storage and the local file path is returned. Only works for messages that have media metadata stored.',
      inputSchema: {
        message_id: z
          .string()
          .max(200)
          .describe('The message ID containing media (shown in list_messages output)'),
        chat: z
          .string()
          .max(200)
          .describe('The chat name, phone number, or JID where the message is from')
          .optional()
      },
      annotations: { readOnlyHint: false, openWorldHint: true }
    },

    async ({ message_id, chat: _chat }: any) => {
      const toolCheck = permissions.isToolEnabled('download_media');
      if (!toolCheck.allowed) {
        return { content: [{ type: 'text', text: toolCheck.error ?? 'Tool disabled' }], isError: true };
      }

      if (!(waClient as { isConnected: () => boolean }).isConnected()) {
        return {
          content: [
            { type: 'text', text: 'WhatsApp not connected. Use the authenticate tool first.' }
          ],
          isError: true
        };
      }

      const dlRate = permissions.checkDownloadRateLimit();
      if (!dlRate.allowed) {
        return { content: [{ type: 'text', text: dlRate.error ?? 'Download rate limit exceeded' }], isError: true };
      }

      const storePath = process.env.STORE_PATH || '/data/store';
      const quota = await checkMediaQuota(`${storePath}/media`, LIMITS.MEDIA_QUOTA_BYTES);
      if (!quota.allowed) {
        audit.log(
          'download_media',
          'quota_exceeded',
          { currentMB: quota.currentMB, limitMB: quota.limitMB },
          false
        );
        return { content: [{ type: 'text', text: quota.error ?? 'Media quota exceeded' }], isError: true };
      }

      try {
        const result = await (waClient as { downloadMedia: (messageId: string) => Promise<{ mediaType: string; path: string; chatJid: string }> }).downloadMedia(message_id);
        audit.log('download_media', 'downloaded', {
          messageId: message_id,
          mediaType: result.mediaType,
          path: result.path
        });

        return {
          content: [
            {
              type: 'text',
              text:
                'Media downloaded successfully.\n' +
                `  Type: ${result.mediaType}\n` +
                `  Path: ${result.path}\n` +
                `  Chat: ${result.chatJid}`
            }
          ]
        };
      } catch (error) {
        audit.log(
          'download_media',
          'failed',
          { messageId: message_id, error: (error as Error).message },
          false
        );
        return {
          content: [{ type: 'text', text: `Failed to download media: ${(error as Error).message}` }],
          isError: true
        };
      }
    }
  );

  server.registerTool(
    'send_file',
    {
      description: 'Send a media file (image, video, audio, document) via WhatsApp. The file must exist at the specified path inside the container. Supports fuzzy matching on recipient names. For audio files, they are sent as voice messages.',
      inputSchema: {
        to: z
          .string()
          .max(200)
          .describe('Recipient: contact name, group name, phone number (e.g. +1234567890), or JID'),
        file_path: z
          .string()
          .max(500)
          .describe('Absolute path to the file to send (must be accessible inside the container)'),
        media_type: z
          .enum(['image', 'video', 'audio', 'document'])
          .describe('Type of media being sent'),
        caption: z
          .string()
          .max(LIMITS.MAX_CAPTION_LENGTH)
          .describe(
            `Optional caption/message to include with the media (max ${LIMITS.MAX_CAPTION_LENGTH} chars)`
          )
          .optional()
      },
      annotations: { destructiveHint: false, openWorldHint: true }
    },

    async ({ to, file_path, media_type, caption }: any) => {
      const toolCheck = permissions.isToolEnabled('send_file');
      if (!toolCheck.allowed) {
        return { content: [{ type: 'text', text: toolCheck.error ?? 'Tool disabled' }], isError: true };
      }

      if (!(waClient as { isConnected: () => boolean }).isConnected()) {
        return {
          content: [
            { type: 'text', text: 'WhatsApp not connected. Use the authenticate tool first.' }
          ],
          isError: true
        };
      }

      try {
        validateUploadPath(file_path, (LIMITS as Record<string, unknown>).UPLOAD_ALLOWED_DIRS as string[]);
      } catch (err) {
        audit.log('send_file', 'path_denied', { path: file_path, error: (err as Error).message }, false);
        return { content: [{ type: 'text', text: (err as Error).message }], isError: true };
      }

      const extCheck = checkExtension(file_path);
      if (extCheck.dangerous) {
        audit.log(
          'send_file',
          'dangerous_ext',
          { path: file_path, ext: extCheck.extension },
          false
        );
        return { content: [{ type: 'text', text: extCheck.warning! }], isError: true };
      }

      try {
        const fileStat = await stat(file_path);
        if (fileStat.size > LIMITS.MAX_FILE_SIZE_BYTES) {
          const sizeMB = Math.round(fileStat.size / 1024 / 1024);
          const limitMB = Math.round(LIMITS.MAX_FILE_SIZE_BYTES / 1024 / 1024);
          return {
            content: [
              {
                type: 'text',
                text: `File too large (${sizeMB} MB). Maximum allowed: ${limitMB} MB.`
              }
            ],
            isError: true
          };
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Cannot access file: ${(err as Error).message}` }],
          isError: true
        };
      }

      const magicCheck = await verifyMagicBytes(file_path, media_type);
      if (!magicCheck.valid && magicCheck.warning) {
        audit.log(
          'send_file',
          'type_mismatch',
          { path: file_path, warning: magicCheck.warning },
          false
        );
        return {
          content: [{ type: 'text', text: `File type verification failed: ${magicCheck.warning}` }],
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
              text: `${error || 'Ambiguous recipient'}\n\n${list}\n\nCall send_file again with the exact JID.`
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
        const result = await (waClient as { uploadAndSendMedia: (jid: string, path: string, type: string, caption: string) => Promise<{ id: string; timestamp: number }> }).uploadAndSendMedia(jid, file_path, media_type, caption ?? '');
        audit.log('send_file', 'sent', { to: jid, mediaType: media_type, messageId: result.id });

        const chatName = store.getChatByJid(jid)?.name ?? to;
        const sentAt = new Date(result.timestamp).toLocaleString('en-CA', {
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
          hour12: false, timeZone: process.env.TZ || 'UTC'
        });
        return {
          content: [
            {
              type: 'text',
              text: `${media_type} sent to ${chatName} (${jid}).\nMessage ID: ${result.id}\nSent at: ${sentAt}`
            }
          ]
        };
      } catch (error) {
        audit.log(
          'send_file',
          'failed',
          { to: jid, mediaType: media_type, error: (error as Error).message },
          false
        );
        return {
          content: [{ type: 'text', text: `Failed to send file: ${(error as Error).message}` }],
          isError: true
        };
      }
    }
  );
}
