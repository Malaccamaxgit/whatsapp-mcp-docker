/**
 * Custom contact names (set_contact_name) — store resolution and priority
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MessageStore } from '../../src/whatsapp/store.js';
import { initEncryption } from '../../src/security/crypto.js';

describe('custom contact names (MessageStore)', () => {
  it('getDisplayNameForJid prefers custom name over chat name', () => {
    initEncryption(null);
    const store = new MessageStore(':memory:');
    const jid = '138053771370743@lid';
    store.upsertChat(jid, 'WhatsApp Push', false, 1000, 'Hi');
    assert.equal(store.getDisplayNameForJid(jid), 'WhatsApp Push');
    store.setCustomContactName(jid, 'Kapso AI');
    assert.equal(store.getDisplayNameForJid(jid), 'Kapso AI');
  });

  it('clears custom name with empty string', () => {
    initEncryption(null);
    const store = new MessageStore(':memory:');
    const jid = '15145551234@s.whatsapp.net';
    store.upsertChat(jid, 'John', false, 1000, 'Hi');
    store.setCustomContactName(jid, 'Johnny');
    assert.equal(store.getDisplayNameForJid(jid), 'Johnny');
    store.setCustomContactName(jid, '');
    assert.equal(store.getDisplayNameForJid(jid), 'John');
  });

  it('resolves custom name from mapped alternate JID (LID ↔ phone)', () => {
    initEncryption(null);
    const store = new MessageStore(':memory:');
    const lidJid = '44612043436101@lid';
    const phoneJid = '33680940027@s.whatsapp.net';
    store.upsertContactMapping(lidJid, phoneJid, '+33680940027', 'Mapped');
    store.upsertChat(lidJid, null, false, 1000, 'x');
    store.setCustomContactName(phoneJid, 'Alias Name');
    assert.equal(store.getDisplayNameForJid(lidJid), 'Alias Name');
  });

  it('listChats filter matches custom_contact_names.name', () => {
    initEncryption(null);
    const store = new MessageStore(':memory:');
    const jid = '999888777666@lid';
    store.upsertChat(jid, null, false, 1000, 'm');
    store.setCustomContactName(jid, 'UniqueFilterLabel');
    const rows = store.listChats({ filter: 'UniqueFilter', limit: 20, offset: 0 });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].jid, jid);
  });
});
