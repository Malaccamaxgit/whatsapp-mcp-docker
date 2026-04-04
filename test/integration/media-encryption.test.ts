/**
 * Media Encryption Integration Tests
 *
 * Tests end-to-end encryption for media files and metadata
 */

import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { MessageStore } from '../../src/whatsapp/store.js';
import { initEncryption, isEncryptionEnabled } from '../../src/security/crypto.js';
import { unlinkSync } from 'node:fs';
import { join } from 'node:path';

const TEST_DB_PATH = join(process.cwd(), '.test-data', 'media-encryption-test.db');

describe('Media Encryption Integration', () => {
  let store: MessageStore;
  const testEncryptionKey = 'test-media-encryption-key-12345678901234567890123456789012';

  before(() => {
    // Initialize encryption FIRST before creating store
    const enabled = initEncryption(testEncryptionKey);
    assert.ok(enabled, 'Encryption should be enabled');
    assert.ok(isEncryptionEnabled(), 'Encryption should be active');

    // Clean up any existing test database
    try {
      unlinkSync(TEST_DB_PATH);
    } catch (err) {
      // Ignore if doesn't exist
    }

    // Create store AFTER encryption is initialized
    store = new MessageStore(TEST_DB_PATH);
  });

  after(() => {
    if (store) {
      store.close();
    }
    try {
      unlinkSync(TEST_DB_PATH);
    } catch (err) {
      // Ignore
    }
  });

  it('should encrypt media_raw_json on write and decrypt on read', () => {
    const messageId = `test-msg-${Date.now()}`;
    const chatJid = '1234567890@s.whatsapp.net';
    const testMediaRawJson = JSON.stringify({
      imageMessage: {
        url: 'https://example.com/image.jpg',
        mimetype: 'image/jpeg',
        fileSha256: 'abc123'
      }
    });

    // Insert message with media raw JSON
    store.addMessage({
      id: messageId,
      chatJid,
      senderJid: '0987654321@s.whatsapp.net',
      senderName: 'Test User',
      body: 'Test message with media',
      timestamp: Math.floor(Date.now() / 1000),
      isFromMe: false,
      hasMedia: true,
      mediaType: 'image'
    });

    // Update media info with raw JSON
    store.updateMediaInfo(messageId, {
      rawJson: testMediaRawJson
    });

    // Retrieve message and verify decryption
    const messages = store.listMessages({ chatJid, limit: 1 });
    assert.ok(messages.length > 0, 'Should retrieve message');

    const retrievedMsg = messages[0];
    assert.strictEqual(retrievedMsg.body, 'Test message with media', 'Body should be decrypted');
    assert.strictEqual(retrievedMsg.sender_name, 'Test User', 'Sender name should be decrypted');
  });

  it('should handle media metadata encryption with special characters', () => {
    const messageId = `test-msg-special-${Date.now()}`;
    const chatJid = '1234567890@s.whatsapp.net';

    // Test with special characters and unicode
    const specialMediaJson = JSON.stringify({
      documentMessage: {
        fileName: 'Test_文档.pdf',
        caption: 'Emoji test: 🚀 Ñoño',
        mimetype: 'application/pdf'
      }
    });

    store.addMessage({
      id: messageId,
      chatJid,
      senderJid: '0987654321@s.whatsapp.net',
      senderName: 'User With Ñame',
      body: 'Message with émojis: 🎉🔥',
      timestamp: Math.floor(Date.now() / 1000),
      isFromMe: false,
      hasMedia: true,
      mediaType: 'document'
    });

    store.updateMediaInfo(messageId, {
      rawJson: specialMediaJson
    });

    // Verify special characters survive encryption/decryption
    const messages = store.searchMessages({ query: 'émojis' });
    assert.ok(messages.length > 0, 'Should find message with special chars');

    const msg = messages[0];
    assert.ok(msg.body.includes('🎉'), 'Emoji should be preserved');
    assert.strictEqual(msg.sender_name, 'User With Ñame', 'Special chars in name preserved');
  });

  it('should handle mixed encrypted and plaintext media metadata', () => {
    const messageId = `test-msg-mixed-${Date.now()}`;
    const chatJid = '1234567890@s.whatsapp.net';

    // Insert message without encryption first (simulate legacy data)
    const legacyMediaJson = '{"legacy": true}';

    store.addMessage({
      id: messageId,
      chatJid,
      senderJid: '0987654321@s.whatsapp.net',
      senderName: 'Legacy User',
      body: 'Legacy message',
      timestamp: Math.floor(Date.now() / 1000),
      isFromMe: false,
      hasMedia: true,
      mediaType: 'image'
    });

    // Manually insert legacy media raw JSON without encryption prefix
    const stmt = store.db.prepare(
      'UPDATE messages SET media_raw_json = ? WHERE id = ?'
    );
    stmt.run(legacyMediaJson, messageId);

    // Should return plaintext value (no enc: prefix)
    const row = store.db.prepare('SELECT media_raw_json FROM messages WHERE id = ?').get(messageId);
    assert.strictEqual(row.media_raw_json, legacyMediaJson, 'Legacy data should remain plaintext');
  });

  it('should encrypt chat last_message_preview', () => {
    const chatJid = 'preview-test@s.whatsapp.net';
    const previewText = 'This is a secret preview message';

    // Upsert chat with preview
    store.upsertChat(chatJid, 'Preview Test Chat', false, Math.floor(Date.now() / 1000), previewText);

    // Retrieve and verify encryption
    const chat = store.getChatByJid(chatJid);
    assert.ok(chat, 'Chat should exist');
    assert.strictEqual(chat.last_message_preview, previewText, 'Preview should be decrypted');

    // Verify it's actually encrypted in the database
    const rawRow = store.db.prepare('SELECT last_message_preview FROM chats WHERE jid = ?').get(chatJid);
    assert.ok(rawRow.last_message_preview.startsWith('enc:'), 'Preview should be encrypted in DB');
  });

  it('should handle approval encryption end-to-end', () => {
    const approvalData = {
      toJid: 'approval-test@s.whatsapp.net',
      action: 'Deploy to production',
      details: 'Version 2.0 with critical security fixes',
      timeoutMs: 300000
    };

    // Create approval
    const approval = store.createApproval(approvalData);

    // Verify encryption
    const retrievedApproval = store.getApproval(approval.id);
    assert.ok(retrievedApproval, 'Approval should exist');
    assert.strictEqual(retrievedApproval.action, approvalData.action, 'Action should be decrypted');
    assert.strictEqual(retrievedApproval.details, approvalData.details, 'Details should be decrypted');

    // Verify actually encrypted in database
    const rawRow = store.db.prepare('SELECT action, details FROM approvals WHERE id = ?').get(approval.id);
    assert.ok(rawRow.action.startsWith('enc:'), 'Action should be encrypted in DB');
    assert.ok(rawRow.details.startsWith('enc:'), 'Details should be encrypted in DB');
  });

  it('should maintain FTS5 search with encrypted bodies', () => {
    const messageId = `test-msg-search-${Date.now()}`;
    const chatJid = 'search-test@s.whatsapp.net';
    const searchableBody = 'This message contains searchable keywords for FTS5 testing';

    store.addMessage({
      id: messageId,
      chatJid,
      senderJid: '0987654321@s.whatsapp.net',
      senderName: 'Search Test',
      body: searchableBody,
      timestamp: Math.floor(Date.now() / 1000),
      isFromMe: false,
      hasMedia: false
    });

    // FTS5 should still work (it stores plaintext separately)
    const searchResults = store.searchMessages({ query: 'keywords' });
    assert.ok(searchResults.length > 0, 'FTS5 should find encrypted message');

    const found = searchResults.find(m => m.id === messageId);
    assert.ok(found, 'Should find our message');
    assert.strictEqual(found.body, searchableBody, 'Body should be decrypted in results');
  });
});
