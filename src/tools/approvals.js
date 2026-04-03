/**
 * Approval Workflow Tools
 *
 * request_approval, check_approvals
 */

import { z } from 'zod';
import { resolveRecipient } from '../utils/fuzzy-match.js';
import { LIMITS } from '../security/permissions.js';

const TZ = process.env.TZ || 'UTC';

function formatTime(ms) {
  return new Date(ms).toLocaleTimeString('en-CA', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, timeZone: TZ
  });
}

function formatDateTime(ms) {
  return new Date(ms).toLocaleString('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, timeZone: TZ
  });
}

export function registerApprovalTools(server, waClient, store, permissions, audit) {
  // ── request_approval ─────────────────────────────────────────

  server.tool(
    'request_approval',
    'Send an approval request to a WhatsApp contact. The recipient can reply APPROVE/YES or DENY/NO. Returns a request ID for tracking status with check_approvals. Use this when an action needs human confirmation before proceeding.',
    {
      to: z.string().max(200).describe('Recipient: contact name, phone number, or JID'),
      action: z
        .string()
        .max(LIMITS.MAX_APPROVAL_ACTION_LENGTH)
        .describe('What needs approval (e.g. "Deploy to production", "Delete user account")'),
      details: z
        .string()
        .max(LIMITS.MAX_APPROVAL_DETAILS_LENGTH)
        .describe('Context and details about the action'),
      timeout: z
        .number()
        .min(10)
        .max(3600)
        .default(300)
        .describe('Timeout in seconds before the request expires (10–3600, default 300)')
        .optional()
    },
    async ({ to, action, details, timeout = 300 }) => {
      const toolCheck = permissions.isToolEnabled('request_approval');
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

      if (!resolved) {
        if (candidates.length > 0) {
          const list = candidates.map((c) => `  - "${c.name}" → ${c.jid}`).join('\n');
          return { content: [{ type: 'text', text: `${error}\n\n${list}` }], isError: true };
        }
        return { content: [{ type: 'text', text: error }], isError: true };
      }

      const contactCheck = permissions.canSendTo(resolved);
      if (!contactCheck.allowed) {
        return { content: [{ type: 'text', text: contactCheck.error }], isError: true };
      }

      const rateCheck = permissions.checkRateLimit();
      if (!rateCheck.allowed) {
        return { content: [{ type: 'text', text: rateCheck.error }], isError: true };
      }

      try {
        const approval = store.createApproval({
          toJid: resolved,
          action,
          details,
          timeoutMs: timeout * 1000
        });

        const expiresAt = formatTime(approval.created_at + approval.timeout_ms);

        const message = [
          '*APPROVAL REQUEST*',
          '',
          `*Action:* ${action}`,
          `*Details:* ${details}`,
          '',
          '*Reply with:*',
          '- "APPROVE" or "YES" to confirm',
          '- "DENY" or "NO" to reject',
          '',
          `*Request ID:* ${approval.id}`,
          `*Expires:* ${expiresAt}`
        ].join('\n');

        await waClient.sendMessage(resolved, message);
        audit.log('request_approval', 'sent', { to: resolved, action, id: approval.id });

        return {
          content: [
            {
              type: 'text',
              text:
                `Approval request sent.\n\n` +
                `  Request ID: ${approval.id}\n` +
                `  Action: ${action}\n` +
                `  Sent to: ${resolved}\n` +
                `  Expires: ${expiresAt}\n\n` +
                `Use check_approvals with this Request ID to poll for the response.`
            }
          ]
        };
      } catch (error) {
        audit.log('request_approval', 'failed', { error: error.message }, false);
        return {
          content: [{ type: 'text', text: `Failed to send approval request: ${error.message}` }],
          isError: true
        };
      }
    },
    { annotations: { openWorldHint: true, readOnlyHint: false } }
  );

  // ── check_approvals ──────────────────────────────────────────

  server.tool(
    'check_approvals',
    'Check the status of approval requests. Provide a request ID to check a specific approval, or omit it to list all pending approvals with their status and remaining time.',
    {
      request_id: z
        .string()
        .describe('Specific approval request ID to check (omit to list all pending)')
        .optional()
    },
    async ({ request_id }) => {
      const toolCheck = permissions.isToolEnabled('check_approvals');
      if (!toolCheck.allowed) {
        return { content: [{ type: 'text', text: toolCheck.error }], isError: true };
      }

      if (request_id) {
        const approval = store.getApproval(request_id);

        if (!approval) {
          return {
            content: [{ type: 'text', text: `Approval request "${request_id}" not found.` }],
            isError: true
          };
        }

        let text = `Approval: ${request_id}\n\n`;
        text += `  Action: ${approval.action}\n`;
        text += `  Status: ${approval.status.toUpperCase()}\n`;

        if (approval.status === 'approved' || approval.status === 'denied') {
          text += `  Response: ${approval.response_text || '(no message)'}\n`;
          text += `  Responded at: ${formatDateTime(approval.responded_at)}`;
        } else if (approval.status === 'expired') {
          text += `  Expired at: ${formatDateTime(approval.created_at + approval.timeout_ms)}`;
        } else {
          const remaining = Math.max(
            0,
            Math.round((approval.created_at + approval.timeout_ms - Date.now()) / 1000)
          );
          text += `  Time remaining: ${remaining} seconds`;
        }

        return { content: [{ type: 'text', text }] };
      }

      // List all pending
      const pending = store.getPendingApprovals();

      if (pending.length === 0) {
        return { content: [{ type: 'text', text: 'No pending approval requests.' }] };
      }

      const lines = pending.map((a) => {
        const remaining = Math.max(
          0,
          Math.round((a.created_at + a.timeout_ms - Date.now()) / 1000)
        );
        return `  - [${a.id}] "${a.action}" → ${a.to_jid} (${remaining}s remaining)`;
      });

      return {
        content: [
          {
            type: 'text',
            text: `Pending Approvals (${pending.length}):\n\n${lines.join('\n')}`
          }
        ]
      };
    },
    { annotations: { readOnlyHint: true } }
  );
}
