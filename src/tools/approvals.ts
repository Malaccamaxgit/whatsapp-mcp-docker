/**
 * Approval Workflow Tools
 *
 * request_approval, check_approvals
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PermissionManager } from '../security/permissions.js';
import type { MessageStore } from '../whatsapp/store.js';
import type { WhatsAppClient } from '../whatsapp/client.js';
import type { AuditLogger } from '../security/audit.js';
import { resolveRecipient } from '../utils/fuzzy-match.js';
import { LIMITS } from '../security/permissions.js';
import { registerTool, type ToolInput, type McpResult } from '../utils/mcp-types.js';

const TZ = process.env.TZ || 'UTC';

function formatTime (ms: number): string {
  return new Date(ms).toLocaleTimeString('en-CA', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, timeZone: TZ
  });
}

function formatDateTime (ms: number): string {
  return new Date(ms).toLocaleString('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, timeZone: TZ
  });
}

export function registerApprovalTools (
  server: McpServer,
  waClient: WhatsAppClient,
  store: MessageStore,
  permissions: PermissionManager,
  audit: AuditLogger
): void {
  // ── request_approval ─────────────────────────────────────────

  const requestApprovalInputSchema = {
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
  };

  const requestApprovalHandler = async ({
    to,
    action,
    details,
    timeout = 300
  }: ToolInput<typeof requestApprovalInputSchema>): Promise<McpResult> => {
    const toolCheck = permissions.isToolEnabled('request_approval');
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

    if (!resolved) {
      if (candidates.length > 0) {
        const list = candidates.map((c) => `  - "${c.name ?? c.jid}" → ${c.jid}`).join('\n');
        return { content: [{ type: 'text', text: `${error ?? 'Ambiguous recipient'}\n\n${list}` }], isError: true };
      }
      return { content: [{ type: 'text', text: error ?? 'Could not resolve recipient' }], isError: true };
    }

    const contactCheck = permissions.canSendTo(resolved);
    if (!contactCheck.allowed) {
      return { content: [{ type: 'text', text: contactCheck.error ?? 'Cannot send to this contact' }], isError: true };
    }

    const rateCheck = permissions.checkRateLimit();
    if (!rateCheck.allowed) {
      return { content: [{ type: 'text', text: rateCheck.error ?? 'Rate limit exceeded' }], isError: true };
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
              'Approval request sent.\n\n' +
              `  Request ID: ${approval.id}\n` +
              `  Action: ${action}\n` +
              `  Sent to: ${resolved}\n` +
              `  Expires: ${expiresAt}\n\n` +
              'Use check_approvals with this Request ID to poll for the response.'
          }
        ]
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error || '');
      audit.log('request_approval', 'failed', { error: errorMsg }, false);
      return {
        content: [{ type: 'text', text: `Failed to send approval request: ${errorMsg}` }],
        isError: true
      };
    }
  };

  registerTool(server, 'request_approval', {
    description: 'Send an approval request to a WhatsApp contact. The recipient can reply APPROVE/YES or DENY/NO. Returns a request ID for tracking status with check_approvals. Use this when an action needs human confirmation before proceeding.',
    inputSchema: requestApprovalInputSchema,
    annotations: { openWorldHint: true, readOnlyHint: false }
  }, requestApprovalHandler);

  // ── check_approvals ──────────────────────────────────────────

  const checkApprovalsInputSchema = {
    request_id: z
      .string()
      .describe('Specific approval request ID to check (omit to list all pending)')
      .optional()
  };

  const checkApprovalsHandler = async ({
    request_id
  }: ToolInput<typeof checkApprovalsInputSchema>): Promise<McpResult> => {
    const toolCheck = permissions.isToolEnabled('check_approvals');
    if (!toolCheck.allowed) {
      return { content: [{ type: 'text', text: toolCheck.error ?? 'Tool disabled' }], isError: true };
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
      text += `  Details: ${approval.details}\n`;
      text += `  Status: ${approval.status.toUpperCase()}\n`;

      if (approval.status === 'approved' || approval.status === 'denied') {
        text += `  Response: ${approval.response_text || '(no message)'}\n`;
        text += `  Responded at: ${formatDateTime(approval.responded_at ?? 0)}`;
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
      return [
        `  - [${a.id}] "${a.action}" → ${a.to_jid} (${remaining}s remaining)`,
        `    Details: ${a.details}`
      ].join('\n');
    });

    return {
      content: [
        {
          type: 'text',
          text: `Pending Approvals (${pending.length}):\n\n${lines.join('\n')}`
        }
      ]
    };
  };

  registerTool(server, 'check_approvals', {
    description: 'Check the status of approval requests. Provide a request ID to check a specific approval, or omit it to list all pending approvals with their status and remaining time.',
    inputSchema: checkApprovalsInputSchema,
    annotations: { readOnlyHint: true }
  }, checkApprovalsHandler);
}
