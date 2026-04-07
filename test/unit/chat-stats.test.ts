/**
 * Per-chat message statistics (listChatsWithStats / getAllChatsUnified)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MessageStore } from '../../src/whatsapp/store.js';
import { initEncryption } from '../../src/security/crypto.js';

describe('chat message stats (MessageStore)', () => {
  it('listChatsWithStats reports message_count and zero last_hour for old messages', () => {
    initEncryption(null);
    const store = new MessageStore(':memory:');
    const jid = '111122223333@lid';
    const now = Math.floor(Date.now() / 1000);
    store.upsertChat(jid, 'A', false, now - 10_000, 'old');

    for (let i = 0; i < 5; i++) {
      store.addMessage({
        id: `m${i}`,
        chatJid: jid,
        senderJid: jid,
        senderName: 'A',
        body: `msg ${i}`,
        timestamp: now - 7200 - i,
        isFromMe: false,
        hasMedia: false,
        mediaType: null
      });
    }

    const rows = store.listChatsWithStats({ limit: 20, offset: 0 });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].message_count, 5);
    assert.equal(rows[0].messages_last_hour, 0);
  });

  it('listChatsWithStats counts messages in the last hour', () => {
    initEncryption(null);
    const store = new MessageStore(':memory:');
    const jid = '999988887777@s.whatsapp.net';
    const now = Math.floor(Date.now() / 1000);

    store.upsertChat(jid, 'B', false, now, 'x');
    for (let i = 0; i < 3; i++) {
      store.addMessage({
        id: `recent-${i}`,
        chatJid: jid,
        senderJid: jid,
        senderName: 'B',
        body: 'recent',
        timestamp: now - 100 - i,
        isFromMe: true,
        hasMedia: false,
        mediaType: null
      });
    }
    for (let i = 0; i < 2; i++) {
      store.addMessage({
        id: `old-${i}`,
        chatJid: jid,
        senderJid: jid,
        senderName: 'B',
        body: 'old',
        timestamp: now - 5000 - i,
        isFromMe: true,
        hasMedia: false,
        mediaType: null
      });
    }

    const rows = store.listChatsWithStats({ limit: 20, offset: 0 });
    assert.equal(rows[0].message_count, 5);
    assert.equal(rows[0].messages_last_hour, 3);
  });

  it('listChatsWithStats returns zeros for chats with no messages', () => {
    initEncryption(null);
    const store = new MessageStore(':memory:');
    const jid = '444455556666@lid';
    store.upsertChat(jid, 'Empty', false, 1000, null);
    const rows = store.listChatsWithStats({ limit: 20, offset: 0 });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].message_count, 0);
    assert.equal(rows[0].messages_last_hour, 0);
  });

  it('getAllChatsUnified sums message stats across merged LID and phone JIDs', () => {
    initEncryption(null);
    const store = new MessageStore(':memory:');
    const lidJid = '44612043436101@lid';
    const phoneJid = '33680940027@s.whatsapp.net';
    const now = Math.floor(Date.now() / 1000);

    store.upsertContactMapping(lidJid, phoneJid, '+33680940027', 'Merged Contact');
    store.upsertChat(phoneJid, 'Merged Contact', false, now - 200, 'p');
    store.upsertChat(lidJid, 'Merged Contact', false, now, 'l');

    store.addMessage({
      id: 'a',
      chatJid: phoneJid,
      senderJid: phoneJid,
      senderName: 'Merged Contact',
      body: 'from phone',
      timestamp: now - 60,
      isFromMe: true,
      hasMedia: false,
      mediaType: null
    });
    store.addMessage({
      id: 'b',
      chatJid: lidJid,
      senderJid: lidJid,
      senderName: 'Merged Contact',
      body: 'from lid',
      timestamp: now - 120,
      isFromMe: true,
      hasMedia: false,
      mediaType: null
    });

    const unified = store.getAllChatsUnified();
    const row = unified.find((c) => c.jid === lidJid);
    assert.ok(row);
    assert.equal(row!.message_count, 2);
    assert.equal(row!.messages_last_hour, 2);
  });

  it('listChatsWithStats uses the same name filter as listChats (custom names)', () => {
    initEncryption(null);
    const store = new MessageStore(':memory:');
    const jid = '777766665555@lid';
    store.upsertChat(jid, null, false, 1000, 'm');
    store.setCustomContactName(jid, 'CustomStatName');
    store.addMessage({
      id: 'z',
      chatJid: jid,
      senderJid: jid,
      senderName: null,
      body: 'x',
      timestamp: 1000,
      isFromMe: true,
      hasMedia: false,
      mediaType: null
    });
    const rows = store.listChatsWithStats({ filter: 'CustomStat', limit: 20, offset: 0 });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].message_count, 1);
  });
});
