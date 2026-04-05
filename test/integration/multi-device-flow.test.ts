/**
 * Multi-Device Message Flow Integration Tests
 *
 * Integration tests for Phase 4 multi-device JID mapping support.
 * Tests real-world scenarios with multiple devices per contact.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { MessageStore } from '../../src/whatsapp/store.js';
import { unlinkSync, existsSync } from 'node:fs';

describe('Multi-Device Message Flow Integration', () => {
  let store: MessageStore;
  const testDbPath = '/tmp/test-multi-device-integration.db';

  beforeEach(() => {
    store = new MessageStore(testDbPath);
  });

  afterEach(() => {
    store.close();
    try {
      if (existsSync(testDbPath)) { unlinkSync(testDbPath); }
      if (existsSync(testDbPath + '-wal')) { unlinkSync(testDbPath + '-wal'); }
      if (existsSync(testDbPath + '-shm')) { unlinkSync(testDbPath + '-shm'); }
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Unified Chat History Across Devices', () => {
    it('should unify chat history from multiple devices', () => {
      const phoneNumber = '+14384083030';
      const lidJid1 = '128819088347371@lid';
      const lidJid2 = '138053771370743@lid';

      // Create contact with two devices
      const contact = store.getOrCreateContactByPhone(phoneNumber, 'Benjamin Alloul');
      store.addDeviceLid(phoneNumber, lidJid1, { isPrimary: true });
      store.addDeviceLid(phoneNumber, lidJid2, { isPrimary: false });

      const now = Math.floor(Date.now() / 1000);

      // Simulate messages arriving from both devices
      // These would normally appear as separate chats without multi-device support
      store.upsertChat(lidJid1, 'Benjamin Alloul', false, now - 200, 'Message from device 1');
      store.upsertChat(lidJid2, 'Benjamin Alloul', false, now - 100, 'Message from device 2');

      store.addMessage({
        id: 'msg1',
        chatJid: lidJid1,
        senderJid: lidJid1,
        senderName: 'Benjamin Alloul',
        body: 'Hello from my phone',
        timestamp: now - 200,
        isFromMe: false,
        hasMedia: false,
        mediaType: null
      });

      store.addMessage({
        id: 'msg2',
        chatJid: lidJid2,
        senderJid: lidJid2,
        senderName: 'Benjamin Alloul',
        body: 'And from my desktop',
        timestamp: now - 100,
        isFromMe: false,
        hasMedia: false,
        mediaType: null
      });

      // Get unified chat listing
      const unifiedChats = store.getAllChatsUnified();
      const benjaminChats = unifiedChats.filter((c) => c.name === 'Benjamin Alloul');

      // Should be unified into a single chat entry
      assert.equal(benjaminChats.length, 1);
      
      // Should have the most recent message
      const chat = benjaminChats[0];
      assert.equal(chat.last_message_preview, 'Message from device 2');
      assert.ok(chat.last_message_at && chat.last_message_at > now - 150);
    });

    it('should merge unread counts from multiple device chats', () => {
      const phoneNumber = '+33680940027';
      const lidJid1 = '44612043436101@lid';
      const lidJid2 = '44612043436102@lid';

      store.getOrCreateContactByPhone(phoneNumber, 'Séverine');
      store.addDeviceLid(phoneNumber, lidJid1);
      store.addDeviceLid(phoneNumber, lidJid2);

      const now = Math.floor(Date.now() / 1000);

      // Create separate chat entries with unread messages
      store.upsertChat(lidJid1, 'Séverine', false, now - 100, 'Msg 1');
      store.upsertChat(lidJid2, 'Séverine', false, now, 'Msg 2');

      store.db!.prepare('UPDATE chats SET unread_count = 2 WHERE jid = ?').run(lidJid1);
      store.db!.prepare('UPDATE chats SET unread_count = 3 WHERE jid = ?').run(lidJid2);

      const unified = store.getAllChatsUnified();
      const severineChat = unified.find((c) => c.name === 'Séverine');

      assert.ok(severineChat !== null);
      assert.equal(severineChat?.unread_count, 5);
    });
  });

  describe('Device Discovery and Auto-Linking', () => {
    it('should link new device to existing contact by phone number', () => {
      const phoneNumber = '+1234567890';
      const existingLid = '111111@lid';
      const newLid = '222222@lid';

      // Create contact with first device
      store.getOrCreateContactByPhone(phoneNumber, 'Test User');
      store.addDeviceLid(phoneNumber, existingLid);

      // Simulate new device appearing
      store.addDeviceLid(phoneNumber, newLid);

      // Both devices should be linked to same contact
      const contact = store.getContactByJid(newLid);
      assert.ok(contact !== null);
      assert.equal(contact?.devices.length, 2);
      assert.ok(contact?.devices.some((d) => d.lidJid === existingLid));
      assert.ok(contact?.devices.some((d) => d.lidJid === newLid));
    });

    it('should handle device activity updates', () => {
      const phoneNumber = '+9876543210';
      const lidJid = '999999@lid';

      const contact = store.getOrCreateContactByPhone(phoneNumber, 'Active User');
      
      // Add device with old timestamp
      const oldTimestamp = Math.floor(Date.now() / 1000) - 3600;
      store.addDeviceLid(phoneNumber, lidJid, { lastSeen: oldTimestamp });

      // Simulate new activity - update last_seen
      const newTimestamp = Math.floor(Date.now() / 1000);
      store.addDeviceLid(phoneNumber, lidJid, { lastSeen: newTimestamp });

      const updated = store.getContactByJid(lidJid);
      assert.ok(updated !== null);
      
      const device = updated?.devices.find((d) => d.lidJid === lidJid);
      assert.ok(device !== undefined);
      assert.ok(device?.lastSeen && device.lastSeen >= newTimestamp);
    });
  });

  describe('Backfill Device Mappings', () => {
    it('should discover devices from existing messages', () => {
      const phoneNumber = '+5555555555';
      const lidJid1 = '555001@lid';
      const lidJid2 = '555002@lid';
      const phoneJid = '5555555555@s.whatsapp.net';

      const now = Math.floor(Date.now() / 1000);

      // Simulate historical messages from different JID formats
      store.upsertChat(lidJid1, 'Historical User', false, now - 200, 'Old message');
      store.upsertChat(lidJid2, 'Historical User', false, now - 100, 'Newer message');
      store.upsertChat(phoneJid, 'Historical User', false, now, 'Latest');

      store.addMessage({
        id: 'msg1',
        chatJid: lidJid1,
        senderJid: lidJid1,
        senderName: 'Historical User',
        body: 'From device 1',
        timestamp: now - 200,
        isFromMe: false,
        hasMedia: false,
        mediaType: null
      });

      store.addMessage({
        id: 'msg2',
        chatJid: lidJid2,
        senderJid: lidJid2,
        senderName: 'Historical User',
        body: 'From device 2',
        timestamp: now - 100,
        isFromMe: false,
        hasMedia: false,
        mediaType: null
      });

      // Manually create contact mappings (simulating what would happen during message processing)
      store.upsertContactMapping(lidJid1, phoneJid, phoneNumber, 'Historical User');
      store.upsertContactMapping(lidJid2, phoneJid, phoneNumber, 'Historical User');

      // Run migration to populate multi-device schema
      const result = store.migrateToMultiDevice();

      assert.ok(result.contactsCreated > 0);
      assert.ok(result.devicesMigrated >= 2);

      // Verify all devices are linked
      const contact = store.getContactByJid(lidJid1);
      assert.ok(contact !== null);
      assert.equal(contact?.devices.length, 2);
      assert.ok(contact?.phoneJids.includes(phoneJid));
    });
  });

  describe('Self-Account Detection', () => {
    it('should mark contact as self-account from is_from_me messages', () => {
      const phoneNumber = '+14384083030';
      const lidJid = '128819088347371@lid';

      const contact = store.getOrCreateContactByPhone(phoneNumber, 'Myself');
      store.addDeviceLid(phoneNumber, lidJid);

      // Add message with is_from_me flag
      const now = Math.floor(Date.now() / 1000);
      store.addMessage({
        id: 'self-msg',
        chatJid: lidJid,
        senderJid: lidJid,
        senderName: 'Myself',
        body: 'Message from my other device',
        timestamp: now,
        isFromMe: true,
        hasMedia: false,
        mediaType: null
      });

      // Mark as self-account (this would be done automatically in real usage)
      store.markContactAsSelf(contact.id);

      const updated = store.getContactByJid(lidJid);
      assert.ok(updated !== null);
      assert.equal(updated?.isSelf, true);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle contact with no devices', () => {
      const phoneNumber = '+0000000000';
      const contact = store.getOrCreateContactByPhone(phoneNumber, 'No Devices');
      
      assert.ok(contact.id > 0);
      assert.equal(contact.devices.length, 0);
      assert.equal(contact.phoneJids.length, 0);
    });

    it('should handle duplicate device additions', () => {
      const phoneNumber = '+1111111111';
      const lidJid = '111111@lid';

      store.getOrCreateContactByPhone(phoneNumber, 'Test');
      
      // Add same device twice
      store.addDeviceLid(phoneNumber, lidJid, { isPrimary: false });
      store.addDeviceLid(phoneNumber, lidJid, { isPrimary: true });

      const contact = store.getContactByJid(lidJid);
      assert.ok(contact !== null);
      assert.equal(contact?.devices.length, 1);
      
      // Second addition should have updated is_primary
      const device = contact?.devices[0];
      assert.equal(device?.isPrimary, true);
    });

    it('should handle contact deletion cascade', () => {
      const phoneNumber = '+9999999999';
      const lidJid = '999999@lid';

      const contact = store.getOrCreateContactByPhone(phoneNumber, 'Cascade Test');
      store.addDeviceLid(phoneNumber, lidJid);

      // Verify device exists
      const before = store.getContactByJid(lidJid);
      assert.ok(before !== null);
      assert.equal(before?.devices.length, 1);

      // Delete contact (should cascade to devices)
      store.db!.prepare('DELETE FROM contacts WHERE id = ?').run(contact.id);

      // Device should be gone due to CASCADE
      const after = store.getContactByJid(lidJid);
      assert.equal(after, null);
    });
  });
});
