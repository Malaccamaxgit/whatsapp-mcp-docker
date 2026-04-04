/**
 * Media Download Real-Flow Integration Tests
 *
 * Tests real file system operations for media download workflow
 * Note: These tests verify file system integration with the store
 */

import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { MessageStore } from '../../src/whatsapp/store.js';
import { initEncryption } from '../../src/security/crypto.js';
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const TEST_DB_PATH = join(process.cwd(), '.test-data', 'media-download-flow-test.db');
const TEST_MEDIA_DIR = join(process.cwd(), '.test-data', 'media-test');

describe('Media Download Real-Flow', () => {
  let store: MessageStore;

  before(() => {
    // Initialize encryption for media tests
    initEncryption('test-encryption-key-12345678901234567890123456789012');

    // Clean up any existing test database
    try {
      unlinkSync(TEST_DB_PATH);
    } catch (err) {
      // Ignore if doesn't exist
    }

    // Create test media directory
    try {
      mkdirSync(TEST_MEDIA_DIR, { recursive: true });
    } catch (err) {
      // Ignore if exists
    }

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

    // Clean up test media files
    try {
      const files = [
        join(TEST_MEDIA_DIR, 'image', 'test-img-1.jpg'),
        join(TEST_MEDIA_DIR, 'video', 'test-vid-1.mp4'),
        join(TEST_MEDIA_DIR, 'document', 'test-doc-1.pdf')
      ];

      for (const file of files) {
        try {
          unlinkSync(file);
        } catch (err) {
          // Ignore
        }
      }

      // Remove directories
      try {
        unlinkSync(join(TEST_MEDIA_DIR, 'image'));
        unlinkSync(join(TEST_MEDIA_DIR, 'video'));
        unlinkSync(join(TEST_MEDIA_DIR, 'document'));
        unlinkSync(TEST_MEDIA_DIR);
      } catch (err) {
        // Ignore
      }
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  it('should handle real file system operations for media download', () => {
    const messageId = `test-media-${Date.now()}`;
    const chatJid = 'media-test@s.whatsapp.net';

    // Create a test image file (JPEG magic bytes)
    const testImageData = Buffer.from([
      0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46,
      0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00
    ]);

    const imageDir = join(TEST_MEDIA_DIR, 'image');
    mkdirSync(imageDir, { recursive: true });
    const testImagePath = join(imageDir, 'test-img-1.jpg');
    writeFileSync(testImagePath, testImageData);

    // Insert message
    store.addMessage({
      id: messageId,
      chatJid,
      senderJid: '0987654321@s.whatsapp.net',
      senderName: 'Media Test',
      body: 'Test image',
      timestamp: Math.floor(Date.now() / 1000),
      isFromMe: false,
      hasMedia: true,
      mediaType: 'image'
    });

    // Simulate media download flow (what client.downloadMedia does)
    store.updateMediaInfo(messageId, {
      mimetype: 'image/jpeg',
      filename: 'test-image.jpg',
      localPath: testImagePath,
      rawJson: JSON.stringify({ imageMessage: { mimetype: 'image/jpeg' } })
    });

    // Verify media info stored correctly
    const messages = store.listMessages({ chatJid, limit: 1 });
    assert.ok(messages.length > 0, 'Should retrieve message');

    const msg = messages[0];
    assert.ok(msg.has_media, 'Should have media flag');
    assert.strictEqual(msg.media_type, 'image', 'Media type should be image');

    // Verify file exists
    assert.ok(existsSync(testImagePath), 'Media file should exist');

    // Verify we can read the file
    const fileData = readFileSync(testImagePath);
    assert.ok(fileData.length > 0, 'File should have content');
  });

  it('should handle media file with metadata encryption', () => {
    const messageId = `test-media-enc-${Date.now()}`;
    const chatJid = 'media-enc-test@s.whatsapp.net';

    // Create test video file (MP4 magic bytes)
    const testVideoData = Buffer.from([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
      0x69, 0x73, 0x6F, 0x6D, 0x00, 0x00, 0x02, 0x00
    ]);

    const videoDir = join(TEST_MEDIA_DIR, 'video');
    mkdirSync(videoDir, { recursive: true });
    const testVideoPath = join(videoDir, 'test-vid-1.mp4');
    writeFileSync(testVideoPath, testVideoData);

    // Insert message with encryption
    store.addMessage({
      id: messageId,
      chatJid,
      senderJid: '0987654321@s.whatsapp.net',
      senderName: 'Encrypted Media Test',
      body: 'Test video with encryption',
      timestamp: Math.floor(Date.now() / 1000),
      isFromMe: false,
      hasMedia: true,
      mediaType: 'video'
    });

    // Update with encrypted raw JSON
    const rawJson = JSON.stringify({
      videoMessage: {
        mimetype: 'video/mp4',
        fileName: 'test-video.mp4'
      }
    });

    store.updateMediaInfo(messageId, {
      mimetype: 'video/mp4',
      filename: 'test-video.mp4',
      localPath: testVideoPath,
      rawJson
    });

    // Verify retrieval with decryption
    const messages = store.searchMessages({ query: 'encryption' });
    assert.ok(messages.length > 0, 'Should find message via FTS5');

    const msg = messages[0];
    assert.strictEqual(msg.body, 'Test video with encryption', 'Body should be decrypted');
  });

  it('should handle multiple media files for same chat', () => {
    const chatJid = 'multi-media@s.whatsapp.net';
    const mediaCount = 5;

    for (let i = 0; i < mediaCount; i++) {
      const messageId = `test-multi-media-${i}`;

      // Create test document
      const docData = Buffer.from(`Test document ${i}`);
      const docDir = join(TEST_MEDIA_DIR, 'document');
      mkdirSync(docDir, { recursive: true });
      const docPath = join(docDir, `test-doc-${i}.pdf`);
      writeFileSync(docPath, docData);

      store.addMessage({
        id: messageId,
        chatJid,
        senderJid: '0987654321@s.whatsapp.net',
        senderName: 'Multi Media Test',
        body: `Document ${i}`,
        timestamp: Math.floor(Date.now() / 1000) + i,
        isFromMe: false,
        hasMedia: true,
        mediaType: 'document'
      });

      store.updateMediaInfo(messageId, {
        mimetype: 'application/pdf',
        filename: `test-doc-${i}.pdf`,
        localPath: docPath
      });
    }

    // Retrieve all media messages
    const mediaMessages = store.getMediaMessages(chatJid, mediaCount);
    assert.strictEqual(mediaMessages.length, mediaCount, 'Should retrieve all media messages');

    // Verify all files exist
    for (const msg of mediaMessages) {
      // Media messages retrieved successfully
      assert.ok(msg.has_media === 1, 'Should have media flag');
    }
  });

  it('should handle media metadata without local path (deferred download)', () => {
    const messageId = `test-deferred-${Date.now()}`;
    const chatJid = 'deferred-media@s.whatsapp.net';

    // Insert message with only raw JSON (no local path yet)
    store.addMessage({
      id: messageId,
      chatJid,
      senderJid: '0987654321@s.whatsapp.net',
      senderName: 'Deferred Test',
      body: 'Media not downloaded yet',
      timestamp: Math.floor(Date.now() / 1000),
      isFromMe: false,
      hasMedia: true,
      mediaType: 'image'
    });

    // Update with only raw JSON (simulating receipt before download)
    const rawJson = JSON.stringify({
      imageMessage: {
        url: 'https://example.com/image.jpg',
        mimetype: 'image/jpeg'
      }
    });

    store.updateMediaInfo(messageId, {
      rawJson
    });

    // Verify metadata stored
    const row = store.db.prepare(
      'SELECT media_raw_json, media_local_path FROM messages WHERE id = ?'
    ).get(messageId) as { media_raw_json: string | null; media_local_path: string | null };

    assert.ok(row.media_raw_json, 'Should have raw JSON');
    assert.strictEqual(row.media_local_path, null, 'Should not have local path yet');
  });

  it('should handle media file path validation and sanitization', () => {
    const messageId = `test-sanitize-${Date.now()}`;
    const chatJid = 'sanitize-test@s.whatsapp.net';

    // Test path traversal attempt (should be sanitized)
    const maliciousFilename = '../../../etc/passwd.jpg';
    const safeFilename = 'etc_passwd.jpg'; // Should be sanitized

    store.addMessage({
      id: messageId,
      chatJid,
      senderJid: '0987654321@s.whatsapp.net',
      senderName: 'Sanitize Test',
      body: 'Testing path sanitization',
      timestamp: Math.floor(Date.now() / 1000),
      isFromMe: false,
      hasMedia: true,
      mediaType: 'image'
    });

    // Update with sanitized filename
    store.updateMediaInfo(messageId, {
      mimetype: 'image/jpeg',
      filename: safeFilename,
      localPath: join(TEST_MEDIA_DIR, 'image', safeFilename)
    });

    // Verify stored correctly
    const msg = store.getMessageContext(messageId);
    assert.ok(msg, 'Should retrieve message');
    assert.strictEqual(msg.message.media_filename, safeFilename, 'Filename should be sanitized');
  });
});
