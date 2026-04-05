/**
 * Authentication Tool
 *
 * Pairing-code-based authentication for terminal CLI environments.
 * Returns a simple 8-digit code the user enters in WhatsApp mobile.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PermissionManager } from '../security/permissions.js';
import type { WhatsAppClient } from '../whatsapp/client.js';
import type { AuditLogger } from '../security/audit.js';
import { validatePhoneNumber } from '../utils/phone.js';

// Union type for content that can be either text or image
interface TextContent {
  type: 'text';
  text: string;
}

interface ImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

type McpContent = TextContent | ImageContent;

const DEFAULT_POLL_MS = 5000;
const DEFAULT_LINK_TIMEOUT_SEC = 120;

/** Profile/env defaults (Docker MCP → AUTH_*). AUTH_WAIT_FOR_LINK defaults false (safe for Cursor/long-lived MCP clients). */
function authEnvWaitForLink (): boolean {
  const v = process.env.AUTH_WAIT_FOR_LINK;
  if (v === undefined || v === null || String(v).trim() === '') {return false;}
  const s = String(v).trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes' || s === 'on') {return true;}
  return false;
}

function authEnvLinkTimeoutSec (): number {
  const n = parseInt(process.env.AUTH_LINK_TIMEOUT_SEC || String(DEFAULT_LINK_TIMEOUT_SEC), 10);
  if (Number.isNaN(n)) {return DEFAULT_LINK_TIMEOUT_SEC;}
  return Math.min(600, Math.max(15, n));
}

function authEnvPollIntervalSec (): number {
  const n = parseInt(process.env.AUTH_POLL_INTERVAL_SEC || '5', 10);
  if (Number.isNaN(n)) {return 5;}
  return Math.min(60, Math.max(2, n));
}

interface WaitResult {
  ok: boolean;
  jid?: string;
  elapsedSec: number;
}

/**
 * Poll until WhatsApp reports connected or timeout. Logs progress to stderr every interval.
 */
async function waitForDeviceLink (
  waClient: WhatsAppClient,
  { pollIntervalMs = DEFAULT_POLL_MS, timeoutSec = DEFAULT_LINK_TIMEOUT_SEC } = {}
): Promise<WaitResult> {
  const start = Date.now();
  const deadline = start + timeoutSec * 1000;
  let checkNumber = 0;
  while (Date.now() < deadline) {
    if (waClient.isConnected()) {
      const elapsedSec = Math.round((Date.now() - start) / 1000);
      return { ok: true, jid: waClient.jid ?? undefined, elapsedSec };
    }
    const remaining = deadline - Date.now();
    const sleepMs = Math.min(pollIntervalMs, Math.max(0, remaining));
    if (sleepMs <= 0) {break;}
    await new Promise((r) => setTimeout(r, sleepMs));
    checkNumber += 1;
    const elapsed = Math.round((Date.now() - start) / 1000);
    console.error(
      `[AUTH] Waiting for device link... ${elapsed}s elapsed (check #${checkNumber}, every ${pollIntervalMs / 1000}s)`
    );
  }
  const elapsedSec = Math.round((Date.now() - start) / 1000);
  return { ok: false, elapsedSec };
}

function appendWaitResult (text: string, wait: WaitResult): string {
  if (wait.ok) {
    return `${text}\n\n**Linked successfully** as ${wait.jid} (detected after ${wait.elapsedSec}s; polled every few seconds).`;
  }
  return (
    `${text}\n\n**No link detected** within ${wait.elapsedSec}s. If you are still linking, call authenticate again. ` +
    'For QR codes, they expire in ~20s — request a fresh one. To skip waiting next time, pass waitForLink: false.'
  );
}

interface DisconnectResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

interface AuthenticateResult {
  content: McpContent[];
  isError?: boolean;
}


function createDisconnectHandler (
  waClient: WhatsAppClient,
  permissions: PermissionManager,
  audit: AuditLogger
) {
  return async (): Promise<DisconnectResult> => {
    const toolCheck = permissions.isToolEnabled('disconnect');
    if (!toolCheck.allowed) {
      return { content: [{ type: 'text', text: toolCheck.error ?? 'Tool disabled' }], isError: true };
    }

    if (!waClient.isConnected() && !waClient.hasSession) {
      return {
        content: [
          {
            type: 'text',
            text: 'Not currently authenticated. No session to disconnect.'
          }
        ]
      };
    }

    try {
      const previousJid = waClient.jid;
      await waClient.logout();

      audit.log('disconnect', 'logged_out', { jid: previousJid }, true);

      return {
        content: [
          {
            type: 'text',
            text: previousJid
              ? `Successfully disconnected from WhatsApp (${previousJid}).\n\nThe session has been cleared. Call authenticate with a phone number to link a device again.`
              : 'Successfully disconnected from WhatsApp.\n\nThe session has been cleared. Call authenticate with a phone number to link a device again.'
          }
        ]
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error || '');
      audit.log('disconnect', 'logout_failed', { error: errorMsg }, false);
      return {
        content: [
          {
            type: 'text',
            text: `Failed to disconnect: ${errorMsg}`
          }
        ],
        isError: true
      };
    }
  };
}

function createAuthenticateHandler (
  waClient: WhatsAppClient,
  permissions: PermissionManager,
  audit: AuditLogger
) {
  return async ({
    phoneNumber,
    waitForLink,
    linkTimeoutSec,
    pollIntervalSec,
    force
  }: {
    phoneNumber?: string;
    waitForLink?: boolean;
    linkTimeoutSec?: number;
    pollIntervalSec?: number;
    force?: boolean;
  }): Promise<AuthenticateResult> => {
    const toolCheck = permissions.isToolEnabled('authenticate');
    if (!toolCheck.allowed) {
      return { content: [{ type: 'text', text: toolCheck.error ?? 'Tool disabled' }], isError: true };
    }
    // When force is requested but isConnected() still reports true, we still
    // proceed — requestPairingCode handles the force flag internally.
    if (waClient.isConnected() && !force) {
      permissions.resetAuthBackoff();
      return {
        content: [
          {
            type: 'text',
            text: `Already authenticated and connected as ${waClient.jid}.\nNo further action needed — you can send messages and use all tools.`
          }
        ]
      };
    }

    // When force is true but probe verification failed, report the issue and proceed
    if (force && waClient.isConnected() === false) {
      const probe = waClient.getProbeStatus();
      if (probe.lastError) {
        console.error('[AUTH] Force re-pairing requested — WebSocket probe failed:', probe.lastError);
      }
    }

    // If a session exists on disk but the connection is currently down (e.g. after
    // AUTO_CONNECT_ON_STARTUP=false or a transient disconnect), attempt to reconnect
    // using the existing session rather than requiring a new pairing code.
    if (!phoneNumber && waClient.hasSession) {
      console.error('[AUTH] Session exists but not connected — attempting reconnect');
      try {
        const reconnectResult = await waClient.reconnect();
        if (reconnectResult.connected) {
          permissions.resetAuthBackoff();
          return {
            content: [
              {
                type: 'text',
                text:
                  `Reconnected to existing session as ${reconnectResult.jid}.\n` +
                  'No further action needed — you can send messages and use all tools.'
              }
            ]
          };
        }
      } catch (err) {
        const errMessage = err instanceof Error ? err.message : String(err || '');
        console.error('[AUTH] Reconnect attempt failed:', errMessage);
      }
      // Reconnect failed — session may be stale; prompt for phone number
      const knownJid = waClient.jid;
      return {
        content: [
          {
            type: 'text',
            text:
              `A session exists${knownJid ? ` for ${knownJid}` : ''} but could not reconnect automatically.\n\n` +
              'The session may have expired or been revoked. To re-authenticate:\n' +
              '  Call authenticate with your phone number to link this device again.\n\n' +
              'Format: "+" followed by country code and number (E.164).\n' +
              'Example: authenticate({ phoneNumber: "+15145551234" })'
          }
        ]
      };
    }

    if (!phoneNumber) {
      return {
        content: [
          {
            type: 'text',
            text:
              'Phone number is required for first-time authentication.\n\n' +
              'Format: international E.164 — "+" followed by country code and number.\n' +
              'No spaces, dashes, or parentheses.\n\n' +
              'Examples:\n' +
              '  +15145551234     (Canada: country code 1)\n' +
              '  +353871234567    (Ireland: country code 353)\n' +
              '  +33612345678     (France: country code 33)\n' +
              '  +491711234567    (Germany: country code 49)\n\n' +
              'Common mistakes to avoid:\n' +
              '  0612345678       — missing country code (should be +33612345678)\n' +
              '  (514) 555-1234   — local format (should be +15145551234)\n' +
              '  00447911123456   — use "+" not "00" prefix\n\n' +
              'Ask the user for their phone number in this format, then call:\n' +
              '  authenticate({ phoneNumber: "+..." })'
          }
        ],
        isError: true
      };
    }

    const validation = validatePhoneNumber(phoneNumber);
    if (!validation.valid) {
      return {
        content: [
          {
            type: 'text',
            text:
              `Invalid phone number: ${validation.error}\n\n` +
              'Required format: "+" followed by country code and number (E.164).\n' +
              'Examples: +15145551234 (Canada), +353871234567 (Ireland), +33612345678 (France)'
          }
        ],
        isError: true
      };
    }

    // TODO: Add country-code-specific length validation to catch unusual formats
    // (e.g., +1 numbers should be 10 digits, +33 should be 9 digits, etc.)
    // Current validation allows 7-15 digits which may accept invalid numbers.
    // See: https://en.wikipedia.org/wiki/E.164#Country_codes_and_maximum_lengths

    const authRate = permissions.checkAuthRateLimit();
    if (!authRate.allowed) {
      audit.log('authenticate', 'rate_limited', { retryAfterSec: authRate.retryAfterSec }, false);
      return {
        content: [{ type: 'text', text: authRate.error ?? 'Rate limit exceeded' }],
        isError: true
      };
    }

    // Only true/false from the tool override profile env; null/undefined/omitted → AUTH_WAIT_FOR_LINK (default true).
    const shouldWait =
      waitForLink === true || waitForLink === false ? waitForLink : authEnvWaitForLink();
    const resolvedPollSec = pollIntervalSec ?? authEnvPollIntervalSec();
    const resolvedTimeoutSec = linkTimeoutSec ?? authEnvLinkTimeoutSec();
    const waitOpts = {
      pollIntervalMs: Math.round(resolvedPollSec * 1000),
      timeoutSec: resolvedTimeoutSec
    };

    try {
      const result = await waClient.requestPairingCode(validation.number!, force ?? false);

      if (result.alreadyConnected) {
        permissions.recordAuthAttempt(true);
        return {
          content: [
            {
              type: 'text',
              text: `Already connected as ${result.jid}.`
            }
          ]
        };
      }

      // At this point, alreadyConnected === false, so result has either code or qrCode/qrImageBase64
      if ('qrCode' in result && result.qrCode) {
        permissions.recordAuthAttempt(true);
        audit.log('authenticate', 'qr_fallback', { number: validation.number });

        const content: McpContent[] = [];
        if (result.qrImageBase64) {
          content.push({
            type: 'image',
            data: result.qrImageBase64,
            mimeType: 'image/png'
          });
        }

        content.push({
          type: 'text',
          text:
            'Scan this QR code with WhatsApp > Linked Devices > Link a Device.\n\n' +
            'QR codes expire in ~20 seconds. If the code has expired, call authenticate again for a fresh one.\n' +
            'Once linked, the session persists across container restarts.\n\n' +
            'Note: QR mode returns immediately — use get_connection_status to check if the scan succeeded.\n\n' +
            'Terminal Mode: Open this URL in your browser to view the QR code:\n' +
            `data:image/png;base64,${result.qrImageBase64}`
        });

        return { content };
      }

      permissions.recordAuthAttempt(true);
      audit.log('authenticate', 'pairing_code_requested', { number: validation.number });

      const backoffNote =
        permissions.authBackoffSec > 0
          ? `\n\nNote: If this code expires unused, you can retry after ${permissions.authBackoffSec}s cooldown.`
          : '';

      // At this point, we know it's the { code, waitForConnection } variant
      const codeResult = result as { code: string; waitForConnection: unknown };

      let pairText =
        `Your pairing code is: ${codeResult.code}\n\n` +
        'To link this device:\n' +
        '1. Open WhatsApp on your phone\n' +
        '2. Go to Settings > Linked Devices\n' +
        '3. Tap "Link a Device"\n' +
        '4. Tap "Link with phone number instead"\n' +
        `5. Enter the code: ${codeResult.code}\n\n` +
        'The code expires in 60 seconds. Once linked, the session persists across restarts.' +
        backoffNote +
        (shouldWait
          ? `\n\nWaiting up to ${waitOpts.timeoutSec}s, checking every ${waitOpts.pollIntervalMs / 1000}s — ` +
            'this response will confirm when your device is linked.'
          : '');

      if (shouldWait) {
        const wait = await waitForDeviceLink(waClient, waitOpts);
        audit.log(
          'authenticate',
          wait.ok ? 'link_detected' : 'link_wait_timeout',
          {
            mode: 'pairing',
            elapsedSec: wait.elapsedSec
          },
          wait.ok
        );
        pairText = appendWaitResult(pairText, wait);
      }

      return {
        content: [{ type: 'text', text: pairText }]
      };
    } catch (error) {
      permissions.recordAuthAttempt(false);
      const nextRetry = permissions.authBackoffSec;
      audit.log(
        'authenticate',
        'pairing_failed',
        {
          error: error instanceof Error ? error.message : String(error || ''),
          nextRetrySec: nextRetry
        },
        false
      );
      return {
        content: [
          {
            type: 'text',
            text:
              `Authentication failed: ${error instanceof Error ? error.message : String(error || '')}\n\n` +
              `Next retry available in ${nextRetry} seconds. ` +
              '(Backoff increases automatically to avoid WhatsApp rate limits.)'
          }
        ],
        isError: true
      };
    }
  };
}

export function registerAuthTools (
  server: McpServer,
  waClient: WhatsAppClient,
  permissions: PermissionManager,
  audit: AuditLogger
): void {
  server.registerTool(
    'disconnect',
    {
      description: 'Log out and disconnect from WhatsApp. This clears the session and requires re-authentication. Use this when you want to unlink the current device or switch to a different WhatsApp account.',
      inputSchema: {},
      annotations: { idempotentHint: false, readOnlyHint: false }
    },

    createDisconnectHandler(waClient, permissions, audit) as any
  );

  server.registerTool(
    'authenticate',
    {
      description: 'Link this device to WhatsApp. Returns an 8-digit pairing code or a QR code. By default, waits and polls until the device links or a timeout, then appends success or failure to the same response. Defaults for waitForLink, linkTimeoutSec, and pollIntervalSec come from Docker MCP Toolkit profile (whatsapp-mcp-docker.auth_* config → AUTH_* env) when arguments are omitted; pass explicit tool arguments to override per call.',
      inputSchema: {
        phoneNumber: z
          .string()
          .describe(
            'Phone number in international E.164 format: "+" followed by country code and number, no spaces or dashes. ' +
              'Examples: "+15145551234" (Canada), "+353871234567" (Ireland), "+33612345678" (France), "+491711234567" (Germany). ' +
              'The country code is mandatory — do NOT use local formats like "06..." or "(514) 555-1234".'
          )
          .optional(),
        waitForLink: z
          .boolean()
          .optional()
          .describe(
            'If true, after showing pairing code or QR, poll until connected or timeout. If false, return immediately. Omit to use profile default (auth_wait_for_link / AUTH_WAIT_FOR_LINK).'
          ),
        linkTimeoutSec: z
          .number()
          .min(15)
          .max(600)
          .optional()
          .describe(
            'Max seconds to wait when waiting (15–600). Omit to use profile default (auth_link_timeout_sec / AUTH_LINK_TIMEOUT_SEC).'
          ),
        pollIntervalSec: z
          .number()
          .min(2)
          .max(60)
          .optional()
          .describe(
            'Seconds between connection checks (2–60). Omit to use profile default (auth_poll_interval_sec / AUTH_POLL_INTERVAL_SEC).'
          ),
        force: z
          .boolean()
          .optional()
          .describe(
            'Force re-pairing even when the server reports being connected. Use this when the connection is broken but isConnected() falsely returns true.'
          )
      },
      annotations: { idempotentHint: true, readOnlyHint: false }
    },

    createAuthenticateHandler(waClient, permissions, audit) as any
  );
}
