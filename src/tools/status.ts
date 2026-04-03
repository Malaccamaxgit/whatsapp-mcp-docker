/**
 * Connection Status Tool
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PermissionManager } from '../security/permissions.js';
import type { MessageStore } from '../whatsapp/store.js';
import type { WhatsmeowClient } from '../whatsapp/client.js';

export function registerStatusTools(
  server: McpServer,
  waClient: WhatsmeowClient,
  store: MessageStore,
  permissions: PermissionManager
): void {
  server.tool(
    'get_connection_status',
    'Check WhatsApp connection state, authenticated user info, and database statistics including chat count, message count, and last sync time.',
    {},
    async () => {
      const toolCheck = permissions.isToolEnabled('get_connection_status');
      if (!toolCheck.allowed) {
        return { content: [{ type: 'text', text: toolCheck.error }], isError: true };
      }
      const connected = waClient.isConnected?.() ?? false;
      const hasSession = waClient.isLoggedIn?.() ?? false;
      const stats = store.getStats();
      const health = waClient.getHealthStats?.() ?? { uptime: 0, recentErrorCount: 0, logoutReason: null, reconnecting: false };

      let text = 'WhatsApp Connection Status:\n';

      if (connected && hasSession) {
        // Fully authenticated and connected
        text += `  ✅ Connected: Yes\n`;
        text += `  ✅ Authenticated as: ${waClient.jid}\n`;
        text += `  Status: Ready to send/receive messages\n`;
        if (health.uptime > 0) {
          const h = Math.floor(health.uptime / 3600);
          const m = Math.floor((health.uptime % 3600) / 60);
          text += `  Uptime: ${h}h ${m}m\n`;
        }
      } else if (!connected && hasSession) {
        // Session file exists on disk but WebSocket is not currently up
        const jidDisplay = waClient.jid || 'unknown';
        text += `  ❌ Connected: No\n`;
        if (health.reconnecting) {
          text += `  ⏳ Session: ${jidDisplay} (reconnection in progress...)\n`;
          text += `  Status: Reconnecting automatically — please wait\n`;
        } else {
          text += `  ⚠️  Session: ${jidDisplay} (disconnected)\n`;
          text += `  Status: Call authenticate (no phone number needed) to reconnect,\n`;
          text += `          or call disconnect to clear the session and re-link a new device\n`;
        }
      } else {
        // No session at all — needs full authentication
        text += `  ❌ Connected: No\n`;
        text += `  ❌ Authenticated: No session\n`;
        text += `  Status: Not authenticated — call authenticate with your phone number to link this device\n`;
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
        text += `  Last Message: ${new Date(stats.lastSync * 1000).toLocaleString()}`;
      }

      return { content: [{ type: 'text', text }] };
    },
    { annotations: { readOnlyHint: true, idempotentHint: true } }
  );
}
