/**
 * Test Fixtures & Helpers
 * 
 * Common test data setup with proper foreign key relationships
 */

/**
 * Create test chat with proper initialization
 * @param {MessageStore} store - MessageStore instance
 * @param {string} jid - Chat JID
 * @param {string} name - Display name
 * @param {boolean} isGroup - Is group chat
 * @returns {object} Chat data
 */
export function createTestChat(store, jid, name = 'Test User', isGroup = false) {
  const timestamp = Math.floor(Date.now() / 1000);
  store.upsertChat(jid, name, isGroup, timestamp, 'Test message');
  return { jid, name, is_group: isGroup ? 1 : 0, timestamp };
}

/**
 * Create test message with proper foreign keys
 * @param {MessageStore} store - MessageStore instance  
 * @param {string} chatJid - Parent chat JID (must exist)
 * @param {string} body - Message body
 * @param {object} options - Additional options
 * @returns {object} Message data
 */
export function createTestMessage(store, chatJid, body = 'Test message', options = {}) {
  const message = {
    id: options.id || `test_msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    chatJid,
    senderJid: options.senderJid || chatJid,
    senderName: options.senderName || 'Test User',
    body,
    timestamp: options.timestamp || Math.floor(Date.now() / 1000),
    isFromMe: options.isFromMe || false,
    hasMedia: options.hasMedia || false,
    mediaType: options.mediaType || null
  };
  
  store.addMessage(message);
  return message;
}

/**
 * Create test approval request
 * @param {MessageStore} store - MessageStore instance
 * @param {string} toJid - Recipient JID
 * @param {string} action - Approval action
 * @param {string} details - Approval details
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {object} Approval data
 */
export function createTestApproval(store, toJid, action, details = '', timeoutMs = 300000) {
  return store.createApproval({
    toJid,
    action,
    details,
    timeoutMs
  });
}

/**
 * Initialize complete test environment with sample data
 * @param {MessageStore} store - MessageStore instance
 * @returns {object} Test data references
 */
export function initializeTestData(store) {
  // Create users
  const user1 = createTestChat(store, '+1234567890@s.whatsapp.net', 'Alice');
  const user2 = createTestChat(store, '+0987654321@s.whatsapp.net', 'Bob');
  const group1 = createTestChat(store, '120363001234@g.us', 'Engineering Team', true);
  
  // Create messages for each chat
  const msg1 = createTestMessage(store, user1.jid, 'Hello from Alice');
  const msg2 = createTestMessage(store, user2.jid, 'Hello from Bob');
  const msg3 = createTestMessage(store, group1.jid, 'Team update', { senderJid: user1.jid, senderName: 'Alice' });
  
  return {
    users: [user1, user2],
    groups: [group1],
    messages: [msg1, msg2, msg3],
    allChats: [user1, user2, group1]
  };
}

/**
 * Create test media file
 * @param {string} dir - Directory path
 * @param {string} filename - Filename
 * @param {string} type - Media type (image, video, audio, document)
 * @returns {string} File path
 */
export function createTestMediaFile(dir, filename, type = 'image') {
  const path = `${dir}/${filename}`;
  
  let content;
  switch (type) {
    case 'image':
      // JPEG magic bytes
      content = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xD9]);
      break;
    case 'video':
      // MP4 magic bytes
      content = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6F, 0x6D, 0x00, 0x00, 0x02, 0x00]);
      break;
    case 'audio':
      // OGG magic bytes
      content = Buffer.from([0x4F, 0x67, 0x67, 0x53, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00]);
      break;
    case 'document':
      // PDF magic bytes
      content = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34]);
      break;
    default:
      content = Buffer.from('test content');
  }
  
  try {
    writeFileSync(path, content);
  } catch (e) {
    // Ignore write errors
  }
  
  return path;
}

import { writeFileSync } from 'node:fs';
