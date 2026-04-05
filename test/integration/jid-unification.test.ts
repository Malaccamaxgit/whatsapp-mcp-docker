/**
 * JID Unification Integration Tests
 *
 * Tests for the contact_mappings feature that unifies duplicate chat entries
 * caused by @lid and @s.whatsapp.net JID formats.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { MessageStore } from '../../src/whatsapp/store.js';
import { isLidJid, isPhoneJid, extractPhoneNumber, normalizeJid, resolveJid } from '../../src/utils/jid-utils.js';
import { unlinkSync, existsSync } from 'node:fs';

describe('JID Unification', () => {
  let store: MessageStore;
  const testDbPath = '/tmp/test-jid-unification.db';

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

  describe('JID Utilities', () => {
    it('should detect LID JIDs', () => {
      assert.equal(isLidJid('44612043436101@lid'), true);
      assert.equal(isLidJid('128819088347371@lid'), true);
      assert.equal(isLidJid('33680940027@s.whatsapp.net'), false);
      assert.equal(isLidJid('1234567890@g.us'), false);
    });

    it('should detect phone JIDs', () => {
      assert.equal(isPhoneJid('33680940027@s.whatsapp.net'), true);
      assert.equal(isPhoneJid('14384083030@s.whatsapp.net'), true);
      assert.equal(isPhoneJid('44612043436101@lid'), false);
      assert.equal(isPhoneJid('1234567890@g.us'), false);
    });

    it('should extract phone numbers from JIDs', () => {
      assert.equal(extractPhoneNumber('33680940027@s.whatsapp.net'), '33680940027');
      assert.equal(extractPhoneNumber('44612043436101@lid'), '44612043436101');
      assert.equal(extractPhoneNumber('1234567890@g.us'), '1234567890');
      assert.equal(extractPhoneNumber('invalid'), null);
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

      assert.equal(normalizeJid('33680940027@s.whatsapp.net', mappings), '44612043436101@lid');
      assert.equal(normalizeJid('44612043436101@lid', mappings), '44612043436101@lid');
      assert.equal(normalizeJid('9999999999@s.whatsapp.net', mappings), '9999999999@s.whatsapp.net');
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

      assert.equal(resolveJid('+33680940027', mappings), '44612043436101@lid');
      assert.equal(resolveJid('33680940027', mappings), '44612043436101@lid');
      assert.equal(resolveJid('33680940027@s.whatsapp.net', mappings), '44612043436101@lid');
      assert.equal(resolveJid('1234567890', mappings), '1234567890@s.whatsapp.net');
    });
  });

  describe('Contact Mappings', () => {
    it('should store and retrieve contact mappings', () => {
      const lidJid = '44612043436101@lid';
      const phoneJid = '33680940027@s.whatsapp.net';
      const phoneNumber = '+33680940027';
      const contactName = 'Séverine Godet';

      store.upsertContactMapping(lidJid, phoneJid, phoneNumber, contactName);

      const byLid = store.getContactMappingByLid(lidJid);
      assert.ok(byLid !== null);
      assert.equal(byLid?.lid_jid, lidJid);
      assert.equal(byLid?.phone_jid, phoneJid);
      assert.equal(byLid?.phone_number, phoneNumber);
      assert.equal(byLid?.contact_name, contactName);

      const byPhoneJid = store.getContactMappingByPhoneJid(phoneJid);
      assert.ok(byPhoneJid !== null);
      assert.equal(byPhoneJid?.lid_jid, lidJid);

      const byPhone = store.getContactMappingByPhone(phoneNumber);
      assert.ok(byPhone !== null);
      assert.equal(byPhone?.lid_jid, lidJid);
    });

    it('should update existing mappings', () => {
      const lidJid = '128819088347371@lid';
      const phoneJid = '14384083030@s.whatsapp.net';

      store.upsertContactMapping(lidJid, phoneJid, '+14384083030', 'Benjamin Alloul');
      store.upsertContactMapping(lidJid, phoneJid, '+14384083030', 'Benjamin Alloul Updated');

      const mapping = store.getContactMappingByLid(lidJid);
      assert.ok(mapping !== null);
      assert.equal(mapping?.contact_name, 'Benjamin Alloul Updated');
    });

    it('should get unified JID', () => {
      const lidJid = '44612043436101@lid';
      const phoneJid = '33680940027@s.whatsapp.net';

      store.upsertContactMapping(lidJid, phoneJid, '+33680940027', 'Test Contact');

      assert.equal(store.getUnifiedJid(phoneJid), lidJid);
      assert.equal(store.getUnifiedJid(lidJid), lidJid);
      assert.equal(store.getUnifiedJid('unknown@s.whatsapp.net'), 'unknown@s.whatsapp.net');
    });

    it('should get JID mapping details', () => {
      const lidJid = '44612043436101@lid';
      const phoneJid = '33680940027@s.whatsapp.net';
      const phoneNumber = '+33680940027';

      store.upsertContactMapping(lidJid, phoneJid, phoneNumber, 'Test Contact');

      const mapping = store.getJidMapping(phoneJid);
      assert.ok(mapping !== null);
      assert.equal(mapping?.lidJid, lidJid);
      assert.equal(mapping?.phoneJid, phoneJid);
      assert.equal(mapping?.phoneNumber, phoneNumber);
    });
  });

  describe('Unified Chat Listing', () => {
    it('should merge duplicate chats with different JID formats', () => {
      const lidJid = '44612043436101@lid';
      const phoneJid = '33680940027@s.whatsapp.net';
      const contactName = 'Séverine Godet';

      store.upsertContactMapping(lidJid, phoneJid, '+33680940027', contactName);

      const now = Math.floor(Date.now() / 1000);
      store.upsertChat(lidJid, contactName, false, now - 100, 'Message from LID');
      store.upsertChat(phoneJid, contactName, false, now, 'Message from phone JID');

      const unified = store.getAllChatsUnified();
      const matchingChats = unified.filter((c) => c.name === contactName);
      assert.equal(matchingChats.length, 1);
      assert.equal(matchingChats[0].jid, lidJid);
      assert.equal(matchingChats[0].last_message_preview, 'Message from phone JID');
    });

    it('should preserve group chats without merging', () => {
      const groupJid = '123456789@g.us';
      const groupName = 'Test Group';
      const now = Math.floor(Date.now() / 1000);

      store.upsertChat(groupJid, groupName, true, now, 'Group message');

      const unified = store.getAllChatsUnified();
      const groupChat = unified.find((c) => c.jid === groupJid);

      assert.ok(groupChat !== null);
      assert.equal(groupChat?.is_group, 1);
    });

    it('should handle chats without mappings', () => {
      const unknownJid = '9999999999@s.whatsapp.net';
      const now = Math.floor(Date.now() / 1000);

      store.upsertChat(unknownJid, 'Unknown Contact', false, now, 'Test message');

      const unified = store.getAllChatsUnified();
      const unknownChat = unified.find((c) => c.jid === unknownJid);

      assert.ok(unknownChat !== null);
      assert.equal(unknownChat?.jid, unknownJid);
    });

    it('should merge unread counts from duplicate chats', () => {
      const lidJid = '44612043436101@lid';
      const phoneJid = '33680940027@s.whatsapp.net';

      store.upsertContactMapping(lidJid, phoneJid, '+33680940027', 'Test Contact');

      const now = Math.floor(Date.now() / 1000);
      store.upsertChat(lidJid, 'Test Contact', false, now - 100, 'Message 1');
      store.upsertChat(phoneJid, 'Test Contact', false, now, 'Message 2');

      store.db!.prepare('UPDATE chats SET unread_count = 2 WHERE jid = ?').run(lidJid);
      store.db!.prepare('UPDATE chats SET unread_count = 3 WHERE jid = ?').run(phoneJid);

      const unified = store.getAllChatsUnified();
      const merged = unified.find((c) => c.name === 'Test Contact');

      assert.ok(merged !== null);
      assert.equal(merged?.unread_count, 5);
    });
  });

  describe('Migration', () => {
    it('should migrate existing duplicate chats', () => {
      const lidJid = '44612043436101@lid';
      const phoneJid = '33680940027@s.whatsapp.net';
      const contactName = 'Séverine Godet';
      const now = Math.floor(Date.now() / 1000);

      store.upsertChat(lidJid, contactName, false, now - 100, 'LID message');
      store.upsertChat(phoneJid, contactName, false, now, 'Phone JID message');

      const result = store.migrateDuplicateChats();

      assert.ok(result.migrated > 0);

      const mapping = store.getContactMappingByLid(lidJid);
      assert.ok(mapping !== null);
      assert.equal(mapping?.phone_jid, phoneJid);
      assert.equal(mapping?.contact_name, contactName);
    });

    it('should skip chats without duplicates', () => {
      const uniqueJid = '1234567890@s.whatsapp.net';
      const uniqueName = 'Unique Contact';
      const now = Math.floor(Date.now() / 1000);

      store.upsertChat(uniqueJid, uniqueName, false, now, 'Unique message');

      const result = store.migrateDuplicateChats();

      // migrateDuplicateChats only increments skipped for same-named groups
      // lacking a @lid/@phone pair. A single unique entry is simply skipped
      // (no counter increment). The intent is: nothing was migrated.
      assert.equal(result.migrated, 0);

      const mapping = store.getContactMappingByPhoneJid(uniqueJid);
      assert.equal(mapping, null);
    });

    it('should handle multiple duplicate pairs', () => {
      const now = Math.floor(Date.now() / 1000);

      store.upsertChat('1111111111@lid', 'Contact A', false, now, 'A LID');
      store.upsertChat('1111111111@s.whatsapp.net', 'Contact A', false, now, 'A Phone');

      store.upsertChat('2222222222@lid', 'Contact B', false, now, 'B LID');
      store.upsertChat('2222222222@s.whatsapp.net', 'Contact B', false, now, 'B Phone');

      const result = store.migrateDuplicateChats();

      assert.equal(result.migrated, 2);

      const mappingA = store.getContactMappingByLid('1111111111@lid');
      const mappingB = store.getContactMappingByLid('2222222222@lid');

      assert.ok(mappingA !== null);
      assert.ok(mappingB !== null);
    });
  });

  describe('Integration with Messages', () => {
    it('should handle messages with different JID formats', () => {
      const lidJid = '44612043436101@lid';
      const phoneJid = '33680940027@s.whatsapp.net';

      store.upsertContactMapping(lidJid, phoneJid, '+33680940027', 'Test Contact');

      const now = Math.floor(Date.now() / 1000);

      // Ensure chat rows exist with names so getAllChatsUnified can find them
      store.upsertChat(phoneJid, 'Test Contact', false, now - 100, null);
      store.upsertChat(lidJid, 'Test Contact', false, now, null);

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

      const unified = store.getAllChatsUnified();
      const chat = unified.find((c) => c.name === 'Test Contact');

      assert.ok(chat !== null);
      assert.equal(chat?.jid, lidJid);

      const messages1 = store.listMessages({ chatJid: phoneJid, limit: 10 });
      const messages2 = store.listMessages({ chatJid: lidJid, limit: 10 });

      assert.equal(messages1.length, 1);
      assert.equal(messages2.length, 1);
    });
  });
});
