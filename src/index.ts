/**
 * WhatsApp MCP Server
 *
 * Entry point — wires the WhatsApp client, SQLite store, security layer,
 * and 15 MCP tools together. Runs on stdio transport for Docker MCP Toolkit.
 *
 * Tools: disconnect, authenticate, get_connection_status,
 *        send_message, send_file, download_media,
 *        list_chats, list_messages, search_messages,
 *        search_contacts, catch_up, mark_messages_read,
 *        export_chat_data, request_approval, check_approvals
 */

import { readFileSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WhatsAppClient } from './whatsapp/client.js';
import { MessageStore } from './whatsapp/store.js';
import { AuditLogger } from './security/audit.js';
import { PermissionManager } from './security/permissions.js';
import { initEncryption, isEncryptionEnabled } from './security/crypto.js';
import { createServer } from './server.js';

interface PackageJson {
  version: string;
}

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as PackageJson;
const STORE_PATH = process.env.STORE_PATH || '/data/store';

initEncryption(process.env.DATA_ENCRYPTION_KEY ?? '');

const store = new MessageStore(`${STORE_PATH}/messages.db`);
const permissions = new PermissionManager();

// Audit logger created without alert callback initially
const audit = new AuditLogger();

const waClient = new WhatsAppClient({
  storePath: STORE_PATH,
  messageStore: store,
  onConnected: () => {
    permissions.resetAuthBackoff();
  },
  onDisconnected: ({ reason, permanent }) => {
    const msg = permanent
      ? `WhatsApp session ended (${reason}). Call the authenticate tool to re-link.`
      : `WhatsApp temporarily disconnected (${reason}). Reconnection was attempted but failed.`;
    console.error(`[WA] onDisconnected: ${msg}`);
    audit.log(
      'connection',
      permanent ? 'session_ended' : 'disconnected',
      { reason, permanent },
      false
    );
    try {
      mcpServer.server.notification({
        method: 'notifications/disconnected',
        params: { reason, permanent, message: msg }
      });
    } catch {
      /* best-effort */
    }
  },
  onMessage: () => {},
  config: {
    SEND_READ_RECEIPTS: process.env.SEND_READ_RECEIPTS,
    AUTO_READ_RECEIPTS: process.env.AUTO_READ_RECEIPTS,
    PRESENCE_MODE: process.env.PRESENCE_MODE
  }
});

const { mcpServer } = createServer({
  version: pkg.version,
  waClient,
  store,
  audit,
  permissions,
  storePath: STORE_PATH
});

// Wire up audit alert callback after mcpServer is available
audit.setAlertCallback((alert) => {
  try {
    mcpServer.server.notification({
      method: 'notifications/audit_failure',
      params: alert
    });
  } catch {
    // Best-effort; alert already logged to stderr
  }
});

waClient.onMessage = (msg) => {
  const preview = msg.body?.substring(0, 60) || (msg.hasMedia ? `[${msg.mediaType || 'media'}]` : '');
  console.error('[MSG]', msg.senderName || msg.senderJid, ':', preview);
  try {
    mcpServer.sendLoggingMessage({
      level: 'info',
      data: `Message from ${msg.senderName || msg.senderJid}: ${preview}`
    });
  } catch {
    /* best-effort */
  }
  try {
    mcpServer.server.notification({
      method: 'notifications/message_received',
      params: {
        messageId: msg.id,
        from: msg.chatJid,
        senderName: msg.senderName,
        timestamp: msg.timestamp
      }
    });
  } catch {
    /* notification delivery is best-effort */
  }
};

process.on('SIGINT', async () => {
  console.error('[SHUTDOWN] Closing...');
  audit.log('server', 'shutdown');
  await waClient.disconnect();
  store.close();
  audit.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.error('[SHUTDOWN] SIGTERM received');
  audit.log('server', 'shutdown');
  await waClient.disconnect();
  store.close();
  audit.close();
  process.exit(0);
});

async function main () {
  console.error(`[STARTUP] WhatsApp MCP Server v${pkg.version}`);
  console.error('[STARTUP] Store path:', STORE_PATH);
  console.error('[STARTUP] Encryption:', isEncryptionEnabled() ? 'ON' : 'OFF');

  const retentionDays = parseInt(process.env.MESSAGE_RETENTION_DAYS || '90', 10);
  if (retentionDays > 0) {
    store.startAutoPurge(retentionDays);
  }

  // Auto-connect on startup (default: true for backward compatibility).
  // When false, initialize() loads the session from disk but does not connect;
  // the authenticate tool must be called explicitly to establish the connection.
  const autoConnect = process.env.AUTO_CONNECT_ON_STARTUP !== 'false';
  console.error('[STARTUP] Auto-connect on startup:', autoConnect ? 'YES' : 'NO');

  try {
    // initialize() now accepts autoConnect and waits for session restore when a
    // session file exists, so isConnected() is accurate by the time it returns.
    await waClient.initialize({ autoConnect });

    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);

    // Self-terminate when the gateway closes our stdin (Cursor reload / gateway restart).
    // This lets the gateway start a fresh container with clean stdio pipes rather than
    // leaving orphaned containers that fight the new one for the WhatsApp session.
    process.stdin.once('end', async () => {
      console.error('[SHUTDOWN] stdin closed — gateway disconnected, self-terminating');
      try { await waClient.disconnect(); } catch { /* best-effort */ }
      store.close();
      audit.close();
      process.exit(0);
    });

    console.error('[STARTUP] MCP server running on stdio');

    // Report authentication state at startup
    const isAuthenticated = waClient.isConnected();
    const jid = waClient.jid;
    const sessionExists = waClient.hasSession;

    if (isAuthenticated) {
      console.error(`[STARTUP] Authentication state: CONNECTED as ${jid}`);
    } else if (sessionExists) {
      console.error(
        `[STARTUP] Authentication state: SESSION EXISTS${jid ? ` for ${jid}` : ''} — connection establishing or call authenticate tool`
      );
    } else {
      console.error(
        '[STARTUP] Authentication state: NOT AUTHENTICATED — call authenticate tool to link device'
      );
    }

    audit.log('server', 'started', {
      storePath: STORE_PATH,
      encryption: isEncryptionEnabled(),
      retentionDays: retentionDays || 'disabled',
      autoConnect,
      isAuthenticated,
      sessionExists,
      jid: jid || null
    });
  } catch (error) {
    console.error('[STARTUP] Startup error:', error);
    audit.log('server', 'startup_failed', { error: error instanceof Error ? error.message : String(error) }, false);
    process.exit(1);
  }
}

main();
