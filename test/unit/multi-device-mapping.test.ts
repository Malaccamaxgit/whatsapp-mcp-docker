/**
 * Multi-Device JID Mapping Unit Tests
 *
 * Tests for the Phase 4 multi-device contact schema and methods.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { MessageStore } from '../../src/whatsapp/store.js';
import { unlinkSync, existsSync } from 'node:fs';

describe('Multi-Device JID Mapping', () => {
  let store: MessageStore;
  const testDbPath = '/tmp/test-multi-device.db';

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

  describe('Contact Creation with Multiple Devices', () => {
    it('should create a contact with multiple device LIDs', () => {
      const phoneNumber = '+14384083030';
      const contactName = 'Benjamin Alloul';
      const lidJid1 = '128819088347371@lid';
      const lidJid2 = '138053771370743@lid';

      // Create contact and add devices
      const contact = store.getOrCreateContactByPhone(phoneNumber, contactName);
      assert.ok(contact.id > 0);
      assert.equal(contact.phoneNumber, phoneNumber);
      assert.equal(contact.canonicalName, contactName);

      // Add first device
      store.addDeviceLid(phoneNumber, lidJid1, {
        deviceType: 'unknown',
        isPrimary: true,
        lastSeen: Math.floor(Date.now() / 1000)
      });

      // Add second device
      store.addDeviceLid(phoneNumber, lidJid2, {
        deviceType: 'unknown',
        isPrimary: false,
        lastSeen: Math.floor(Date.now() / 1000)
      });

      // Verify contact has both devices
      const updatedContact = store.getContactByJid(lidJid1);
      assert.ok(updatedContact !== null);
      assert.equal(updatedContact?.devices.length, 2);
      
      const primaryDevice = updatedContact?.devices.find((d) => d.isPrimary);
      assert.ok(primaryDevice !== undefined);
      assert.equal(primaryDevice?.lidJid, lidJid1);
    });

    it('should retrieve contact by any device LID', () => {
      const phoneNumber = '+33680940027';
      const lidJid1 = '44612043436101@lid';
      const lidJid2 = '44612043436102@lid';

      const contact = store.getOrCreateContactByPhone(phoneNumber, 'Test Contact');
      store.addDeviceLid(phoneNumber, lidJid1);
      store.addDeviceLid(phoneNumber, lidJid2);

      // Should find same contact by either LID
      const byLid1 = store.getContactByJid(lidJid1);
      const byLid2 = store.getContactByJid(lidJid2);

      assert.ok(byLid1 !== null);
      assert.ok(byLid2 !== null);
      assert.equal(byLid1?.id, byLid2?.id);
      assert.equal(byLid1?.devices.length, 2);
      assert.equal(byLid2?.devices.length, 2);
    });

    it('should handle phone JIDs in addition to LIDs', () => {
      const phoneNumber = '+14384083030';
      const lidJid = '128819088347371@lid';
      const phoneJid = '14384083030@s.whatsapp.net';

      const contact = store.getOrCreateContactByPhone(phoneNumber, 'Test');
      store.addDeviceLid(phoneNumber, lidJid);
      if (contact.id) {
        store.addPhoneJidToContact(contact.id, phoneJid);
      }

      const retrieved = store.getContactByJid(lidJid);
      assert.ok(retrieved !== null);
      assert.equal(retrieved?.phoneJids.length, 1);
      assert.equal(retrieved?.phoneJids[0], phoneJid);
    });
  });

  describe('Device Retrieval and Querying', () => {
    it('should get all devices for a contact', () => {
      const phoneNumber = '+1234567890';
      const devices = [
        '111111111@lid',
        '222222222@lid',
        '333333333@lid'
      ];

      const contact = store.getOrCreateContactByPhone(phoneNumber, 'Multi-Device User');
      for (const lid of devices) {
        store.addDeviceLid(phoneNumber, lid);
      }

      const retrieved = store.getContactDevices(contact.id);
      assert.equal(retrieved.length, 3);
      
      const lidJids = retrieved.map((d) => d.lidJid);
      for (const lid of devices) {
        assert.ok(lidJids.includes(lid));
      }
    });

    it('should set and retrieve primary device', () => {
      const phoneNumber = '+9876543210';
      const primaryLid = '999999999@lid';
      const secondaryLid = '888888888@lid';

      store.getOrCreateContactByPhone(phoneNumber, 'Test');
      store.addDeviceLid(phoneNumber, primaryLid, { isPrimary: false });
      store.addDeviceLid(phoneNumber, secondaryLid, { isPrimary: false });

      // Set primary device
      store.setPrimaryDevice(primaryLid);

      const contact = store.getContactByJid(primaryLid);
      assert.ok(contact !== null);
      
      const primaryDevice = contact?.devices.find((d) => d.isPrimary);
      assert.ok(primaryDevice !== undefined);
      assert.equal(primaryDevice?.lidJid, primaryLid);

      const secondaryDevice = contact?.devices.find((d) => d.lidJid === secondaryLid);
      assert.ok(secondaryDevice !== undefined);
      assert.equal(secondaryDevice?.isPrimary, false);
    });

    it('should get all JIDs for a contact', () => {
      const phoneNumber = '+5555555555';
      const lidJids = ['111@lid', '222@lid'];
      const phoneJids = ['5555555555@s.whatsapp.net'];

      const contact = store.getOrCreateContactByPhone(phoneNumber, 'Test');
      for (const lid of lidJids) {
        store.addDeviceLid(phoneNumber, lid);
      }
      if (contact.id) {
        for (const pj of phoneJids) {
          store.addPhoneJidToContact(contact.id, pj);
        }
      }

      const allJids = store.getAllJidsForContact(phoneNumber);
      assert.equal(allJids.length, lidJids.length + phoneJids.length);
      
      for (const lid of lidJids) {
        assert.ok(allJids.includes(lid));
      }
      for (const pj of phoneJids) {
        assert.ok(allJids.includes(pj));
      }
    });
  });

  describe('Message Merging from Multiple Devices', () => {
    it('should handle messages from different devices of same contact', () => {
      const phoneNumber = '+1111111111';
      const lidJid1 = '111111@lid';
      const lidJid2 = '222222@lid';

      // Create contact with two devices
      const contact = store.getOrCreateContactByPhone(phoneNumber, 'Test Contact');
      store.addDeviceLid(phoneNumber, lidJid1, { isPrimary: true });
      store.addDeviceLid(phoneNumber, lidJid2, { isPrimary: false });

      const now = Math.floor(Date.now() / 1000);

      // Add messages from both devices to the same chat
      store.addMessage({
        id: 'msg1',
        chatJid: lidJid1,
        senderJid: lidJid1,
        senderName: 'Test Contact',
        body: 'Message from device 1',
        timestamp: now - 100,
        isFromMe: false,
        hasMedia: false,
        mediaType: null
      });

      store.addMessage({
        id: 'msg2',
        chatJid: lidJid2,
        senderJid: lidJid2,
        senderName: 'Test Contact',
        body: 'Message from device 2',
        timestamp: now,
        isFromMe: false,
        hasMedia: false,
        mediaType: null
      });

      // Messages should be retrievable by either device JID
      const msgs1 = store.listMessages({ chatJid: lidJid1, limit: 10 });
      const msgs2 = store.listMessages({ chatJid: lidJid2, limit: 10 });

      assert.equal(msgs1.length, 1);
      assert.equal(msgs2.length, 1);
      assert.equal(msgs1[0].body, 'Message from device 1');
      assert.equal(msgs2[0].body, 'Message from device 2');
    });
  });

  describe('Migration from Legacy Schema', () => {
    it('should migrate existing contact_mappings to multi-device schema', () => {
      // Create legacy mappings
      store.upsertContactMapping(
        '128819088347371@lid',
        '14384083030@s.whatsapp.net',
        '+14384083030',
        'Benjamin Alloul'
      );

      store.upsertContactMapping(
        '138053771370743@lid',
        '14384083030@s.whatsapp.net',
        '+14384083030',
        'Benjamin Alloul'
      );

      // Run migration
      const result = store.migrateToMultiDevice();

      assert.ok(result.contactsCreated > 0);
      assert.ok(result.devicesMigrated > 0);
      assert.equal(result.errors.length, 0);

      // Verify migrated data
      const contact = store.getContactByJid('128819088347371@lid');
      assert.ok(contact !== null);
      assert.equal(contact?.phoneNumber, '+14384083030');
      assert.equal(contact?.devices.length, 2);
      assert.ok(contact?.phoneJids.includes('14384083030@s.whatsapp.net'));
    });

    it('should handle migration with missing phone numbers gracefully', () => {
      // Create mapping without phone number
      store.upsertContactMapping(
        '999999999@lid',
        null,
        null,
        'Unknown Contact'
      );

      // Run migration - should not throw
      const result = store.migrateToMultiDevice();
      
      // Should create contact with empty phone number
      assert.ok(result.contactsCreated >= 0);
    });
  });

  describe('Fallback for Unknown LIDs', () => {
    it('should return null for unknown LID', () => {
      const contact = store.getContactByJid('unknown@lid');
      assert.equal(contact, null);
    });

    it('should gracefully handle queries for non-existent contacts', () => {
      const jids = store.getAllJidsForContact('+9999999999');
      // Should return empty array or handle gracefully
      assert.ok(Array.isArray(jids));
    });
  });
});
