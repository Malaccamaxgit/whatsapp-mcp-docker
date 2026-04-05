/**
 * Connection Status Tool
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PermissionManager } from '../security/permissions.js';
import type { MessageStore } from '../whatsapp/store.js';
import type { WhatsAppClient } from '../whatsapp/client.js';
import { formatTimestamp } from '../utils/timezone.js';

export function registerStatusTools (
  server: McpServer,
  waClient: WhatsAppClient,
  store: MessageStore,
  permissions: PermissionManager
): void {
  const get_connection_status_handler = () => {
    const toolCheck = permissions.isToolEnabled('get_connection_status');
    if (!toolCheck.allowed) {
      return { content: [{ type: 'text', text: toolCheck.error }], isError: true };
    }
    const connected = waClient.isConnected();
    const hasSession = waClient.hasSession;
    const stats = store.getStats();
    const health = waClient.getHealthStats();
    const probe = waClient.getProbeStatus();

    let text = 'WhatsApp Connection Status:\n';

    if (connected && hasSession) {
      text += '  ✅ Connected: Yes\n';
      text += '  ✅ WebSocket Probe: Verified\n';
      text += `  ✅ Authenticated as: ${waClient.jid}\n`;
      text += '  Status: Ready to send/receive messages\n';
      if (health.uptime > 0) {
        const h = Math.floor(health.uptime / 3600);
        const m = Math.floor((health.uptime % 3600) / 60);
        text += `  Uptime: ${h}h ${m}m\n`;
      }
    } else if (!connected && hasSession) {
      const jidDisplay = waClient.jid || 'unknown';
      text += '  ❌ Connected: No\n';
      text += `  🔍 WebSocket Probe: ${probe.verified ? 'Verified' : 'Not verified'}\n`;
      if (probe.lastError) {
        text += `  Probe Error: ${probe.lastError}\n`;
      }
      if (health.reconnecting) {
        text += `  ⏳ Session: ${jidDisplay} (reconnection in progress...)\n`;
        text += '  Status: Reconnecting automatically — please wait\n';
      } else {
        text += `  ⚠️  Session: ${jidDisplay} (disconnected)\n`;
        text += '  Status: Call authenticate (no phone number needed) to reconnect,\n';
        text += '          or call disconnect to clear the session and re-link a new device\n';
      }
    } else {
      text += '  ❌ Connected: No\n';
      text += '  🔍 WebSocket Probe: Not verified\n';
      text += '  ❌ Authenticated: No session\n';
      text += '  Status: Not authenticated — call authenticate with your phone number to link this device\n';
    }

    if (health.recentErrorCount > 0) {
      text += `  Recent Errors (5 min): ${health.recentErrorCount}\n`;
    }

    if (health.logoutReason) {
      text += `  Last Disconnect Reason: ${health.logoutReason}\n`;
    }

    text += '\nDatabase Statistics:\n';
    text += `  Chats: ${stats.chatCount}\n`;
    text += `  Messages: ${stats.messageCount}\n`;
    text += `  Unread: ${stats.unreadCount}\n`;
    text += `  Pending Approvals: ${stats.pendingApprovals}\n`;

    if (stats.lastSync) {
      text += `  Last Message: ${formatTimestamp(stats.lastSync)}`;
    }

    return { content: [{ type: 'text', text }] };
  };

  server.registerTool(
    'get_connection_status',
    {
      description: 'Check WhatsApp connection state, authenticated user info, and database statistics including chat count, message count, and last sync time.',
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true }
    },

    get_connection_status_handler as any
  );
}
