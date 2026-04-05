/**
 * JID Unification Integration Tests
 *
 * Tests for the contact_mappings feature that unifies duplicate chat entries
 * caused by @lid and @s.whatsapp.net JID formats.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MessageStore } from '../../src/whatsapp/store.js';
import { isLidJid, isPhoneJid, extractPhoneNumber, normalizeJid, resolveJid } from '../../src/utils/jid-utils.js';

describe('JID Unification', () => {
  let store: MessageStore;
  const testDbPath = '/tmp/test-jid-unification.db';

  beforeEach(() => {
    store = new MessageStore(testDbPath);
  });

  afterEach(() => {
    store.close();
    // Clean up test database
    try {
      const fs = require('fs');
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }
      // Also remove WAL and SHM files if they exist
      if (fs.existsSync(testDbPath + '-wal')) {
        fs.unlinkSync(testDbPath + '-wal');
      }
      if (fs.existsSync(testDbPath + '-shm')) {
        fs.unlinkSync(testDbPath + '-shm');
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('JID Utilities', () => {
    it('should detect LID JIDs', () => {
      expect(isLidJid('44612043436101@lid')).toBe(true);
      expect(isLidJid('128819088347371@lid')).toBe(true);
      expect(isLidJid('33680940027@s.whatsapp.net')).toBe(false);
      expect(isLidJid('1234567890@g.us')).toBe(false);
    });

    it('should detect phone JIDs', () => {
      expect(isPhoneJid('33680940027@s.whatsapp.net')).toBe(true);
      expect(isPhoneJid('14384083030@s.whatsapp.net')).toBe(true);
      expect(isPhoneJid('44612043436101@lid')).toBe(false);
      expect(isPhoneJid('1234567890@g.us')).toBe(false);
    });

    it('should extract phone numbers from JIDs', () => {
      expect(extractPhoneNumber('33680940027@s.whatsapp.net')).toBe('33680940027');
      expect(extractPhoneNumber('44612043436101@lid')).toBe('44612043436101');
      expect(extractPhoneNumber('1234567890@g.us')).toBe('1234567890');
      expect(extractPhoneNumber('invalid')).toBe(null);
    });

    it('should normalize JIDs using mappings', () => {
      const mappings = [
        {
          id: 1,
          lid_jid: '44612043436101@lid',
          phone_jid: '33680940027@s.whatsapp.net',
          phone_number: '+33680940027',
          contact_name: 'Séverine Godet',
          created_at: Date.now(),
          updated_at: Date.now()
        }
      ];

      // Should prefer LID format
      expect(normalizeJid('33680940027@s.whatsapp.net', mappings)).toBe('44612043436101@lid');
      expect(normalizeJid('44612043436101@lid', mappings)).toBe('44612043436101@lid');
      
      // Unknown JID should be returned as-is
      expect(normalizeJid('9999999999@s.whatsapp.net', mappings)).toBe('9999999999@s.whatsapp.net');
    });

    it('should resolve recipient strings to JIDs', () => {
      const mappings = [
        {
          id: 1,
          lid_jid: '44612043436101@lid',
          phone_jid: '33680940027@s.whatsapp.net',
          phone_number: '+33680940027',
          contact_name: 'Séverine Godet',
          created_at: Date.now(),
          updated_at: Date.now()
        }
      ];

      // Phone number should resolve to LID
      expect(resolveJid('+33680940027', mappings)).toBe('44612043436101@lid');
      expect(resolveJid('33680940027', mappings)).toBe('44612043436101@lid');
      
      // JID should be normalized
      expect(resolveJid('33680940027@s.whatsapp.net', mappings)).toBe('44612043436101@lid');
      
      // Unknown recipient should be converted to phone JID
      expect(resolveJid('1234567890', mappings)).toBe('1234567890@s.whatsapp.net');
    });
  });

  describe('Contact Mappings', () => {
    it('should store and retrieve contact mappings', () => {
      const lidJid = '44612043436101@lid';
      const phoneJid = '33680940027@s.whatsapp.net';
      const phoneNumber = '+33680940027';
      const contactName = 'Séverine Godet';

      // Store mapping
      store.upsertContactMapping(lidJid, phoneJid, phoneNumber, contactName);

      // Retrieve by LID
      const byLid = store.getContactMappingByLid(lidJid);
      expect(byLid).not.toBeNull();
      expect(byLid?.lid_jid).toBe(lidJid);
      expect(byLid?.phone_jid).toBe(phoneJid);
      expect(byLid?.phone_number).toBe(phoneNumber);
      expect(byLid?.contact_name).toBe(contactName);

      // Retrieve by phone JID
      const byPhoneJid = store.getContactMappingByPhoneJid(phoneJid);
      expect(byPhoneJid).not.toBeNull();
      expect(byPhoneJid?.lid_jid).toBe(lidJid);

      // Retrieve by phone number
      const byPhone = store.getContactMappingByPhone(phoneNumber);
      expect(byPhone).not.toBeNull();
      expect(byPhone?.lid_jid).toBe(lidJid);
    });

    it('should update existing mappings', () => {
      const lidJid = '128819088347371@lid';
      const phoneJid = '14384083030@s.whatsapp.net';
      
      // Store initial mapping
      store.upsertContactMapping(lidJid, phoneJid, '+14384083030', 'Benjamin Alloul');
      
      // Update with additional info
      store.upsertContactMapping(lidJid, phoneJid, '+14384083030', 'Benjamin Alloul Updated');
      
      const mapping = store.getContactMappingByLid(lidJid);
      expect(mapping).not.toBeNull();
      expect(mapping?.contact_name).toBe('Benjamin Alloul Updated');
    });

    it('should get unified JID', () => {
      const lidJid = '44612043436101@lid';
      const phoneJid = '33680940027@s.whatsapp.net';
      
      store.upsertContactMapping(lidJid, phoneJid, '+33680940027', 'Test Contact');
      
      // Should prefer LID
      expect(store.getUnifiedJid(phoneJid)).toBe(lidJid);
      expect(store.getUnifiedJid(lidJid)).toBe(lidJid);
      
      // Unknown JID should be returned as-is
      expect(store.getUnifiedJid('unknown@s.whatsapp.net')).toBe('unknown@s.whatsapp.net');
    });

    it('should get JID mapping details', () => {
      const lidJid = '44612043436101@lid';
      const phoneJid = '33680940027@s.whatsapp.net';
      const phoneNumber = '+33680940027';
      
      store.upsertContactMapping(lidJid, phoneJid, phoneNumber, 'Test Contact');
      
      const mapping = store.getJidMapping(phoneJid);
      expect(mapping).not.toBeNull();
      expect(mapping?.lidJid).toBe(lidJid);
      expect(mapping?.phoneJid).toBe(phoneJid);
      expect(mapping?.phoneNumber).toBe(phoneNumber);
    });
  });

  describe('Unified Chat Listing', () => {
    it('should merge duplicate chats with different JID formats', () => {
      const lidJid = '44612043436101@lid';
      const phoneJid = '33680940027@s.whatsapp.net';
      const contactName = 'Séverine Godet';
      
      // Create mapping
      store.upsertContactMapping(lidJid, phoneJid, '+33680940027', contactName);
      
      // Create duplicate chats
      const now = Math.floor(Date.now() / 1000);
      store.upsertChat(lidJid, contactName, false, now - 100, 'Message from LID');
      store.upsertChat(phoneJid, contactName, false, now, 'Message from phone JID');
      
      // Get unified chats
      const unified = store.getAllChatsUnified();
      
      // Should have only one chat entry for this contact
      const matchingChats = unified.filter((c) => c.name === contactName);
      expect(matchingChats.length).toBe(1);
      
      // Should prefer LID JID
      expect(matchingChats[0].jid).toBe(lidJid);
      
      // Should have the most recent message
      expect(matchingChats[0].last_message_preview).toBe('Message from phone JID');
    });

    it('should preserve group chats without merging', () => {
      const groupJid = '123456789@g.us';
      const groupName = 'Test Group';
      const now = Math.floor(Date.now() / 1000);
      
      store.upsertChat(groupJid, groupName, true, now, 'Group message');
      
      const unified = store.getAllChatsUnified();
      const groupChat = unified.find((c) => c.jid === groupJid);
      
      expect(groupChat).not.toBeNull();
      expect(groupChat?.is_group).toBe(1);
    });

    it('should handle chats without mappings', () => {
      const unknownJid = '9999999999@s.whatsapp.net';
      const now = Math.floor(Date.now() / 1000);
      
      store.upsertChat(unknownJid, 'Unknown Contact', false, now, 'Test message');
      
      const unified = store.getAllChatsUnified();
      const unknownChat = unified.find((c) => c.jid === unknownJid);
      
      expect(unknownChat).not.toBeNull();
      expect(unknownChat?.jid).toBe(unknownJid);
    });

    it('should merge unread counts from duplicate chats', () => {
      const lidJid = '44612043436101@lid';
      const phoneJid = '33680940027@s.whatsapp.net';
      
      store.upsertContactMapping(lidJid, phoneJid, '+33680940027', 'Test Contact');
      
      const now = Math.floor(Date.now() / 1000);
      // Create chats with unread counts
      store.upsertChat(lidJid, 'Test Contact', false, now - 100, 'Message 1');
      store.upsertChat(phoneJid, 'Test Contact', false, now, 'Message 2');
      
      // Manually set unread counts (since upsertChat doesn't set them)
      store.db!.prepare('UPDATE chats SET unread_count = 2 WHERE jid = ?').run(lidJid);
      store.db!.prepare('UPDATE chats SET unread_count = 3 WHERE jid = ?').run(phoneJid);
      
      const unified = store.getAllChatsUnified();
      const merged = unified.find((c) => c.name === 'Test Contact');
      
      expect(merged).not.toBeNull();
      expect(merged?.unread_count).toBe(5); // 2 + 3
    });
  });

  describe('Migration', () => {
    it('should migrate existing duplicate chats', () => {
      const lidJid = '44612043436101@lid';
      const phoneJid = '33680940027@s.whatsapp.net';
      const contactName = 'Séverine Godet';
      const now = Math.floor(Date.now() / 1000);
      
      // Create duplicate chats (simulating pre-migration state)
      store.upsertChat(lidJid, contactName, false, now - 100, 'LID message');
      store.upsertChat(phoneJid, contactName, false, now, 'Phone JID message');
      
      // Run migration
      const result = store.migrateDuplicateChats();
      
      expect(result.migrated).toBeGreaterThan(0);
      
      // Verify mapping was created
      const mapping = store.getContactMappingByLid(lidJid);
      expect(mapping).not.toBeNull();
      expect(mapping?.phone_jid).toBe(phoneJid);
      expect(mapping?.contact_name).toBe(contactName);
    });

    it('should skip chats without duplicates', () => {
      const uniqueJid = '1234567890@s.whatsapp.net';
      const uniqueName = 'Unique Contact';
      const now = Math.floor(Date.now() / 1000);
      
      store.upsertChat(uniqueJid, uniqueName, false, now, 'Unique message');
      
      const result = store.migrateDuplicateChats();
      
      expect(result.skipped).toBeGreaterThan(0);
      
      // No mapping should be created
      const mapping = store.getContactMappingByPhoneJid(uniqueJid);
      expect(mapping).toBeNull();
    });

    it('should handle multiple duplicate pairs', () => {
      const now = Math.floor(Date.now() / 1000);
      
      // Create two sets of duplicates
      store.upsertChat('1111111111@lid', 'Contact A', false, now, 'A LID');
      store.upsertChat('1111111111@s.whatsapp.net', 'Contact A', false, now, 'A Phone');
      
      store.upsertChat('2222222222@lid', 'Contact B', false, now, 'B LID');
      store.upsertChat('2222222222@s.whatsapp.net', 'Contact B', false, now, 'B Phone');
      
      const result = store.migrateDuplicateChats();
      
      expect(result.migrated).toBe(2);
      
      // Verify both mappings
      const mappingA = store.getContactMappingByLid('1111111111@lid');
      const mappingB = store.getContactMappingByLid('2222222222@lid');
      
      expect(mappingA).not.toBeNull();
      expect(mappingB).not.toBeNull();
    });
  });

  describe('Integration with Messages', () => {
    it('should handle messages with different JID formats', () => {
      const lidJid = '44612043436101@lid';
      const phoneJid = '33680940027@s.whatsapp.net';
      
      store.upsertContactMapping(lidJid, phoneJid, '+33680940027', 'Test Contact');
      
      const now = Math.floor(Date.now() / 1000);
      
      // Add messages with different JID formats
      store.addMessage({
        id: 'msg1',
        chatJid: phoneJid,
        senderJid: phoneJid,
        senderName: 'Test Contact',
        body: 'Message from phone JID',
        timestamp: now - 100,
        isFromMe: false,
        hasMedia: false,
        mediaType: null
      });
      
      store.addMessage({
        id: 'msg2',
        chatJid: lidJid,
        senderJid: lidJid,
        senderName: 'Test Contact',
        body: 'Message from LID',
        timestamp: now,
        isFromMe: false,
        hasMedia: false,
        mediaType: null
      });
      
      // Get unified chat
      const unified = store.getAllChatsUnified();
      const chat = unified.find((c) => c.name === 'Test Contact');
      
      expect(chat).not.toBeNull();
      expect(chat?.jid).toBe(lidJid);
      
      // Both messages should be accessible
      const messages1 = store.listMessages({ chatJid: phoneJid, limit: 10 });
      const messages2 = store.listMessages({ chatJid: lidJid, limit: 10 });
      
      expect(messages1.length).toBe(1);
      expect(messages2.length).toBe(1);
    });
  });
});
