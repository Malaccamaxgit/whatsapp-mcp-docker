import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PermissionManager } from '../security/permissions.js';
import { registerTool, type ToolInput, type McpResult } from '../utils/mcp-types.js';

export interface ToolDocumentation {
  summary: string;
  usage: Array<{
    param: string;
    required: boolean;
    description: string;
  }>;
  examples: Array<{
    name: string;
    call: string;
  }>;
  response: {
    success: string;
    errors: Array<{
      code: string;
      message: string;
    }>;
  };
  relatedTools: Array<{
    name: string;
    description: string;
  }>;
  pitfalls: string[];
}

const DEFAULT_ERRORS: Array<{ code: string; message: string }> = [
  { code: 'NOT_CONNECTED', message: 'WhatsApp session is disconnected; call authenticate first.' },
  { code: 'RATE_LIMITED', message: 'Rate limit exceeded; retry after cooldown.' },
  { code: 'VALIDATION_ERROR', message: 'Invalid or missing arguments.' }
];

function docs (
  summary: string,
  usage: ToolDocumentation['usage'],
  examples: ToolDocumentation['examples'],
  relatedTools: ToolDocumentation['relatedTools'],
  pitfalls: string[],
  success: string,
  errors: ToolDocumentation['response']['errors'] = DEFAULT_ERRORS
): ToolDocumentation {
  return {
    summary,
    usage,
    examples,
    response: {
      success,
      errors
    },
    relatedTools,
    pitfalls
  };
}

export const toolDocs: Record<string, ToolDocumentation> = {
  disconnect: docs(
    'Log out and clear the local WhatsApp session.',
    [],
    [{ name: 'Disconnect current account', call: 'disconnect({})' }],
    [{ name: 'authenticate', description: 'Link a device again after disconnecting' }],
    ['This removes the active session from the server.'],
    'Successfully disconnected from WhatsApp; call authenticate to re-link.'
  ),
  authenticate: docs(
    'Link this server to a WhatsApp account using pairing code or QR fallback.',
    [
      { param: 'phoneNumber', required: false, description: 'E.164 phone number (+countrycode...)' },
      { param: 'waitForLink', required: false, description: 'Wait for successful link in same response' },
      { param: 'linkTimeoutSec', required: false, description: 'Max wait time while polling for link' },
      { param: 'pollIntervalSec', required: false, description: 'Polling interval for link checks' },
      { param: 'force', required: false, description: 'Force re-pair even if already connected' }
    ],
    [{ name: 'Link immediately', call: 'authenticate({ phoneNumber: "+15145551234", waitForLink: false })' }],
    [{ name: 'get_connection_status', description: 'Verify current connection health' }],
    ['Phone number must be E.164 format.', 'Pairing codes expire quickly and may need refresh.'],
    'Returns pairing instructions, QR image fallback, or linked-success message.'
  ),
  get_connection_status: docs(
    'Show connection, probe, and local database health summary.',
    [],
    [{ name: 'Inspect status', call: 'get_connection_status({})' }],
    [{ name: 'authenticate', description: 'Use if status is disconnected' }],
    ['A stored session may exist even when websocket is currently disconnected.'],
    'Text block with connected/authenticated state and database stats.'
  ),
  send_message: docs(
    'Send a text message to a contact or group.',
    [
      { param: 'to', required: true, description: 'Name, phone number, or JID' },
      { param: 'message', required: true, description: 'Message body text' }
    ],
    [{ name: 'Send by name', call: 'send_message({ to: "John Smith", message: "Hello!" })' }],
    [{ name: 'search_contacts', description: 'Resolve recipients before sending' }],
    ['Fuzzy matching can return ambiguity errors; retry with exact JID.'],
    'Message sent confirmation including message ID.'
  ),
  list_messages: docs(
    'Read messages from one chat with optional date and context filters.',
    [
      { param: 'chat', required: true, description: 'Chat name, phone number, or JID' },
      { param: 'limit', required: false, description: 'Maximum messages per page' },
      { param: 'page', required: false, description: 'Pagination page (0-based)' },
      { param: 'before', required: false, description: 'Only messages before date/time' },
      { param: 'after', required: false, description: 'Only messages after date/time' },
      { param: 'include_context', required: false, description: 'Include neighbor messages' },
      { param: 'context_messages', required: false, description: 'Neighbors per side when context enabled' }
    ],
    [{ name: 'Read latest chat page', call: 'list_messages({ chat: "John Smith", limit: 50 })' }],
    [{ name: 'search_messages', description: 'Search globally before drilling into a chat' }],
    ['Use page to access older history.', 'Message IDs are needed for reaction/edit/delete tools.'],
    'Chronological message list with IDs and read/media metadata.'
  ),
  search_messages: docs(
    'Run full-text search over stored messages, optionally in one chat.',
    [
      { param: 'query', required: true, description: 'Keyword, phrase, or boolean query' },
      { param: 'chat', required: false, description: 'Optional chat scope' },
      { param: 'limit', required: false, description: 'Maximum results per page' },
      { param: 'page', required: false, description: 'Pagination page' },
      { param: 'include_context', required: false, description: 'Include nearby messages' }
    ],
    [{ name: 'Global search', call: 'search_messages({ query: "invoice AND April" })' }],
    [{ name: 'list_messages', description: 'Inspect one chat after finding matching results' }],
    ['When access restrictions are enabled, pass chat explicitly for policy checks.'],
    'Search result list containing chat, sender, timestamp, and message IDs.'
  ),
  list_chats: docs(
    'List chats sorted by latest activity.',
    [
      { param: 'filter', required: false, description: 'Optional name substring filter' },
      { param: 'groups_only', required: false, description: 'Show only group chats' },
      { param: 'limit', required: false, description: 'Max chats per page' },
      { param: 'page', required: false, description: 'Pagination page' }
    ],
    [{ name: 'List recent chats', call: 'list_chats({ limit: 20 })' }],
    [{ name: 'list_messages', description: 'Read messages for a specific listed chat' }],
    ['Pagination is required for long chat histories.'],
    'Conversation list with unread count, preview, and JID info.'
  ),
  catch_up: docs(
    'Generate an activity summary of unread and recent messages.',
    [{ param: 'since', required: false, description: 'Window: 1h, 4h, today, 24h, this_week' }],
    [{ name: 'Morning summary', call: 'catch_up({ since: "today" })' }],
    [{ name: 'mark_messages_read', description: 'Clear unread counters after review' }],
    ['This is a summary view and does not include full raw history.'],
    'Structured summary by active chats, questions, unread highlights, and approvals.'
  ),
  search_contacts: docs(
    'Find contacts/groups by name or number fragment.',
    [
      { param: 'query', required: true, description: 'Search text' },
      { param: 'include_chats', required: false, description: 'Include related chats for single contact result' },
      { param: 'limit', required: false, description: 'Maximum matches' }
    ],
    [{ name: 'Find contact', call: 'search_contacts({ query: "Jane" })' }],
    [{ name: 'send_message', description: 'Use matched contact to send a message' }],
    ['Similar names can still require explicit JID for disambiguation.'],
    'Matched contacts with JID and recent activity information.'
  ),
  mark_messages_read: docs(
    'Mark messages as read for a chat or explicit IDs.',
    [
      { param: 'chat', required: false, description: 'Chat to mark read' },
      { param: 'message_ids', required: false, description: 'Specific message IDs to mark read' }
    ],
    [{ name: 'Mark entire chat read', call: 'mark_messages_read({ chat: "Engineering Team" })' }],
    [{ name: 'catch_up', description: 'Confirm unread count reduction' }],
    ['Provide at least one of chat or message_ids.'],
    'Confirmation containing number of messages marked read.'
  ),
  export_chat_data: docs(
    'Export chat history in JSON or CSV format.',
    [
      { param: 'jid', required: true, description: 'Target chat JID' },
      { param: 'format', required: false, description: 'json (default) or csv' }
    ],
    [{ name: 'Export JSON', call: 'export_chat_data({ jid: "15145551234@s.whatsapp.net", format: "json" })' }],
    [{ name: 'list_chats', description: 'Find valid chat JIDs first' }],
    ['Large chats return summarized preview text in MCP output.'],
    'Export metadata and sample preview of exported data.'
  ),
  request_approval: docs(
    'Send approval request message and create tracked approval record.',
    [
      { param: 'to', required: true, description: 'Recipient for approval request' },
      { param: 'action', required: true, description: 'Action requiring approval' },
      { param: 'details', required: true, description: 'Context and details' },
      { param: 'timeout', required: false, description: 'Expiration in seconds' }
    ],
    [{ name: 'Request deploy approval', call: 'request_approval({ to: "Ops", action: "Deploy", details: "Release 2.1", timeout: 600 })' }],
    [{ name: 'check_approvals', description: 'Poll approval response status' }],
    ['Approval status remains pending until recipient responds or timeout expires.'],
    'Returns request ID and expiry details for polling.'
  ),
  check_approvals: docs(
    'Check one approval request or list all pending approvals.',
    [{ param: 'request_id', required: false, description: 'Specific approval request ID' }],
    [{ name: 'List pending', call: 'check_approvals({})' }],
    [{ name: 'request_approval', description: 'Create new request before polling status' }],
    ['Unknown request IDs return an error.'],
    'Status view with timestamps and response text when available.'
  ),
  download_media: docs(
    'Download media from a message to persistent storage.',
    [
      { param: 'message_id', required: true, description: 'Message ID containing media' },
      { param: 'chat', required: false, description: 'Chat context for disambiguation and safety checks' }
    ],
    [{ name: 'Download one media message', call: 'download_media({ message_id: "AC8E7D7E0AAAE3...", chat: "Benjamin" })' }],
    [
      { name: 'list_messages', description: 'Find message IDs first' },
      { name: 'send_file', description: 'Send local media file back to a chat' }
    ],
    ['Media can expire on WhatsApp servers.', 'Message IDs are case-sensitive.'],
    'Media downloaded successfully with type, local path, and chat JID.',
    [
      { code: 'MEDIA_EXPIRED', message: 'Media no longer available on WhatsApp servers.' },
      { code: 'INVALID_MESSAGE_ID', message: 'Message ID was not found in local/remote context.' },
      { code: 'NO_MEDIA', message: 'Target message has no media attachment.' },
      { code: 'CHAT_MISMATCH', message: 'Message does not belong to supplied chat argument.' }
    ]
  ),
  send_file: docs(
    'Upload and send a local file as WhatsApp media.',
    [
      { param: 'to', required: true, description: 'Recipient name or JID' },
      { param: 'file_path', required: true, description: 'Absolute in-container file path' },
      { param: 'media_type', required: true, description: 'image, video, audio, or document' },
      { param: 'caption', required: false, description: 'Optional caption text' }
    ],
    [{ name: 'Send image with caption', call: 'send_file({ to: "John", file_path: "/data/store/media/pic.jpg", media_type: "image", caption: "Status update" })' }],
    [{ name: 'download_media', description: 'Inverse operation for received media' }],
    ['Path must be allowed by file guard rules.', 'File type/magic-byte checks may reject mismatches.'],
    'Send confirmation with message ID and timestamp.'
  ),
  create_group: docs(
    'Create a new group with initial participants.',
    [
      { param: 'name', required: true, description: 'Group name' },
      { param: 'participants', required: true, description: 'Participant phone numbers or JIDs' }
    ],
    [{ name: 'Create project group', call: 'create_group({ name: "Project Alpha", participants: ["+15145551234"] })' }],
    [{ name: 'get_group_info', description: 'Inspect participants and settings after create' }],
    ['Participants must be valid WhatsApp identities.', 'Group creation can fail if account permissions are limited.'],
    'Group JID and invite link (if available).'
  ),
  get_group_info: docs(
    'Retrieve group metadata, participants, and admin settings.',
    [{ param: 'group', required: true, description: 'Group name (fuzzy) or @g.us JID' }],
    [{ name: 'Lookup by name', call: 'get_group_info({ group: "Engineering Team" })' }],
    [{ name: 'get_joined_groups', description: 'List available groups first' }],
    ['Non-existent or inaccessible groups return errors.'],
    'Formatted group details including participant/admin list.'
  ),
  get_joined_groups: docs(
    'List groups the linked account has joined.',
    [],
    [{ name: 'List memberships', call: 'get_joined_groups({})' }],
    [{ name: 'get_group_info', description: 'Inspect one group in detail' }],
    ['Result depends on current linked account state.'],
    'Group list with participant count and admin indicators.'
  ),
  get_group_invite_link: docs(
    'Get invite link for a group (requires admin).',
    [{ param: 'group', required: true, description: 'Group name or JID' }],
    [{ name: 'Fetch invite link', call: 'get_group_invite_link({ group: "Engineering Team" })' }],
    [{ name: 'join_group', description: 'Use invite link/code to join another account' }],
    ['Requires group admin rights.'],
    'Invite URL for the target group.'
  ),
  join_group: docs(
    'Join a group from invite link or code.',
    [{ param: 'link', required: true, description: 'Invite URL or raw invite code' }],
    [{ name: 'Join from URL', call: 'join_group({ link: "https://chat.whatsapp.com/XXXX" })' }],
    [{ name: 'leave_group', description: 'Leave group if joined by mistake' }],
    ['Expired or revoked invite codes will fail.'],
    'Join confirmation with resulting group JID.'
  ),
  leave_group: docs(
    'Leave a group conversation.',
    [{ param: 'group', required: true, description: 'Group name or @g.us JID' }],
    [{ name: 'Leave by name', call: 'leave_group({ group: "Noise Group" })' }],
    [{ name: 'join_group', description: 'Rejoin later via invite if needed' }],
    ['You need a new invite to rejoin after leaving.'],
    'Confirmation that the account left the group.'
  ),
  update_group_participants: docs(
    'Add/remove/promote/demote group participants.',
    [
      { param: 'group', required: true, description: 'Target group' },
      { param: 'action', required: true, description: 'add | remove | promote | demote' },
      { param: 'participants', required: true, description: 'Participant phone numbers or JIDs' }
    ],
    [{ name: 'Promote participant', call: 'update_group_participants({ group: "Engineering", action: "promote", participants: ["+15145551234"] })' }],
    [{ name: 'get_group_info', description: 'Validate new participant/admin state' }],
    ['Most actions require group admin privileges.'],
    'Per-participant action results.'
  ),
  set_group_name: docs(
    'Rename a group (admin required).',
    [
      { param: 'group', required: true, description: 'Group name or JID' },
      { param: 'name', required: true, description: 'New group name' }
    ],
    [{ name: 'Rename group', call: 'set_group_name({ group: "Old Name", name: "New Name" })' }],
    [{ name: 'get_group_info', description: 'Verify the updated name' }],
    ['Requires admin rights.'],
    'Confirmation that group name was updated.'
  ),
  set_group_topic: docs(
    'Set or clear group topic/description.',
    [
      { param: 'group', required: true, description: 'Group name or JID' },
      { param: 'topic', required: true, description: 'New topic text (empty to clear)' }
    ],
    [{ name: 'Update topic', call: 'set_group_topic({ group: "Engineering", topic: "Standup at 10:00" })' }],
    [{ name: 'get_group_info', description: 'Confirm topic/description state' }],
    ['Requires admin rights in many groups.'],
    'Confirmation of updated or cleared topic.'
  ),
  send_reaction: docs(
    'React to a specific message with an emoji.',
    [
      { param: 'chat', required: true, description: 'Chat containing the message' },
      { param: 'message_id', required: true, description: 'Target message ID' },
      { param: 'emoji', required: true, description: 'Reaction emoji (empty string removes reaction)' }
    ],
    [{ name: 'Add reaction', call: 'send_reaction({ chat: "John", message_id: "ABC123", emoji: "👍" })' }],
    [{ name: 'list_messages', description: 'Find message IDs first' }],
    ['Message must exist in local history for best sender resolution.'],
    'Confirmation that reaction was added or removed.'
  ),
  edit_message: docs(
    'Edit a previously sent message.',
    [
      { param: 'chat', required: true, description: 'Chat containing the message' },
      { param: 'message_id', required: true, description: 'Message to edit' },
      { param: 'new_text', required: true, description: 'Replacement text' }
    ],
    [{ name: 'Edit typo', call: 'edit_message({ chat: "John", message_id: "ABC123", new_text: "Corrected text" })' }],
    [{ name: 'delete_message', description: 'Fallback if edit is no longer allowed' }],
    ['WhatsApp generally limits edits to a short time window and own messages.'],
    'Confirmation that message was edited.'
  ),
  delete_message: docs(
    'Delete/revoke a previously sent message for everyone.',
    [
      { param: 'chat', required: true, description: 'Chat containing the message' },
      { param: 'message_id', required: true, description: 'Message to revoke' }
    ],
    [{ name: 'Delete mistaken message', call: 'delete_message({ chat: "John", message_id: "ABC123" })' }],
    [{ name: 'list_messages', description: 'Locate message IDs and sender context' }],
    ['May fail for old messages or non-owned messages (e.g., WhatsApp error 479).'],
    'Confirmation that message was deleted for everyone.'
  ),
  get_user_info: docs(
    'Fetch WhatsApp profile metadata for phone numbers.',
    [
      { param: 'phones', required: true, description: 'E.164 phone numbers or JIDs' },
      { param: 'save_names', required: false, description: 'Persist returned display names locally' }
    ],
    [{ name: 'Lookup one number', call: 'get_user_info({ phones: ["+15145551234"] })' }],
    [{ name: 'sync_contact_names', description: 'Bulk-refresh local names' }],
    ['Public profile fields vary by user privacy settings.'],
    'Per-user profile details (name/status/business fields when available).'
  ),
  is_on_whatsapp: docs(
    'Check whether numbers are registered on WhatsApp.',
    [{ param: 'phones', required: true, description: 'E.164 phone numbers or JIDs to check' }],
    [{ name: 'Preflight check', call: 'is_on_whatsapp({ phones: ["+15145551234", "+447911123456"] })' }],
    [{ name: 'send_message', description: 'Send only to confirmed accounts' }],
    ['Registration status can change over time.'],
    'List of identifiers with on-WhatsApp boolean status.'
  ),
  get_profile_picture: docs(
    'Get current profile picture URL for contact or group.',
    [{ param: 'target', required: true, description: 'Phone number, name, or JID' }],
    [{ name: 'Fetch picture URL', call: 'get_profile_picture({ target: "John Smith" })' }],
    [{ name: 'search_contacts', description: 'Resolve exact contact/JID first' }],
    ['Some accounts have no profile picture or privacy-restricted pictures.'],
    'Direct WhatsApp CDN URL or no-picture message.'
  ),
  sync_contact_names: docs(
    'Refresh local chat display names from WhatsApp profiles.',
    [
      { param: 'contacts', required: false, description: 'Optional subset of JIDs/phones to sync' },
      { param: 'force', required: false, description: 'Refresh names even when non-JID names already exist' }
    ],
    [{ name: 'Sync all unresolved names', call: 'sync_contact_names({})' }],
    [{ name: 'set_contact_name', description: 'Apply custom local overrides manually' }],
    ['Custom names set with set_contact_name are preserved by default.'],
    'Sync summary with updated/no-name/error counts.'
  ),
  set_contact_name: docs(
    'Set or clear local custom display name for a contact/group.',
    [
      { param: 'jid', required: true, description: 'JID or E.164 phone number' },
      { param: 'name', required: true, description: 'Custom display name; empty string clears' }
    ],
    [{ name: 'Set nickname', call: 'set_contact_name({ jid: "15145551234@s.whatsapp.net", name: "John (Client)" })' }],
    [{ name: 'sync_contact_names', description: 'Populate missing names from profile data' }],
    ['This changes only local display, not remote WhatsApp profile names.'],
    'Confirmation of updated or cleared local custom name.'
  ),
  wait_for_message: docs(
    'Block until a message arrives (with optional chat/sender filters).',
    [
      { param: 'timeout', required: true, description: 'Seconds to wait (1-300)' },
      { param: 'chat', required: false, description: 'Only match this chat' },
      { param: 'from_phone', required: false, description: 'Only match this sender' }
    ],
    [{ name: 'Wait for next inbound', call: 'wait_for_message({ timeout: 60, chat: "John Smith" })' }],
    [{ name: 'list_messages', description: 'Read historical messages if wait times out' }],
    ['Long waits can be interrupted by client/gateway cancellation.'],
    'Received message payload with sender, chat, body, media flag, and message ID.'
  ),
  get_tool_info: docs(
    'Get detailed documentation for any available WhatsApp MCP tool.',
    [{ param: 'tool_name', required: true, description: 'Target tool name (e.g., send_message)' }],
    [{ name: 'Get download_media docs', call: 'get_tool_info({ tool_name: "download_media" })' }],
    [{ name: 'list_chats', description: 'Example operational tool' }],
    ['Tool names are case-sensitive.'],
    'Returns detailed sections: usage, examples, response, errors, related tools, pitfalls.',
    [{ code: 'UNKNOWN_TOOL', message: 'Requested tool name does not exist.' }]
  )
};

export function getToolInfoHint (toolName: string): string {
  return `Use get_tool_info({tool_name: '${toolName}'}) for examples, errors, and response format.`;
}

export function withToolInfoHint (toolName: string, description: string): string {
  if (toolName === 'get_tool_info') {return description;}
  const trimmed = description.trim();
  const hint = getToolInfoHint(toolName);
  if (trimmed.includes(hint)) {return trimmed;}
  return `${trimmed} ${hint}`;
}

export function withToolInfoErrorHint (message: string, toolName: string): string {
  const hint = `Call get_tool_info({tool_name: '${toolName}'}) for correct usage.`;
  if (message.includes(hint)) {return message;}
  return `${message} ${hint}`;
}

function formatDocumentation (toolName: string, doc: ToolDocumentation): string {
  const usage = doc.usage.length > 0
    ? doc.usage
        .map((u) => `  - ${u.param} (${u.required ? 'required' : 'optional'}): ${u.description}`)
        .join('\n')
    : '  (no input arguments)';

  const examples = doc.examples.length > 0
    ? doc.examples
        .map((ex, index) => `  ${index + 1}. ${ex.name}\n     ${ex.call}`)
        .join('\n\n')
    : '  (no examples available)';

  const errors = doc.response.errors.length > 0
    ? doc.response.errors.map((e) => `  - ${e.code}: ${e.message}`).join('\n')
    : '  (none documented)';

  const related = doc.relatedTools.length > 0
    ? doc.relatedTools.map((r) => `  - ${r.name}: ${r.description}`).join('\n')
    : '  (none)';

  const pitfalls = doc.pitfalls.length > 0
    ? doc.pitfalls.map((p) => `  - ${p}`).join('\n')
    : '  (none)';

  return [
    `TOOL: ${toolName}`,
    '',
    `SUMMARY:\n  ${doc.summary}`,
    '',
    `USAGE:\n${usage}`,
    '',
    `EXAMPLES:\n${examples}`,
    '',
    `RESPONSE:\n  Success:\n    ${doc.response.success}`,
    '',
    `ERRORS:\n${errors}`,
    '',
    `RELATED TOOLS:\n${related}`,
    '',
    `PITFALLS:\n${pitfalls}`
  ].join('\n');
}

export function registerToolInfoTool (
  server: McpServer,
  permissions: PermissionManager
): void {
  const inputSchema = {
    tool_name: z.string().min(1).describe('Name of the tool to get documentation for')
  };

  const handler = async ({ tool_name }: ToolInput<typeof inputSchema>): Promise<McpResult> => {
    const toolCheck = permissions.isToolEnabled('get_tool_info');
    if (!toolCheck.allowed) {
      return { content: [{ type: 'text', text: toolCheck.error ?? 'Tool disabled' }], isError: true };
    }

    const doc = toolDocs[tool_name];
    if (!doc) {
      const available = Object.keys(toolDocs).sort().join(', ');
      return {
        content: [{
          type: 'text',
          text: `Unknown tool: ${tool_name}. Available tools: ${available}.`
        }],
        isError: true
      };
    }

    return {
      content: [{ type: 'text', text: formatDocumentation(tool_name, doc) }]
    };
  };

  registerTool(server, 'get_tool_info', {
    description: 'Get detailed help for a WhatsApp MCP tool: usage examples, response format, error codes, pitfalls, and related tools. Call before using an unfamiliar tool.',
    inputSchema,
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false }
  }, handler);
}
